# State Combat Analytics (starter clone)

A dark-themed, single-page dashboard for a game alliance/state: a home
dashboard, an SvS prep tool (request + schedule), a feedback board, and an
admin page for leadership. Two more sections — a bear-trap calculator and an
alliance-championship calculator — are stubbed in as "coming soon" cards
ready for you to build out later.

This is a **from-scratch rebuild**, not a copy of anyone's live data. It ships
with a couple of placeholder members so you can see it working immediately;
replace them with your real roster (or add them from the Admin page).

## Running it

No build step. Either:

- Open `index.html` directly in a browser, or
- Serve the folder (recommended, avoids some browser file:// quirks):
  ```
  python3 -m http.server 8080
  ```
  then visit `http://localhost:8080`.

## Deploying

Drag the folder into [Netlify Drop](https://app.netlify.com/drop), or connect
it as a static site on Netlify/Vercel/GitHub Pages/Cloudflare Pages — no
build command needed, publish directory is the project root.

## How data works right now

Everything lives in the browser's `localStorage`, seeded once from
`data.js`. That means:

- It works immediately with zero setup.
- Data is **per-browser** — not shared between your alliance members. Two
  people visiting the site each get their own local copy. See "Going
  multi-user" below for making it actually shared.
- To reset to the seed data, clear `localStorage` for the site (or delete
  the `wos_seeded_v2` key) and reload.

### Customizing your data

Edit the `SEED_*` constants at the top of `data.js`, or just use the Admin
page once the app is running:

- `DEFAULT_STATE` — your state number, rival state number, next SvS date
  (also editable from Admin → State config).
- `SEED_MEMBERS` — your roster, in-game `gamerId`, alliance, role, and `pin`
  (also editable from Admin → Members: USER NAME, GAMER ID, ALLIANCE,
  RESET PIN, RANK columns — PIN itself isn't a column there, since only the
  member or an admin should ever see/set it; see "Sign-in" below). Every
  seeded account needs a `pin` here or nobody can sign in as them — the
  placeholder roster ships with `1111`/`2222`/`3333` for its three members,
  which you'll want to change before sharing the site. Roles are `member`,
  `officer`, or `admin` in the data —
  the RANK column and role dropdown display `officer` as **R4** everywhere
  in the UI (matching the alliance-rank naming the game itself uses), but
  the stored value stays `officer`, so nothing else in this doc or the
  code changes meaning when you see "officer". officer/admin get the
  Admin page link. On that page itself, an officer (R4) only sees and
  manages members in their own alliance (Members table and Bag
  submissions table both scoped), can't delete members, and RANK shows as
  plain text, not an editable dropdown — only the `admin` role can
  promote/demote or delete anyone. The `admin` role sees and manages
  everyone, rank and deletion included.
- `BAG_SECTIONS` — the backpack scoring fields on SvS prep → MY BAG,
  grouped by day. Point rates are **base values with Valeria's +8% bonus
  already removed** — nothing in this codebase applies an 8% (or any)
  multiplier anywhere, so what a member enters scores at exactly these
  rates (all values pts per unit): Speedups are entered in **minutes** at
  30 pts/min — Construction, Research, Troop, *and* General/Expert Skill
  all score at this same rate (Construction/Research/Troop in the
  top-level SPEEDUPS section auto-fill into their day below, while General
  is a wildcard that scores on its own and can stand in for any of the
  three — see "Speedups: top-level entry, auto-fill, and the General
  wildcard"), Fire Crystals (building upgrades) 2,000, Fire Crystal Shards
  (research) 1,000, Charm Guide +1 = 70, Charm Design +1 = 70 (both D1
  fields — this 70pt rate was carried over from an earlier "Chief Charm"
  field these two replaced, since no distinct rate was given for them;
  correct it in `BAG_SECTIONS` in `data.js` if the real per-item values
  differ), Expert Sigils (excl. Common)
  6,000, Books of Knowledge 60, Hero Shards 350/1,220/3,040
  (Rare/Epic/Mythic), Lucky Wheel 8,000/spin, Beast Slay uses Stamina Cans
  at 12,000/can (regular beasts cost 10 stamina each; this assumes
  top-tier Lv.26-30 beasts — the real per-tier table is
  9,000/9,750/10,500/11,250/12,000 for Lv.1-10/11-15/16-20/21-25/26-30,
  but there's only one Stamina Cans field to enter against, so it always
  uses the top-tier rate), Polar Terror rallies 30,000 each, Troop Day
  scores promotion potential (see below), Wild Marks 15,000/1,150
  (Adv/Common), Mithril 144,000, Hero Gear Essence Stones 4,000, Hero
  Exclusive Gear Widgets 8,000. (The old "Chief Gear +1" field was removed
  entirely — D5/Hero Power no longer has a Chief Gear input — and the old
  "Pet Advancement Score +1" field was removed entirely too — D3/Beast
  Slay no longer has a Pet Advancement input.)
  Gem-based speedups are excluded from scoring entirely, same as the
  in-game rules. Gathering (Meat/Wood/Coal/Iron) doesn't have its own bag
  field currently — there's nowhere in the form to enter gathered
  resources — so it isn't scored; the point rate would be `amount / 1,000
  × 2` for Meat/Wood, `amount / 200 × 2` for Coal, and `amount / 50 × 2`
  for Iron if a field for it gets added later. A few fields (Design Plans,
  Polishing Solution, Hardened Alloy) are left unscored (`points: null`)
  — the game doesn't score them directly, they're crafting ingredients
  for the gear-score fields above. Construction and Research speedup
  points are computed (`calc`, not a flat rate) since they depend on
  sibling fields — see the Construction/Research Day gates below;
  `computeBagPoints()` calls `field.calc(value, allValues)` so any field's
  calc can read the rest of that submission's values, not just its own.
- Troop Day (D4) scores **promotion potential**, not troops trained from
  scratch: a member enters how many T1-T9 troops they have (only the ones
  still worth promoting), and each tier auto-scores the points difference
  between that tier and **T11** — the current top tier — using the base
  per-tier table (T1=3, T2=4, T3=5, T4=8, T5=12, T6=18, T7=25, T8=35,
  T9=45, T10=60, T11=75): 72/71/70/67/63/57/50/40/30 pts for T1-T9
  respectively (e.g. T1→T11 = 75-3 = 72/troop, so 9,000 T1 troops =
  9,000 × 72 = 648,000 pts). `TROOP_TIER_POINTS` in `data.js` holds the
  full table and `troopPromotionPointsPerTroop(fromTier, toTier)` is a
  general helper that works for any tier pair (e.g. a T10→T11 promotion
  is 75-60 = 15/troop) — the bag form itself still only has T1-T9 fields
  (promoting up to the current top tier), so a T10-troop promotion has no
  field to enter it against yet. Newly-**trained** troops (as opposed to
  promoted ones) would score the tier's full value, not the difference,
  but there's no bag field for that either — training-from-scratch counts
  aren't currently collected anywhere in the form. There's no separate
  entry for Rookie-Off — see below, it reuses this same T1 field instead
  of asking members to enter their T1 count twice. D4 also has its own
  **Troop Train / Promotion Speedups** field (minutes, 30 pts/min,
  auto-filled from the top-level Troop speedup field under SPEEDUPS) —
  it's specifically what a member needs to actually do anything on Troop
  Day, with a live green/red status line underneath showing whether
  they're eligible for a Troop Day slot (see the day gates below). Its
  points count toward the D4/Troop Day total the schedule shows, since it
  lives in that section. D4 opens with a disclaimer that **Troop Train /
  Promotion Speedups is the only required field** on that page (it's what
  determines a Troop Day slot) — T1-T9 and everything else there is
  optional, fill in whatever tiers a member actually has. The T1 field's
  note also flags that its number feeds the Rookie-Off leaderboard
  directly.
- **Rookie-Off** (`#/rookie-off`, also a home-page card) is a standalone
  leaderboard for the T1 promotion contest — rank, member, alliance, T1
  troop count, and the points that count is worth at the D4 T1 rate, plus
  a state-wide total and "contest potential" (everyone's T1 promoted to
  T11). It's entirely derived from each member's D4 "T1 Troops
  (promotable)" bag value — no separate data entry, so a member's number
  here always matches what they entered on MY BAG. Signed-in members only.
- Admin → Bag submissions has an ALLIANCE TOTAL footer row summing every
  section's points (plus the grand total) across whichever members are
  visible — the full roster for `admin`, just their own alliance for a
  scoped `officer`.
- Lucky Wheel (on D3 — the old D2 Lucky Wheel field was removed entirely,
  so D3 is the only place it's entered now) is entered as **Total Gems**,
  not a spin count. Spins cost 1,500 gems each, or 13,500 gems for a
  10-spin bundle
  (the better rate) — gems get spent on bundles first, leftover gems on
  single spins, capped at the game's 150-spin limit — same live plain-text
  math under the field as Stamina Cans: bundles used, spins bought, points
  earned. Everyone also gets 1 free spin/day for 3 days (24,000 pts total,
  not gem-denominated) — noted in the calc text but not added to the
  score, since it's not tied to a specific day's field. If that day's free
  spin is still banked, a 10-pack costs 12,000 gems instead of 13,500 —
  also just a note, not folded into scoring.
- Beast Slay's only enterable field is **Stamina Cans** — Polar Terror
  isn't a separate input. Since a stamina can is a shared resource (spend
  it on regular beasts or a Polar Terror rally, not both), the form shows
  live plain-text math under that field: how many Lv.26-30 beasts vs. how
  many Polar Terror rallies (25 stamina each) that stamina could buy, the
  points each route earns, and which nets more. The actual submitted
  score always uses the zero-waste beast rate (12,000 pts/can), since
  beasts divide any stamina total evenly and Terror rallies (25 stamina)
  can strand leftover stamina.
- `SEED_SCHEDULE_DAYS` — the prep-day names shown on the SvS schedule tab.
- `PLANNED_TOOLS` — the "coming soon" cards on the home page. Each has an
  `id` (used as its route, e.g. `/bears`), `title`, `desc`, and `color`.

## Pages

- **Home** (`#/`) — operation cards (svs_prep, rookie_off, feedback, and
  the planned tools) + database stat tiles.
- **Rookie-Off** (`#/rookie-off`) — T1 troop promotion leaderboard, see
  "Rookie-Off" above. Signed-in members only.
- **SvS prep** (`#/svs`) — MY BAG tab lets a signed-in member submit their
  backpack and mark available half-hour slots; MY SUBMISSION and MY POINTS
  show their own data back to them. The SCHEDULE tab (full grid, 3 days ×
  48 slots, TSV export) is visible only to the `admin` role — officers and
  regular members don't get it at all, even read-only; see "Publishing
  the SvS schedule" below for how they see the finalized result instead.
  MY BAG **auto-saves as a draft** while a member is filling it out —
  every field, toggle, time slot, and the notes box — so a refresh, a
  closed tab, or a lost connection before they hit SUBMIT doesn't lose
  their progress. Saves are debounced (about 700ms after the last change,
  flushed immediately on page close) rather than firing on every
  keystroke, and each draft is stored under `Store.bagDrafts`, keyed by
  member id exactly like `Store.bagSubmissions` — so a member only ever
  sees their own draft, never anyone else's, and it syncs the same way
  everything else does once Supabase is configured (see "Going
  multi-user" below). Submitting the bag clears that member's draft and
  writes to `Store.bagSubmissions` as before — the draft is purely a
  not-yet-submitted safety net, not a second copy of submitted data.
- **Feedback** (`#/feedback`) — signed-in members can post ideas/bugs;
  anyone can upvote/downvote.
- **Admin** (`#/admin`) — visible to `officer`/`admin` members (in the
  topbar and bottom nav once signed in as one), but what they see there
  differs sharply. The `admin` role gets everything: state config,
  alliance tags, the full member roster and roles, bulk-clear SvS slots,
  a full bag-cycle reset (Clear Bags — see below), furnace brackets, bag
  submission editing, and feedback moderation. An `officer` gets only two
  panels — Members and Bag submissions, both scoped to their own alliance
  (see below) — everything else on the page is simply not rendered for
  them, not just disabled.

### Clear Bags (resetting for a new SvS cycle)

Admin → SvS prep — bulk actions has a **Clear Bags** button (`admin` role
only, same as everything else in that panel) for starting a fresh cycle.
Unlike **Clear all booked slots** just above it (which only unassigns the
SCHEDULE grid), Clear Bags wipes every member's bag data everywhere it
lives: `Store.bagSubmissions` (submitted bags — values, calculated points,
notes, and their selected time slots), `Store.bagDrafts` (autosaved,
not-yet-submitted drafts — see "Auto-saves as a draft" above), and the
SCHEDULE grid + its per-day published flags (`Store.schedule` /
`Store.schedulePublished`), since those are generated from members' bag
time-slot selections. It does **not** touch `Store.members` — names, PINs,
Gamer IDs, alliance tags, and roles are all untouched, so everyone signs
back in exactly as before and just sees a blank MY BAG. Because it's
state-wide and irreversible, it asks for confirmation (a plain `confirm()`
dialog) before doing anything, and does nothing if that's cancelled.

### Admins editing a member's bag

An **Edit Bag** button sits next to the ✕ delete button on every row of
Admin → Members, and Admin → Bag submissions has one too (even for members
who haven't submitted yet). Both open the exact same MY BAG wizard the
member themselves would use — backpack fields, availability type, time
slots — pre-loaded with that member's existing submission, never a blank
form or a separate admin copy. An amber banner across the top ("Editing
`<name>`'s bag as admin") makes it unambiguous whose data is being changed.
Saving writes back to that member's own submission (not the admin's) and
returns to Admin; **Exit editing** does the same without saving. Leaving
mid-edit any other way (clicking Home, SvS, or Admin in the nav) also drops
back to editing your own bag next time you open MY BAG, so a forgotten edit
session can't quietly stick around and hijack your next visit.

**This is full-admin only — R4/officer doesn't get it.** R4 still manages
its own alliance's roster in Members (name, gamer ID, alliance, Reset PIN)
exactly as before, but neither Edit Bag button renders for an R4: the
Members-table one simply doesn't appear, and the Bag submissions one is
replaced with an "admin only" label. This isn't just a hidden button —
opening or saving another member's bag is gated by role at the point the
edit actually happens (`svsWizardTargetUser()` refuses to resolve to
anyone but the signed-in user unless they're a full admin, and the wizard's
save step re-checks the same thing), so it can't be reached by jumping
straight to a route or replaying stale state either.

Editing someone's saved **time-slot availability** never touches the
**schedule** — clearing every slot they'd tapped just means the optimizer
now treats them the same as anyone else who never signed up (excluded from
its pool, listed in Unassigned Players, needs a manual placement — see
"Unassigned players" above). If they already hold a schedule slot that no
longer matches their updated availability, saving doesn't silently clear or
move it: a warning appears first ("This player is currently scheduled for
`<time>`, but `<time>` is no longer included in their selected
availability"), and a second click on **SAVE ANYWAY** is required to
confirm — the schedule slot itself is left exactly as it was either way;
un-assigning it is a separate, deliberate action on the SCHEDULE tab.

### Speedups: top-level entry, auto-fill, and the General wildcard

The **SPEEDUPS** section at the top of the backpack has four fields —
Construction, Research, Troop, and General — so a member can log
everything they're holding in one place. Construction, Research, and
Troop each auto-fill (`syncTo`) into their matching day's own field the
moment you tab or click out of them (D1's Construction, D2's Research,
D4's Troop Train / Promotion Speedups) — enter it once at the top and it
shows up below.

**General is a wildcard.** It doesn't score points directly (nothing
tells the app which building you'd actually spend it on), but it counts
toward *eligibility* for Construction, Research, or Troop Day — even at 0
in a day's own field, banked General minutes are enough to unlock that
day's time slot. Each day's status box also shows a live suggestion of
where your General minutes have the most open opportunity right now,
e.g. `D2 — Research (300 mins of General speedups suggested to use)` —
it points at whichever eligible day currently has the least of its own
speedup type banked.

### Construction Day (D1) and Research Day (D2) gates

Both days can run out of things to spend speedups on, same as Troop Day
running out of queue capacity — and both have **two independent gates**,
not one. Points (and the "definitely eligible" status) only zero out once
*both* gates are maxed; with exactly one maxed, speedups still score, and
the status box shows an amber "may be eligible" instead of a flat "yes":

- **Construction** — the two gates are the member's furnace sitting at
  the state's current cap (Admin → Furnace brackets' top bracket) and
  **War Academy Maxed**. Both maxed → Construction speedups and Fire
  Crystals score 0, Day 1 points come only from Chief Charm (red status).
  Exactly one maxed → speedups still score normally, but the status box
  reads "may be eligible for a Construction Day time slot" (amber) since
  one of the two avenues is used up. Neither maxed → normal green
  "eligible" status.
- **Research** — the two gates are **War Academy Research Maxed** and
  **Tech Research Maxed** (the Research Center's own track). Both maxed →
  Research speedup points score 0 (red status), though Fire Crystal
  Shards (1,000 pts each), Expert Sigils, Books of Knowledge, and hero
  shards are unaffected either way. Exactly one maxed → speedups still
  score, status reads "may be eligible" (amber). Neither maxed → normal
  green "eligible" status.
- **Troop** — unchanged, single gate: needs banked Troop Train /
  Promotion speedup minutes (or General wildcard minutes) to have
  anything to do during the window.

The status box under each day's speedup field updates live (green =
eligible, amber = may be eligible — one of two gates maxed, red = 0
minutes banked or fully maxed out) as you fill in the form, so a member
sees where they stand right where they're entering the numbers — not
just later on TIME SLOTS. Slot eligibility itself (whether you actually
get scheduled) only locks a day out when it's fully maxed or nothing's
banked — the amber "may be" state still counts as eligible for
scheduling purposes, it's just flagging that one of the two avenues is
gone. The same underlying gate is enforced app-wide:

- On MY BAG → TIME SLOTS, a member locked out of a day sees a warning
  banner naming every blocked day and why, and that day's tab is locked
  (BY DAY mode) or a note explains their taps won't carry over to it
  (ALL DAYS mode).
- On the admin SCHEDULE grid, a member locked out of a day never shows up
  in that day's slot "available" list, and the assign dropdown for every
  slot on that day simply won't offer them — see below.

Adding the matching speedup minutes — or General wildcard minutes, or
un-marking a "maxed" toggle — immediately makes a member eligible again,
whether they edit their own bag or an admin edits it for them.

### Who shows up in a slot's assign dropdown

The admin SCHEDULE grid doesn't offer a roster-wide picker on every slot
— each slot's dropdown is scoped to just the members who actually signed
up for *that* slot (tapped it on MY BAG → TIME SLOTS, and aren't gated
out of the day entirely — see the eligibility gates above). A slot no one
signed up for shows "no signups for this slot" instead of a dropdown full
of names nobody actually said they'd cover.

On top of that, a member can't be in two places at once, so once they're
assigned to one slot, every other slot's dropdown on that day drops them
from its list for the rest of that day — assigning them elsewhere means
clearing their current slot first. This is enforced in the data too (not
just the dropdown's option list), so a duplicate assignment can never get
written even by another path: re-assigning someone who's already on the
day automatically clears their old slot.

The one exception is a slot that already has someone assigned who
doesn't show up in that slot's signups (e.g. they were assigned before
they signed up, or their availability changed afterward) — they stay in
that slot's dropdown, tagged "(didn't sign up for this slot)", so the
assignment stays visible and can still be changed or cleared instead of
silently disappearing.

### Optimize, manual picks, and resetting a day

Three controls sit above each day's slot grid (admin only):

- **⚡ OPTIMIZE THIS DAY** auto-fills every open slot to maximize that
  day's total points. A member's point value for the day is fixed by
  their bag submission — it doesn't change based on which slot they take
  — so this reduces to fitting as many of the highest-point signed-up
  members as possible into the slots they actually said they could cover
  (each member only in a slot they tapped on TIME SLOTS, one slot per
  member per day, same as everywhere else in the app). It's solved as
  maximum-weight bipartite matching (an augmenting-path search over
  members in descending point order), not a naive first-come greedy fill,
  so it finds the actual best total, not just *a* valid schedule.
- **Manual picks are untouchable by both the optimizer and reset.**
  Choosing someone from a slot's dropdown yourself marks that slot 📌
  **manual** — OPTIMIZE will never reassign that slot or place that
  member somewhere else, and it excludes them from its pool entirely
  before optimizing everyone else around them. Clearing a slot back to
  "— empty —" un-marks it.
- **RESET THIS DAY** clears every slot on the current day back to
  empty — except manual ones, which it leaves exactly as they are. Handy
  for re-running OPTIMIZE from scratch after members' signups change,
  without having to re-enter your manual overrides.

Because OPTIMIZE only fills *open* (non-manual) slots and always leaves
manual ones alone, the normal flow is: make any manual picks you already
know you want, hit OPTIMIZE to fill in the rest optimally, then keep
hand-editing any individual slot from its dropdown same as always —
nothing about publishing changes, and edits made after optimizing are
just further manual picks.

Any schedule-changing action on a day that's currently **published** —
OPTIMIZE, RESET, or a manual assignment from either the main grid or the
Unassigned Players panel below — automatically flips that day back to
**draft**. A published schedule is a snapshot you've signed off on; the
moment it changes underneath that snapshot, it needs a fresh publish
before EXPORT DAY will work on it again (see "Exporting a day" below).

### Unassigned players

A separate panel below the slot grid lists every member who's **eligible
for the day and has real points on the line, but never tapped a single
time slot for it** — "no slots selected" is read as *availability
unknown*, never as *available for anything*, so these members are
deliberately excluded from OPTIMIZE's candidate pool no matter how many
points they're worth. Sending them through the optimizer anyway would mean
scheduling someone for a window they never actually confirmed they could
cover.

Each row shows the member's name, their potential points for the day, and
whether they're currently assigned — plus a dropdown to place them
yourself once you've confirmed their availability outside the app (in
alliance chat, for instance). That dropdown only ever offers slots that
are currently open (or the member's own current slot, so you can see and
change their placement); it can't be used to bump someone else out of a
slot. Placing someone here marks that slot 📌 manual, exactly like a pick
from the main grid — protected from OPTIMIZE and RESET the same way, and
it reverts a published day back to draft the same way too. Their potential
points stay visible in the panel the whole time, but only count toward the
day's **SCHEDULED PTS** total (shown in the status bar above the grid)
once they're actually placed in a slot — an unassigned member's points are
informational only, never counted as scheduled.

The panel empties out on its own as members either get placed or submit
availability for the day — there's nothing to dismiss or acknowledge, it's
just a live view of who still needs a manual look.

### Exporting a day

**EXPORT DAY only works on a published day.** Click it on a day that's
still in draft and nothing opens — a message reading exactly "This day
must be published before exporting" appears under the button instead. No
preview or copy text is generated for an unpublished day; publish it
first (see below), same requirement as always.

On a published day, EXPORT DAY opens a screenshot/copy-friendly overlay —
a light "buff schedule" card in the style of the in-game alliance
schedules players are used to sharing in chat, not a raw file download.
It has its own two filters, independent of anything else on the page:

- A time-range picker: **Full day**, **1st half · 00:00-11:30**, or
  **2nd half · 12:00-23:30**.
- An alliance picker: **All alliances**, or one specific alliance tag —
  populated only from alliances actually assigned a slot that day (not
  the state's whole alliance list), so it never offers a tag with nothing
  to export.

Both filters apply to the visual preview table AND the generated copy
text together — there's no case where the preview shows one set of
entries and the copy text shows another. The card lists every *assigned*
slot matching the filters, always sorted chronologically; empty slots are
left out, since the point of this view is "who's doing what," not a
blank grid. Each row shows the time, the member's in-game **Game ID**
(the visual preview always keeps this, no matter which export mode is
selected below), an **ALLY** badge in that alliance's chosen color (see
below), and their name in the game's own `[TAG]Name` convention — the
tag shown is always whatever alliance is actually on that member's own
record, never rewritten to match the filter (someone from a different
alliance filling a slot in an otherwise-SUN block still shows their real
tag).

**Two different copy-text formats, depending on the alliance filter** —
these are deliberately not the same:

- **One specific alliance selected** — meant to paste into that
  alliance's own in-game chat, so it's kept short: `TIME - [TAG]Name`,
  no Game ID. Heading: `Day 2 — Research — SUN Buffs`.
- **All alliances selected** — a state-wide export meant for the State
  President to actually place people in slots, so it keeps the Game ID:
  `TIME - [TAG]Name - GAME ID`. Heading: `Day 2 — Research — State Buff
  Schedule`.

Either way, filtering happens first and chunking into copy blocks happens
after — so a block is never left with a wrong or empty count because it
was split before the filters ran. **No copy block ever holds more than 10
player lines** (in-game chat has limited usable space); once a filtered,
sorted result has more than 10 entries, it's automatically split into
multiple numbered blocks — `Day 2 — Research — SUN Buffs (1/2)`, `(2/2)`,
and so on — each with its own independent **COPY TEXT** button that
copies only that block, never the whole export at once. A live preview of
each block's exact text sits right there with its character count.
**CLOSE ✕** (or clicking outside the card) dismisses the overlay without
changing anything on the schedule itself.

### Alliance colors

Admin → Alliances has a small color swatch next to each alliance tag
(alongside the existing add/remove controls) — click it to pick that
alliance's highlight color. It's used wherever an alliance shows up as a
badge, starting with the ALLY column on the EXPORT DAY card, so each
alliance is visually recognizable at a glance in a schedule screenshot.
An alliance with no color picked yet just shows as a neutral grey badge.

### Publishing the SvS schedule

The SCHEDULE tab under SvS prep only exists for the `admin` role — officers
and regular members don't get it in any form, not even read-only. From SvS
prep → SCHEDULE, an admin works the live grid (assign members to slots, see
per-slot availability and each available member's points for that day),
then clicks **Publish this day** once it's finalized. Publishing is
per-day, not all-or-nothing.

Once a day is published, the home page grows a **SVS SCHEDULE — PUBLISHED**
section, sectioned by alliance tag, showing every member their own
alliance's finalized slots (with points) across all published days. That
home-page section is the only place officers and regular members ever see
schedule assignments.

**Unpublish this day** on the same admin toggle reverts a day to draft if
you need to make changes before members see them again.
- **Bear calculator / Alliance championship** (`#/bears`, `#/championship`)
  — stub pages linked from home-page cards marked "COMING SOON". Build
  these out next: add a data shape to `data.js` and a `render...()`
  function in `app.js`, then swap the entry in `PLANNED_TOOLS` (or just
  give the route a real renderer in `ROUTES`).

## Sign-in

Sign-in requires an existing account plus its exact 4-digit PIN — there's
no way in without one, and no "type any PIN to claim this account"
fallback, so a member's bag data can't be reached by guessing or typing
someone else's name. The sign-in modal has two tabs:

- **Existing Member** — sign in with your chief name *or* Gamer ID, plus
  your PIN. Both must match a real account exactly; an unrecognized
  name/ID or a wrong PIN is rejected with an error, not silently let
  through.
- **New Member** — for anyone without an account yet: enter your Gamer
  Name, Alliance Tag, Gamer ID, and create a 4-digit PIN. That PIN is
  required on every login from then on. Blocked if the name or Gamer ID
  is already taken (you're pointed at "Existing Member" instead).

A member can also be added directly from Admin → Members ("Add member"),
which now also requires a 4-digit PIN at creation time — same reasoning:
an account with no PIN set has no way to be signed into. An admin can set
or replace a member's PIN at any time with **Reset PIN** next to them in
Admin → Members — it prompts the admin for the new 4-digit PIN and applies
it immediately (share it with the real member out of band); if that member
was already signed in, they're signed out so they re-authenticate with the
new PIN.

Because signing in requires the account owner's real PIN, and MY BAG /
MY SUBMISSION / MY POINTS all read `Store.bagSubmissions[Store.currentUser.id]`
— never another member's id — a member only ever sees their own bag data
once signed in. Viewing or editing *another* member's bag from Admin →
Members → Edit Bag is still possible, but only for the `admin` role (not
`officer`/R4), same as before.

**Home is public** — anyone can view it without signing in. SvS prep is
fully behind the login wall: a logged-out visitor gets a single "sign in
required" gate instead of the page, no per-tab peeking. Feedback and Admin
still gate individual actions (posting, the admin page itself) the same as
before.

This is still **local-only "security"** — a PIN check running entirely in
the browser is easy to bypass with dev tools, and there's no password
recovery beyond an admin resetting it. It stops casual impersonation, not a
determined technical user. Fine for a friendly alliance tool; not something
to rely on if that concerns you. See "Going multi-user" below for real
auth with a real backend.

**There's one permanent admin account**: name **Tacos**, PIN **2652**. It's
seeded automatically and self-heals — `Store.init()` checks for it (by id,
or by name if something re-added a similarly-named member) on every load
and re-adds or repairs it if it's missing or was edited, so it survives a
member deletion, clearing `localStorage`, or connecting to a Supabase
project that predates it. It's also protected in the UI: in Admin →
Members its row has no delete button, RANK is locked (not the editable
dropdown other admins/officers get), the name field is disabled, and Reset
PIN is replaced with a "permanent login" badge instead of a clickable
reset. This is meant as an always-available fallback login (e.g. if every
other admin account gets deleted or locked out) — change the id/name/PIN
in `PERMANENT_ADMIN_MEMBER` near the top of `data.js` if you'd rather use
different credentials, or remove the self-healing call in `Store.init()`
if you don't want a permanent account at all.

## Going multi-user (a real shared backend) + deploying with Vercel

By default every `Store.x` value (members, schedule, bag submissions,
feedback, alliances, etc.) lives in the browser's `localStorage` — fast,
zero setup, but **per-browser**: two people visiting the site each get
their own separate copy of everything. This section makes it actually
shared, using [Supabase](https://supabase.com) (free tier, Postgres +
row-level security) as the backend and [Vercel](https://vercel.com) to
host the static files. Everything below is already wired into the code —
this is just filling in two config values and running one SQL script, not
writing anything new.

### How it works

`data.js` has a `SUPABASE_CONFIG` object near the `Store` definition:

```js
const SUPABASE_CONFIG = {
  url: "",     // e.g. "https://xxxxxxxxxxxx.supabase.co"
  anonKey: "", // the "anon public" key — safe to publish, it's gated by Row Level Security, not secrecy
};
```

Leave both blank (the default) and nothing changes — the app runs exactly
as it always has, localStorage only. Fill both in and every `Store.x`
getter/setter transparently switches to reading/writing a single Supabase
table (`app_state`, one JSON row per key — see `schema.sql`) instead,
with an in-memory cache so the app's synchronous read-modify-write pattern
(`const x = Store.foo; x.bar = 1; Store.foo = x;`, used everywhere in
`app.js`) keeps working unchanged, and a realtime subscription so one
person's changes show up for everyone else without a manual refresh.
`Store.currentUser` (who's signed into *this* browser) always stays
localStorage-only, Supabase or not — that's inherently per-device, not
shared data.

This is a **key/value store, not a fully relational schema** — simpler and
lower-risk than modeling every entity as its own table, but it means two
admins editing the exact same list at the exact same instant will have one
overwrite the other (last write wins per key), not merge. Fine for
occasional admin edits from a handful of people; if that ever becomes a
real problem, a given key (e.g. `wos_bag_submissions`) can be split into
its own real table later without touching anything else.

**Force Sync to Supabase**: Admin → State config has a "Supabase sync"
panel with a **Force Sync** button (admin-only, hidden for officers/R4).
It re-pushes every synced key from this browser's current data up to
Supabase, overwriting whatever's there — useful if this browser has data
you know is more current (e.g. you just fixed something locally, or you
filled in `SUPABASE_CONFIG` for the first time on a browser that already
had real data seeded) and you don't want to wait for the normal
read/write flow to reconcile it. The button is disabled with an
explanatory message until `SUPABASE_CONFIG` is filled in.

### Set up Supabase

1. Create a free account and project at [supabase.com](https://supabase.com)
   (pick any name/region/password — you won't need the database password
   for any of this).
2. Once the project finishes provisioning, open **SQL Editor** in the left
   sidebar, **New query**, paste in the contents of `schema.sql` from this
   project, and **Run**. This creates the `app_state` table, sets up Row
   Level Security policies (open read/write — see the comments in that
   file for the tradeoff and how to lock it down further), and turns on
   realtime for the table.
3. Open **Project Settings -> API**. Copy the **Project URL** and the
   **anon public** key (not the `service_role` key — that one must never
   ship in a public site).
4. Paste those into `SUPABASE_CONFIG` in `data.js`:
   ```js
   const SUPABASE_CONFIG = {
     url: "https://xxxxxxxxxxxx.supabase.co",
     anonKey: "eyJhbGciOi...",
   };
   ```
5. Reload the site locally (`python3 -m http.server 8080`, per "Running
   it" above) and check the browser console — no errors, and the Network
   tab should show a request to your `*.supabase.co` domain. Open the site
   in two different browsers (or one normal + one incognito window), sign
   in as the same admin in both, and confirm a change in one (e.g. adding
   an alliance) shows up in the other within a second or two without
   reloading.

### Deploy to Vercel

The site is static — no build step — so this is a drag-and-drop:

1. Push this project folder to a GitHub repo (or use Vercel's CLI /
   drag-and-drop deploy if you'd rather skip Git).
2. At [vercel.com](https://vercel.com), **Add New -> Project**, import
   that repo.
3. Framework preset: **Other** (or "No Framework"). Leave the build
   command blank and set the output directory to the project root (`.`) —
   there's nothing to build, Vercel just serves the files as-is.
4. Deploy. You'll get a `*.vercel.app` URL immediately; attach a custom
   domain afterward from the project's **Domains** tab if you want one.

Since `SUPABASE_CONFIG`'s values are meant to be public (the anon key is
protected by Row Level Security, not by being secret), they can simply be
committed in `data.js` as shown above — no Vercel environment variables or
build step needed to inject them. Once deployed, every visitor to your
Vercel URL shares the same Supabase-backed data.

### Notes and limits

- The custom PIN sign-in still runs entirely in the browser (see "Sign-in"
  below) — moving to Supabase makes the *data* shared, it doesn't add
  server-enforced auth. The open RLS policies in `schema.sql` match that
  existing trust model. If you need real access control (a member truly
  can't read/write data without a valid login, enforced by the server, not
  just the UI), that means adopting Supabase Auth and rewriting the RLS
  policies around `auth.uid()` — a bigger change than this setup covers.
- If Supabase is unreachable (wrong URL/key, project paused, offline), the
  app logs an error to the console and falls back to in-memory seed data
  for that session rather than showing a blank page — nothing is silently
  lost, but nothing saves either until the connection is fixed. Reverting
  `SUPABASE_CONFIG` back to blank strings always instantly restores the
  original localStorage-only behavior.
- Free-tier Supabase projects pause after a week of no API requests and
  wake back up automatically on the next request (with a several-second
  delay on that first request) — fine for an alliance tool used a few
  times a week, worth knowing if the site feels slow to load after a quiet
  stretch.

## Notes

- Fonts: uses Google Fonts (Space Mono) over the network. If you need a
  fully offline build, download the font and reference it locally, or
  drop the `@import` in `styles.css` and rely on the monospace fallback.
- This is intentionally framework-free so it's easy to read and modify
  file-by-file (`index.html`, `styles.css`, `data.js`, `app.js`).
