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
  // State Progression → Max Troop Building Level — a SEPARATE progression
  // cap from maxFurnaceLevel above (a state can be FC5 furnace / FC4
  // troop-building, or any other valid combination — never assumed equal).
  // Controls how far the SVS Alliance Signup form's three Training Camp
  // Level dropdowns extend — see SVS_SIGNUP_BUILDING_LEVELS_ALL and
  // svsSignupAvailableBuildingLevels() further down this file. Defaults to
  // the top of that list so a brand-new install isn't artificially capped
  // until an admin actually sets one.
  maxTroopBuildingLevel: "FC10",
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
    ],
  },
  {
    title: "D3 — BEAST SLAY",
    fields: [
      { key: "d3_stamina_cans", label: "Stamina Cans (1 can = 10 stamina)", rateNote: "12,000 pts per can — regular beasts cost 10 stamina each, top-tier (Lv.26-30) rate", points: 12000, staminaCalc: true },
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
// you build them out. Alliance Championship used to be one of these — it's
// a real, built page now (see renderChampionship in app.js), so it's wired
// up as its own home-page card + route instead of living in this list.
const PLANNED_TOOLS = [
  {
    id: "bears",
    title: "bear_calculator",
    desc: "Bear Trap hit planner — squad comp, gear thresholds, hit timing.",
    color: "var(--accent-teal)",
    icon: "paw",
    tag: "ANALYTICS",
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
  wos_bag_drafts: {},
  // Alliance Championship lane plans, ONE PER ALLIANCE TAG — see the
  // "Alliance Championship" block further down this file for why this is a
  // map ({ [allianceTag]: { players, lanes, primaryPair } }) rather than a
  // single shared object.
  wos_championship: {},
  // SVS Alliance Signup — { [playerId]: signupRecord }, one active signup
  // per player. See the "SVS Alliance Signup" block further down this file.
  wos_svs_signups: {},
  // Admin-controlled — whether players can currently submit/edit a signup.
  wos_svs_signups_open: true,
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
      this._set("wos_bag_drafts", {});
      this._set("wos_championship", {});
      this._set("wos_svs_signups", {});
      this._set("wos_svs_signups_open", true);
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

  // In-progress, not-yet-submitted MY BAG state — same shape as
  // bagSubmissions, keyed by memberId, and synced the same way. Auto-saved
  // (debounced) by app.js as a member fills out the wizard, so a refresh
  // or closed tab before they hit SUBMIT doesn't lose their progress. A
  // member's entry here is only ever read/written for that member's own
  // id (or, for an admin editing someone else's bag, that member's id —
  // never the admin's), so one member's draft is never exposed to
  // another. Cleared for a given member once they actually submit — see
  // the doSave() in app.js's renderWizardSubmit.
  get bagDrafts() { return this._synced("wos_bag_drafts", {}).get(); },
  set bagDrafts(v) { this._synced("wos_bag_drafts", {}).set(v); },

  // Alliance Championship lane plans — a MAP of { [allianceTag]: { players,
  // lanes, primaryPair } }, one independent dataset per alliance, separate
  // from every bag/member key above. See the "Alliance Championship" block
  // further down this file for the per-alliance access model.
  //
  // migrateLegacyChampionshipShape guards against the pre-alliance-scoping
  // shape (a single { players, lanes, primaryPair } object, not a map of
  // alliance tags to that shape) that this key held before this feature —
  // rather than exposing that old, never-actually-scoped roster under a
  // real alliance tag it was never associated with, it's preserved as-is
  // under a synthetic "__legacy_unscoped__" key so nothing is silently
  // lost, but it isn't shown to any alliance automatically.
  get championship() {
    const raw = this._synced("wos_championship", {}).get();
    return migrateLegacyChampionshipShape(raw);
  },
  set championship(v) {
    this._synced("wos_championship", {}).set(v);
  },

  // { [playerId]: signupRecord } — see the "SVS Alliance Signup" block
  // further down this file.
  get svsSignups() { return this._synced("wos_svs_signups", {}).get(); },
  set svsSignups(v) { this._synced("wos_svs_signups", {}).set(v); },

  // Admin toggle — whether players can currently submit or edit a signup.
  get svsSignupsOpen() { return this._synced("wos_svs_signups_open", true).get(); },
  set svsSignupsOpen(v) { this._synced("wos_svs_signups_open", true).set(v); },

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

// ---------------------------------------------------------------------------
// Alliance Championship — lane planner. Entirely separate storage from the
// bag planner (Store.bagSubmissions/bagDrafts/schedule) and from
// Store.members — a Championship "player" here is a standalone roster
// entry (imported from screenshots, a pasted/uploaded dataset, or typed in
// by an admin), not tied to a site account/login at all, so clearing or
// editing it never touches anyone's member profile, PIN, or bag data.
//
// SCOPING: each alliance tag gets its own completely independent dataset —
// SYP's imported/edited player list, lanes, and primary-lane choice are
// never visible to or editable by SUN, LIT, NEM, etc. Store.championship
// (see the getter/setter above) holds the map of every alliance's data;
// getChampionshipForAlliance/setChampionshipForAlliance/
// clearChampionshipForAlliance below are the only way app.js reads or
// writes one alliance's slice of it, and app.js's access-control layer
// (championshipAccessibleAlliance/canAccessChampionship) is what decides
// which alliance tag a given signed-in user is even allowed to pass in —
// an R4/officer is hard-locked to their own member record's alliance tag
// and the UI never offers them a way to type or select a different one.
//
// HONEST LIMITATION: this whole app authenticates with app-managed PINs
// stored in a shared client-readable table, not real per-user backend
// accounts — there is no server-side session to attach a Postgres Row
// Level Security policy to. The separation above is enforced at the data
// and UI layer (every read/write is keyed by alliance tag, and the alliance
// tag is always taken from the signed-in member's own record, never from
// free-form input), which is consistent with how every other permission in
// this app already works, but it is not a substitute for real backend
// authorization. If you need that guarantee, put Alliance Championship data
// in its own Supabase table (not `app_state`) with RLS policies keyed to a
// real Supabase Auth session per alliance — see README.md.
// ---------------------------------------------------------------------------
const LANE_KEYS = ["left", "middle", "right"];
const LANE_LABELS = { left: "LEFT", middle: "MIDDLE", right: "RIGHT" };
const CHAMPIONSHIP_LANE_CAP = 20;
const CHAMPIONSHIP_TOTAL_CAP = 60; // 3 lanes x 20 — anyone beyond this (by power) is left unassigned
const PRIMARY_PAIR_LANES = {
  left_right: ["left", "right"],
  left_middle: ["left", "middle"],
  middle_right: ["middle", "right"],
};

// One alliance's Championship dataset shape. Not called DEFAULT_CHAMPIONSHIP
// any more since "the" championship data no longer exists — only ever one
// per alliance tag — but kept as a factory function (not a shared object
// literal) so nothing accidentally mutates a single shared instance.
function defaultChampionshipData() {
  return {
    players: [], // [{ id, name, power, needsReview: boolean }] — no rank/order-of-battle data is kept, only name + power
    lanes: { left: [], middle: [], right: [] }, // arrays of player ids
    primaryPair: "left_right", // key into PRIMARY_PAIR_LANES — which two lanes get maxed to 20/20
  };
}

// See the big comment above Store.championship's getter — converts the
// pre-alliance-scoping single-object shape into the map shape without
// exposing that old roster under any real alliance tag.
function migrateLegacyChampionshipShape(raw) {
  if (raw && Array.isArray(raw.players)) {
    return { __legacy_unscoped__: raw };
  }
  return raw && typeof raw === "object" ? raw : {};
}

// Deep-copied read of one alliance's dataset (or a fresh empty one if that
// alliance has never saved a plan yet) — callers get their own copy to
// mutate freely without touching Store.championship until they explicitly
// save it back.
function getChampionshipForAlliance(allianceTag) {
  const map = Store.championship;
  const saved = allianceTag ? map[allianceTag] : null;
  if (!saved) return defaultChampionshipData();
  return {
    players: (saved.players || []).map((p) => ({ ...p })),
    lanes: {
      left: [...(saved.lanes?.left || [])],
      middle: [...(saved.lanes?.middle || [])],
      right: [...(saved.lanes?.right || [])],
    },
    primaryPair: saved.primaryPair || "left_right",
  };
}

// Writes ONLY this alliance's slice of the map, leaving every other
// alliance's dataset in Store.championship completely untouched.
function setChampionshipForAlliance(allianceTag, data) {
  if (!allianceTag) return;
  const map = { ...Store.championship };
  map[allianceTag] = data;
  Store.championship = map;
}

// Resets one alliance's dataset back to empty (Clear Championship Plan) —
// again, every other alliance's entry in the map is untouched.
function clearChampionshipForAlliance(allianceTag) {
  if (!allianceTag) return;
  const map = { ...Store.championship };
  delete map[allianceTag];
  Store.championship = map;
}

// Total players imported across EVERY alliance's Championship dataset —
// purely an informational count for the home-page card; never exposes
// which alliance any of those players belong to.
function championshipTotalPlayersImported() {
  const map = Store.championship;
  return Object.keys(map).reduce((sum, tag) => {
    if (tag === "__legacy_unscoped__") return sum;
    return sum + ((map[tag] && map[tag].players) ? map[tag].players.length : 0);
  }, 0);
}

// Accepts "185,000,000", "185M", "185.4M", "1.2B", "500K", or a bare
// integer, and returns a plain number — or null if it doesn't look like a
// power value at all. Used for both OCR-extracted text and manual entry,
// so an admin can type "185M" directly instead of counting zeros.
function parsePowerToken(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase().replace(/[,\s]/g, "");
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)([KMB])?$/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (!isFinite(n)) return null;
  if (m[2] === "K") n *= 1e3;
  else if (m[2] === "M") n *= 1e6;
  else if (m[2] === "B") n *= 1e9;
  return Math.round(n);
}

// Full-number, comma-separated display (e.g. "185,000,000") — the results
// section shows exact totals, not the abbreviated "185M" style used
// elsewhere on the site (fmtNum in app.js), since exact power differences
// are the whole point of the balancing display.
function formatFullNumber(n) {
  n = Math.round(Number(n) || 0);
  return n.toLocaleString("en-US");
}

// ---------------------------------------------------------------------------
// Screenshot OCR parsing — tuned to the actual in-game "Order of Battle"
// list layout (Info -> Left/Middle/Right Lane), NOT a one-row-per-line
// format. Each player is rendered as its own little card: a rank number OR
// a "No engagement" label on the left, an avatar, the gamer name, and
// "Troop Power: N" directly under the name. Tesseract reads that back as
// several separate text lines per player, e.g.:
//   No engagement
//   [YUM]oakleygirl
//   Troop Power: 1,169
// Only Gamer Name + Troop Power are extracted and stored — Order of
// Battle/rank, "No engagement", the lane tabs, "Registered: X/20", the
// lane's own total "Troop Power: N" line, and every other button/label are
// deliberately ignored (see CHAMPIONSHIP_OCR_IGNORE_LINE below), and none
// of that is kept on the player object.
// ---------------------------------------------------------------------------

// Lines that are UI chrome, not a player's name — skipped when walking
// backward from a "Troop Power:" line to find the name above it.
const CHAMPIONSHIP_OCR_IGNORE_LINE = [
  /^(left|middle|right)\s*lane/i,
  /^registered\s*[:.]/i,
  /^order of battle/i,
  /^troop power$/i, // the bare column-header word, no colon/number
  /^no\s*engagement/i,
  /^info$/i,
  /^x$/i,
  /^\d{1,3}$/, // a bare rank number sitting on its own line
  /preparation phase/i,
  /alliance leader/i,
  /r4 members/i,
  /adjust the lane/i,
  /view deployment/i,
  /change lane/i,
  /team deployment/i,
];

function isChampionshipOcrJunkLine(line) {
  const t = (line || "").trim();
  if (!t) return true;
  return CHAMPIONSHIP_OCR_IGNORE_LINE.some((re) => re.test(t));
}

// Matches a "Troop Power: 1,169" (or "TroopPower 185M", minor OCR noise
// around the colon/spacing) line and captures the numeric part.
const CHAMPIONSHIP_POWER_LINE_RE = /troop\s*power\s*[:.]?\s*([\d][\d,.\s]*)\s*([kmb])?/i;

// Parses every screenshot's OCR text into { name, power, needsReview } rows
// — one call per screenshot; combining/deduping across screenshots happens
// separately in mergeChampionshipImports so overlapping uploads work.
function parseChampionshipOcrText(text) {
  const rawLines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/ /g, " ").trim());
  const rows = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const m = CHAMPIONSHIP_POWER_LINE_RE.exec(line);
    if (!m) continue;

    // The lane's own total ("Registered: 57/20" immediately followed by
    // "Troop Power: 10,184") is NOT a player — skip it. Real player rows
    // never sit directly under a "Registered:" line.
    let prevIdx = i - 1;
    while (prevIdx >= 0 && rawLines[prevIdx].trim() === "") prevIdx--;
    if (prevIdx >= 0 && /^registered\s*[:.]/i.test(rawLines[prevIdx])) continue;

    const power = parsePowerToken(m[1] + (m[2] || ""));

    // Walk backward past rank numbers / "No engagement" / blank lines to
    // find the name line sitting just above this power line.
    let nameIdx = i - 1;
    while (nameIdx >= 0 && isChampionshipOcrJunkLine(rawLines[nameIdx])) nameIdx--;
    let name = nameIdx >= 0 ? rawLines[nameIdx].trim() : "";
    // If we walked straight into another player's power line without ever
    // finding a name in between (a name line the OCR dropped entirely),
    // there's no real name to use here.
    if (CHAMPIONSHIP_POWER_LINE_RE.test(name)) name = "";

    // Nothing recognized at all (no name AND no usable power) — not worth
    // a row, there's nothing for the admin to review.
    if (!name && (power == null || power <= 0)) continue;

    rows.push({
      name, // may be "" — the review table flags/labels this, never guesses one
      power: power == null ? 0 : power,
      needsReview: !name || power == null || power <= 0,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Dataset import (paste or .csv upload) — an alternative to the screenshot
// OCR importer above, using the exact same "Gamer Name + Power only" model.
// Expected format is a simple two-column CSV with a header row:
//   name,power
//   oakleygirl,1169
// Column order doesn't matter (found by header name, case-insensitive) and
// a stray header-less paste falls back to column order [name, power].
// ---------------------------------------------------------------------------

// Minimal CSV line splitter — handles a double-quoted field (with "" as an
// escaped quote inside it) so a name that happens to contain a comma can
// still be quoted, without pulling in a full CSV library for two columns.
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

// Parses pasted or uploaded CSV text into raw rows: { name, power,
// invalidReason: string|null }. Gamer names are preserved exactly as
// entered (only surrounding whitespace is trimmed) — full Unicode, spaces,
// apostrophes, underscores, accents, and every other character some through
// completely untouched. This does NOT dedupe or check for conflicts against
// the existing roster — see buildChampionshipImportPreview for that, which
// runs across combined dataset + existing players.
function parseChampionshipDataset(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== ""); // blank rows are ignored entirely, not flagged
  if (!lines.length) return { rowsRead: 0, rows: [] };

  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const headerNameIdx = header.indexOf("name");
  const headerPowerIdx = header.indexOf("power");
  const hasRecognizedHeader = headerNameIdx !== -1 && headerPowerIdx !== -1;
  const nameIdx = hasRecognizedHeader ? headerNameIdx : 0;
  const powerIdx = hasRecognizedHeader ? headerPowerIdx : 1;
  const dataLines = hasRecognizedHeader ? lines.slice(1) : lines;

  const rows = dataLines.map((line) => {
    const cols = splitCsvLine(line);
    const name = (cols[nameIdx] || "").trim();
    const rawPower = (cols[powerIdx] || "").trim();
    const power = rawPower ? parsePowerToken(rawPower) : null;
    let invalidReason = null;
    if (!name && !rawPower) invalidReason = "empty row";
    else if (!name) invalidReason = "missing name";
    else if (!rawPower) invalidReason = "missing power";
    else if (power == null || power <= 0) invalidReason = "invalid power";
    return { name, power: power == null ? 0 : power, invalidReason };
  });
  return { rowsRead: rows.length, rows };
}

// Builds the "Dataset Import Preview" — combines the freshly-parsed dataset
// rows against `existingPlayers` (the alliance's CURRENT working roster,
// which already includes anything from screenshots, a previous dataset
// import, or manual entry — so this is what makes dataset + screenshot
// imports "just work together" into one deduped list) and classifies every
// row:
//   - "invalid"  — unusable as parsed (missing name/power, bad power) —
//                  still surfaced as its own row so it can be fixed or
//                  removed before import, never silently dropped.
//   - "conflict" — the gamer name already exists on the roster with a
//                  DIFFERENT power — flagged "Power Conflict — Needs
//                  Review" with a choice of which value to keep.
//   - duplicate  — the gamer name already exists with the SAME power (or
//                  appears more than once within this same paste/upload) —
//                  counted but not shown as its own preview row, since
//                  there's nothing to review.
//   - "ready"    — a genuinely new, valid, unique player.
// Two players are NEVER treated as the same just because they share a
// power value — matching is name-first, power is only ever a secondary
// check on an already-matched name.
function buildChampionshipImportPreview(parsedRows, existingPlayers) {
  const existingByKey = new Map(
    (existingPlayers || [])
      .filter((p) => p.name && p.name.trim())
      .map((p) => [p.name.trim().toLowerCase(), p])
  );
  const seenThisBatch = new Set();
  const rows = [];
  let duplicatesRemoved = 0;
  let conflicts = 0;
  let invalidRows = 0;
  let validPlayers = 0;

  parsedRows.forEach((r) => {
    if (r.invalidReason) {
      invalidRows++;
      rows.push({
        tempId: newChampImportRowId(),
        name: r.name,
        power: r.power,
        category: "invalid",
        statusLabel: "Needs Review",
        reason: r.invalidReason,
      });
      return;
    }
    const key = r.name.trim().toLowerCase();
    if (seenThisBatch.has(key)) {
      duplicatesRemoved++;
      return;
    }
    const existing = existingByKey.get(key);
    if (existing) {
      seenThisBatch.add(key);
      if (existing.power === r.power) {
        duplicatesRemoved++;
        return;
      }
      conflicts++;
      rows.push({
        tempId: newChampImportRowId(),
        name: r.name,
        power: r.power,
        existingPower: existing.power,
        chosenPower: existing.power, // default to keeping what's already saved
        category: "conflict",
        statusLabel: "Power Conflict — Needs Review",
      });
      return;
    }
    seenThisBatch.add(key);
    validPlayers++;
    rows.push({
      tempId: newChampImportRowId(),
      name: r.name,
      power: r.power,
      category: "ready",
      statusLabel: "Ready",
    });
  });

  rows.sort((a, b) => (b.power || 0) - (a.power || 0));
  return { rowsRead: parsedRows.length, validPlayers, duplicatesRemoved, conflicts, invalidRows, rows };
}

function newChampImportRowId() {
  return "ci_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Splits `items` (each { id, power }, any order) into two groups, each
// capped at `capEach`, minimizing the difference between the groups'
// total power. Greedy "always add to the currently-lighter side" (a
// standard longest-processing-time heuristic) gets close on its own; the
// swap pass afterward is a simple local-search polish — try every
// cross-group pair, keep any swap that shrinks the gap, repeat until
// nothing helps. Cheap and fast at the sizes this tool deals with (<=40
// items), and doesn't need to be perfectly optimal to be a good plan.
function balanceTwoGroups(items, capEach) {
  const sorted = [...items].sort((a, b) => b.power - a.power);
  const a = [];
  const b = [];
  let sumA = 0;
  let sumB = 0;
  sorted.forEach((p) => {
    if (a.length >= capEach) { b.push(p); sumB += p.power; return; }
    if (b.length >= capEach) { a.push(p); sumA += p.power; return; }
    if (sumA <= sumB) { a.push(p); sumA += p.power; }
    else { b.push(p); sumB += p.power; }
  });

  let improved = true;
  let guard = 0;
  while (improved && guard < 500) {
    improved = false;
    guard++;
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b.length; j++) {
        const diffNow = Math.abs(sumA - sumB);
        const newSumA = sumA - a[i].power + b[j].power;
        const newSumB = sumB - b[j].power + a[i].power;
        if (Math.abs(newSumA - newSumB) < diffNow) {
          const tmp = a[i];
          a[i] = b[j];
          b[j] = tmp;
          sumA = newSumA;
          sumB = newSumB;
          improved = true;
        }
      }
    }
  }

  return { aIds: a.map((p) => p.id), bIds: b.map((p) => p.id), sumA, sumB };
}

// Full plan: sort everyone by power, take the strongest CHAMPIONSHIP_TOTAL_CAP
// (60) — anyone past that isn't placed in a lane at all — split the
// strongest 40 of those into the two chosen primary lanes (balanced, 20/20
// when there are enough players), and send the rest to the remaining
// (overflow) lane. Below 40 total players there's nothing left for
// overflow; below 2*capEach the two primary lanes just split whatever
// exists as evenly as the cap allows.
function balanceChampionshipLanes(players, primaryPair) {
  const primaryKeys = PRIMARY_PAIR_LANES[primaryPair] || PRIMARY_PAIR_LANES.left_right;
  const overflowKey = LANE_KEYS.find((k) => !primaryKeys.includes(k));

  const sorted = [...players].sort((a, b) => b.power - a.power);
  const capped = sorted.slice(0, CHAMPIONSHIP_TOTAL_CAP);
  const primaryPool = capped.slice(0, CHAMPIONSHIP_LANE_CAP * 2);
  const overflowPool = capped.slice(CHAMPIONSHIP_LANE_CAP * 2);

  const { aIds, bIds } = balanceTwoGroups(primaryPool, CHAMPIONSHIP_LANE_CAP);

  const lanes = { left: [], middle: [], right: [] };
  lanes[primaryKeys[0]] = aIds;
  lanes[primaryKeys[1]] = bIds;
  lanes[overflowKey] = overflowPool.slice(0, CHAMPIONSHIP_LANE_CAP).map((p) => p.id);
  return lanes;
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

// ---------------------------------------------------------------------------
// SVS Alliance Signup — additive feature, entirely separate storage
// (Store.svsSignups) from the bag planner, schedule, and Alliance
// Championship. One record per player id — a player returning to the
// signup tab loads and edits their existing record rather than creating a
// second one (see getSvsSignup/upsertSvsSignup below). Alliance Tag is
// deliberately NOT its own seed list here — it reuses Store.alliances (the
// same admin-managed list the rest of the app already uses), so a
// newly-added alliance shows up here automatically with zero extra wiring.
// Furnace/FC Level and Troop Level, by contrast, use their OWN fixed lists
// below (SVS_SIGNUP_FURNACE_LEVELS / SVS_SIGNUP_TROOP_LEVELS) — spec'd with
// a different range than the bag planner's Store.furnaceFc / TROOP_TIER_POINTS,
// so they're kept independent rather than reusing those.
// ---------------------------------------------------------------------------

// Furnace / Fire Crystal level options for the signup form's own dropdown —
// a fixed list (not Store.furnaceFc, which is the admin-managed bag-planner
// list and can differ from this one).
const SVS_SIGNUP_FURNACE_LEVELS = ["28", "29", "30", "FC1", "FC2", "FC3", "FC4", "FC5", "FC6", "FC7", "FC8", "FC9", "FC10"];

// Troop levels for the signup form's three troop-type dropdowns — T6-T12
// only. Deliberately separate from TROOP_TIER_POINTS (T1-T11) above — that
// table is bag-planner promotion SCORING (a different concept, a different
// range), while this is just "what's the highest tier you currently have"
// for each troop type on the signup form.
const SVS_SIGNUP_TROOP_LEVELS = ["T6", "T7", "T8", "T9", "T10", "T11", "T12"];

const SVS_PARTICIPATION_OPTIONS = [
  { value: "STAYING", label: "Staying in my alliance" },
  { value: "TRAVELING", label: "Traveling to SVS Alliance" },
];

// Training Camp / Troop Building level — a THIRD, separate progression
// value from both Furnace/FC Level and Troop Tier (see the CORE RULE
// comment on the signup form: furnace, troop tier, and troop-building
// level never collapse into each other, even though they share "FC"
// naming with the furnace list). This is the full possible range; how
// much of it a player can actually pick from is capped by the admin's
// Store.state.maxTroopBuildingLevel — see svsSignupAvailableBuildingLevels.
const SVS_SIGNUP_BUILDING_LEVELS_ALL = ["LVL 30", "FC1", "FC2", "FC3", "FC4", "FC5", "FC6", "FC7", "FC8", "FC9", "FC10"];

// The three troop types every signup tracks — used to iterate infantry/
// lancer/marksman consistently (validation, admin table, form rendering)
// instead of repeating the same three keys everywhere.
const SVS_SIGNUP_TROOP_TYPES = [
  { key: "infantry", label: "Infantry" },
  { key: "lancer", label: "Lancer" },
  { key: "marksman", label: "Marksman" },
];

// State-configured ceiling for the signup form's three Training Camp Level
// dropdowns — NOT the same setting as maxFurnaceLevel (a state can be
// furnace FC5 / troop-building FC4, or any other combination). Falls back
// to the full list if the stored value doesn't match anything in it (e.g.
// blank on a very old save), so the form never ends up offering zero
// options.
function svsSignupAvailableBuildingLevels() {
  const cap = Store.state?.maxTroopBuildingLevel;
  const idx = SVS_SIGNUP_BUILDING_LEVELS_ALL.indexOf(cap);
  if (idx === -1) return SVS_SIGNUP_BUILDING_LEVELS_ALL.slice();
  return SVS_SIGNUP_BUILDING_LEVELS_ALL.slice(0, idx + 1);
}

// Looks up a player's current signup, or null if they've never submitted
// one. playerId is always Store.currentUser's member id — never free text.
function getSvsSignup(playerId) {
  if (!playerId) return null;
  return Store.svsSignups[playerId] || null;
}

// Creates or updates the ONE signup record for playerId — never appends a
// second record for the same id. Preserves the original submittedAt across
// edits, and always stamps updatedAt with the current time.
function upsertSvsSignup(playerId, patch) {
  if (!playerId) return null;
  const all = { ...Store.svsSignups };
  const now = Date.now();
  const existing = all[playerId];
  const record = {
    ...patch,
    playerId,
    submittedAt: existing ? existing.submittedAt : now,
    updatedAt: now,
  };
  all[playerId] = record;
  Store.svsSignups = all;
  return record;
}

// Field-by-field validation, in the order the form presents them, so the
// FIRST missing thing is always what gets reported back — matches the
// spec's example messages exactly (e.g. "Please select your Marksman troop
// level."). Also re-checks each Training Camp Level against the CURRENT
// admin-configured maximum server-side (not just by hiding options in the
// dropdown) — if the state's max was lowered after a player picked a
// higher one, or a stale/tampered value somehow reaches here, the save is
// rejected with a clear message rather than silently accepted.
function validateSvsSignupForm(v) {
  v = v || {};
  if (!v.gamerId || !String(v.gamerId).trim()) return "Please enter your Gamer ID.";
  if (!v.gamerName || !String(v.gamerName).trim()) return "Please enter your Gamer Name.";
  if (!v.allianceTag) return "Please select your Alliance Tag.";
  if (!v.furnaceLevel) return "Please select your Furnace / FC Level.";
  if (!v.svsParticipation) return "Please choose whether you're staying or traveling for SVS.";

  const availableBuilding = svsSignupAvailableBuildingLevels();
  for (const t of SVS_SIGNUP_TROOP_TYPES) {
    const entry = v.troops?.[t.key] || {};
    if (!entry.troopLevel) return `Please select your ${t.label} troop level.`;
    if (!entry.buildingLevel) return `Please select your ${t.label} Training Camp level.`;
    if (!availableBuilding.includes(entry.buildingLevel)) {
      return `Your ${t.label} Training Camp level is above the state's current maximum (${availableBuilding[availableBuilding.length - 1]}) — please choose a valid level.`;
    }
  }
  return null;
}
