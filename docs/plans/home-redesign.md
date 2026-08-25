# Plan — Schedule Command Home Redesign

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** feature

**Status:** PLANNING (2026-08-25). Mockup received (Option B — Contracted). T6 model: this is the **Plan (T1)** terminal.

**Mockup asset:** `docs/plans/assets/home-redesign-mockup.png` (visual source of truth).

---

## The mandate (LOCKED — verbatim from detach brief)

Two separate responsibilities, do not conflate them:

- The **existing Schedule Command Home screen** is the **FUNCTIONAL source of truth.**
- The **supplied mockup** is the **VISUAL source of truth.**

**Failure mode to avoid (happened on the Sales Command redesign):** functional
requirements were met but the visual implementation stayed too close to the OLD app —
the new mockup's aesthetic was not implemented literally enough. Result was heavy
back-and-forth on dark feature backgrounds, warm linen page surface, teal accents, card
proportions, spacing, typography hierarchy, borders, status colors, button styling,
contrast, information density, composition. **Do not repeat that.**

The finished screen must **visually resemble the mockup at first glance** — not the old
Schedule Command screen with beige components rearranged, a few borders/cards added, and
labels changed.

### PRESERVE (functional)
existing data · business logic · actions · permissions · routes · scheduling behavior ·
working components where practical.

### REPRODUCE (visual — from mockup)
overall page composition · dark charcoal **Weekly Crew Capacity** panel · dark charcoal
**Next Up** panel · warm sand/linen page surface · light warm cards · teal highlights &
primary actions · orange/red/purple/green operational signals · condensed bold typography ·
heading sizes & hierarchy · section spacing · card padding · card radius · border weight ·
button proportions · compact day-capacity indicators · horizontal alignment · relative
sizing of the three middle panels · restrained shadows · information density.

### OLD STYLES ARE NOT SACRED
Reuse **logic** aggressively; reuse **visual styling** selectively. Existing CSS/component
styles may be overridden where needed. If a shared component forces the old look, either
(1) add a new variant, (2) restyle it safely, or (3) wrap its logic in a Home-specific
presentation component. Prefer explicit variants (e.g. `<JobCard variant="home-compact" />`)
over globally changing a shared component used elsewhere. Do NOT globally modify a shared
component in a way that changes other screens.

---

## §0 Baseline (observed current state) [read-verified, baseline agent 2026-08-25]

**There is no Home screen today.** `/` → `/jobs` (`App.jsx:310`). The functional source of
truth for the "Jobs to Prepare" list is the existing `/jobs` view.

**Structure of `/jobs` (`src/views/Jobs.jsx`):** NOT a flat table. It's a **stage-picker
landing** (tiles: Staged / Ready / Active / On Hold / Complete / All) → per-stage **drilldown
list** selected by `?tab=`. `VALID_TABS = staged|scheduled|active|on-hold|complete|all`
(`Jobs.jsx:11`).

**The job card = `StageJobCard.jsx`** — already rendered expanded in the list. Its inline
toggles are **PLANNING / MANAGEMENT / DETAILS / BUDGET** (`StageJobCard.jsx:677-682`), which
flip `panels` state to show/hide panels inline (no route change). Clicking the card **header**
navigates to `/jobs/:jobId?mode=management` (`:671`). ← These four toggles are what Chris
means by "Planning, Management, and the other two links."

**Panels' content:** Planning = SOW/MTRL/CREW(X/needed)/DAYS/MOBS scorecards; Management =
PROP/BILLING/DEPOSIT/PRT/LOGS/FILES/NOTES; Details = crew names + SOW day lines + notes;
Budget = per-WTC bid breakdown.

**Status model (`src/lib/jobStatus.js`, `src/lib/queries.js`):** raw status normalizes to
Scheduled / In Progress / On Hold / Complete / Ongoing. Within **Scheduled**, `isReady()`
splits **STAGED** (not ready) vs **READY** (ready) via `ready_confirmed_at` + a checklist
(`queries.js:91-104`). Load-bearing — must be preserved.

**Filters/search:** time chips This Week/Month/Quarter/All Time/**Custom** with auto-fit
widening (`Jobs.jsx:402-408, 360-370`); two search scopes (drilldown `search`, picker
`pickerSearch`) matching job_num/job_name/work_type. Stage "filter" today = the picker tiles +
`?tab=`, NOT a dropdown.

**Primary card actions (by stage):** staged→**Promote to Ready** (gated by checklist),
ready→**Kickoff**, on-hold→**Resume**, complete→**Send to Billing** (`StageJobCard.jsx:720-741`).
Scorecards deep-link: CREW→`/schedule` (build-schedule path), PRT/LOGS→management tabs, SOW/
MTRL/DAYS/MOBS→modals.

**JobDetail (`/jobs/:jobId`) tabs:** planning mode = SOW, Logistics; management mode =
Overview, Production, Daily Log, Billing, History (`JobDetail.jsx:137-214`).

**No pagination** (`loadJobs` fetches all, `queries.js:477-495`). **No** "BUILD SCHEDULE /
VIEW JOB / ⋮ / Showing 1-25 of 68 / View All Jobs" exist in code. **Permissions:** binary
app-access gate on `apps.includes('schedule')` (`App.jsx:90-107`); no per-action role gating.

## §0.1 Mockup ↔ reality divergences [must resolve before build]

- **D1 — job-card inner labels. RESOLVED [LOCKED].** Mockup shows Overview/Details/Crew &
  Equipment/Schedule Plan; real card has **Planning/Management/Details/Budget**. Per Chris:
  keep the real four panels; the mockup's card internals are skin-only.
- **D2 — row action buttons.** Mockup rows show `VIEW JOB` + `BUILD SCHEDULE`; real card has
  stage-specific actions (Promote/Kickoff/Resume/Send-to-Billing) + scorecard deep-links.
  [DESIGN-OPEN, recommend] Keep real actions/behavior (functional truth); it's fine to *style*
  the header-nav as a "View Job" affordance and the CREW→/schedule path as "Build Schedule"
  where it reads naturally, but do not invent new actions. No new mutations.
- **D3 — list navigation model. RESOLVED → single list + `ALL STAGES ▾` dropdown** (see
  Decisions-Ratified). Real screen today = stage picker tiles → drilldown; Home replaces that
  with one "Jobs to Prepare" list, stage as dropdown, keeping the underlying predicates.
- **D4 — "Showing 1-25 of 68 / View All Jobs".** No pagination today. Either add a display
  cap + "View All" (new, small) or render all rows and treat the count as informational.
  [DESIGN-OPEN, recommend] Add a simple client-side cap with "View All Jobs" — cheap, matches
  mockup, respects the 1000-row PostgREST cap concern.
- **D5 — top panels are NEW data.** Weekly Crew Capacity (23/18/5 + per-day X/23), Next Up,
  Needs Attention, At a Glance are not on `/jobs` today. Data-availability pending the visual/
  StatsBar agent (`StatsBar.jsx` may already compute crew capacity).

## §1 Pre-build VISUAL AUDIT [read-verified, 2026-08-25]

Tokens live in `src/index.css:1-32`; styling is one global `src/App.css` (no Tailwind/CSS
modules). **The design DNA already matches the mockup** — the work is retuning token values +
building the Home composition, NOT a framework change.

| # | Aspect | Current | Mockup target | Verdict |
|---|---|---|---|---|
| 1 | Page background | warm sand `--bg #b5a896` (muted/greige) | lighter warm linen ~`#E7DECB` | **Restyle token** — lighten `--bg` (Home-scoped var to avoid changing every screen) |
| 2 | Header / nav | dark `#1c1814` **top header + horizontal nav**, no sidebar (`App.jsx:277-306`) | Option B shows a **left charcoal sidebar** + top nav | **DESIGN-OPEN (D6)** — top-nav is already dark+teal & close; sidebar is app-wide chrome, out of a Home-only scope. Recommend defer sidebar |
| 3 | Top actions | right "Actions" row of `app-act-btn`, green primary (`App.css:66-97`) | compact `+ JOB` / `ACTIONS ▾`, teal primary | **Restyle** — tighten to 2 controls look, primary→teal |
| 4 | Weekly Crew Capacity | `StatsBar` dark grid, Avail/Out per day, mono, click→modal (`StatsBar.jsx`) | 3 circular badges (Avail/Assigned/Open) + per-day `X/23`+bar+% + TODAY + teal "View Crew Schedule" | **Restyle + extend** `StatsBar` (data mostly present: crew/assignments/crew_status/jobs). Home variant |
| 5 | Dark feature panels | `#1c1814` warm-near-black on header/statsbar/score-card | near-black charcoal; also **Next Up** card | **Reuse** dark surface; add **Next Up** as a new dark card; optionally cool/darken toward `#0E0E0C` |
| 6 | Light panels | `jh-card`/`sjc-card` bg `#c8bcaa`, r10, subtle shadow (`App.css:2533,5658`) | lighter creamy cards `~#F2ECDE`, thin warm border, restrained shadow | **Restyle token** (lighter card bg); keep radius/shadow recipe |
| 7 | Typography | Barlow Condensed (display) + Barlow (body) + JetBrains Mono (nums) (`index.css:29-31`) | condensed bold uppercase labels, big mono numerals | **Reuse as-is** — already the mockup's type system. No new font |
| 8 | Color system | **primary = Command Green `#5BBD3F`**; teal `#30cfac` = header-brand only; full status palette (`index.css:6,15-23`) | **primary = teal `#30cfac`**; green = "available/ready" signal only; orange/red/purple signals | **Restyle (D-teal)** — promote teal to primary on Home; green→signal role. Home-scoped, not global |
| 9 | Spacing | `app-main` 24px pad; card gap 8px; grid gap 14px (`App.css:415,2526,5175`) | tighter section rhythm, compact controls | **Restyle** — Home-specific spacing scale |
| 10 | Borders/radii/shadows | border `rgba(28,24,20,.14–.2)`, r8/10-12, shadow `0 2px 8px /.07` (`App.css:2533-2542`) | thin warm borders, r10-14, near-flat shadow | **Reuse** recipe, minor tune |
| 11 | Buttons | `app-act-btn` condensed uppercase, r8, green primary (`App.css:66-97`) | teal filled primary + teal outline secondary, compact | **Restyle** — teal variants, keep condensed-uppercase form |
| 12 | Job list | `AllJobsList` groups by stage → full `sjc-card`s; also picker tiles | single "Jobs to Prepare" list, compact rows + toolbar | **DESIGN-OPEN (D3)** + restyle |
| 13 | Compact job card | `jh-card` compact expandable row w/ `jh-status-badge` EXISTS (`App.css:2533-2624`); full `sjc-card` | compact row → click opens collapsed card → Planning/Mgmt/Details/Budget expand inline | **Reuse `sjc-card` logic**, present collapsed-by-default in a compact row; Home variant |

**Net:** font system, dark-panel surface, card/border/shadow recipe, and StatsBar/`sjc-card`
logic all **reuse**. Restyle = token values (page + card bg lighten, teal→primary) + the Home
composition + StatsBar/`Next Up` visual treatment. No framework or shared-logic rewrite.

## §2 Proposed change

**A. Home-scoped theme layer.** Add a `.home-screen` scope (or `data-screen="home"`) that
overrides tokens locally so other screens are untouched this pass:
`--bg` → lighter linen, `--bg-card` → creamy, primary accent → teal `#30cfac`, define the
signal roles (green=available/ready, orange=assigned/staged, red=needs-crew/low, purple=open/
completion). [Honors "don't globally mutate shared components" + the standing teal direction.]

**B. New Home route + screen.** Add `/home` (and point `/` there instead of `/jobs`, keeping
`/jobs` working). New `src/views/Home.jsx` composing:
1. Greeting header ("Good morning, …" + schedule overview) inside existing shell.
2. **Weekly Crew Capacity** — Home variant of `StatsBar`: 3 circular summary badges + per-day
   `X/total` + progress bar + % + TODAY marker + teal "View Crew Schedule". Reuse its data calc.
3. **Needs Attention / Next Up / At a Glance** three-panel row — Needs Attention + At a Glance
   are light cards built from existing job/crew data (jobs-need-crews, conflicts, not-ready;
   jobs-scheduled, crew-assignments, completion). **Next Up** = dark feature card for the top
   priority job with teal BUILD SCHEDULE (→ existing `/schedule` path) + VIEW JOB (→ existing
   `/jobs/:id`). [Data wiring is the main new work — see D5.]
4. **Jobs to Prepare** — the existing job list, reskinned to compact rows that open the
   collapsed `sjc-card` inline (Planning/Management/Details/Budget expand as today). Resolve D3.

**C. Preserve** all job-card logic, status derivation, filters/search, actions, routes,
permissions verbatim (see §0 preserve list).

## §3 Files to touch (draft)
- `src/index.css` — add Home-scoped token overrides (no global token changes).
- `src/App.css` — new Home classes (`.home-*`), sidebar chrome (`.app-sidebar`), StatsBar Home
  variant, compact-row job card, Next Up / Needs Attention / At a Glance cards.
- `src/App.jsx` — **add left sidebar to `AppShell`** (nav from `NAV_ITEMS`), per-route
  full-bleed flag so `/schedule` renders without it; add `/home` route; repoint `/`.
- `src/views/Home.jsx` — NEW screen composition.
- `src/components/StatsBar.jsx` — Home variant / extend for badges + per-day capacity.
- `src/components/StageJobCard.jsx` — support a `variant="home-compact"` (collapsed-by-default
  in a compact row) WITHOUT changing its use on `/jobs`.
- Possibly a small `src/lib/queries.js` addition for the Needs-Attention / At-a-Glance / Next-Up
  aggregates (read-only selects; no schema change, no migration).

## §4 Out of scope / deferred
- Global green→teal swap on other screens (this pass keeps teal Home-scoped; global swap stays
  the deferred polish pass per standing direction). NOTE: the app-wide **sidebar** IS in scope
  per D6 — only the teal token swap stays Home-scoped.
- Any change to job-card business logic, status model, or the `/jobs` picker behavior beyond
  what D3 decides.
- No DB migrations (UI + read-only queries only) → no shared-Supabase collision with the live
  `feat/delete-scheduled-job` branch.

## §5 Estimate / time budget
Rough: theme layer (S) + Home composition & 3 panels (M) + StatsBar Home variant (M) + compact
job-row variant wiring (M) + data aggregates for the panels (M) + in-browser visual verify vs
mockup (S). Single focused build session. Firm up after D3/D6/teal decisions land.

## Decisions — RATIFIED [LOCKED — Chris, 2026-08-25]
- **D3 = (a) single list + `ALL STAGES ▾` dropdown.** Replace the picker-tiles→drilldown flow
  on Home with one "Jobs to Prepare" list; stage becomes a dropdown filter; keep time chips +
  search + auto-fit. Preserve all underlying stage predicates/status derivation.
- **D6 = (b) add the left charcoal sidebar APP-WIDE, EXCEPT the Crew Schedule view**
  (`/schedule` stays full-width / no sidebar — it needs horizontal room for the grid).
  → Now an app-shell change: sidebar lives in `AppShell`; every route except `/schedule`
  renders inside it. Content width on all other screens shrinks to sit beside the sidebar —
  expect light per-screen layout adjustments (intended, not scope creep). Mechanism: a
  per-route "full-bleed / no-sidebar" flag for `/schedule`.
- **D-teal = yes** — teal `#30cfac` promoted to primary accent on Home; green → "available/
  ready" signal role. Home-scoped token layer (global swap on other screens stays deferred).
- **D2 = yes** — keep real job-card actions (Promote/Kickoff/Resume/Send-to-Billing + scorecard
  deep-links); style header-nav as "View Job" and CREW→/schedule as "Build Schedule" where it
  reads naturally; invent no new actions/mutations.
- **D4 = yes** — add a simple client-side "Showing 1-25 of 68 / View All Jobs" cap.

## Scope delta from D6 (sidebar app-wide)
This lifts the redesign from "Home screen only" to "**new app-shell (sidebar) + new Home
screen**." Added surface:
- `AppShell` (`App.jsx:112,277-306`) gains a left charcoal sidebar (nav moves/duplicates from
  the top row); top header keeps greeting + `+ JOB` / `ACTIONS ▾`.
- Per-route flag so `/schedule` renders full-bleed without the sidebar.
- Each other screen's outer container adjusts to the narrower content column.
- Still **no DB migrations** — chrome + read-only queries only.

## §6 Locked decisions [LOCKED — Chris, 2026-08-25]

1. **Option B — Contracted** is the chosen layout (mockup right column). Keeps more of the
   job list in view; job card opens **inline on the same page**, no navigation change,
   filters/search/context preserved.
2. **Job card is UNCHANGED** — same layout, same tabs, same functionality. Clicking a row
   opens the job card **collapsed**; the tab links (Overview / Details / Crew & Equipment /
   Schedule Plan / …) expand detail **inline on the same page**. Reuse existing job-card
   logic wholesale; only its visual skin changes to match the mockup.
3. **This is a visual reskin**, not a functional change. Preserve all data, business logic,
   actions, permissions, routes, scheduling behavior.
4. **New Home screen.** Today `/` redirects to `/jobs`; there is no Home route. This redesign
   introduces the Home/schedule-overview screen (Weekly Crew Capacity + Needs Attention /
   Next Up / At a Glance + "Jobs to Prepare" list). The "Jobs to Prepare" list IS the existing
   job-list/job-card functionality, reskinned. [DERIVED — confirm the current job list lives
   in `src/views/Jobs.jsx`; baseline agent running.]

## §8 Design system — extracted from mockup [LOCKED to mockup]

The literal visual target. Build to THESE values, not to the old app's styling.

### Color roles
- **Page surface:** warm sand / linen, ~`#E7DECB`–`#EAE2D2` (light warm beige). NOT white,
  NOT the old app background.
- **Dark feature panels:** near-black charcoal, ~`#0E0E0C`–`#141412`. Used for: **left
  sidebar**, **Weekly Crew Capacity** bar, and the **Next Up** card. These are the visual
  anchors — they must read as genuinely dark/black, not dark-gray beige.
- **Light warm cards:** slightly lighter-than-page warm cards (~`#F2ECDE` / faint warm
  border) for Needs Attention, At a Glance, Jobs-to-Prepare rows.
- **Teal accent (primary):** turquoise ~`#30CFAC` (per SC pop-color standard — teal, NOT
  green). Used for: primary buttons (BUILD SCHEDULE filled), secondary outline buttons
  (VIEW JOB / VIEW CREW SCHEDULE), active nav highlight, active filter chip, key stat
  numbers/icons, links ("VIEW ALL ALERTS →", "VIEW ANALYTICS →").
- **Operational signal colors:**
  - **Green** — crew available / READY status / positive checks.
  - **Orange/amber** — assigned count / STAGED status / warnings / mid-capacity days.
  - **Red** — needs-crews alert / "Crew not assigned" / low-capacity days (e.g. Sat 35%).
  - **Purple** — open crew spots / schedule-completion %.

### Typography
- Condensed, **bold**, uppercase section labels (WEEKLY CREW CAPACITY, NEEDS ATTENTION,
  NEXT UP, AT A GLANCE, JOBS TO PREPARE). Large bold numerals for stats (23 / 18 / 5, 12 /
  168 / 97%). Greeting: "Good morning, John. ☀️" + "Here's your schedule overview."
- [DESIGN-OPEN] confirm exact display font vs. what's currently loaded — visual-audit agent
  running. If current font isn't condensed enough, add a condensed display face for headings.

### Composition (top → bottom)
1. **Header row** (on sand): greeting left; top nav + `+ JOB` + `ACTIONS ▾` right.
2. **Weekly Crew Capacity** — full-width **dark charcoal** bar. Left: three big circular
   stat badges (23 Crew Available / teal-green, 18 Assigned / orange, 5 Open Crew Spots /
   purple). Right: six day-capacity indicators MON 24–SAT 29, each `X / 23` + thin progress
   bar + % (color-coded), with a "TODAY" marker under the current day. Top-right: teal
   outline `VIEW CREW SCHEDULE →`.
3. **Three middle panels**, equal-ish columns:
   - **Needs Attention** (light card) — 3 alert rows, each with a colored round icon badge +
     count + label + subtext + chevron; footer `VIEW ALL ALERTS →`.
   - **Next Up** (dark charcoal feature card) — job title, Job #, Customer, Work Type, Crew
     status (red "Crew not assigned"), Location; two buttons: `BUILD SCHEDULE →` (filled
     teal) + `VIEW JOB` (teal outline); star icon top-right.
   - **At a Glance** (light card) — 3 stats (12 Jobs scheduled / teal, 168 Crew assignments /
     orange, 97% Schedule completion / purple); footer `VIEW ANALYTICS →`.
4. **Jobs to Prepare** — section title + subtitle + "SHOWING 1-25 OF 68 JOBS" + `VIEW ALL
   JOBS →`. Toolbar: search box + time chips (THIS WEEK / **THIS MONTH** active / THIS
   QUARTER / ALL TIME) on the left; `ALL STAGES ▾` + "Viewing Staged" on the right. Then the
   job rows — compact single-line rows (status badge + box icon + job # & name + customer +
   work-type pill + location + start date + crew X/Y + budget + `VIEW JOB` / `BUILD SCHEDULE`
   / ⋮). A clicked row opens the collapsed job card inline with its tab bar (Option B behavior).

### Borders / radii / shadows / density
- Restrained shadows (near-flat). Medium card radius (~10–14px). Thin warm borders on light
  cards; dark panels borderless. Compact controls — small pill chips and buttons, NOT the
  old oversized toolbar. Higher information density than the old screen.

## §9 Variant strategy [DERIVED — confirm after baseline]
Per the mandate: reuse LOGIC, restyle VISUALLY; do NOT globally mutate shared components used
on other screens. Where a shared component (e.g. the job card / StatsBar) forces the old look,
prefer an explicit Home-scoped variant/wrapper over a global style change. Concrete plan to be
filled in once the two baseline agents report.

## §7 After-build VISUAL VERIFICATION [TODO — gate for "done"]
Run the app, compare rendered screen to mockup. Must confirm: Weekly Crew Capacity is
actually charcoal/black · Next Up is a dark feature card · surrounding workspace is warm
sand/linen · teal accents in the same visual role · same hierarchy · comparable card
proportions, whitespace, typography · controls compact (not the old oversized toolbar) ·
screen immediately reads as the NEW mockup, not the old screen. Functional success alone is
NOT completion. **Functional fidelity + visual fidelity = completion.**
