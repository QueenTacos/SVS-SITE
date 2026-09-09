// ---------------------------------------------------------------------------
// app.js — router + page renderers for the State Combat Analytics clone.
// Vanilla JS, no build step. Routes are hash-based: #/, #/svs, #/feedback,
// #/admin, plus stub pages for planned tools (#/bears, #/championship).
// ---------------------------------------------------------------------------

// Store.init() is async (it awaits the initial Supabase fetch when a
// shared backend is configured — see data.js; it resolves on the next
// microtask, effectively synchronously, in plain localStorage mode). Every
// boot path below waits on this same promise before the first render, so
// the app never renders against an empty/default cache while that fetch
// is still in flight.
const storeReady = Store.init();

const ROUTES = {
  "/": renderHome,
  "/svs": renderSvS,
  "/rookie-off": renderRookieOff,
  "/feedback": renderFeedback,
  "/admin": renderAdmin,
  "/championship": renderChampionship,
};
// wire up stub routes for planned tools
PLANNED_TOOLS.forEach((t) => {
  ROUTES["/" + t.id] = (el) => renderComingSoon(el, t);
});

function currentPath() {
  const h = location.hash.replace(/^#/, "");
  return h || "/";
}

function navigate(path) {
  location.hash = path;
}

// Display label for a stored role value. The data/permissions layer still
// uses "officer" internally (role checks, filters, etc. all stay as-is) —
// this only changes what shows up in the UI, matching the alliance-rank
// naming ("R4") the game itself uses.
function roleLabel(role) {
  if (role === "officer") return "R4";
  return role || "member";
}

function fmtNum(n) {
  n = Number(n) || 0;
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n);
}

// ---------------------------------------------------------------------------
// Shell: topbar (with admin link) + bottom nav + router outlet
// ---------------------------------------------------------------------------
function renderShell() {
  const st = Store.state;
  const user = Store.currentUser;
  document.getElementById("shell").innerHTML = `
    <div class="topbar">
      <a href="#/" class="brand">
        <span class="name">STATE-${st.stateNumber}</span>
        <span class="ver">${st.version}</span>
      </a>
      ${isAdmin(user) ? `<a href="#/admin" class="signin" style="color:var(--accent-gold);">⚙ admin</a>` : `<span></span>`}
      <div class="clock" id="clock">--:-- <span class="tz">UTC</span></div>
      ${
        user
          ? `<div class="who">◇ ${user.name}<button id="signOutBtn">sign out</button></div>`
          : `<button class="signin" id="signInBtn">◇ sign in</button>`
      }
    </div>
    <main id="app"></main>
    <nav class="bottom-nav">
      <a href="#/" data-path="/">◆<br/>home</a>
      <a href="#/svs" data-path="/svs">▶<br/>svs</a>
      ${isAdmin(user) ? `<a href="#/admin" data-path="/admin">⚙<br/>admin</a>` : ""}
    </nav>
  `;
  document.getElementById("signInBtn")?.addEventListener("click", openSignIn);
  document.getElementById("signOutBtn")?.addEventListener("click", () => {
    // Flush any pending debounced draft save first — svsWizardTargetUser()
    // (and so the draft's owner id) can no longer be resolved once
    // currentUser is cleared.
    flushDraftAutosave();
    Store.currentUser = null;
    renderShell();
    router();
  });
  // Any real nav click (topbar/bottom-nav) ends an in-progress admin edit
  // of someone else's bag — otherwise it'd silently stick around and hijack
  // the next visit to MY BAG. The Admin "Edit" button navigates
  // programmatically instead of via one of these anchors, so it's unaffected.
  // Flush first — svsWizardTargetUser() needs svsEditingMemberId intact to
  // resolve the member actually being edited, not the admin's own id.
  document.querySelectorAll(".topbar a, .bottom-nav a").forEach((a) =>
    a.addEventListener("click", () => { flushDraftAutosave(); svsEditingMemberId = null; })
  );
  tickClock();
}

function tickClock() {
  const el = document.getElementById("clock");
  if (!el) return;
  const now = new Date();
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  el.innerHTML = `${hh}:${mm} <span class="tz">UTC</span>`;
}
setInterval(tickClock, 15000);

function router() {
  const path = currentPath();
  const container = document.getElementById("app");
  if (!container) return;
  document
    .querySelectorAll(".bottom-nav a")
    .forEach((a) => a.classList.toggle("active", a.dataset.path === path));
  const renderer = ROUTES[path] || renderHome;
  container.innerHTML = "";
  renderer(container);
}

window.addEventListener("hashchange", () => { storeReady.then(() => { renderShell(); router(); }); });
window.addEventListener("DOMContentLoaded", () => {
  storeReady.then(() => {
    renderShell();
    router();
  });
});

// ---------------------------------------------------------------------------
// Sign-in modal (local identity only — see README for real auth)
// ---------------------------------------------------------------------------
// Sign-in requires an existing account (matched by chief name OR Gamer ID)
// plus its exact 4-digit PIN — there's no "type any PIN to claim this
// account" fallback, so a member's data can't be reached by guessing a
// name that happens to belong to someone else. A brand-new member instead
// uses the "New Member" tab to create their own account (Gamer Name,
// Alliance Tag, Gamer ID, PIN) up front. An account with no PIN set (e.g.
// one an admin added without setting one) simply can't sign in until an
// admin sets a PIN for it from Admin → Members → Reset PIN.
function openSignIn() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <button class="close">&times;</button>
      <h3>Sign in</h3>
      <div class="tabs" style="margin-bottom:2px;">
        <button data-authtab="login" class="active">Existing Member</button>
        <button data-authtab="signup">New Member</button>
      </div>
      <div id="authPane"></div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector(".close").onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const pane = overlay.querySelector("#authPane");
  const tabBtns = overlay.querySelectorAll("[data-authtab]");
  const showTab = (tab) => {
    tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.authtab === tab));
    if (tab === "signup") renderSignUpPane(pane, overlay);
    else renderLoginPane(pane, overlay);
  };
  tabBtns.forEach((b) => b.addEventListener("click", () => showTab(b.dataset.authtab)));
  showTab("login");
}

function renderLoginPane(pane, overlay) {
  pane.innerHTML = `
    <p style="color:var(--text-dim);font-size:12px;margin-top:8px;">Sign in with your chief name or Gamer ID, plus your 4-digit PIN.</p>
    <input id="siName" placeholder="Chief name or Gamer ID..." list="memberList" />
    <datalist id="memberList">
      ${Store.members.map((m) => `<option value="${m.name}">`).join("")}
    </datalist>
    <input id="siPin" placeholder="4-digit PIN..." inputmode="numeric" maxlength="4" style="letter-spacing:.3em;" />
    <div id="siErr" style="color:var(--accent-red);font-size:11.5px;margin-top:-4px;min-height:28px;"></div>
    <button class="btn primary" id="siGo" style="width:100%;">Sign in</button>
  `;
  const errEl = pane.querySelector("#siErr");
  const pinInput = pane.querySelector("#siPin");
  pinInput.addEventListener("input", () => {
    pinInput.value = pinInput.value.replace(/\D/g, "").slice(0, 4);
  });
  const go = () => {
    const idOrName = pane.querySelector("#siName").value.trim();
    const pin = pinInput.value.trim();
    errEl.textContent = "";
    if (!idOrName) { errEl.textContent = "Enter your chief name or Gamer ID."; return; }
    if (!/^\d{4}$/.test(pin)) { errEl.textContent = "PIN must be exactly 4 digits."; return; }

    const members = Store.members;
    const member = members.find(
      (m) =>
        m.name.toLowerCase() === idOrName.toLowerCase() ||
        (m.gamerId && m.gamerId.toLowerCase() === idOrName.toLowerCase())
    );

    if (!member) {
      errEl.textContent = 'No account found with that name or Gamer ID. Use "New Member" above to create one.';
      return;
    }
    if (!member.pin) {
      errEl.textContent = "This account doesn't have a PIN set yet — ask an admin to set one from Admin → Members.";
      return;
    }
    if (member.pin !== pin) {
      errEl.textContent = "Incorrect PIN.";
      return;
    }

    Store.currentUser = member;
    overlay.remove();
    renderShell();
    router();
  };
  pane.querySelector("#siGo").onclick = go;
  pinInput.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
}

function renderSignUpPane(pane, overlay) {
  pane.innerHTML = `
    <p style="color:var(--text-dim);font-size:12px;margin-top:8px;">Create your account — this PIN will be required on every future sign-in.</p>
    <input id="suName" placeholder="Gamer name..." />
    <input id="suAlliance" placeholder="Alliance tag (e.g. SYP)..." />
    <input id="suGamerId" placeholder="Gamer ID..." />
    <input id="suPin" placeholder="Create a 4-digit PIN..." inputmode="numeric" maxlength="4" style="letter-spacing:.3em;" />
    <div id="suErr" style="color:var(--accent-red);font-size:11.5px;margin-top:-4px;min-height:28px;"></div>
    <button class="btn primary" id="suGo" style="width:100%;">Create account</button>
  `;
  const errEl = pane.querySelector("#suErr");
  const pinInput = pane.querySelector("#suPin");
  pinInput.addEventListener("input", () => {
    pinInput.value = pinInput.value.replace(/\D/g, "").slice(0, 4);
  });
  const go = () => {
    const name = pane.querySelector("#suName").value.trim();
    const alliance = pane.querySelector("#suAlliance").value.trim();
    const gamerId = pane.querySelector("#suGamerId").value.trim();
    const pin = pinInput.value.trim();
    errEl.textContent = "";
    if (!name) { errEl.textContent = "Enter your gamer name."; return; }
    if (!alliance) { errEl.textContent = "Enter your alliance tag."; return; }
    if (!gamerId) { errEl.textContent = "Enter your Gamer ID."; return; }
    if (!/^\d{4}$/.test(pin)) { errEl.textContent = "PIN must be exactly 4 digits."; return; }

    const members = Store.members;
    const nameTaken = members.some((m) => m.name.toLowerCase() === name.toLowerCase());
    const idTaken = members.some((m) => m.gamerId && m.gamerId.toLowerCase() === gamerId.toLowerCase());
    if (nameTaken || idTaken) {
      errEl.textContent = 'An account with that name or Gamer ID already exists — use "Existing Member" to sign in instead.';
      return;
    }

    const member = { id: "m" + Date.now(), name, gamerId, alliance, role: "member", pin };
    Store.members = [...members, member];
    Store.currentUser = member;
    overlay.remove();
    renderShell();
    router();
  };
  pane.querySelector("#suGo").onclick = go;
  pinInput.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
}

// ---------------------------------------------------------------------------
// HOME
// ---------------------------------------------------------------------------
function renderHome(el) {
  const st = Store.state;
  const publishedSection = renderPublishedScheduleByAlliance();

  el.innerHTML = `
    <div class="section-label">▸ STATE ${st.stateNumber} OPERATIONS</div>
    <div class="section-label">▸ OPERATIONS</div>
    <div class="grid2">
      ${opCard({
        href: "#/svs", color: "var(--accent-purple)", title: "svs_prep",
        desc: "Backpack, optimiser, schedule.",
        meta: `SVS ${st.svsDate} · MAX FURNACE FC${st.maxFurnaceLevel || "—"}`,
      })}
      ${opCard({
        href: "#/rookie-off", color: "var(--accent-pink)", title: "rookie_off",
        desc: "T1 troop promotion leaderboard — pulled from MY BAG.",
        meta: "TROOP DAY CONTEST",
      })}
      ${opCard({
        href: "#/feedback", color: "var(--accent-orange)", title: "feedback",
        desc: "Post, vote, and track ideas & bugs.",
        meta: "TELL US WHAT'S MISSING", plus: true,
      })}
      ${opCard({
        href: "#/championship", color: "var(--accent-green)", title: "championship",
        desc: "Alliance Championship lane planner — import players, auto-balance lanes.",
        meta: `${Store.championship.players.length} PLAYERS IMPORTED`,
      })}
      ${PLANNED_TOOLS.map((t) =>
        opCard({
          href: "#/" + t.id, color: t.color, title: t.title,
          desc: t.desc, meta: "COMING SOON", dim: true,
        })
      ).join("")}
    </div>

    ${publishedSection}

    <div class="section-label">▸ DATABASE</div>
    <div class="stat-row">
      <div class="stat-card">
        <div class="label">MEMBERS</div>
        <div class="value">${Store.members.length}</div>
        <div class="sub">REGISTERED</div>
      </div>
      <div class="stat-card">
        <div class="label">SUBMISSIONS</div>
        <div class="value">${Store.feedback.length}</div>
        <div class="sub">FEEDBACK ITEMS</div>
      </div>
      <div class="stat-card">
        <div class="label">SLOTS FILLED</div>
        <div class="value">${countFilledSlots()}</div>
        <div class="sub">SVS PREP</div>
      </div>
    </div>
  `;
}

// Home page "▸ SVS SCHEDULE" section — only the days an admin has published,
// grouped by alliance so each alliance can see its own finalized assignments
// at a glance. Returns "" (renders nothing) until at least one day is live.
function renderPublishedScheduleByAlliance() {
  const published = Store.schedulePublished;
  const publishedDays = SEED_SCHEDULE_DAYS.filter((d) => published[d]);
  if (!publishedDays.length) return "";

  const sched = Store.schedule;
  const alliances = Store.alliances;
  const membersById = Object.fromEntries(Store.members.map((m) => [m.id, m]));

  const allianceBlocks = alliances
    .map((tag) => {
      const rows = [];
      publishedDays.forEach((day) => {
        (sched[day] || []).forEach((s) => {
          if (!s.member) return;
          const m = membersById[s.member.id];
          if (!m || m.alliance !== tag) return;
          rows.push({ day, time: s.time, name: s.member.name, pts: pointsForMemberOnDay(s.member.id, day) });
        });
      });
      if (!rows.length) return "";
      return `
        <div class="panel" style="background:var(--panel-2);">
          <div class="planner-header"><strong>${escapeHtml(tag)}</strong><span class="eyebrow">${rows.length} SLOT${rows.length === 1 ? "" : "S"}</span></div>
          <div style="display:flex;flex-direction:column;gap:4px;">
            ${rows
              .map(
                (r) => `
              <div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border);">
                <span style="color:var(--text-dim);">${escapeHtml(r.day)} · ${r.time}</span>
                <span>${escapeHtml(r.name)} <span style="color:var(--accent-amber);">· ${fmtNum(r.pts)} pts</span></span>
              </div>`
              )
              .join("")}
          </div>
        </div>`;
    })
    .filter(Boolean)
    .join("");

  return `
    <div class="section-label">▸ SVS SCHEDULE — PUBLISHED</div>
    <div class="grid2">
      ${allianceBlocks || `<div class="panel" style="color:var(--text-dim);font-size:12px;">Published, but no slots are assigned yet.</div>`}
    </div>
  `;
}

// Maps a schedule day label ("Day 1 — Construction") to its matching
// BAG_SECTIONS entry ("D1 — CONSTRUCTION DAY") so the schedule can show
// each member's score for the specific day they're being scheduled on.
function bagSectionForScheduleDay(day) {
  const m = /Day (\d+)/.exec(day || "");
  if (!m) return null;
  return BAG_SECTIONS.find((s) => s.title.startsWith(`D${m[1]} `)) || null;
}

function pointsForMemberOnDay(memberId, day) {
  const section = bagSectionForScheduleDay(day);
  if (!section) return 0;
  const sub = Store.bagSubmissions[memberId];
  if (!sub) return 0;
  const { bySection } = computeBagPoints(sub.values);
  const found = bySection.find((s) => s.title === section.title);
  return found ? found.points : 0;
}

// Which schedule day (by its label) is which SvS day — Construction,
// Research, and Troop Training all gate whether a member can produce
// anything during their window on banked speedup minutes (General
// wildcard minutes count too — see generalSpeedupSuggestion in data.js).
function isConstructionDay(day) {
  return /construction/i.test(day || "");
}
function isResearchDay(day) {
  return /research/i.test(day || "");
}
function isTroopDay(day) {
  return /troop/i.test(day || "");
}

// Troop Day eligibility: needs at least some troop-training/promotion
// speedup minutes banked (sp_troop_train, entered on D4 — Troop Training,
// auto-filled from the top-level Troop speedup field) — or General
// wildcard minutes standing in for them — to actually train/promote
// anything during the window.
function troopDayEligible(values) {
  return Number(values?.sp_troop_train) > 0 || Number(values?.sp_general) > 0;
}

// Single dispatcher covering all three gated days, so slot-locking logic
// (availableMembersForSlot, renderWizardTimeSlots) doesn't need a special
// case per day.
function dayEligible(day, values) {
  if (isConstructionDay(day)) return typeof constructionDayEligible === "function" ? constructionDayEligible(values) : true;
  if (isResearchDay(day)) return typeof researchDayEligible === "function" ? researchDayEligible(values) : true;
  if (isTroopDay(day)) return troopDayEligible(values);
  return true;
}
function isGatedDay(day) {
  return isConstructionDay(day) || isResearchDay(day) || isTroopDay(day);
}

function countFilledSlots() {
  const sched = Store.schedule;
  return Object.values(sched).reduce((sum, day) => sum + day.filter((s) => s.member).length, 0);
}

// Members who marked themselves available for this day/slot-index on their
// SvS prep → MY BAG → TIME SLOTS submission (separate from the single
// "assigned" chief on the schedule grid — this is everyone who said they
// could be online).
function availableMembersForSlot(day, i) {
  const subs = Store.bagSubmissions;
  const members = Store.members;
  return Object.entries(subs)
    .filter(([memberId, sub]) => {
      // Count a slot as available if it was ever marked under EITHER
      // availability mode, not just whichever mode the submission ended up
      // on. A member can tap a slot under "ALL DAYS", then click over to
      // "BY DAY" just to look before submitting — that switches
      // availabilityType but the earlier tap is still sitting in
      // slots.all and should still count.
      const onAll = !!sub.slots?.all?.[i];
      const onDay = !!sub.slots?.byDay?.[day]?.[i];
      if (!(onAll || onDay)) return false;
      // Construction/Research/Troop Day are the exception: no open
      // opportunity + banked speedups (own or General wildcard) means no
      // real capacity to produce anything during the window, so they don't
      // surface as available no matter what they tapped.
      if (isGatedDay(day) && !dayEligible(day, sub.values)) return false;
      return true;
    })
    .map(([memberId]) => members.find((m) => m.id === memberId))
    .filter(Boolean);
}

// Any edit to a day's schedule — a manual pick, RESET, or OPTIMIZE —
// invalidates a previously-published version of that day: the exported
// copy would no longer match what's actually assigned. Publishing stays
// a separate, explicit action (togglePublish), so this only ever turns
// PUBLISHED back to DRAFT, never the other way.
function unpublishDayOnEdit(day) {
  const p = Store.schedulePublished;
  if (p[day]) {
    p[day] = false;
    Store.schedulePublished = p;
  }
}

// Did this member tap ANY slot for this day — under "ALL DAYS" (which
// covers every day at once) or "BY DAY" for this specific day? This is
// the raw "did they submit availability at all" signal, independent of
// whether any of those particular slots are still open — that's what
// separates it from availableMembersForSlot, which is asking about one
// specific slot's eligibility.
function memberTappedAnySlotForDay(day, sub) {
  if (!sub) return false;
  const all = sub.slots?.all;
  const byDay = sub.slots?.byDay?.[day];
  return (Array.isArray(all) && all.some(Boolean)) || (Array.isArray(byDay) && byDay.some(Boolean));
}

// Shared manual-assignment logic for BOTH the main slot grid's dropdown
// and the Unassigned Players section's dropdown: clears any other slot
// the member is already sitting in that same day (never let one member
// hold two slots at once), places them (or clears the slot, if memberId
// is falsy), marks the result manual (locked against RESET/OPTIMIZE), and
// flips the day back to draft if it had been published — a schedule
// that's just been hand-edited no longer matches what was published.
function manualAssignMember(day, slotIdx, memberId) {
  const s = Store.schedule;
  if (!memberId) {
    s[day][slotIdx].member = null;
    s[day][slotIdx].manual = false;
  } else {
    const dupeSlot = s[day].find((slot, j) => j !== slotIdx && slot.member?.id === memberId);
    if (dupeSlot) { dupeSlot.member = null; dupeSlot.manual = false; }
    const m = Store.members.find((mm) => mm.id === memberId);
    s[day][slotIdx].member = m ? { id: m.id, name: m.name } : null;
    s[day][slotIdx].manual = !!m;
  }
  Store.schedule = s;
  unpublishDayOnEdit(day);
}

// Members who are eligible to play on this day and have real points on
// the line, but never tapped a single time slot for it — "zero slots
// selected" is treated as availability UNKNOWN, never as "available for
// everything." They're deliberately kept out of the optimizer pool (see
// optimizeScheduleForDay below) and can only be scheduled by an admin
// manually confirming their availability outside the app and picking a
// slot for them here.
function unassignedPlayersForDay(day) {
  const subs = Store.bagSubmissions;
  const schedDay = Store.schedule[day] || [];
  return Store.members
    .filter((m) => {
      const sub = subs[m.id];
      if (!sub) return false;
      if (isGatedDay(day) && !dayEligible(day, sub.values)) return false;
      if (memberTappedAnySlotForDay(day, sub)) return false;
      return pointsForMemberOnDay(m.id, day) > 0;
    })
    .map((m) => ({
      member: m,
      points: pointsForMemberOnDay(m.id, day),
      currentSlotIdx: schedDay.findIndex((s) => s.member?.id === m.id),
    }))
    .sort((a, b) => b.points - a.points);
}

// Checks a not-yet-saved availability draft against a member's CURRENT
// schedule assignments. Changing availability (whether the member does it
// themselves, or an admin does it for them via Edit Bag) never touches the
// schedule automatically — but if a day they're currently assigned to no
// longer has that slot ticked in the new draft, that's worth flagging
// before saving rather than letting it slide by silently.
function scheduleMismatchWarnings(user, draft) {
  const warnings = [];
  SEED_SCHEDULE_DAYS.forEach((day) => {
    const daySlots = Store.schedule[day] || [];
    const idx = daySlots.findIndex((s) => s.member?.id === user.id);
    if (idx === -1) return;
    const stillAvailable =
      draft.availabilityType === "all"
        ? !!draft.slots.all[idx]
        : !!(draft.slots.byDay[day] || [])[idx];
    if (!stillAvailable) warnings.push({ day, time: daySlots[idx].time });
  });
  return warnings;
}

// Reset this day's schedule, but leave every manually-assigned slot
// (s.manual === true) untouched — those were an admin's deliberate pick
// and clearing the day shouldn't silently undo them. Everything else
// (empty slots, and anything the OPTIMIZE button placed) gets cleared.
function resetScheduleForDay(day) {
  const sched = Store.schedule;
  sched[day] = sched[day].map((s) => (s.manual && s.member ? s : { time: s.time, member: null, manual: false }));
  Store.schedule = sched;
  unpublishDayOnEdit(day);
}

// Auto-assign every eligible, signed-up member to a slot on this day so
// the total points across all filled slots is as high as possible.
// Manually-assigned slots (and the members sitting in them) are locked —
// they're left alone and excluded from the pool entirely. A member's
// point value for the day is the same no matter which of their signed-up
// slots they land in (points come from their bag submission, not the
// slot itself), so maximizing the total reduces to: fit as many of the
// highest-point members as possible into the remaining open slots, each
// only in a slot they actually signed up for.
//
// This is solved as maximum-weight bipartite matching via the standard
// trick for "one weight per left-node" graphs: process members in
// descending point order and run an augmenting-path search (Kuhn's
// algorithm) for each — a member already placed can be bumped to a
// different one of their own available slots to make room for a
// higher-priority member, but since higher-priority members are always
// placed first and never removed once matched, the running total can
// only go up, which yields the maximum achievable total.
function optimizeScheduleForDay(day) {
  const slots = Store.schedule[day];
  const openIdxs = slots.map((s, i) => i).filter((i) => !(slots[i].manual && slots[i].member));
  const lockedMemberIds = new Set(
    slots.filter((s) => s.manual && s.member).map((s) => s.member.id)
  );
  const openIdxSet = new Set(openIdxs);
  const candidates = Store.members
    .filter((m) => !lockedMemberIds.has(m.id))
    .map((m) => ({
      id: m.id,
      name: m.name,
      points: pointsForMemberOnDay(m.id, day),
      slots: openIdxs.filter((i) => availableMembersForSlot(day, i).some((am) => am.id === m.id)),
    }))
    .filter((c) => c.slots.length > 0)
    .sort((a, b) => b.points - a.points);

  const bySlot = {}; // slotIdx -> candidate object
  function augment(candidate, visited) {
    for (const slotIdx of candidate.slots) {
      if (visited.has(slotIdx)) continue;
      visited.add(slotIdx);
      const occupant = bySlot[slotIdx];
      if (!occupant || augment(occupant, visited)) {
        bySlot[slotIdx] = candidate;
        return true;
      }
    }
    return false;
  }
  candidates.forEach((c) => augment(c, new Set()));

  const sched = Store.schedule;
  openIdxSet.forEach((i) => {
    const match = bySlot[i];
    sched[day][i] = { time: slots[i].time, member: match ? { id: match.id, name: match.name } : null, manual: false };
  });
  Store.schedule = sched;
  unpublishDayOnEdit(day);
}

function opCard({ href, color, title, desc, meta, plus, dim }) {
  return `
    <a href="${href}" class="card op-card clickable" style="--accent:${color};${dim ? "opacity:.6;" : ""}">
      <h3>${title} <span style="color:${color}">${plus ? "+" : "▶"}</span></h3>
      <p>${desc}</p>
      <div class="meta">${meta}</div>
    </a>
  `;
}

function renderComingSoon(el, tool) {
  el.innerHTML = `
    <div class="eyebrow">// PLANNED TOOL</div>
    <h1 class="page-title" style="color:${tool.color}">${tool.title}</h1>
    <div class="panel gate">
      <p>${tool.desc}</p>
      <p style="font-size:12px;">Not built yet — this is a placeholder route so the card has somewhere to link to. Build it out in <code>app.js</code> (add a renderer) and <code>data.js</code> (add its data) when you're ready.</p>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// SVS PREP
// ---------------------------------------------------------------------------
let svsTab = "request";
let svsDay = SEED_SCHEDULE_DAYS[0];
let svsWizardStep = "backpack";
let svsWizardDayTab = SEED_SCHEDULE_DAYS[0];
let svsDraft = null;
// The EXPORT DAY overlay's own filters — { day, range: "full"|"first"|"second",
// alliance: "" | tag }. Null when the overlay is closed.
let exportModalState = null;
// When an admin opens someone else's bag from Admin → Bag submissions →
// Edit, this holds that member's id and the wizard below edits their
// submission instead of the signed-in admin's own.
let svsEditingMemberId = null;

function svsWizardTargetUser() {
  if (svsEditingMemberId) {
    // Defense in depth: even if svsEditingMemberId got set some other way
    // (stale state, a direct console poke), a non-admin never actually
    // opens someone else's bag through this — it silently falls back to
    // their own.
    if (!canEditMemberBag(Store.currentUser)) {
      svsEditingMemberId = null;
      return Store.currentUser;
    }
    const m = Store.members.find((mm) => mm.id === svsEditingMemberId);
    if (m) return m;
    svsEditingMemberId = null; // target member was deleted mid-edit
  }
  return Store.currentUser;
}

// Every slot on this page is UTC only — no per-member local-time picker.
// That's deliberate: mixed timezones on a shared schedule is how slots get
// double-booked or missed, so everyone reads and books off the same clock.
const FIXED_TIMEZONE = "UTC";

// Only the top admin role manages/sees the schedule page — officers are
// treated like regular members here (they still get the admin page link
// elsewhere via isAdmin(), this is specifically about the SCHEDULE tab).
function canSeeSchedule(user) {
  return !!user && user.role === "admin";
}

// Opening and editing ANOTHER member's bag (values, time-slot availability,
// pins, gamer info) on their behalf is a full-admin-only power — R4/officer
// gets the rest of the Admin page (its own alliance's Members roster, Bag
// submissions read-only view) but not this. Checked both where the "Edit
// Bag" buttons are rendered (UI) and again at the point an edit is actually
// opened/saved (svsWizardTargetUser / the wizard's save action), so this
// can't be bypassed just by reaching the route with stale state.
function canEditMemberBag(user) {
  return !!user && user.role === "admin";
}

function renderSvS(el) {
  // The whole SvS page is behind login — logged-out visitors get a single
  // gate here instead of tabs with per-tab gates underneath.
  if (!Store.currentUser) {
    el.innerHTML = `
      <div class="panel" style="text-align:center;padding:32px 20px;">
        <div class="eyebrow" style="color:var(--accent-purple);margin-bottom:10px;">SIGN IN REQUIRED</div>
        <p style="font-size:12.5px;color:var(--text-dim);margin:0 0 16px;">SvS prep is for alliance members only. Sign in with your chief name and PIN to continue.</p>
        <button class="btn primary" id="svsGoSignIn">Sign in</button>
      </div>
    `;
    el.querySelector("#svsGoSignIn").onclick = openSignIn;
    return;
  }

  const scheduleAllowed = canSeeSchedule(Store.currentUser);
  if (svsTab === "schedule" && !scheduleAllowed) svsTab = "request";
  el.innerHTML = `
    <div class="tabs" style="--accent-active:var(--accent-purple)">
      <button data-t="request" class="${svsTab === "request" ? "active" : ""}">MY BAG</button>
      <button data-t="mysub" class="${svsTab === "mysub" ? "active" : ""}">MY SUBMISSION</button>
      <button data-t="mypoints" class="${svsTab === "mypoints" ? "active" : ""}">MY POINTS</button>
      ${scheduleAllowed ? `<button data-t="schedule" class="${svsTab === "schedule" ? "active" : ""}">SCHEDULE</button>` : ""}
    </div>
    <div id="svsBody"></div>
  `;
  el.querySelectorAll(".tabs button").forEach((b) =>
    b.addEventListener("click", () => { svsTab = b.dataset.t; if (svsTab === "request") svsWizardStep = svsWizardStep || "backpack"; renderSvS(el); })
  );
  const body = el.querySelector("#svsBody");
  if (svsTab === "request") renderSvSWizard(body);
  else if (svsTab === "mysub") renderSvSMySubmission(body);
  else if (svsTab === "mypoints") renderSvSMyPoints(body);
  else if (scheduleAllowed) renderSvSSchedule(body);
  else renderSvSWizard(body);
}

function blankDraft() {
  return {
    values: {},
    timezone: FIXED_TIMEZONE,
    availabilityType: "all",
    slots: { all: Array(48).fill(false), byDay: SEED_SCHEDULE_DAYS.reduce((a, d) => ((a[d] = Array(48).fill(false)), a), {}) },
    notes: "",
    updatedAt: null,
  };
}

function loadDraft(user) {
  // Prefer an in-progress autosaved draft (Store.bagDrafts) over the last
  // official submission (Store.bagSubmissions) — it's the more recent
  // in-flight edit. Falls back to the last submission (so re-opening MY
  // BAG to make changes still starts from what was actually submitted),
  // then to a blank form for a brand-new member.
  const existing = Store.bagDrafts[user.id] || Store.bagSubmissions[user.id];
  if (existing) {
    // fill in any structure gaps (e.g. new schedule days) without losing saved data
    const d = blankDraft();
    return {
      ...d,
      ...existing,
      slots: {
        all: existing.slots?.all || d.slots.all,
        byDay: { ...d.slots.byDay, ...(existing.slots?.byDay || {}) },
      },
    };
  }
  return blankDraft();
}

// ---------------------------------------------------------------------------
// Auto-save the in-progress MY BAG wizard (svsDraft) as a draft, debounced
// so rapid typing doesn't fire a write per keystroke. Keyed by whichever
// member the wizard is currently editing (svsWizardTargetUser() — normally
// the signed-in member themselves, or the member an admin is editing on
// their behalf), so a draft only ever lands under its own owner's id and
// is only ever read back for that same id — one member can't see another
// member's in-progress draft. Resolves the target user at fire time (not
// schedule time) so it can't write to a stale id if the wizard's context
// changed in between.
// ---------------------------------------------------------------------------
let draftSaveTimer = null;
const DRAFT_SAVE_DEBOUNCE_MS = 700;

function scheduleDraftAutosave() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = setTimeout(() => {
    draftSaveTimer = null;
    flushDraftAutosave();
  }, DRAFT_SAVE_DEBOUNCE_MS);
}

// Writes the pending draft immediately (skipping the debounce delay) —
// used right before anything that could otherwise lose the last few
// un-debounced keystrokes: the page unloading, or the current user
// signing out mid-edit.
function flushDraftAutosave() {
  clearTimeout(draftSaveTimer);
  draftSaveTimer = null;
  const user = svsWizardTargetUser();
  if (!user || !svsDraft) return;
  const drafts = Store.bagDrafts;
  drafts[user.id] = svsDraft;
  Store.bagDrafts = drafts;
}

window.addEventListener("beforeunload", flushDraftAutosave);
// Mobile browsers (notably iOS Safari) often skip beforeunload on tab
// close/switch — pagehide is the reliable equivalent there.
window.addEventListener("pagehide", flushDraftAutosave);

function svsGate(el, msg) {
  el.innerHTML = `
    <div class="panel">
      <div class="eyebrow" style="color:var(--accent-purple);margin-bottom:10px;">SIGN IN TO SUBMIT</div>
      <button class="btn primary" id="goSignIn">${msg}</button>
    </div>
  `;
  el.querySelector("#goSignIn").onclick = openSignIn;
}

function renderSvSWizard(el) {
  const user = svsWizardTargetUser();
  if (!user) return svsGate(el, "Sign in to submit your bag");
  if (!svsDraft) svsDraft = loadDraft(user);

  const steps = [
    { id: "backpack", label: "BACKPACK" },
    { id: "review", label: "REVIEW" },
    { id: "timeslots", label: "TIME SLOTS" },
    { id: "submit", label: "SUBMIT" },
  ];
  const stepIdx = steps.findIndex((s) => s.id === svsWizardStep);

  el.innerHTML = `
    ${
      svsEditingMemberId
        ? `<div class="panel" style="background:rgba(255,176,32,.1);border-color:var(--accent-amber);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px;">
            <span style="font-size:12px;color:var(--accent-amber);">✎ Editing <strong>${escapeHtml(user.name)}</strong>'s bag as admin</span>
            <button class="btn small" id="exitEdit">Exit editing</button>
          </div>`
        : ""
    }
    <div class="panel">
      <div class="eyebrow" style="margin-bottom:2px;">svs_my_bag</div>
      <div style="font-size:12px;color:var(--text-dim);margin-bottom:14px;">SvS · ${Store.state.svsDate}</div>
      <div class="wizard-steps">
        ${steps
          .map(
            (s, i) => `
          <div class="step ${i === stepIdx ? "active" : ""} ${i < stepIdx ? "done" : ""}">
            <div class="bar"></div><div class="label">${s.label}</div>
          </div>`
          )
          .join("")}
      </div>
      <div id="wizardBody"></div>
    </div>
  `;
  if (svsEditingMemberId) {
    el.querySelector("#exitEdit").onclick = () => {
      // Flush before clearing svsEditingMemberId — otherwise the pending
      // save would resolve to the admin's own id instead of the member
      // actually being edited, since svsWizardTargetUser() falls back to
      // Store.currentUser once svsEditingMemberId is gone.
      flushDraftAutosave();
      svsEditingMemberId = null;
      svsDraft = null;
      svsWizardStep = "backpack";
      navigate("/admin");
    };
  }
  const body = el.querySelector("#wizardBody");
  if (svsWizardStep === "backpack") renderWizardBackpack(body, el);
  else if (svsWizardStep === "review") renderWizardReview(body, el);
  else if (svsWizardStep === "timeslots") renderWizardTimeSlots(body, el);
  else renderWizardSubmit(body, el);
}

// Stamina cans convert to 10 stamina each. Regular (Lv.26-30) beasts cost
// 10 stamina and score 12,000 pts; a Polar Terror rally costs 25 stamina
// and scores 30,000 pts. Given a stamina-can count, show plain text for
// what that stamina could actually buy either way, and which nets more
// points — this is informational only, the submitted score always uses
// the zero-waste beast rate (12,000/can) since beasts divide any stamina
// total evenly while Terror rallies can leave stamina stranded.
function staminaCalcHtml(cans) {
  const stamina = (Number(cans) || 0) * 10;
  const BEAST_COST = 10, BEAST_PTS = 12000;
  const TERROR_COST = 25, TERROR_PTS = 30000;
  if (!stamina) {
    return `<div class="rate" style="margin-top:6px;">Enter your stamina cans to see what that stamina can earn.</div>`;
  }
  const beasts = Math.floor(stamina / BEAST_COST);
  const terrors = Math.floor(stamina / TERROR_COST);
  const beastTotal = beasts * BEAST_PTS;
  const terrorTotal = terrors * TERROR_PTS;
  let verdict;
  if (beastTotal > terrorTotal) verdict = `Beasts earn ${fmtNum(beastTotal - terrorTotal)} more pts — no stamina left over.`;
  else if (terrorTotal > beastTotal) verdict = `Polar Terror rallies earn ${fmtNum(terrorTotal - beastTotal)} more pts.`;
  else verdict = "Both options earn the same total.";
  return `
    <div class="rate" style="margin-top:6px;line-height:1.6;">
      <div style="color:var(--text-faint);letter-spacing:.5px;font-size:10.5px;margin-bottom:4px;">OPTIMAL STAMINA USE FOR MOST POINTS</div>
      ${fmtNum(stamina)} stamina from ${fmtNum(Number(cans) || 0)} can${Number(cans) === 1 ? "" : "s"}<br>
      • Up to <strong style="color:var(--text);">${beasts}</strong> Lv.26-30 beasts → ${fmtNum(beastTotal)} pts<br>
      • Up to <strong style="color:var(--text);">${terrors}</strong> Polar Terror rallies (25 stamina each) → ${fmtNum(terrorTotal)} pts<br>
      <span style="color:var(--accent-amber);">${verdict}</span>
    </div>
  `;
}

// Lucky Wheel gems. Bundles (13,500 gems = 10 spins) are always the
// better per-spin rate than singles (1,500 gems = 1 spin), so gems get
// spent on bundles first with any remainder going to singles — same
// combo the score itself uses (luckyWheelPoints in data.js), so what's
// shown here always matches what's submitted.
function luckyWheelCalcHtml(gems) {
  gems = Number(gems) || 0;
  if (!gems) {
    return `<div class="rate" style="margin-top:6px;">Enter total gems spent on the Lucky Wheel to see spins and points. You also get 1 free spin/day for 3 days (24,000 pts total) — free, no gems needed.</div>`;
  }
  const bundles = Math.floor(gems / LUCKY_WHEEL_BUNDLE_COST);
  const remainder = gems - bundles * LUCKY_WHEEL_BUNDLE_COST;
  const singles = Math.floor(remainder / LUCKY_WHEEL_SINGLE_COST);
  const spins = luckyWheelSpins(gems);
  const points = spins * LUCKY_WHEEL_SPIN_PTS;
  const capped = bundles * LUCKY_WHEEL_BUNDLE_SPINS + singles > LUCKY_WHEEL_SPIN_CAP;
  return `
    <div class="rate" style="margin-top:6px;line-height:1.6;">
      <div style="color:var(--text-faint);letter-spacing:.5px;font-size:10.5px;margin-bottom:4px;">OPTIMAL GEM USE FOR MOST POINTS</div>
      ${fmtNum(gems)} gems<br>
      • ${bundles} bundle${bundles === 1 ? "" : "s"} of 10 (13,500 gems each) = ${bundles * LUCKY_WHEEL_BUNDLE_SPINS} spins<br>
      • ${singles} single spin${singles === 1 ? "" : "s"} from the ${fmtNum(remainder)} gems left over<br>
      <span style="color:var(--text);">= ${spins} spins${capped ? " (capped at the 150-spin event limit)" : ""} → ${fmtNum(points)} pts</span><br>
      <span style="color:var(--accent-amber);">+ 1 free spin/day for 3 days (24,000 pts total) — free, not counted above. If that day's free spin is still banked, buying a 10-pack that day only costs 12,000 gems instead of 13,500.</span>
    </div>
  `;
}

// Live status line under a "standout" speedup field (Construction,
// Research, Troop) — these numbers are what actually gate that day's time
// slot (dayEligible, above), so it's worth flagging right where they're
// entered rather than only discovering it on TIME SLOTS. Also surfaces the
// General-wildcard suggestion when it points at this day.
function dayStatusHtml(statusKey, values) {
  const suggestion = generalSpeedupSuggestion(values);
  // tone: "ok" (green, definitely eligible), "warn" (amber, "may be
  // eligible" — exactly one of two gates is maxed), or "closed" (red,
  // either 0 minutes banked or both gates maxed / no capacity at all).
  let tone, primary;
  if (statusKey === "construction") {
    const fullyMaxed = constructionFullyMaxed(values);
    const partiallyMaxed = constructionPartiallyMaxed(values);
    const mins = Number(values?.d1_construction) || 0;
    if (fullyMaxed) {
      tone = "closed";
      primary = "Furnace at the state's current cap AND War Academy maxed — Construction speedups score 0 pts. Day 1 points now come only from Chief Charm.";
    } else if (partiallyMaxed) {
      tone = mins > 0 ? "warn" : "closed";
      primary = mins > 0
        ? `${fmtNum(mins)} min banked — furnace cap or War Academy is maxed (not both), so this may be eligible for a Construction Day time slot.`
        : "Furnace cap or War Academy is maxed (not both) — bank Construction minutes and you may still be eligible for a Construction Day time slot.";
    } else {
      tone = mins > 0 ? "ok" : "closed";
      primary = mins > 0
        ? `${fmtNum(mins)} min banked — eligible for a Construction Day time slot.`
        : "0 minutes — no real capacity to build on Construction Day, and no Construction Day time slot (see TIME SLOTS).";
    }
  } else if (statusKey === "research") {
    const fullyMaxed = researchFullyMaxed(values);
    const partiallyMaxed = researchPartiallyMaxed(values);
    const mins = Number(values?.d2_research) || 0;
    if (fullyMaxed) {
      tone = "closed";
      primary = "War Academy Research AND Tech Research both maxed — Research speedups score 0 pts here. Fire Crystal Shards, sigils, books, and hero shards still count.";
    } else if (partiallyMaxed) {
      tone = mins > 0 ? "warn" : "closed";
      primary = mins > 0
        ? `${fmtNum(mins)} min banked — War Academy Research or Tech Research is maxed (not both), so this may be eligible for a Research Day time slot.`
        : "War Academy Research or Tech Research is maxed (not both) — bank Research minutes and you may still be eligible for a Research Day time slot.";
    } else {
      tone = mins > 0 ? "ok" : "closed";
      primary = mins > 0
        ? `${fmtNum(mins)} min banked — eligible for a Research Day time slot.`
        : "0 minutes — no real capacity to research on Research Day, and no Research Day time slot (see TIME SLOTS).";
    }
  } else {
    const ok = troopDayEligible(values);
    const mins = Number(values?.sp_troop_train) || 0;
    tone = ok ? "ok" : "closed";
    primary = ok
      ? `${fmtNum(mins)} min banked${mins === 0 ? " (from General wildcard)" : ""} — eligible for a Troop Day time slot.`
      : "0 minutes — no real capacity to promote troops on Troop Day, and no Troop Day time slot (see TIME SLOTS).";
  }
  const dayLabelForKey = { construction: "D1 — Construction", research: "D2 — Research", troop: "D4 — Troop" }[statusKey];
  const sub = suggestion && suggestion.day === dayLabelForKey
    ? `${suggestion.label} (${fmtNum(suggestion.mins)} mins of General speedups suggested to use)`
    : "";
  const toneColor = tone === "ok" ? "var(--accent-green)" : tone === "warn" ? "var(--accent-amber)" : "var(--accent-red)";
  const toneBg = tone === "ok" ? "rgba(62,207,142,.1)" : tone === "warn" ? "rgba(255,176,32,.1)" : "rgba(255,84,112,.1)";
  return `
    <div class="rate" style="margin-top:6px;padding:8px 10px;border-radius:6px;background:${toneBg};border:1px solid ${toneColor};color:${toneColor};">
      ${primary}
    </div>
    ${sub ? `<div class="rate" style="margin-top:4px;color:var(--accent-amber);">${sub}</div>` : ""}
  `;
}

function renderWizardBackpack(el, wrap) {
  el.innerHTML = `
    ${BAG_SECTIONS.map(
      (section) => `
      <div class="section-title">${section.title}</div>
      ${
        section.title === "SPEEDUPS"
          ? `<p style="font-size:11.5px;color:var(--text-dim);margin:-4px 0 12px;">Enter what you have banked — Construction, Research, and Troop auto-fill into their matching day below. <strong style="color:var(--text);">General</strong> is a wildcard: it can stand in for any of the three, spent wherever the opportunity is best.</p>`
          : ""
      }
      ${
        section.title === "D4 — TROOP TRAINING"
          ? `<p style="font-size:11.5px;color:var(--text-dim);margin:-4px 0 12px;"><strong style="color:var(--accent-amber);">Required:</strong> Troop Train / Promotion Speedups (below) — this is what determines your Troop Day slot. <strong style="color:var(--text);">Everything else on this page is optional</strong> — fill in whatever troop tiers you actually have.</p>`
          : ""
      }
      <div class="field-grid">
        ${section.fields
          .map((f) => {
            if (f.type === "select") {
              const opts = f.options === "furnaceFc" ? Store.furnaceFc : [];
              return `
              <div class="field">
                <label>${f.label}<span class="rate">${f.rateNote || ""}</span></label>
                <select data-field="${f.key}">
                  ${opts.map((o) => `<option ${svsDraft.values[f.key] === o ? "selected" : ""}>${o}</option>`).join("")}
                </select>
              </div>`;
            }
            if (f.type === "toggle") {
              const on = !!svsDraft.values[f.key];
              return `
              <div class="field">
                <label>${f.label}<span class="rate">${f.rateNote || ""}</span></label>
                <button type="button" data-toggle="${f.key}" class="btn${on ? " primary" : ""}" style="width:100%;">${on ? "✓ MAXED" : "NOT MAXED"}</button>
              </div>`;
            }
            const highlight = f.standout || f.wildcard;
            return `
            <div class="field" ${
              highlight
                ? `style="grid-column:1 / -1;background:rgba(255,176,32,.06);border:1px solid var(--accent-amber);border-radius:8px;padding:12px 14px;"`
                : ""
            }>
              <label>${f.label}${f.standout ? ` <span style="color:var(--accent-amber);font-size:10px;letter-spacing:1px;">★ REQUIRED</span>` : f.wildcard ? ` <span style="color:var(--accent-amber);font-size:10px;letter-spacing:1px;">★ WILDCARD</span>` : ""}<span class="rate">${f.rateNote || ""}</span></label>
              <div class="field-unit" style="${highlight ? "max-width:220px;" : ""}">
                <input type="number" min="0" ${f.max ? `max="${f.max}"` : ""} data-field="${f.key}" value="${svsDraft.values[f.key] ?? ""}" placeholder="0" />
                ${f.unit ? `<span class="unit-suffix">${f.unit}</span>` : ""}
              </div>
              ${f.staminaCalc ? `<div data-stamina-calc="${f.key}">${staminaCalcHtml(svsDraft.values[f.key])}</div>` : ""}
              ${f.gemsCalc ? `<div data-gems-calc="${f.key}">${luckyWheelCalcHtml(svsDraft.values[f.key])}</div>` : ""}
              ${f.statusKey ? `<div data-day-status="${f.key}">${dayStatusHtml(f.statusKey, svsDraft.values)}</div>` : ""}
            </div>`;
          })
          .join("")}
      </div>`
    ).join("")}
    <button class="btn primary" id="wizNext" style="margin-top:6px;">NEXT → REVIEW POINTS</button>
  `;
  el.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      svsDraft.values[btn.dataset.toggle] = !svsDraft.values[btn.dataset.toggle];
      scheduleDraftAutosave();
      renderWizardBackpack(el, wrap);
    });
  });
  el.querySelectorAll("[data-field]").forEach((input) => {
    const field = BAG_SECTIONS.flatMap((s) => s.fields).find((f) => f.key === input.dataset.field);
    const commitLocal = () => {
      svsDraft.values[input.dataset.field] = input.tagName === "SELECT" ? input.value : Number(input.value) || 0;
      if (field?.staminaCalc) {
        const calcEl = el.querySelector(`[data-stamina-calc="${field.key}"]`);
        if (calcEl) calcEl.innerHTML = staminaCalcHtml(svsDraft.values[field.key]);
      }
      if (field?.gemsCalc) {
        const calcEl = el.querySelector(`[data-gems-calc="${field.key}"]`);
        if (calcEl) calcEl.innerHTML = luckyWheelCalcHtml(svsDraft.values[field.key]);
      }
      if (field?.statusKey) {
        const statusEl = el.querySelector(`[data-day-status="${field.key}"]`);
        if (statusEl) statusEl.innerHTML = dayStatusHtml(field.statusKey, svsDraft.values);
      }
      scheduleDraftAutosave();
    };
    input.addEventListener("input", commitLocal);
    // On change (blur/enter/select), also run the sync-to-day-field copy
    // and do a full re-render — any field (not just the obviously
    // cross-cutting ones, e.g. Current Furnace Level feeds Construction
    // Day's status box) can affect another section's eligibility/points
    // display. change only fires on blur/select, never mid-keystroke, so
    // this can't yank focus away while someone is still typing.
    input.addEventListener("change", () => {
      commitLocal();
      if (field?.syncTo) svsDraft.values[field.syncTo] = svsDraft.values[input.dataset.field];
      renderWizardBackpack(el, wrap);
    });
  });
  el.querySelector("#wizNext").onclick = () => { svsWizardStep = "review"; refreshSvS(); };
}

function refreshSvS() {
  const app = document.getElementById("app");
  if (app) renderSvS(app);
}

function renderWizardReview(el, wrap) {
  const { bySection, total } = computeBagPoints(svsDraft.values);
  el.innerHTML = `
    <div class="section-title">POINTS BY SECTION</div>
    <div style="margin-bottom:16px;">
      ${bySection
        .map((s) => `<div class="points-row"><span class="k">${s.title}</span><span class="v">${fmtNum(s.points)}</span></div>`)
        .join("")}
      <div class="points-row total"><span class="k">TOTAL PROJECTED</span><span class="v">${fmtNum(total)}</span></div>
    </div>
    <div style="display:flex;gap:10px;">
      <button class="btn" id="wizBack">← BACK</button>
      <button class="btn primary" id="wizNext">NEXT → TIME SLOTS</button>
    </div>
  `;
  el.querySelector("#wizBack").onclick = () => { svsWizardStep = "backpack"; refreshSvS(); };
  el.querySelector("#wizNext").onclick = () => { svsWizardStep = "timeslots"; refreshSvS(); };
}

function renderWizardTimeSlots(el) {
  const mode = svsDraft.availabilityType;
  // Which of the gated days (Construction/Research/Troop) is this member
  // NOT eligible for, given their currently-banked speedups?
  const blockedDays = SEED_SCHEDULE_DAYS.filter((d) => isGatedDay(d) && !dayEligible(d, svsDraft.values));
  // On a locked day itself, in BY DAY mode, lock the slot grid entirely —
  // there's nothing for them to do in that window, so don't let them tap
  // slots that can't be honored.
  const onLockedTab = mode === "byday" && blockedDays.includes(svsWizardDayTab);
  const activeSlots = mode === "all" ? svsDraft.slots.all : svsDraft.slots.byDay[svsWizardDayTab];
  const blockedReason = (d) => {
    if (isTroopDay(d)) return "no banked Troop speedup minutes";
    if (isConstructionDay(d)) return !constructionOpportunityOpen(svsDraft.values) ? "no open Construction opportunity — furnace at cap AND War Academy maxed" : "no banked Construction speedup minutes";
    if (isResearchDay(d)) return !researchOpportunityOpen(svsDraft.values) ? "War Academy Research AND Tech Research both maxed" : "no banked Research speedup minutes";
    return "";
  };
  el.innerHTML = `
    <p style="font-size:11.5px;color:var(--text-dim);margin:0 0 16px;">All times on this page are <strong style="color:var(--text);">UTC</strong> — everyone books and reads the schedule off the same clock, no local-time conversion.</p>
    <div class="section-title">AVAILABILITY TYPE</div>
    <div class="pill-toggle">
      <button data-mode="all" class="${mode === "all" ? "active" : ""}">ALL DAYS<br><span style="font-size:10px;color:var(--text-faint);">Same slots across ${SEED_SCHEDULE_DAYS.length} days</span></button>
      <button data-mode="byday" class="${mode === "byday" ? "active" : ""}">BY DAY<br><span style="font-size:10px;color:var(--text-faint);">Pick slots separately per day</span></button>
    </div>
    ${
      blockedDays.length
        ? `<div class="panel" style="background:rgba(255,176,32,.1);border-color:var(--accent-amber);padding:10px 12px;margin-top:12px;font-size:11.5px;color:var(--accent-amber);">
            You won't be scheduled for: ${blockedDays.map((d) => `<strong>${d}</strong> (${blockedReason(d)})`).join(", ")}${mode === "all" ? " — those taps apply to your other days only" : ""}. Go back to BACKPACK and add the matching speedup minutes (or General wildcard minutes) if you have them.
          </div>`
        : ""
    }
    ${
      mode === "byday"
        ? `<div class="day-tabs">${SEED_SCHEDULE_DAYS.map((d) => {
            const locked = blockedDays.includes(d);
            return `<button data-d="${d}" ${locked ? "disabled" : ""} class="${d === svsWizardDayTab ? "active" : ""}" style="${locked ? "opacity:.4;cursor:not-allowed;" : ""}">${d.toUpperCase()}${locked ? " 🔒" : ""}</button>`;
          }).join("")}</div>`
        : ""
    }
    <div class="section-title" style="margin-top:14px;">TAP EVERY SLOT YOU COULD BE ONLINE</div>
    ${
      onLockedTab
        ? `<div class="panel" style="background:var(--panel-2);text-align:center;padding:20px 14px;">
            <div style="font-size:13px;color:var(--text-dim);">${svsWizardDayTab} is locked for you — ${blockedReason(svsWizardDayTab)}.</div>
          </div>`
        : `
    <p style="font-size:11.5px;color:var(--text-dim);margin:-2px 0 14px;">More slots = better chance of getting assigned. We prioritise high scorers across the widest availability window.</p>
    <div class="toggle-grid">
      ${activeSlots
        .map((on, i) => `<button data-slot="${i}" class="${on ? "on" : ""}">${slotTimeLabel(i)}</button>`)
        .join("")}
    </div>`
    }
    <div style="display:flex;gap:10px;margin-top:16px;">
      <button class="btn" id="wizBack">← BACK</button>
      <button class="btn primary" id="wizNext">NEXT → SUBMIT</button>
    </div>
  `;
  el.querySelectorAll("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => { svsDraft.availabilityType = b.dataset.mode; scheduleDraftAutosave(); renderWizardTimeSlots(el); })
  );
  el.querySelectorAll(".day-tabs button").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.disabled) return;
      svsWizardDayTab = b.dataset.d; renderWizardTimeSlots(el);
    })
  );
  el.querySelectorAll("[data-slot]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.slot);
      const arr = mode === "all" ? svsDraft.slots.all : svsDraft.slots.byDay[svsWizardDayTab];
      arr[i] = !arr[i];
      btn.classList.toggle("on", arr[i]);
      scheduleDraftAutosave();
    })
  );
  el.querySelector("#wizBack").onclick = () => { svsWizardStep = "review"; refreshSvS(); };
  el.querySelector("#wizNext").onclick = () => { svsWizardStep = "submit"; refreshSvS(); };
}

function slotTimeLabel(i) {
  const h = Math.floor(i / 2);
  const m = i % 2 === 0 ? "00" : "30";
  return `${String(h).padStart(2, "0")}:${m}`;
}

function countSelectedSlots() {
  if (svsDraft.availabilityType === "all") return { n: svsDraft.slots.all.filter(Boolean).length, denom: 48 };
  let n = 0;
  SEED_SCHEDULE_DAYS.forEach((d) => (n += (svsDraft.slots.byDay[d] || []).filter(Boolean).length));
  return { n, denom: 48 * SEED_SCHEDULE_DAYS.length };
}

function bestBuffDay() {
  const { bySection } = computeBagPoints(svsDraft.values);
  const dayScored = bySection.filter((s) => /^D\d/.test(s.title));
  if (!dayScored.length || dayScored.every((s) => s.points === 0)) return "—";
  const top = dayScored.reduce((a, b) => (b.points > a.points ? b : a));
  return `${top.title.split("—")[1]?.trim() || top.title} · ${fmtNum(top.points)}`;
}

function renderWizardSubmit(el, wrap) {
  const user = svsWizardTargetUser();
  const editing = !!svsEditingMemberId;
  const { n, denom } = countSelectedSlots();
  el.innerHTML = `
    <div class="panel" style="background:var(--panel-2);">
      <div class="eyebrow" style="margin-bottom:8px;">CONFIRM & SUBMIT</div>
      <div class="summary-row"><span class="k">Chief</span><span class="v">${escapeHtml(user.name)}</span></div>
      <div class="summary-row"><span class="k">Availability</span><span class="v">${n} / ${denom} slots (${svsDraft.availabilityType === "all" ? "all days" : "by day"})</span></div>
      <div class="summary-row"><span class="k">Best buff day</span><span class="v">${bestBuffDay()}</span></div>
    </div>
    <div class="section-title" style="margin-top:16px;">NOTES (OPTIONAL)</div>
    <textarea class="feedback-input" id="wizNotes" placeholder="Anything the scheduler should know...">${escapeHtml(svsDraft.notes || "")}</textarea>
    <div id="wizScheduleWarning" style="display:none;margin-top:14px;padding:10px 12px;border-radius:6px;background:rgba(255,176,32,.1);border:1px solid var(--accent-amber);font-size:11.5px;color:var(--accent-amber);"></div>
    <div style="display:flex;gap:10px;margin-top:16px;">
      <button class="btn" id="wizBack">← BACK</button>
      <button class="btn primary" id="wizSubmit" style="flex:1;">${editing ? `SAVE ${escapeHtml(user.name).toUpperCase()}'S BAG` : "SUBMIT BAG"}</button>
    </div>
    <div id="wizMsg" style="margin-top:10px;font-size:12px;color:var(--accent-green);"></div>
  `;
  el.querySelector("#wizNotes").addEventListener("input", (e) => {
    svsDraft.notes = e.target.value;
    scheduleDraftAutosave();
  });
  const warnEl = el.querySelector("#wizScheduleWarning");
  const submitBtn = el.querySelector("#wizSubmit");
  let confirmedPastWarning = false;
  const doSave = () => {
    svsDraft.notes = el.querySelector("#wizNotes").value;
    svsDraft.updatedAt = Date.now();
    const all = Store.bagSubmissions;
    all[user.id] = svsDraft;
    Store.bagSubmissions = all;
    // This submission now supersedes the autosaved draft — clear it (and
    // cancel any still-pending debounced save) so a later visit to MY BAG
    // starts from what was actually submitted, not a leftover draft.
    clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
    const drafts = Store.bagDrafts;
    if (drafts[user.id]) {
      delete drafts[user.id];
      Store.bagDrafts = drafts;
    }
    svsDraft = null;
    svsWizardStep = "backpack";
    finishSubmit();
  };
  el.querySelector("#wizBack").onclick = () => { svsWizardStep = "timeslots"; refreshSvS(); };
  submitBtn.onclick = () => {
    // Defensive re-check: an admin-edit save must still be an admin at the
    // moment it's actually written, not just when the wizard was opened.
    if (editing && !canEditMemberBag(Store.currentUser)) {
      svsEditingMemberId = null;
      navigate("/admin");
      return;
    }
    if (!confirmedPastWarning) {
      const warnings = scheduleMismatchWarnings(user, svsDraft);
      if (warnings.length) {
        confirmedPastWarning = true;
        warnEl.style.display = "block";
        warnEl.innerHTML =
          `<strong>Heads up — this won't change the schedule automatically:</strong><br>` +
          warnings
            .map(
              (w) =>
                `This player is currently scheduled for ${escapeHtml(w.time)} on ${escapeHtml(w.day)}, but ${escapeHtml(w.time)} is no longer included in their selected availability.`
            )
            .join("<br>") +
          `<br><br>Their schedule slot stays as-is unless you go change it yourself on the SCHEDULE tab.`;
        submitBtn.textContent = "SAVE ANYWAY";
        return;
      }
    }
    doSave();
  };
  function finishSubmit() {
    if (editing) {
      svsEditingMemberId = null;
      navigate("/admin");
    } else {
      svsTab = "mysub";
      refreshSvS();
    }
  }
}

function renderSvSMySubmission(el) {
  const user = Store.currentUser;
  if (!user) return svsGate(el, "Sign in to view your submission");
  const sub = Store.bagSubmissions[user.id];
  if (!sub) {
    el.innerHTML = `
      <div class="panel gate">
        <p>You haven't submitted your bag for this SvS yet.</p>
        <button class="btn primary" id="goReq">Start your bag</button>
      </div>
    `;
    el.querySelector("#goReq").onclick = () => { svsTab = "request"; svsWizardStep = "backpack"; svsDraft = null; refreshSvS(); };
    return;
  }
  const { n, denom } = (() => {
    if (sub.availabilityType === "all") return { n: (sub.slots.all || []).filter(Boolean).length, denom: 48 };
    let n = 0;
    SEED_SCHEDULE_DAYS.forEach((d) => (n += (sub.slots.byDay?.[d] || []).filter(Boolean).length));
    return { n, denom: 48 * SEED_SCHEDULE_DAYS.length };
  })();
  const { total } = computeBagPoints(sub.values);
  el.innerHTML = `
    <div class="panel">
      <div class="eyebrow" style="margin-bottom:8px;">Your submission</div>
      <div class="summary-row"><span class="k">Chief</span><span class="v">${escapeHtml(user.name)}</span></div>
      <div class="summary-row"><span class="k">Timezone</span><span class="v">${escapeHtml(sub.timezone)}</span></div>
      <div class="summary-row"><span class="k">Availability</span><span class="v">${n} / ${denom} slots (${sub.availabilityType === "all" ? "all days" : "by day"})</span></div>
      <div class="summary-row"><span class="k">Projected points</span><span class="v">${fmtNum(total)}</span></div>
      <div class="summary-row"><span class="k">Last updated</span><span class="v">${new Date(sub.updatedAt).toLocaleString()}</span></div>
      ${sub.notes ? `<div class="summary-row"><span class="k">Notes</span><span class="v">${escapeHtml(sub.notes)}</span></div>` : ""}
      <button class="btn primary small" id="editSub" style="margin-top:14px;">Edit submission</button>
    </div>
  `;
  el.querySelector("#editSub").onclick = () => { svsTab = "request"; svsWizardStep = "backpack"; svsDraft = null; refreshSvS(); };
}

function renderSvSMyPoints(el) {
  const user = Store.currentUser;
  if (!user) return svsGate(el, "Sign in to view your points");
  const sub = Store.bagSubmissions[user.id];
  if (!sub) {
    el.innerHTML = `<div class="empty">No submission yet — projected points will show up here once you submit your bag.</div>`;
    return;
  }
  const { bySection, total } = computeBagPoints(sub.values);
  el.innerHTML = `
    <div class="panel">
      <div class="eyebrow" style="margin-bottom:8px;">Projected SvS points</div>
      ${bySection.map((s) => `<div class="points-row"><span class="k">${s.title}</span><span class="v">${fmtNum(s.points)}</span></div>`).join("")}
      <div class="points-row total"><span class="k">TOTAL</span><span class="v">${fmtNum(total)}</span></div>
    </div>
  `;
}

function renderSvSSchedule(el) {
  const admin = canSeeSchedule(Store.currentUser);
  const sched = Store.schedule;
  const published = Store.schedulePublished;
  const slots = sched[svsDay] || [];
  const filled = slots.filter((s) => s.member).length;
  const isPublished = !!published[svsDay];
  const unassignedPlayers = unassignedPlayersForDay(svsDay);
  const scheduledPoints = slots.reduce(
    (sum, s) => sum + (s.member ? pointsForMemberOnDay(s.member.id, svsDay) : 0),
    0
  );

  const dayTabsHtml = `
    <div class="day-tabs">
      ${SEED_SCHEDULE_DAYS
        .map(
          (d) =>
            `<button data-d="${d}" class="${d === svsDay ? "active" : ""}">${d.toUpperCase()}${
              admin ? (published[d] ? " ●" : "") : ""
            }</button>`
        )
        .join("")}
    </div>`;

  // Regular members: locked until an admin publishes this day, then a
  // simple read-only view — no availability data, no editing controls.
  if (!admin) {
    el.innerHTML = `
      <div class="panel">
        <div class="planner-header">
          <div>
            <strong>svs_schedule</strong>
            <span class="eyebrow"> · SvS ${Store.state.svsDate}</span>
          </div>
        </div>
        ${dayTabsHtml}
        ${
          !isPublished
            ? `<div class="panel" style="background:var(--panel-2);text-align:center;padding:26px 16px;">
                <div style="font-size:13px;color:var(--text-dim);">This day's schedule hasn't been published yet.</div>
                <div style="font-size:11.5px;color:var(--text-faint);margin-top:4px;">Check back once your alliance leadership finalizes it.</div>
              </div>`
            : `
              <div class="fill-status">${filled} / ${slots.length} SLOTS FILLED · FINALIZED</div>
              <div class="slot-grid">
                ${slots
                  .map((s, i) => {
                    const mine = s.member && Store.currentUser && s.member.id === Store.currentUser.id;
                    const pts = s.member ? fmtNum(pointsForMemberOnDay(s.member.id, svsDay)) : null;
                    return `
                    <div class="slot-cell">
                      <div class="slot ${s.member ? "filled" : ""} ${mine ? "mine" : ""}">
                        <span class="time">${s.time}</span>
                        <span class="who">${s.member ? `${escapeHtml(s.member.name)} · ${pts} pts` : "— empty —"}</span>
                      </div>
                    </div>`;
                  })
                  .join("")}
              </div>`
        }
      </div>
    `;
    el.querySelectorAll(".day-tabs button").forEach((b) =>
      b.addEventListener("click", () => { svsDay = b.dataset.d; renderSvSSchedule(el); })
    );
    return;
  }

  // Admin: unchanged live/draft grid with full editing + availability,
  // plus a publish/unpublish toggle for the currently-viewed day.
  el.innerHTML = `
    <div class="panel">
      <div class="planner-header" style="flex-wrap:wrap;gap:8px;">
        <div>
          <strong>svs_schedule</strong>
          <span class="eyebrow"> · SvS ${Store.state.svsDate}</span>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn small primary" id="optimizeDay">⚡ OPTIMIZE THIS DAY</button>
          <button class="btn small" id="resetDay">RESET THIS DAY</button>
          <button class="btn small" id="exportDay">EXPORT DAY</button>
        </div>
      </div>
      <p style="font-size:11px;color:var(--text-dim);margin:-4px 0 0;">OPTIMIZE fills every open slot with whoever's signed-up availability maximizes total points — it never touches or reassigns a slot you picked manually. RESET clears everything except your manual picks.</p>
      <p id="exportBlockedMsg" style="font-size:11.5px;color:var(--accent-red);margin:4px 0 0;display:none;"></p>
      ${dayTabsHtml}
      <div class="fill-status" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
        <span>${filled} / ${slots.length} SLOTS FILLED · ${fmtNum(scheduledPoints)} SCHEDULED PTS · PROVISIONAL</span>
        <span style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;letter-spacing:.04em;padding:3px 8px;border-radius:20px;background:${
            isPublished ? "rgba(62,207,142,.15)" : "rgba(255,176,32,.15)"
          };color:${isPublished ? "var(--accent-green)" : "var(--accent-amber)"};">
            ${isPublished ? "● PUBLISHED" : "○ DRAFT"}
          </span>
          <button class="btn small ${isPublished ? "" : "primary"}" id="togglePublish">
            ${isPublished ? "Unpublish this day" : "Publish this day"}
          </button>
        </span>
      </div>
      <div class="slot-grid">
        ${slots
          .map((s, i) => {
            const mine = s.member && Store.currentUser && s.member.id === Store.currentUser.id;
            const avail = availableMembersForSlot(svsDay, i);
            const availLine = avail.length
              ? `<div class="slot-avail">available: ${avail
                  .map((m) => `${escapeHtml(m.name)} (${fmtNum(pointsForMemberOnDay(m.id, svsDay))} pts)`)
                  .join(", ")}</div>`
              : `<div class="slot-avail empty-avail">no submissions for this slot</div>`;
            // A member already assigned to a DIFFERENT slot on this same
            // day can't also be picked here — they can't physically be in
            // two places at once during the same window.
            const assignedElsewhere = new Set(
              slots.filter((other, j) => j !== i && other.member).map((other) => other.member.id)
            );
            // The dropdown only offers members who actually signed up for
            // THIS slot (avail, from availableMembersForSlot — already
            // excludes anyone gated out of the day entirely) — no
            // roster-wide picker, so an admin can't assign someone who
            // never said they'd be online for it. The one exception: if
            // this slot already has someone assigned who no longer shows
            // up in avail (e.g. they were assigned before signing up, or
            // their availability changed since), keep them in the list —
            // tagged so it's clear — so the slot doesn't silently show a
            // name with no way to select/clear it.
            const currentMember = s.member ? Store.members.find((mm) => mm.id === s.member.id) : null;
            const optionMembers = avail.filter((m) => !assignedElsewhere.has(m.id));
            const grandfathered = currentMember && !optionMembers.some((m) => m.id === currentMember.id);
            if (grandfathered) optionMembers.push(currentMember);
            return `
            <div class="slot-cell">
              <div class="slot ${s.member ? "filled" : ""} ${mine ? "mine" : ""}">
                <span class="time">${s.time}</span>
                <select data-assign="${i}" style="flex:1;margin:0 8px;background:var(--panel);border:1px solid var(--border);color:var(--text);border-radius:3px;padding:3px 6px;font-size:11.5px;">
                  <option value="">— empty —</option>
                  ${optionMembers
                    .map((m) => {
                      const notSignedUp = grandfathered && currentMember && m.id === currentMember.id;
                      const label = `${escapeHtml(m.name)}${notSignedUp ? " (didn't sign up for this slot)" : ""}`;
                      return `<option value="${m.id}" ${s.member && s.member.id === m.id ? "selected" : ""}>${label}</option>`;
                    })
                    .join("")}
                </select>
                ${
                  !optionMembers.length
                    ? `<span style="font-size:10.5px;color:var(--text-faint);">no signups for this slot</span>`
                    : ""
                }
                ${s.member ? `<span style="font-size:11px;color:var(--accent-amber);white-space:nowrap;">${fmtNum(pointsForMemberOnDay(s.member.id, svsDay))} pts</span>` : ""}
                ${s.manual && s.member ? `<span title="Manually assigned — RESET and OPTIMIZE won't touch this slot" style="font-size:10px;color:var(--accent-pink);white-space:nowrap;">📌 manual</span>` : ""}
              </div>
              ${availLine}
            </div>`;
          })
          .join("")}
      </div>
    </div>
    <div class="panel">
      <div class="planner-header">
        <strong>Unassigned players</strong>
        <span class="eyebrow"> · eligible, ${fmtNum(unassignedPlayers.length)} with no submitted availability for ${svsDay}</span>
      </div>
      <p style="font-size:11.5px;color:var(--text-dim);margin-top:-6px;">
        These members are eligible and have real points on the line for this day, but never tapped a time slot for it —
        "no slots selected" is treated as <strong style="color:var(--text);">availability unknown</strong>, not "available anytime,"
        so the optimizer skips them entirely. Confirm their availability yourself, then use the dropdown to place them —
        it only offers slots that are currently open.
      </p>
      ${
        unassignedPlayers.length
          ? `<div style="overflow-x:auto;">
        <table>
          <thead><tr><th>PLAYER</th><th>POTENTIAL POINTS</th><th>STATUS</th><th>ASSIGN SLOT</th></tr></thead>
          <tbody>
            ${unassignedPlayers
              .map(({ member, points, currentSlotIdx }) => {
                const assignedTime = currentSlotIdx !== -1 ? slots[currentSlotIdx].time : null;
                // Open = currently empty, OR this member's own current
                // slot (so the dropdown can show/keep their placement,
                // and switching away from it frees it back up for others
                // on the very next render).
                const openIdxs = slots
                  .map((s, i) => i)
                  .filter((i) => !slots[i].member || i === currentSlotIdx);
                return `
                <tr>
                  <td>${escapeHtml(member.name)}</td>
                  <td>${fmtNum(points)}</td>
                  <td>${
                    assignedTime
                      ? `<span style="color:var(--accent-green);">Assigned · ${assignedTime}</span>`
                      : `<span style="color:var(--text-faint);">Unassigned · not counted in scheduled pts</span>`
                  }</td>
                  <td>
                    <select data-unassigned-assign="${member.id}" style="background:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:3px;padding:5px 8px;font-size:12px;">
                      <option value="">— unassigned —</option>
                      ${openIdxs
                        .map((i) => `<option value="${i}" ${i === currentSlotIdx ? "selected" : ""}>${slots[i].time}</option>`)
                        .join("")}
                    </select>
                  </td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>`
          : `<span class="empty">Everyone eligible for ${svsDay} has submitted at least one time slot.</span>`
      }
    </div>
  `;
  el.querySelectorAll(".day-tabs button").forEach((b) =>
    b.addEventListener("click", () => { svsDay = b.dataset.d; renderSvSSchedule(el); })
  );
  el.querySelector("#exportDay").onclick = () => {
    const msgEl = el.querySelector("#exportBlockedMsg");
    const opened = openExportModal(svsDay);
    if (!opened) {
      msgEl.textContent = "This day must be published before exporting";
      msgEl.style.display = "block";
    } else {
      msgEl.textContent = "";
      msgEl.style.display = "none";
    }
  };
  el.querySelector("#togglePublish").onclick = () => {
    const p = Store.schedulePublished;
    p[svsDay] = !p[svsDay];
    Store.schedulePublished = p;
    renderSvSSchedule(el);
  };
  el.querySelector("#optimizeDay").onclick = () => {
    optimizeScheduleForDay(svsDay);
    renderSvSSchedule(el);
  };
  el.querySelector("#resetDay").onclick = () => {
    resetScheduleForDay(svsDay);
    renderSvSSchedule(el);
  };
  el.querySelectorAll("[data-assign]").forEach((sel) =>
    sel.addEventListener("change", () => {
      manualAssignMember(svsDay, Number(sel.dataset.assign), sel.value);
      renderSvSSchedule(el);
    })
  );
  el.querySelectorAll("[data-unassigned-assign]").forEach((sel) =>
    sel.addEventListener("change", () => {
      const memberId = sel.dataset.unassignedAssign;
      const slotIdx = sel.value === "" ? null : Number(sel.value);
      // Clear wherever this member currently sits this day (if anywhere)
      // before applying the new pick, same dedupe guarantee as the main
      // grid — this dropdown can also be used to un-assign someone by
      // picking "— unassigned —".
      const existing = Store.schedule[svsDay].findIndex((s) => s.member?.id === memberId);
      if (existing !== -1 && existing !== slotIdx) manualAssignMember(svsDay, existing, null);
      if (slotIdx !== null) manualAssignMember(svsDay, slotIdx, memberId);
      renderSvSSchedule(el);
    })
  );
}

// A small colored pill for an alliance tag, using its admin-picked color
// (Admin → Alliances) or a neutral grey fallback when none is set. Colors
// are stored as plain "#rrggbb" hex (straight from an <input type="color">),
// so appending a couple of hex digits is a cheap way to get a translucent
// background/border without needing a full color-parsing helper.
function allianceBadgeHtml(tag) {
  if (!tag) return "";
  const color = Store.allianceColors[tag] || "#8a8f98";
  return `<span style="display:inline-block;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:700;letter-spacing:.02em;background:${color}26;color:${color};border:1px solid ${color}66;">${escapeHtml(tag)}</span>`;
}

function exportModalRangeLabel(range) {
  if (range === "first") return "00:00-11:30";
  if (range === "second") return "12:00-23:30";
  return "";
}

const EXPORT_MAX_ENTRIES_PER_BLOCK = 10;

// Alliance tags actually present in this day's schedule (not the state's
// whole alliance roster) — the alliance filter is only ever populated
// with alliances someone from is actually assigned that day.
function exportModalDayAlliances(day) {
  const tags = new Set();
  (Store.schedule[day] || []).forEach((s) => {
    if (!s.member) return;
    const m = Store.members.find((mm) => mm.id === s.member.id);
    if (m?.alliance) tags.add(m.alliance);
  });
  return Array.from(tags).sort();
}

// Filter → sort. Same pipeline feeds both the visual preview (which
// always keeps Game ID, per spec) and the plain-text copy blocks (which
// strip it for an individual alliance but keep it for the state-wide
// export) — filtering always happens before any chunking into blocks.
function exportModalFilteredEntries() {
  const { day, range, alliance } = exportModalState;
  const allSlots = Store.schedule[day] || [];
  const rangeSlots = range === "first" ? allSlots.slice(0, 24) : range === "second" ? allSlots.slice(24, 48) : allSlots;
  return rangeSlots
    .filter((s) => s.member)
    .map((s) => {
      const m = Store.members.find((mm) => mm.id === s.member.id);
      // Preserve whatever alliance tag is actually on the member's own
      // record — never rewrite it to match the alliance filter selected.
      return { time: s.time, gamerId: m?.gamerId || "—", alliance: m?.alliance || "—", name: s.member.name };
    })
    .filter((r) => !alliance || r.alliance === alliance)
    .sort((a, b) => a.time.localeCompare(b.time));
}

function chunkEntries(entries, maxEntries = EXPORT_MAX_ENTRIES_PER_BLOCK) {
  const groups = [];
  for (let i = 0; i < entries.length; i += maxEntries) groups.push(entries.slice(i, i + maxEntries));
  return groups;
}

function formatAllianceEntry(e) {
  return `${e.time} - [${e.alliance}]${e.name}`;
}
function formatStateEntry(e) {
  return `${e.time} - [${e.alliance}]${e.name} - ${e.gamerId}`;
}

// Builds every copy block for the CURRENT filters: an individual alliance
// gets short "TIME - [TAG]Name" lines (no Game ID — meant for that
// alliance's own chat); "All alliances" gets a state-wide export with
// Game IDs included (meant for the State President assigning slots).
// Either way, blocks are capped at EXPORT_MAX_ENTRIES_PER_BLOCK lines,
// numbered only when there's more than one.
function exportModalBlocks() {
  const { day, alliance } = exportModalState;
  const entries = exportModalFilteredEntries();
  const groups = chunkEntries(entries);
  const isAlliance = !!alliance;
  const headingBase = isAlliance ? `${day} — ${alliance} Buffs` : `${day} — State Buff Schedule`;
  const fmt = isAlliance ? formatAllianceEntry : formatStateEntry;
  if (!groups.length) return [{ heading: headingBase, lines: [], text: headingBase }];
  return groups.map((group, i) => {
    const heading = groups.length > 1 ? `${headingBase} (${i + 1}/${groups.length})` : headingBase;
    const lines = group.map(fmt);
    return { heading, lines, text: [heading, ...lines].join("\n") };
  });
}

function openExportModal(day) {
  if (!Store.schedulePublished[day]) return false;
  exportModalState = { day, range: "full", alliance: "" };
  renderExportModal();
  return true;
}

function closeExportModal() {
  document.getElementById("exportModalOverlay")?.remove();
  exportModalState = null;
}

// A dedicated overlay — not the schedule grid itself — so it can use its
// own light, screenshot-friendly card regardless of the app's dark theme
// (this is meant to be screenshotted or copy-pasted into alliance chat,
// same as any other in-game buff schedule graphic).
function renderExportModal() {
  document.getElementById("exportModalOverlay")?.remove();
  if (!exportModalState) return;
  const { day, range, alliance } = exportModalState;
  const rows = exportModalFilteredEntries();
  const st = Store.state;
  const totalSlots = (Store.schedule[day] || []).length;
  const dayAlliances = exportModalDayAlliances(day);
  const blocks = exportModalBlocks();

  const overlay = document.createElement("div");
  overlay.id = "exportModalOverlay";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div style="width:100%;max-width:520px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <span style="font-size:10.5px;letter-spacing:.08em;color:var(--text-faint);">SCREENSHOT OR COPY ↓</span>
        <button id="exportModalClose" class="btn small">CLOSE ✕</button>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:12px;">
        <select id="exportRange" style="flex:1;background:var(--panel);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:8px 10px;font-size:12px;">
          <option value="full" ${range === "full" ? "selected" : ""}>Full day</option>
          <option value="first" ${range === "first" ? "selected" : ""}>1st half · 00:00-11:30</option>
          <option value="second" ${range === "second" ? "selected" : ""}>2nd half · 12:00-23:30</option>
        </select>
        <select id="exportAllianceFilter" style="flex:1;background:var(--panel);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:8px 10px;font-size:12px;">
          <option value="">All alliances</option>
          ${dayAlliances.map((a) => `<option value="${escapeHtml(a)}" ${alliance === a ? "selected" : ""}>${escapeHtml(a)}</option>`).join("")}
        </select>
      </div>
      <div style="background:#fff;color:#1a1a1a;border-radius:10px;padding:18px;max-height:78vh;overflow-y:auto;">
        <div style="font-size:16px;font-weight:700;">${escapeHtml(day)} — Buff Schedule</div>
        <div style="font-size:11.5px;color:#6b7280;margin-top:2px;margin-bottom:14px;">${totalSlots} slots · State ${escapeHtml(st.stateNumber)}</div>
        ${
          rows.length
            ? `<div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:12.5px;">
            <thead>
              <tr style="text-align:left;color:#6b7280;font-size:10.5px;letter-spacing:.04em;">
                <th style="padding:4px 6px;">TIME</th>
                <th style="padding:4px 6px;">GAME ID</th>
                <th style="padding:4px 6px;">ALLY</th>
                <th style="padding:4px 6px;">NAME</th>
              </tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (r) => `
                <tr style="border-top:1px solid #eee;">
                  <td style="padding:6px;color:#374151;">${r.time}</td>
                  <td style="padding:6px;color:#374151;">${escapeHtml(r.gamerId)}</td>
                  <td style="padding:6px;">${allianceBadgeHtml(r.alliance)}</td>
                  <td style="padding:6px;color:#111827;font-weight:600;">[${escapeHtml(r.alliance)}]${escapeHtml(r.name)}</td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>`
            : `<div style="color:#6b7280;font-size:12.5px;padding:12px 0;">No assigned slots match this filter.</div>`
        }
        <div style="margin-top:16px;padding-top:12px;border-top:1px solid #eee;">
          <div style="font-size:11px;color:#9ca3af;letter-spacing:.04em;margin-bottom:8px;">
            ${alliance ? `${escapeHtml(alliance)} CHAT TEXT (no Game IDs)` : "STATE PRESIDENT TEXT (includes Game IDs)"}
            ${blocks.length > 1 ? ` · ${blocks.length} POSTS (max ${EXPORT_MAX_ENTRIES_PER_BLOCK} per post)` : ""}
          </div>
          ${blocks
            .map(
              (b, i) => `
            <div style="background:#f9fafb;border:1px solid #eee;border-radius:8px;padding:10px 12px;margin-bottom:8px;">
              <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px;">
                <span style="font-size:11.5px;color:#374151;font-weight:600;">${escapeHtml(b.heading)}</span>
                <button data-export-copy="${i}" class="btn small primary" style="white-space:nowrap;">COPY TEXT</button>
              </div>
              <pre class="export-copy-text" style="margin:0;background:#111827;color:#f9fafb;font-family:'SF Mono',Consolas,monospace;font-size:11px;line-height:1.6;border-radius:6px;border:none;padding:10px;min-height:90px;max-height:250px;overflow-y:auto;white-space:pre-wrap;word-break:break-word;user-select:text;">${escapeHtml(b.text)}</pre>
              <div style="font-size:10.5px;color:#9ca3af;margin-top:4px;">${b.text.length} chars</div>
            </div>`
            )
            .join("")}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#exportModalClose").onclick = closeExportModal;
  overlay.onclick = (e) => { if (e.target === overlay) closeExportModal(); };
  overlay.querySelector("#exportRange").onchange = (e) => { exportModalState.range = e.target.value; renderExportModal(); };
  overlay.querySelector("#exportAllianceFilter").onchange = (e) => { exportModalState.alliance = e.target.value; renderExportModal(); };
  overlay.querySelectorAll("[data-export-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const block = blocks[Number(btn.dataset.exportCopy)];
      try {
        await navigator.clipboard.writeText(block.text);
      } catch {
        const ta = document.createElement("textarea");
        ta.value = block.text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      const original = btn.textContent;
      btn.textContent = "COPIED ✓";
      setTimeout(() => { btn.textContent = original; }, 1500);
    });
  });
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------------------
// FEEDBACK
// ---------------------------------------------------------------------------
function renderFeedback(el) {
  const items = Store.feedback.slice().sort((a, b) => b.votes - a.votes);
  const user = Store.currentUser;
  el.innerHTML = `
    <div class="eyebrow">// IDEAS & BUGS</div>
    <h1 class="page-title" style="color:var(--accent-orange)">feedback</h1>
    <div class="panel">
      ${
        user
          ? `
        <textarea class="feedback-input" id="fbInput" placeholder="What's missing? Describe an idea or bug..."></textarea>
        <button class="btn primary" id="fbSubmit" style="margin-top:8px;">Post</button>`
          : `<div class="gate" style="padding:10px 0;"><button class="btn primary" id="fbSignIn">Sign in to post</button></div>`
      }
    </div>
    <div>
      ${items
        .map(
          (it) => `
        <div class="feedback-item">
          <div class="vote-box">
            <button data-vote="${it.id}" data-dir="1">▲</button>
            <span class="count">${it.votes}</span>
            <button data-vote="${it.id}" data-dir="-1">▼</button>
          </div>
          <div class="feedback-body">
            <div class="title">${escapeHtml(it.title || it.body.slice(0, 60))}<span class="status-badge ${it.status}">${it.status.toUpperCase()}</span></div>
            <div class="meta">${escapeHtml(it.body)}</div>
            <div class="meta" style="margin-top:4px;">— ${escapeHtml(it.author)} · ${new Date(it.createdAt).toLocaleDateString()}</div>
          </div>
        </div>`
        )
        .join("") || `<div class="empty">No feedback yet. Be the first to post.</div>`}
    </div>
  `;
  el.querySelector("#fbSignIn")?.addEventListener("click", openSignIn);
  el.querySelector("#fbSubmit")?.addEventListener("click", () => {
    const text = el.querySelector("#fbInput").value.trim();
    if (!text) return;
    const item = {
      id: "f" + Date.now(),
      title: text.slice(0, 60),
      body: text,
      author: user.name,
      votes: 1,
      status: "open",
      createdAt: Date.now(),
    };
    Store.feedback = [item, ...Store.feedback];
    renderFeedback(el);
  });
  el.querySelectorAll("[data-vote]").forEach((b) =>
    b.addEventListener("click", () => {
      const items2 = Store.feedback;
      const it = items2.find((x) => x.id === b.dataset.vote);
      it.votes += Number(b.dataset.dir);
      Store.feedback = items2;
      renderFeedback(el);
    })
  );
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------------------------------------------------------------------
// ROOKIE-OFF — a standalone leaderboard for the T1 promotion contest. There
// is no separate entry field for this: it reads straight off each member's
// D4 "T1 Troops (promotable)" bag value, so whatever they enter on MY BAG
// is automatically what shows up here — one number, no double entry.
// ---------------------------------------------------------------------------
function renderRookieOff(el) {
  if (!Store.currentUser) {
    el.innerHTML = `
      <div class="panel" style="text-align:center;padding:32px 20px;">
        <div class="eyebrow" style="color:var(--accent-pink);margin-bottom:10px;">SIGN IN REQUIRED</div>
        <p style="font-size:12.5px;color:var(--text-dim);margin:0 0 16px;">The Rookie-Off leaderboard is for alliance members only. Sign in with your chief name and PIN to continue.</p>
        <button class="btn primary" id="roGoSignIn">Sign in</button>
      </div>
    `;
    el.querySelector("#roGoSignIn").onclick = openSignIn;
    return;
  }

  const bagSubs = Store.bagSubmissions;
  const me = Store.currentUser;
  const rows = Store.members
    .map((m) => ({ member: m, t1: Number(bagSubs[m.id]?.values?.d4_t1) || 0, submitted: !!bagSubs[m.id] }))
    .filter((r) => r.submitted)
    .sort((a, b) => b.t1 - a.t1);
  const total = rows.reduce((sum, r) => sum + r.t1, 0);
  const T1_PROMOTION_PTS = (BAG_SECTIONS.find((s) => s.title.startsWith("D4"))?.fields || []).find((f) => f.key === "d4_t1")?.points || 0;

  el.innerHTML = `
    <div class="eyebrow">// CONTEST</div>
    <h1 class="page-title" style="color:var(--accent-pink)">rookie_off</h1>
    <p style="font-size:12.5px;color:var(--text-dim);margin:-6px 0 16px;">
      T1 troops each member has queued for promotion during SvS — pulled straight from their MY BAG submission, no separate entry.
      Each T1 troop is worth ${fmtNum(T1_PROMOTION_PTS)} pts when promoted to T11.
    </p>
    <div class="stat-row" style="margin-bottom:16px;">
      <div class="stat-card">
        <div class="label">TOTAL T1 TROOPS</div>
        <div class="value">${fmtNum(total)}</div>
        <div class="sub">ACROSS ${rows.length} SUBMISSION${rows.length === 1 ? "" : "S"}</div>
      </div>
      <div class="stat-card">
        <div class="label">CONTEST POTENTIAL</div>
        <div class="value">${fmtNum(total * T1_PROMOTION_PTS)}</div>
        <div class="sub">PTS IF ALL PROMOTED TO T11</div>
      </div>
    </div>
    <div class="panel">
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>RANK</th><th>MEMBER</th><th>ALLIANCE</th><th>T1 TROOPS</th><th>PROMOTION PTS</th></tr></thead>
          <tbody>
            ${
              rows
                .map(
                  (r, i) => `
              <tr ${me && r.member.id === me.id ? `style="color:var(--accent-pink);"` : ""}>
                <td>#${i + 1}</td>
                <td>${escapeHtml(r.member.name)}${me && r.member.id === me.id ? " (you)" : ""}</td>
                <td>${escapeHtml(r.member.alliance || "—")}</td>
                <td>${fmtNum(r.t1)}</td>
                <td>${fmtNum(r.t1 * T1_PROMOTION_PTS)}</td>
              </tr>`
                )
                .join("") || `<tr><td colspan="5">No bag submissions yet.</td></tr>`
            }
          </tbody>
        </table>
      </div>
    </div>
    <p style="font-size:11px;color:var(--text-faint);margin-top:10px;">Want your count on this board? Set your T1 Troops (promotable) figure on <a href="#/svs" style="color:var(--accent-pink);">MY BAG</a> under D4 — Troop Training.</p>
  `;
}

// ---------------------------------------------------------------------------
// ADMIN
// ---------------------------------------------------------------------------
function renderAdmin(el) {
  const user = Store.currentUser;
  if (!isAdmin(user)) {
    el.innerHTML = `
      <div class="eyebrow">// ADMIN</div>
      <h1 class="page-title" style="color:var(--accent-gold)">admin</h1>
      <div class="panel gate">
        <p>This area is for state/alliance leadership.</p>
        ${
          user
            ? `<p style="font-size:12px;">Signed in as ${user.name} (role: ${roleLabel(user.role)}) — not an admin/R4/leader.</p>`
            : `<button class="btn primary" id="gateSignIn">Sign in</button>`
        }
      </div>
    `;
    el.querySelector("#gateSignIn")?.addEventListener("click", openSignIn);
    return;
  }

  const st = Store.state;
  const allMembers = Store.members;
  // Officers only manage their own alliance's roster here — the full
  // admin role (not officer) still sees everyone. This scopes both the
  // Members table and the Bag submissions table below, since both are
  // built from `members`.
  const officerScoped = user.role === "officer";
  const members = officerScoped ? allMembers.filter((m) => m.alliance === user.alliance) : allMembers;
  const alliances = Store.alliances;
  const furnaceFc = Store.furnaceFc;
  const bagSubs = Store.bagSubmissions;

  el.innerHTML = `
    <div class="eyebrow">// LEADERSHIP</div>
    <h1 class="page-title" style="color:var(--accent-gold)">admin</h1>
    ${
      officerScoped
        ? `<div class="panel" style="background:rgba(255,176,32,.1);border-color:var(--accent-amber);">
            <span style="font-size:12px;color:var(--accent-amber);">✎ R4 view — Members and Bag submissions only. State config, alliance tags, SvS bulk actions, furnace brackets, and feedback moderation are admin-only.</span>
          </div>`
        : ""
    }

    ${
      officerScoped
        ? ""
        : `
    <div class="panel">
      <div class="planner-header"><strong>State config</strong></div>
      <div class="field-row">
        <div class="field"><label>OUR STATE #</label><input id="admStateNum" value="${st.stateNumber}" /></div>
        <div class="field"><label>ENEMY STATE #</label><input id="admEnemy" value="${st.enemyState}" /></div>
        <div class="field"><label>NEXT SVS DATE</label><input id="admDate" type="date" value="${st.svsDate}" /></div>
        <div class="field"><label>MAX FURNACE LEVEL</label><input id="admFurnace" value="${st.maxFurnaceLevel || ""}" /></div>
      </div>
      <button class="btn primary small" id="admSaveState">Save</button>
      <span id="admStateMsg" style="margin-left:10px;font-size:12px;color:var(--accent-green);"></span>
    </div>

    <div class="panel">
      <div class="planner-header"><strong>Supabase sync</strong></div>
      <p style="font-size:11.5px;color:var(--text-dim);margin-top:-6px;">
        ${
          supabaseClient
            ? "Every change here already saves to Supabase automatically the instant you make it — this button re-pushes everything currently loaded (members, schedule, bag submissions, feedback, alliances, state config) right now, in case anything didn't save the first time (e.g. you were offline briefly)."
            : "Supabase isn't configured for this site yet (SUPABASE_CONFIG is blank in data.js), so this button has nothing to sync to — data is saved to this browser's localStorage only. See README.md → \"Going multi-user\" to set it up."
        }
      </p>
      <button class="btn small ${supabaseClient ? "primary" : ""}" id="admForceSync" ${supabaseClient ? "" : "disabled"}>⏫ Force Sync to Supabase</button>
      <span id="admSyncMsg" style="margin-left:10px;font-size:12px;"></span>
    </div>

    <div class="panel">
      <div class="planner-header"><strong>Alliances (${alliances.length})</strong></div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
        ${
          alliances
            .map(
              (a, i) => `
          <span style="display:flex;align-items:center;gap:6px;background:var(--panel-2);border:1px solid var(--border);border-radius:4px;padding:5px 6px 5px 10px;font-size:12px;">
            ${allianceBadgeHtml(a)}
            ${escapeHtml(a)}
            <input type="color" data-acolor="${escapeHtml(a)}" value="${Store.allianceColors[a] || "#8a8f98"}" title="Highlight color for ${escapeHtml(a)} (used on EXPORT DAY)" style="width:20px;height:20px;padding:0;border:none;border-radius:3px;background:none;cursor:pointer;" />
            <button data-adel="${i}" style="background:none;border:none;color:var(--accent-red);font-size:11px;">✕</button>
          </span>`
            )
            .join("") || `<span class="empty" style="padding:4px 0;">No alliances yet.</span>`
        }
      </div>
      <div style="display:flex;gap:8px;">
        <input id="admNewAlliance" placeholder="New alliance tag (e.g. SYP)..." style="flex:1;background:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:8px 10px;font-size:12px;" />
        <button class="btn small primary" id="admAddAlliance">Add alliance</button>
      </div>
    </div>
    `
    }

    <div class="panel">
      <div class="planner-header"><strong>Members (${members.length}${officerScoped ? ` / ${allMembers.length}` : ""})</strong></div>
      <p style="font-size:11.5px;color:var(--text-dim);margin-top:-6px;">New members create their own PIN via "New Member" on the sign-in screen. Reset PIN lets you set a member's PIN directly (e.g. if they're locked out) — they'll need that exact PIN on their next sign-in.</p>
      ${
        officerScoped
          ? `<p style="font-size:11.5px;color:var(--accent-amber);margin-top:-4px;">Showing ${escapeHtml(user.alliance || "your alliance")} only — R4s see their own alliance's roster, not the whole state.</p>`
          : ""
      }
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>USER NAME</th><th>GAMER ID</th><th>ALLIANCE</th><th>RESET PIN</th><th>RANK</th><th></th></tr></thead>
          <tbody>
            ${members
              .map(
                (m) => `
              <tr>
                <td><input data-mfield="name" data-mid="${m.id}" value="${escapeHtml(m.name)}" ${m.permanent ? `disabled title="Permanent admin login — name can't be changed"` : ""} style="width:100%;background:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:3px;padding:5px 8px;font-size:12px;${m.permanent ? "opacity:.6;" : ""}" /></td>
                <td><input data-mfield="gamerId" data-mid="${m.id}" value="${escapeHtml(m.gamerId || "")}" placeholder="—" style="width:100%;background:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:3px;padding:5px 8px;font-size:12px;" /></td>
                <td>
                  <select data-mfield="alliance" data-mid="${m.id}" style="background:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:3px;padding:5px 8px;font-size:12px;">
                    <option value="">—</option>
                    ${alliances.map((a) => `<option ${m.alliance === a ? "selected" : ""}>${escapeHtml(a)}</option>`).join("")}
                    ${m.alliance && !alliances.includes(m.alliance) ? `<option selected>${escapeHtml(m.alliance)}</option>` : ""}
                  </select>
                </td>
                <td>
                  ${
                    m.permanent
                      ? `<span style="font-size:10.5px;color:var(--text-faint);" title="Standing admin login — always PIN ${escapeHtml(PERMANENT_ADMIN_MEMBER.pin)}">permanent login</span>`
                      : m.pin
                      ? `<button data-mresetpin="${m.id}" class="btn small" style="font-size:10.5px;color:var(--accent-amber);">Reset PIN</button>`
                      : `<span style="font-size:10.5px;color:var(--text-faint);">no PIN yet</span>`
                  }
                </td>
                <td>
                  ${
                    m.permanent
                      ? `<span style="font-size:12px;color:var(--text-dim);" title="This is the permanent admin login — its rank can't be changed">${escapeHtml(roleLabel(m.role))}</span>`
                      : officerScoped
                      ? `<span style="font-size:12px;color:var(--text-dim);" title="Only the admin role can change rank">${escapeHtml(roleLabel(m.role))}</span>`
                      : `<select data-mfield="role" data-mid="${m.id}" style="background:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:3px;padding:5px 8px;font-size:12px;">
                          ${["member", "officer", "admin"].map((r) => `<option value="${r}" ${m.role === r ? "selected" : ""}>${roleLabel(r)}</option>`).join("")}
                        </select>`
                  }
                </td>
                <td>
                  <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:nowrap;">
                    ${canEditMemberBag(user) ? `<button data-medit2="${m.id}" class="btn small" style="white-space:nowrap;">Edit Bag</button>` : ""}
                    ${!officerScoped && !m.permanent ? `<button data-mdel="${m.id}" class="btn small" style="color:var(--accent-red);">✕</button>` : ""}
                  </div>
                </td>
              </tr>`
              )
              .join("") || `<tr><td colspan="6">No members yet.</td></tr>`}
          </tbody>
        </table>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <input id="admNewMember" placeholder="New member name..." style="flex:1;background:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:8px 10px;font-size:12px;" />
        <input id="admNewGamerId" placeholder="Gamer ID (optional)..." style="width:150px;background:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:8px 10px;font-size:12px;" />
        <input id="admNewPin" placeholder="4-digit PIN..." inputmode="numeric" maxlength="4" style="width:110px;letter-spacing:.2em;background:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:8px 10px;font-size:12px;" />
        <button class="btn small primary" id="admAddMember">Add member</button>
      </div>
    </div>

    ${
      officerScoped
        ? ""
        : `
    <div class="panel">
      <div class="planner-header"><strong>SvS prep — bulk actions</strong></div>
      <p style="font-size:12px;color:var(--text-dim);">${countFilledSlots()} slots currently booked across all days.</p>
      <button class="btn small" id="admClearSlots" style="color:var(--accent-red);">Clear all booked slots</button>
      <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border);">
        <p style="font-size:12px;color:var(--text-dim);margin:0 0 8px;">Reset the planner for a new SvS cycle — clears every member's bag entries, drafts, submissions, points, and selected time slots, plus the booked SCHEDULE grid those slots feed. Member accounts, PINs, and roles are untouched.</p>
        <button class="btn small primary" id="admClearBags" style="background:var(--accent-red);border-color:var(--accent-red);">🗑 Clear Bags (reset for new cycle)</button>
      </div>
    </div>

    <div class="panel">
      <div class="planner-header"><strong>Furnace brackets (${furnaceFc.length})</strong></div>
      <p style="font-size:12px;color:var(--text-dim);margin-top:-6px;">Options for the backpack form's "current furnace level" field.</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
        ${
          furnaceFc
            .map(
              (c, i) => `
          <span style="display:flex;align-items:center;gap:6px;background:var(--panel-2);border:1px solid var(--border);border-radius:4px;padding:5px 6px 5px 10px;font-size:12px;">
            ${escapeHtml(c)}
            <button data-cdel="${i}" style="background:none;border:none;color:var(--accent-red);font-size:11px;">✕</button>
          </span>`
            )
            .join("") || `<span class="empty" style="padding:4px 0;">No brackets yet.</span>`
        }
      </div>
      <div style="display:flex;gap:8px;">
        <input id="admNewCategory" placeholder="New bracket (e.g. FC11)..." style="flex:1;background:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:8px 10px;font-size:12px;" />
        <button class="btn small primary" id="admAddCategory">Add bracket</button>
      </div>
    </div>
    `
    }

    <div class="panel">
      <div class="planner-header"><strong>Bag submissions (${members.filter((m) => bagSubs[m.id]).length} / ${members.length})</strong></div>
      <p style="font-size:12px;color:var(--text-dim);margin-top:-6px;">Projected SvS points from each member's backpack submission.</p>
      <div style="overflow-x:auto;">
        <table>
          <thead><tr><th>MEMBER</th>${BAG_SECTIONS.map((s) => `<th>${s.title.replace(/^D\d\s*—\s*/, "")}</th>`).join("")}<th>TOTAL</th><th>UPDATED</th><th></th></tr></thead>
          <tbody>
            ${
              members
                .map((m) => {
                  const sub = bagSubs[m.id];
                  const editBtn = `<td>${
                    canEditMemberBag(user)
                      ? `<button data-medit="${m.id}" class="btn small">Edit</button>`
                      : `<span style="font-size:10.5px;color:var(--text-faint);" title="Only the admin role can edit another member's bag">admin only</span>`
                  }</td>`;
                  if (!sub) return `<tr><td>${escapeHtml(m.name)}</td>${BAG_SECTIONS.map(() => `<td>—</td>`).join("")}<td>—</td><td>—</td>${editBtn}</tr>`;
                  const { bySection, total } = computeBagPoints(sub.values);
                  return `<tr><td>${escapeHtml(m.name)}</td>${bySection
                    .map((s) => `<td>${fmtNum(s.points)}</td>`)
                    .join("")}<td><strong>${fmtNum(total)}</strong></td><td>${new Date(sub.updatedAt).toLocaleDateString()}</td>${editBtn}</tr>`;
                })
                .join("") || `<tr><td colspan="${BAG_SECTIONS.length + 4}">No members yet.</td></tr>`
            }
          </tbody>
          ${
            members.some((m) => bagSubs[m.id])
              ? (() => {
                  const submitted = members.map((m) => bagSubs[m.id]).filter(Boolean);
                  const sectionTotals = BAG_SECTIONS.map((s) =>
                    submitted.reduce((sum, sub) => sum + (computeBagPoints(sub.values).bySection.find((bs) => bs.title === s.title)?.points || 0), 0)
                  );
                  const grandTotal = submitted.reduce((sum, sub) => sum + computeBagPoints(sub.values).total, 0);
                  return `<tfoot><tr style="font-weight:700;border-top:2px solid var(--border);">
                    <td>ALLIANCE TOTAL${officerScoped ? ` (${user.alliance || "—"})` : ""}</td>
                    ${sectionTotals.map((t) => `<td>${fmtNum(t)}</td>`).join("")}
                    <td>${fmtNum(grandTotal)}</td>
                    <td></td><td></td>
                  </tr></tfoot>`;
                })()
              : ""
          }
        </table>
      </div>
    </div>

    ${
      officerScoped
        ? ""
        : `
    <div class="panel">
      <div class="planner-header"><strong>Feedback moderation (${Store.feedback.length})</strong></div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${Store.feedback
          .map(
            (it, i) => `
          <div style="display:flex;gap:8px;align-items:center;background:var(--panel-2);border:1px solid var(--border);border-radius:4px;padding:8px 10px;">
            <span style="flex:1;font-size:12px;">${escapeHtml(it.title || it.body.slice(0, 40))} <span style="color:var(--text-faint);">(${it.votes} votes)</span></span>
            <select data-fstatus="${i}" style="background:var(--panel);border:1px solid var(--border);color:var(--text);border-radius:3px;padding:4px 6px;font-size:11px;">
              ${["open", "planned", "done"].map((s) => `<option ${it.status === s ? "selected" : ""}>${s}</option>`).join("")}
            </select>
            <button data-fdel="${i}" class="btn small" style="color:var(--accent-red);">✕</button>
          </div>`
          )
          .join("") || `<div class="empty">No feedback submitted yet.</div>`}
      </div>
    </div>
    `
    }
  `;

  // These panels (state config, alliances, furnace brackets, SvS bulk
  // actions, feedback moderation) aren't rendered at all for an officer —
  // guard every single-element lookup with ?. so wiring them up doesn't
  // throw when the elements simply don't exist this render.
  el.querySelector("#admAddAlliance")?.addEventListener("click", () => {
    const tag = el.querySelector("#admNewAlliance").value.trim();
    if (!tag) return;
    const a = Store.alliances;
    if (!a.includes(tag)) a.push(tag);
    Store.alliances = a;
    renderAdmin(el);
  });
  el.querySelectorAll("[data-acolor]").forEach((inp) =>
    inp.addEventListener("change", () => {
      const colors = Store.allianceColors;
      colors[inp.dataset.acolor] = inp.value;
      Store.allianceColors = colors;
      renderAdmin(el);
    })
  );
  el.querySelectorAll("[data-adel]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.adel);
      const a = Store.alliances;
      a.splice(i, 1);
      Store.alliances = a;
      renderAdmin(el);
    })
  );

  el.querySelector("#admAddCategory")?.addEventListener("click", () => {
    const name = el.querySelector("#admNewCategory").value.trim();
    if (!name) return;
    const c = Store.furnaceFc;
    if (!c.includes(name)) c.push(name);
    Store.furnaceFc = c;
    renderAdmin(el);
  });
  el.querySelectorAll("[data-cdel]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.cdel);
      const c = Store.furnaceFc;
      c.splice(i, 1);
      Store.furnaceFc = c;
      renderAdmin(el);
    })
  );

  el.querySelector("#admSaveState")?.addEventListener("click", () => {
    Store.state = {
      ...st,
      stateNumber: el.querySelector("#admStateNum").value.trim(),
      enemyState: el.querySelector("#admEnemy").value.trim(),
      svsDate: el.querySelector("#admDate").value,
      maxFurnaceLevel: el.querySelector("#admFurnace").value.trim(),
    };
    el.querySelector("#admStateMsg").textContent = "Saved.";
    renderShell();
  });

  el.querySelector("#admForceSync")?.addEventListener("click", async () => {
    const btn = el.querySelector("#admForceSync");
    const msgEl = el.querySelector("#admSyncMsg");
    btn.disabled = true;
    msgEl.style.color = "var(--text-dim)";
    msgEl.textContent = "Syncing…";
    const result = await Store.forceSyncToSupabase();
    btn.disabled = false;
    if (result.ok) {
      msgEl.style.color = "var(--accent-green)";
      msgEl.textContent = `Synced ${result.count} data sets to Supabase.`;
    } else if (result.reason === "not_configured") {
      msgEl.style.color = "var(--accent-red)";
      msgEl.textContent = "Supabase isn't configured — nothing to sync to.";
    } else {
      msgEl.style.color = "var(--accent-red)";
      msgEl.textContent = `Sync failed for: ${(result.failedKeys || []).join(", ")}. Check the browser console for details.`;
    }
  });

  el.querySelectorAll("[data-mfield]").forEach((input) =>
    input.addEventListener("change", () => {
      const id = input.dataset.mid;
      const field = input.dataset.mfield;
      const m = Store.members;
      const idx = m.findIndex((mm) => mm.id === id);
      if (idx === -1) return;
      m[idx][field] = input.value;
      Store.members = m;
      if (Store.currentUser && Store.currentUser.id === id) {
        Store.currentUser = m[idx];
        // renderShell() rebuilds the topbar AND swaps in a fresh <main
        // id="app">, orphaning whatever was rendered into the old one — so
        // the current page (this admin panel, most often, since that's
        // where you'd edit your own row) needs a real re-render, not just
        // the shell refresh.
        renderShell();
        router();
        return;
      }
      // An officer editing a member's alliance can move that member out of
      // (or into) the officer's own filtered view — re-render so the table
      // reflects that immediately instead of showing a stale row.
      if (field === "alliance" && Store.currentUser && Store.currentUser.role === "officer") {
        renderAdmin(el);
      }
    })
  );
  el.querySelectorAll("[data-mdel]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const id = btn.dataset.mdel;
      // Defensive re-check — this button never renders for the permanent
      // admin account in the first place (see canEditMemberBag-style
      // gating above), but even if it's deleted some other way,
      // ensurePermanentAdmin() in data.js re-adds it on the very next load.
      if (id === PERMANENT_ADMIN_MEMBER.id) return;
      const m = Store.members.filter((mm) => mm.id !== id);
      Store.members = m;
      renderAdmin(el);
    })
  );
  el.querySelectorAll("[data-mresetpin]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const id = btn.dataset.mresetpin;
      const m = Store.members;
      const idx = m.findIndex((mm) => mm.id === id);
      if (idx === -1) return;
      // The admin sets the new PIN directly (rather than clearing it for
      // anyone to claim on the next login) — that would let anyone who
      // knows this member's name sign in as them before the real member
      // gets a chance to. Give the new PIN to the actual member out of band.
      const newPin = (prompt(`Set a new 4-digit PIN for ${m[idx].name}:`) || "").trim();
      if (!newPin) return; // cancelled
      if (!/^\d{4}$/.test(newPin)) {
        alert("PIN must be exactly 4 digits.");
        return;
      }
      m[idx].pin = newPin;
      Store.members = m;
      if (Store.currentUser && Store.currentUser.id === id) {
        // Sign them out so they re-authenticate with the PIN just set,
        // rather than continuing on a stale in-memory session. Flush first
        // in case they have an in-progress bag draft pending autosave.
        flushDraftAutosave();
        Store.currentUser = null;
        renderShell();
        router();
        return;
      }
      renderAdmin(el);
    })
  );
  el.querySelector("#admNewPin")?.addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 4);
  });
  el.querySelector("#admAddMember").onclick = () => {
    const name = el.querySelector("#admNewMember").value.trim();
    const gamerId = el.querySelector("#admNewGamerId").value.trim();
    const pin = el.querySelector("#admNewPin").value.trim();
    if (!name) return;
    if (!/^\d{4}$/.test(pin)) {
      alert("Enter a 4-digit PIN for this member so they can sign in.");
      return;
    }
    // Officers only ever see their own alliance here, so a member they add
    // needs that alliance from the start — otherwise it'd default blank and
    // immediately vanish from their filtered table.
    const alliance = officerScoped ? user.alliance || "" : "";
    Store.members = [...Store.members, { id: "m" + Date.now(), name, gamerId, alliance, role: "member", pin }];
    renderAdmin(el);
  };
  el.querySelector("#admClearSlots")?.addEventListener("click", () => {
    const sched = Store.schedule;
    Object.keys(sched).forEach((day) => sched[day].forEach((s) => (s.member = null)));
    Store.schedule = sched;
    renderAdmin(el);
  });
  // Full bag-cycle reset — every member's bag data (entries, drafts,
  // submissions, calculated points, and their selected time slots) plus
  // the SCHEDULE grid those slot selections feed into. Deliberately does
  // NOT touch Store.members (accounts, PINs, gamer names/IDs, alliance
  // tags, roles) or anything else — same admin-only gating as every other
  // control in this panel (canSeeSchedule/officerScoped above), plus the
  // confirmation below since this is a state-wide, irreversible action.
  el.querySelector("#admClearBags")?.addEventListener("click", () => {
    const confirmed = confirm(
      "Are you sure you want to clear ALL member bags? This will permanently remove all current bag entries, submissions, saved drafts, points, and selected time slots for every member. Member accounts and profile information will NOT be deleted."
    );
    if (!confirmed) return;

    Store.bagSubmissions = {};
    Store.bagDrafts = {};
    // Fresh objects (not the shared SEED_SCHEDULE/SEED_SCHEDULE_PUBLISHED
    // constants) — those are reused as fallback defaults elsewhere, and
    // Store's Supabase-mode cache can hold onto whatever reference is
    // assigned here, so reusing the constants directly would risk a later
    // read-modify-write mutating the shared seed data itself.
    Store.schedule = SEED_SCHEDULE_DAYS.reduce((acc, day) => { acc[day] = emptySlots(); return acc; }, {});
    Store.schedulePublished = SEED_SCHEDULE_DAYS.reduce((acc, day) => { acc[day] = false; return acc; }, {});

    // Drop any in-progress MY BAG wizard state (this admin's own, or one
    // they're editing on a member's behalf), and cancel any debounced
    // autosave still pending — otherwise it could fire moments later and
    // write stale, just-cleared data straight back into the store.
    clearTimeout(draftSaveTimer);
    draftSaveTimer = null;
    svsDraft = null;
    svsEditingMemberId = null;

    renderAdmin(el);
  });
  const openMemberBagEditor = (memberId) => {
    // Defensive re-check even though these buttons only render for a full
    // admin in the first place — see canEditMemberBag.
    if (!canEditMemberBag(Store.currentUser)) return;
    svsEditingMemberId = memberId;
    svsDraft = null; // force a fresh load of this member's draft
    svsWizardStep = "backpack";
    svsTab = "request";
    navigate("/svs");
  };
  el.querySelectorAll("[data-medit]").forEach((btn) =>
    btn.addEventListener("click", () => openMemberBagEditor(btn.dataset.medit))
  );
  el.querySelectorAll("[data-medit2]").forEach((btn) =>
    btn.addEventListener("click", () => openMemberBagEditor(btn.dataset.medit2))
  );
  el.querySelectorAll("[data-fstatus]").forEach((sel) =>
    sel.addEventListener("change", () => {
      const i = Number(sel.dataset.fstatus);
      const fb = Store.feedback;
      fb[i].status = sel.value;
      Store.feedback = fb;
    })
  );
  el.querySelectorAll("[data-fdel]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.fdel);
      const fb = Store.feedback;
      fb.splice(i, 1);
      Store.feedback = fb;
      renderAdmin(el);
    })
  );
}


// ---------------------------------------------------------------------------
// ALLIANCE CHAMPIONSHIP — lane planner
// Admin-only tool. Screenshots -> client-side OCR extract (Tesseract.js) ->
// editable review list -> auto-balance into 3 lanes (two "primary" lanes
// maxed to 20/20 and balanced by total power, the third lane holds whoever
// is left over) -> manual drag/swap/edit -> explicit Save/Clear. See
// balanceChampionshipLanes, parseChampionshipOcrText, DEFAULT_CHAMPIONSHIP
// etc. in data.js for the underlying data model and algorithm.
//
// Deliberately NOT wired into the bag planner's debounced autosave system:
// this is an admin planning tool with its own explicit "Save Championship
// Plan" button (per the feature request), not a per-member form that needs
// to survive an accidental refresh mid-keystroke. Working edits live in
// champWorking (in-memory only, a deep copy of the last-saved plan) until
// Save writes them back to Store.championship; Clear wipes both. Reloading
// the page always starts from whatever was last explicitly saved.
//
// Store.championship is its own key, completely separate from
// Store.members/bagSubmissions/bagDrafts/schedule — nothing in this section
// ever reads or writes any of those, and nothing in the bag planner reads
// or writes this.
// ---------------------------------------------------------------------------
let champWorking = null; // deep-copied working draft of Store.championship, or null before first load
let champDirty = false; // true once champWorking differs from the last-saved Store.championship
let champOcrBusy = false;
let champOcrStatus = "";
let champDragId = null; // id of the player currently mid-drag

function ensureChampWorking() {
  if (!champWorking) {
    const saved = Store.championship;
    champWorking = {
      players: (saved.players || []).map((p) => ({ ...p })),
      lanes: {
        left: [...(saved.lanes?.left || [])],
        middle: [...(saved.lanes?.middle || [])],
        right: [...(saved.lanes?.right || [])],
      },
      primaryPair: saved.primaryPair || "left_right",
    };
    champDirty = false;
  }
  return champWorking;
}

function champPlayerById(id) {
  return champWorking.players.find((p) => p.id === id) || null;
}

function laneOf(id) {
  return LANE_KEYS.find((k) => (champWorking.lanes[k] || []).includes(id)) || null;
}

function champUnassignedIds() {
  const assigned = new Set(LANE_KEYS.flatMap((k) => champWorking.lanes[k] || []));
  return champWorking.players.filter((p) => !assigned.has(p.id)).map((p) => p.id);
}

function champLaneTotal(key) {
  return (champWorking.lanes[key] || []).reduce((sum, id) => sum + (champPlayerById(id)?.power || 0), 0);
}

function newChampPlayerId() {
  return "cp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Merges freshly-OCR'd (or manually typed) rows into the working roster,
// skipping anyone already on the list (case-insensitive name match) so
// re-uploading an overlapping screenshot never creates a duplicate. Returns
// how many NEW players were added.
function mergeChampionshipImports(found) {
  const existingNames = new Set(champWorking.players.map((p) => p.name.trim().toLowerCase()));
  let added = 0;
  found.forEach((f) => {
    const key = (f.name || "").trim().toLowerCase();
    if (!key || existingNames.has(key)) return;
    existingNames.add(key);
    champWorking.players.push({ id: newChampPlayerId(), rank: f.rank ?? null, name: f.name.trim(), power: f.power });
    added++;
  });
  if (added) champDirty = true;
  return added;
}

// Moves a player into targetLane (one of LANE_KEYS), or out to "unassigned"
// when targetLane is falsy. Refuses (with an alert, no partial change) if
// the target lane is already at the 20-player cap.
function moveChampionshipPlayer(id, targetLane) {
  if (targetLane && (champWorking.lanes[targetLane] || []).length >= CHAMPIONSHIP_LANE_CAP && laneOf(id) !== targetLane) {
    alert(`${LANE_LABELS[targetLane]} lane is already full (${CHAMPIONSHIP_LANE_CAP}/${CHAMPIONSHIP_LANE_CAP}).`);
    return false;
  }
  LANE_KEYS.forEach((k) => { champWorking.lanes[k] = (champWorking.lanes[k] || []).filter((pid) => pid !== id); });
  if (targetLane && LANE_KEYS.includes(targetLane)) champWorking.lanes[targetLane].push(id);
  champDirty = true;
  return true;
}

// Swaps two players' lane assignments (either side may currently be
// "unassigned") — always allowed, since a straight swap can never push a
// lane past its existing size, let alone its cap.
function swapChampionshipPlayers(idA, idB) {
  if (idA === idB) return;
  const laneA = laneOf(idA);
  const laneB = laneOf(idB);
  if (laneA === laneB) return; // both unassigned, or already in the same lane — nothing to do
  LANE_KEYS.forEach((k) => {
    champWorking.lanes[k] = champWorking.lanes[k].filter((pid) => pid !== idA && pid !== idB);
  });
  if (laneB) champWorking.lanes[laneB].push(idA);
  if (laneA) champWorking.lanes[laneA].push(idB);
  champDirty = true;
}

function deleteChampionshipPlayer(id) {
  LANE_KEYS.forEach((k) => { champWorking.lanes[k] = (champWorking.lanes[k] || []).filter((pid) => pid !== id); });
  champWorking.players = champWorking.players.filter((p) => p.id !== id);
  champDirty = true;
}

function championshipPlayerRowHtml(p) {
  if (!p) return "";
  return `
    <div class="rank-item" draggable="true" data-cpid="${p.id}">
      <div class="left">
        <span class="name">${escapeHtml(p.name)}</span>
        ${p.rank != null ? `<span class="desc">Screenshot rank #${p.rank}</span>` : ""}
      </div>
      <span class="score">${formatFullNumber(p.power)}</span>
    </div>
  `;
}

function championshipLanePanelHtml(key, isOverflow, w, total) {
  const ids = w.lanes[key] || [];
  return `
    <div class="panel">
      <div class="planner-header">
        <strong style="color:var(--accent-green);">${LANE_LABELS[key]}</strong>
        <span class="status-badge ${isOverflow ? "planned" : "done"}">${isOverflow ? "OVERFLOW" : "PRIMARY"}</span>
      </div>
      <div class="summary-row"><span class="k">PLAYERS</span><span class="v">${ids.length} / ${CHAMPIONSHIP_LANE_CAP}</span></div>
      <div class="summary-row"><span class="k">TOTAL POWER</span><span class="v">${formatFullNumber(total)}</span></div>
      <div class="lane-drop" data-lanedrop="${key}" style="min-height:60px;margin-top:8px;">
        ${
          ids.length
            ? `<div class="rank-list">${ids.map((id) => championshipPlayerRowHtml(champPlayerById(id))).join("")}</div>`
            : `<div class="empty">Drop players here.</div>`
        }
      </div>
    </div>
  `;
}

function renderChampionship(el) {
  const user = Store.currentUser;
  if (!user) {
    el.innerHTML = `
      <div class="panel" style="text-align:center;padding:32px 20px;">
        <div class="eyebrow" style="color:var(--accent-green);margin-bottom:10px;">SIGN IN REQUIRED</div>
        <p style="font-size:12.5px;color:var(--text-dim);margin:0 0 16px;">The Alliance Championship planner is for alliance leadership. Sign in to continue.</p>
        <button class="btn primary" id="chGoSignIn">Sign in</button>
      </div>
    `;
    el.querySelector("#chGoSignIn").onclick = openSignIn;
    return;
  }
  if (user.role !== "admin") {
    el.innerHTML = `
      <div class="eyebrow">// ALLIANCE CHAMPIONSHIP</div>
      <h1 class="page-title" style="color:var(--accent-green)">championship</h1>
      <div class="panel gate">
        <p>This tool is for state/alliance leadership.</p>
        <p style="font-size:12px;">Signed in as ${escapeHtml(user.name)} (${roleLabel(user.role)}) — ask an admin for access if you need to plan Championship lanes.</p>
      </div>
    `;
    return;
  }

  ensureChampWorking();
  const w = champWorking;
  const sortedPlayers = [...w.players].sort((a, b) => b.power - a.power);
  const primaryKeys = PRIMARY_PAIR_LANES[w.primaryPair] || PRIMARY_PAIR_LANES.left_right;
  const overflowKey = LANE_KEYS.find((k) => !primaryKeys.includes(k));
  const totals = Object.fromEntries(LANE_KEYS.map((k) => [k, champLaneTotal(k)]));
  const primaryDiff = Math.abs(totals[primaryKeys[0]] - totals[primaryKeys[1]]);
  const unassignedIds = champUnassignedIds();
  const hasLaneData = LANE_KEYS.some((k) => (w.lanes[k] || []).length > 0);
  const showLanes = sortedPlayers.length > 0;

  el.innerHTML = `
    <div class="eyebrow">// ALLIANCE CHAMPIONSHIP</div>
    <h1 class="page-title" style="color:var(--accent-green)">championship</h1>
    <p style="font-size:12.5px;color:var(--text-dim);margin:-6px 0 16px;">
      Import the Championship player list from screenshots, review it, then auto-balance two maxed 20-player lanes as evenly as possible — everyone else overflows into the third lane. Separate from bag planning; nothing here touches member accounts, PINs, or bag data.
    </p>

    <div class="section-title">UPLOAD SCREENSHOTS</div>
    <div class="panel">
      <p style="font-size:12px;color:var(--text-dim);margin:0 0 12px;">Upload one or more screenshots of the Alliance Championship player rankings. Overlapping screenshots are fine — players already on the list below won't be added twice.</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <input type="file" id="champFiles" accept="image/*" multiple style="max-width:280px;font-size:12px;color:var(--text-dim);" />
        <button class="btn primary small" id="champProcess" ${champOcrBusy ? "disabled" : ""}>${champOcrBusy ? "Processing…" : "Process Screenshots"}</button>
      </div>
      ${champOcrStatus ? `<p style="font-size:11.5px;color:var(--text-faint);margin:10px 0 0;">${escapeHtml(champOcrStatus)}</p>` : ""}
    </div>

    <div class="section-title">PLAYER LIST — REVIEW &amp; CORRECT</div>
    <div class="panel">
      ${
        sortedPlayers.length
          ? `<div style="overflow-x:auto;">
              <table>
                <thead><tr><th>RANK</th><th>PLAYER</th><th>POWER</th><th></th></tr></thead>
                <tbody>
                  ${sortedPlayers
                    .map(
                      (p, i) => `
                    <tr>
                      <td>#${i + 1}</td>
                      <td><input type="text" data-cpname="${p.id}" value="${escapeHtml(p.name)}" style="width:100%;min-width:120px;background:var(--panel-2);border:1px solid var(--border);color:var(--text);padding:6px 8px;border-radius:4px;font-size:12.5px;" /></td>
                      <td><input type="text" inputmode="decimal" data-cppower="${p.id}" value="${formatFullNumber(p.power)}" style="width:100%;min-width:110px;background:var(--panel-2);border:1px solid var(--border);color:var(--text);padding:6px 8px;border-radius:4px;font-size:12.5px;" /></td>
                      <td><button class="btn small" data-cpdel="${p.id}" style="color:var(--accent-red);">delete</button></td>
                    </tr>`
                    )
                    .join("")}
                </tbody>
              </table>
            </div>`
          : `<div class="empty">No players imported yet — upload screenshots above or add one manually.</div>`
      }
      <button class="btn small" id="champAddPlayer" style="margin-top:12px;">+ Add Player</button>
    </div>

    <div class="section-title">PRIMARY LANES</div>
    <div class="panel">
      <p style="font-size:12px;color:var(--text-dim);margin:0 0 12px;">Choose which two lanes get filled to 20/20 with the strongest, most evenly-matched players. The lane left out becomes the overflow lane.</p>
      <div class="pill-toggle">
        <button data-pair="left_right" class="${w.primaryPair === "left_right" ? "active" : ""}">LEFT + RIGHT</button>
        <button data-pair="left_middle" class="${w.primaryPair === "left_middle" ? "active" : ""}">LEFT + MIDDLE</button>
        <button data-pair="middle_right" class="${w.primaryPair === "middle_right" ? "active" : ""}">MIDDLE + RIGHT</button>
      </div>
      <button class="btn primary" id="champBalance" style="margin-top:14px;">${hasLaneData ? "Rebalance Lanes" : "Balance Lanes"}</button>
      ${
        w.players.length > CHAMPIONSHIP_TOTAL_CAP
          ? `<p style="font-size:11.5px;color:var(--accent-amber);margin:10px 0 0;">${w.players.length - CHAMPIONSHIP_TOTAL_CAP} lowest-power player(s) beyond the ${CHAMPIONSHIP_TOTAL_CAP}-player cap will be left unassigned.</p>`
          : ""
      }
    </div>

    ${
      showLanes
        ? `
    <div class="section-title">RESULTS</div>
    <div class="summary-row" style="margin-bottom:12px;">
      <span class="k">PRIMARY LANES POWER DIFFERENCE (${LANE_LABELS[primaryKeys[0]]} vs ${LANE_LABELS[primaryKeys[1]]})</span>
      <span class="v" style="color:var(--accent-green);">${formatFullNumber(primaryDiff)}</span>
    </div>
    <div class="lane-grid">
      ${LANE_KEYS.map((key) => championshipLanePanelHtml(key, key === overflowKey, w, totals[key])).join("")}
    </div>
    <div class="section-title">UNASSIGNED${w.players.length > CHAMPIONSHIP_TOTAL_CAP ? ` <span style="color:var(--text-faint);font-weight:400;">(includes anyone beyond the ${CHAMPIONSHIP_TOTAL_CAP}-player cap)</span>` : ""}</div>
    <div class="panel lane-drop" data-lanedrop="" style="min-height:60px;">
      ${
        unassignedIds.length
          ? `<div class="rank-list">${unassignedIds.map((id) => championshipPlayerRowHtml(champPlayerById(id))).join("")}</div>`
          : `<div class="empty">Everyone is assigned to a lane.</div>`
      }
    </div>`
        : ""
    }

    <div style="display:flex;gap:10px;margin-top:20px;flex-wrap:wrap;align-items:center;">
      <button class="btn primary" id="champSave">Save Championship Plan</button>
      <button class="btn small" id="champClear" style="color:var(--accent-red);">Clear Championship Plan</button>
      ${champDirty ? `<span style="font-size:11.5px;color:var(--accent-amber);">Unsaved changes</span>` : ""}
    </div>
  `;

  wireChampionshipHandlers(el);
}

function wireChampionshipHandlers(el) {
  el.querySelector("#champProcess")?.addEventListener("click", async () => {
    const input = el.querySelector("#champFiles");
    const files = input?.files ? Array.from(input.files) : [];
    if (!files.length) { alert("Choose one or more screenshot images first."); return; }
    if (typeof Tesseract === "undefined") {
      champOcrStatus = "OCR library failed to load — check your internet connection and try again.";
      renderChampionship(el);
      return;
    }
    champOcrBusy = true;
    champOcrStatus = `Reading ${files.length} screenshot${files.length === 1 ? "" : "s"}…`;
    renderChampionship(el);
    let totalAdded = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        champOcrStatus = `Reading screenshot ${i + 1} of ${files.length}…`;
        const { data } = await Tesseract.recognize(files[i], "eng");
        const found = parseChampionshipOcrText(data.text);
        totalAdded += mergeChampionshipImports(found);
      }
      champOcrStatus = `Done — added ${totalAdded} new player${totalAdded === 1 ? "" : "s"} from ${files.length} screenshot${files.length === 1 ? "" : "s"}. Review the list below before balancing.`;
    } catch (err) {
      console.error("Championship OCR failed:", err);
      champOcrStatus = "Couldn't read one of those screenshots — try a clearer image, or add players manually below.";
    }
    champOcrBusy = false;
    renderChampionship(el);
  });

  el.querySelector("#champAddPlayer")?.addEventListener("click", () => {
    champWorking.players.push({ id: newChampPlayerId(), rank: null, name: "New Player", power: 0 });
    champDirty = true;
    renderChampionship(el);
  });

  el.querySelectorAll("[data-cpname]").forEach((inp) =>
    inp.addEventListener("change", () => {
      const p = champPlayerById(inp.dataset.cpname);
      if (p) { p.name = inp.value.trim() || p.name; champDirty = true; }
      renderChampionship(el);
    })
  );
  el.querySelectorAll("[data-cppower]").forEach((inp) =>
    inp.addEventListener("change", () => {
      const p = champPlayerById(inp.dataset.cppower);
      const parsed = parsePowerToken(inp.value);
      if (p && parsed != null) { p.power = parsed; champDirty = true; }
      renderChampionship(el);
    })
  );
  el.querySelectorAll("[data-cpdel]").forEach((btn) =>
    btn.addEventListener("click", () => {
      deleteChampionshipPlayer(btn.dataset.cpdel);
      renderChampionship(el);
    })
  );

  el.querySelectorAll("[data-pair]").forEach((btn) =>
    btn.addEventListener("click", () => {
      champWorking.primaryPair = btn.dataset.pair;
      champDirty = true;
      renderChampionship(el);
    })
  );

  el.querySelector("#champBalance")?.addEventListener("click", () => {
    if (!champWorking.players.length) { alert("Import or add at least one player first."); return; }
    champWorking.lanes = balanceChampionshipLanes(champWorking.players, champWorking.primaryPair);
    champDirty = true;
    renderChampionship(el);
  });

  // Drag-and-drop: drop a player row onto another player's row to swap the
  // two, or onto a lane's drop-zone (including the "Unassigned" panel) to
  // move it there outright.
  el.querySelectorAll("[data-cpid]").forEach((row) => {
    row.addEventListener("dragstart", (e) => {
      champDragId = row.dataset.cpid;
      row.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", champDragId);
    });
    row.addEventListener("dragend", () => { row.classList.remove("dragging"); champDragId = null; });
    row.addEventListener("dragover", (e) => e.preventDefault());
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const droppedId = champDragId || e.dataTransfer.getData("text/plain");
      const targetId = row.dataset.cpid;
      if (droppedId && targetId && droppedId !== targetId) swapChampionshipPlayers(droppedId, targetId);
      champDragId = null;
      renderChampionship(el);
    });
  });
  el.querySelectorAll("[data-lanedrop]").forEach((zone) => {
    zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("dragover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("dragover");
      const droppedId = champDragId || e.dataTransfer.getData("text/plain");
      champDragId = null;
      if (!droppedId) return;
      moveChampionshipPlayer(droppedId, zone.dataset.lanedrop || null);
      renderChampionship(el);
    });
  });

  el.querySelector("#champSave")?.addEventListener("click", () => {
    Store.championship = {
      players: champWorking.players.map((p) => ({ ...p })),
      lanes: {
        left: [...champWorking.lanes.left],
        middle: [...champWorking.lanes.middle],
        right: [...champWorking.lanes.right],
      },
      primaryPair: champWorking.primaryPair,
    };
    champDirty = false;
    renderChampionship(el);
  });

  el.querySelector("#champClear")?.addEventListener("click", () => {
    const confirmed = confirm(
      "Are you sure you want to clear the Alliance Championship plan? This will permanently remove the imported player list, screenshot data, and lane assignments. Member accounts, bags, and time slots will NOT be affected."
    );
    if (!confirmed) return;
    Store.championship = { players: [], lanes: { left: [], middle: [], right: [] }, primaryPair: "left_right" };
    champWorking = null; // force ensureChampWorking() to reload the fresh empty state
    champDirty = false;
    champOcrStatus = "";
    renderChampionship(el);
  });
}
