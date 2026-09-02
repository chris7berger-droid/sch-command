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

> **Round-1 audit resolved this section.** The original "everything Home-scoped" theme plan had
> a scope contradiction (shell chrome can't be reached by a Home-only scope). Superseded by the
> two-layer split below. See §10 for the full round-1 resolutions.

**A. Two-layer theme + honest frame rebuild (round-2 corrected).** The frame reskin and the
content reskin are different jobs. **Correction to round-1 prose:** the app has **NO sidebar
today** (§1 baseline: top header + horizontal nav only), and the chrome accent is **green
`#5BBD3F`, not teal**. So the frame work is a real **structural reparent + a green→teal
repaint**, not a "small change." Mechanisms:
- **Shell (global): the sidebar REPLACES the top nav** (D6 refined — Chris wants the top menu
  gone). Full reparent spec in **§12**; green→teal chrome repaint list in **§13**. `/schedule`
  renders sidebarless + full-bleed (route-aware, not CSS `:has`).
- **Weekly Crew Capacity strip → Home content, NOT shell.** Rebuilt inside `Home.jsx`; the
  global `<StatsBar/>` (App.jsx:307) is **not rendered on `/home`** (§12) so the old grid can't
  stack above the new strip. Its dark surface uses a Home-scoped `--panel-dark` (§13), not the
  global `--header-dark`.
- **Home body (scoped): `.home-screen` token layer.** `--bg` → lighter linen, `--bg-card` →
  creamy, `--panel-dark: #111110` for capacity strip + Next Up, **content** primary accent →
  teal `#30cfac` (fills) with a dark-teal ink for teal text on light (§13); signal roles
  green=available/ready, orange=assigned/staged, red=needs-crew/low, purple=open/completion.
  Scoped so it can't touch other screens.

**B. New Home route + screen.** Add `/home` (and point `/` there instead of `/jobs`, keeping
`/jobs` working). New `src/views/Home.jsx` composing:
1. Greeting header ("Good morning, …" + schedule overview) inside the (now-sidebar) shell.
2. **Weekly Crew Capacity** — Home variant of `StatsBar` rendered as Home content: 3 circular
   summary badges + per-day `X/total` + progress bar + % + TODAY marker + teal "View Crew
   Schedule". Reuse its data calc; see §11 for exact number sources.
3. **Needs Attention / Next Up / At a Glance** three-panel row — all numbers derive from real
   data per §11 (no hardcoded/guessed values). **Next Up** = dark feature card for the top
   priority job (soonest-starting job still needing attention, §11) with teal BUILD SCHEDULE
   (→ existing `/schedule` path) + VIEW JOB (→ existing `/jobs/:id`).
4. **Jobs to Prepare** — the existing job list, reskinned to compact rows. Clicking a row opens
   the collapsed `sjc-card` inline (Planning/Management/Details/Budget expand as today). **The
   row's right-side action slot surfaces the real per-stage action** (Promote to Ready / Kickoff
   / Resume / Send to Billing) so office staff keep their one-click workflow — no action is
   buried behind the expand click (round-1 fix). Resolve D3 (single list + dropdown).

**C. Preserve** all job-card logic, status derivation, filters/search, actions, routes,
permissions verbatim (see §0 preserve list).

## §3 Files to touch (draft)
- `src/index.css` — `.home-screen` scoped token overrides (Home body only, no global token change).
- `src/App.css` — **global chrome** restyle (`.app-header`, new `.app-sidebar`) + Home classes
  (`.home-*`), Home capacity strip, compact-row job card, Next Up / Needs Attention / At a Glance.
- `src/App.jsx` — **add left sidebar to `AppShell`** (nav from `NAV_ITEMS`) as global chrome;
  per-route full-bleed flag so `/schedule` renders without it; add `/home` route; repoint `/`.
- `src/views/Home.jsx` — NEW screen composition (incl. the rich Weekly Crew Capacity strip as
  Home content).
- `src/components/StatsBar.jsx` — Home variant for the capacity strip (badges + per-day capacity).
  Existing shell usage on other screens stays as-is.
- `src/components/StageJobCard.jsx` — `variant="home-compact"` (collapsed-by-default compact row
  with the real per-stage action on the row) WITHOUT changing its use on `/jobs`.
- `src/lib/queries.js` — new read-only aggregate selectors for the dashboard numbers (§11);
  crew-per-job from **`assignments`** via the `crewByCallLog` grouping (NOT `job_crew` — §11 G2),
  on ONE Mon–Sat window (§11 G3a/b); export/relocate `effectiveStart`. No schema change, no migration.

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
  **Refined 2026-08-25 (round 2):** the sidebar **REPLACES the top horizontal nav** — Chris
  wants the top menu gone. Nav links move from `.app-nav` into the sidebar; the top bar keeps
  only the greeting + `+ JOB` / `ACTIONS`. This is a real **frame reparent** (no sidebar exists
  today — §1 baseline confirms top-header + horizontal nav only), not a small change. Mechanism
  spec in §12.
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

## §10 Audit resolutions — mechanism index [LOCKED, round-2 deepened 2026-08-25]
Round 1 was resolved in prose; round 2 correctly flagged the mechanisms were never written.
Each fix now points to a **concrete, code-anchored** section (not intent):
1. **Frame styling / sidebar** → §2A (two-layer) + **§12** (shell reparent: `useLocation`,
   conditional sidebar mount, `/schedule` full-bleed, StatsBar-off-`/home`) + **§13** (two blacks
   `--panel-dark` vs `--header-dark`; green→teal chrome list). Round-2 correction: sidebar is a
   real reparent replacing the top nav, chrome is green today — both now specced.
2. **Dashboard numbers** → **§11** mechanisms: `job_crew` banned (G2), ONE Mon–Sat crew window
   used by readiness + counts (G3a/b), conflict = distinct job_id, completion-% denominator +
   null guards, `effectiveStart` export. Verified against Jobs.jsx:205-245 / queries.js:100-104 /
   StatsBar.jsx:50-53.
3. **Compact rows / daily actions** → **§14**: `home-compact` conditional return in StageJobCard,
   per-card `stageOf()`, real per-stage action on the row, `active`-row empty-slot handling,
   auto-fit/search/`THIS MONTH`-default all explicitly reconciled.
4. **Legal teal contrast** → §13 G6 (teal fills only; `--teal-ink` for teal text on light).
5. **Adjacent/pre-existing** → §15 (filed, not built this pass).

**Round-3 fixes (final pass, 2026-08-25):** readiness = own-dates map, capacity = week map (§11
G3a, Chris Option 1); `crew_needed` coerced `||0` (B1); Assigned = global crew union (B3);
completion-% denom/numerator guards (B4); `/schedule` gets a collapsed icon-rail so nav isn't
stranded (§12 A1); header transformation + sidebar visual spec written (§12/§12.1 A2/A3); `stageOf`
exported (§14 C3); list cap = 25 of post-filter N (§14 C1); compact-row fields enumerated (§14 C2);
`:337` mis-cite dropped (§13). Per round-3 audit this is **build-ready**; round 4 optional/light.

## §11 Dashboard number sources — MECHANISMS [LOCKED — round-2 deepened 2026-08-25]

**G2 — `job_crew` is BANNED from every dashboard number.** Verified: `job_crew` is Field
Command **clock-ins that only exist post-kickoff** (Jobs.jsx:200-204 comment). Crew-per-job for
scheduling comes from the **`assignments`** table only, via the existing `crewByCallLog` memo
(Jobs.jsx:205-219): group `assignments` by `crew_name` into a Set, keyed by `call_log_id`
(mapped from `job.job_id → job.call_log_id`). The build reuses that exact grouping — no
`job_crew` reads anywhere in the Home selectors. Strike the old "`job_crew.call_log_id` FK"
note from §3.

**G3a — TWO crew maps, each on the RIGHT window [Chris ratified Option 1, round 3].** Round-2's
"one this-week window everywhere" was wrong for readiness: a job crewed for a start date weeks
out has 0 rows this week → falsely "needs crew," and reads "ready" on `/jobs` but "not ready" on
Home. Readiness is a property of the **job's own dates**, not the calendar week. So:
- **`crewByCallLog_week`** = built from a **Mon–Sat-windowed** `assignments` load (G3b) → feeds
  the **capacity strip + "needs crew" + per-day counts** (this-week crew load).
- **`crewByCallLog_all`** = the job's-own-dates map — the **existing all-time** grouping the
  `/jobs` screen already uses (Jobs.jsx:205-219 over the Jobs.jsx:245 load) → feeds
  **`isReady()` + "not ready"** so Home agrees with `/jobs` (no cross-screen contradiction).

This does mean "needs crew" (this-week) and "not ready" (own-dates) answer different questions —
intended: one is "who's short THIS week," the other is "is this job set up." They no longer
contradict because they're labeled as different things, and readiness matches `/jobs` exactly.

**G3b — every assignments read is date-bounded** exactly like `StatsBar.jsx:50-53`:
`.gte('date', mondayStr).lte('date', saturdayStr)` on the `date` column (week from `wkDates`).
Never `select('*')` unbounded (silent 1000-row truncation as the table grows).

Selectors live in a new `queries.js` block, read-only, following `loadJobs()` conventions.

| Number | Mechanism (verified anchors) |
|---|---|
| **Crew available** | active `crew` minus those out per `crew_status` this week — reuse StatsBar's avail calc (StatsBar.jsx:69-85) |
| **Assigned** | **B3:** global distinct crew this week — `new Set(windowedAssignments.map(a=>a.crew_name)).size`. NOT summed from `crewByCallLog_week` (a crew on 2 jobs double-counts, exceeding headcount) |
| **Open crew spots** | Σ over this-week jobs of `max(0, need − size(crewByCallLog_week[call_log_id]))` where **`need = parseInt(crew_needed) || 0`** (B1 — `crew_needed` nullable, App.jsx:151; coerce like Schedule.jsx:584) ← Chris default |
| **Per-day X / total** | assigned / available per day — StatsBar per-day calc (StatsBar.jsx:69-85); this is a **visual rebuild** of the strip, not "reuse as-is" |
| **Jobs need crews** (this-week short) | jobs where `size(crewByCallLog_week[call_log_id]) < (parseInt(crew_needed)||0)` (B1 guard; uses the **week** map) |
| **Schedule conflicts** | a `crew_name` appearing on **≥2 distinct `job_id`** for the same `date` (count distinct job_id, not rows — split shifts on one job are not a conflict) |
| **Jobs not ready** (own-dates setup) | Scheduled-stage jobs failing `isReady(job, crewByCallLog_all, matsByJobId)` (queries.js:100-104) — fed the **all-time / own-dates** map (B2, Option 1) so it matches `/jobs` |
| **Next Up** | soonest-starting job still needing attention (not-ready via `crewByCallLog_all` OR short via `crewByCallLog_week`), ordered by `effectiveStart`. `effectiveStart` has **5 identical non-exported copies** (Jobs.jsx:49 / StageJobCard.jsx:13 / DaysModal.jsx:7 / StagedCardList.jsx:3 / JobDetail.jsx:40) — **export ONE** (shared module) and use it; do not add a 6th ← Chris default |
| **Jobs scheduled** | count of Scheduled-stage jobs in range |
| **Crew assignments** | count of rows in the windowed `assignments` |
| **Schedule completion %** | assigned job-days ÷ total scheduled job-days for Mon–Sat. **B4 guards:** denominator `=== 0` → render `0%`/`—` (quiet week ≠ NaN); constrain numerator to each job's `[start,end] ∩ week` day-set (else >100%); guard null `start_date`/`end_date`. Wall-clock `fmtD` only — never `toISOString()` on a `date` column ← Chris default |

## §12 Shell reparent — MECHANISM (G1/G1b) [LOCKED — D6 keep, sidebar replaces top nav]

**Baseline (verified, App.jsx:273-312):** a flat fragment — `<header class="app-header">` (which
*contains* `<nav class="app-nav">`), then a **sibling** `<StatsBar/>` (L307), then `<main
class="app-main">`. No flex-row wrapper exists.

**Target structure:**
```
<div class="app-frame" flex-row>
  <aside class="app-sidebar" [data-collapsed]/>  {/* nav moved out of header; icon-rail on /schedule */}
  <div class="app-col" flex-column>
    <header class="app-header"/>         {/* greeting + ACTIONS ▾ + +JOB only; nav & Sign Out removed */}
    {/* StatsBar NOT rendered on /home */}
    <main class="app-main"><Routes/></main>
  </div>
</div>
```
- **Route-awareness via `useLocation()`** in `AppShell` (there is none today — this is the single
  hook the round-1 plan never named). Derive `path = useLocation().pathname`.
- **Sidebar ALWAYS mounts — collapses on `/schedule` (A1 fix).** Round-2 said "no sidebar on
  `/schedule`," but since the sidebar now *replaces* the top nav, that would strand `/schedule`
  with **no way to navigate away** (header has no nav). Fix: on `/schedule` render the sidebar as
  a **collapsed icon-rail** (`data-collapsed`, ~64px, icons only) so nav stays reachable while the
  board keeps almost all its width. Expanded (~220px) on every other route. Nav links = `NAV_ITEMS`
  (App.jsx:26-36).
- **`/schedule` width:** `<main>` gets full width minus the 64px rail. The board grid
  `.sch-stats-bar` `50px repeat(6,1fr)` (App.css:669) reflows fine at that width; drop the old
  `.app-main:has(.sch-layout)` zero-padding hack in favor of the rail layout.
- **StatsBar gating:** do **not** render the shell `<StatsBar/>` on `/home` (the Home capacity
  strip replaces it). Elsewhere it renders as today. (Simplest: `{path !== '/home' && <StatsBar/>}`.)
- **A3 — header transformation (not "keeps only"):** today the header has **8 buttons** (Refresh,
  +Job, +Crew, Work Types, Crew List, Send Schedules, Export, Sign Out) and **no greeting**. The
  build must: (a) **add** the greeting block ("Good morning, {name}. ☀️ / Here's your schedule
  overview."); (b) **collapse** the 8 buttons into `+ JOB` + an `ACTIONS ▾` menu holding the rest;
  (c) **move Sign Out into the sidebar** user card. This is real work, not a trim.
- **Wrapper CSS:** `.app-frame { display:flex; min-height:100vh }`, `.app-col { display:flex;
  flex-direction:column; flex:1; min-width:0 }` (the `min-width:0` lets `/schedule`'s grid shrink
  correctly). State these explicitly.
- **Height constant caveat (→ §15):** `.sch-layout { height: calc(100vh − 52px) }` (App.css:661)
  already mismatches the ~96px header and will shift again post-reparent. Re-verify/relink this
  offset during build so the board grid doesn't mis-size.

### §12.1 Sidebar visual spec (A2) [LOCKED to mockup]
The sidebar's own look was undefined — it can't be built to the mockup without this. No
`.app-sidebar`/`.app-frame`/`.app-col` CSS exists today; all new.
- **Surface:** charcoal `--header-dark` (`#1c1814`) full-height; width **220px** expanded / **64px**
  icon-rail (`/schedule`). No right border; subtle inner separators only.
- **Top:** `ScheduleCommandMark` logo (`components/Logo.jsx`) + "SCHEDULE COMMAND / COMMAND SUITE"
  wordmark (hidden in icon-rail mode).
- **Nav list:** `NAV_ITEMS` as rows — icon + label (Barlow Condensed uppercase, tracked); label
  hidden in rail mode (tooltip on hover). **Active item:** teal `#30cfac` text + a teal left-edge
  bar (this is where the old `.app-nav a.active` green underline relocates, recolored — §13 G4b).
  Hover: faint white-alpha row bg.
- **Bottom:** `‹ COLLAPSE` toggle (persists `data-collapsed`), then the **user card** (avatar
  initials + `{name}` / `{role}` from `team_members`) and **SIGN OUT** (relocated from header, A3).
- **Content offset:** `.app-col` sits to the right; other screens' inner containers already use
  auto-fill/minmax grids (verified 6 of 7 shrink fine) so they reflow into the narrower column.

## §13 Theme mechanics — MECHANISM (G4a/G4b/G6) [LOCKED]

- **G4a — two distinct blacks.** Add a Home-scoped `--panel-dark: #111110` (true charcoal) under
  `.home-screen`; point the capacity strip + Next Up card at it. **Do NOT edit the global
  `--header-dark: #1c1814`** (index.css:5, 45 refs across App.css) — editing it would shift the
  header/nav/score-cards app-wide. Result: Home panels read true-black; global chrome unchanged.
- **G4b — green→teal chrome repaint (explicit list, all via `var(--command-green)` today):**
  - `.app-actions-label` color (App.css:57)
  - `.app-act-btn:hover` border-color (App.css:81)
  - `.app-act-primary` background + border-color (App.css:85, 87); `:hover` hardcoded `#4aa832`
    (App.css:91) → teal-hover shade
  - `.app-nav a.active` color + border-bottom (App.css:141-142) → **relocates to the sidebar**
    active-item style (teal text + left-edge bar, §12.1)
  - *(round-3 precision: the old `:337` entry was `.mcl-inp:focus` — a Crew List modal input, NOT
    chrome — dropped. The list above is the complete, correct chrome-green set; nothing missed.)*
  Repaint these to teal `#30cfac`. Chrome keeps `--header-dark`; Home panels use `--panel-dark`;
  they live on separate surfaces (never adjacent), so no two-blacks mismatch.
- **G6 — legal teal on light.** `#30CFAC` teal text on `#F2ECDE` card ≈ 1.6:1 (fails WCAG +
  CLAUDE.md "teal text only on dark"). Rule: **teal `#30cfac` for FILLS only** (buttons, active
  chips, badges on dark). For teal **text/links on light cards** (stat numbers, "VIEW ALL
  ALERTS/ANALYTICS →") use a dark-teal ink `--teal-ink: #0d5c4a`. Add to the `.home-screen` scope.

## §14 List / compact-row — MECHANISM (G5) [LOCKED]

- **`variant="home-compact"` is a conditional return branch inside `StageJobCard`**, not a prop
  tweak. Verified: the card takes a `stage` prop (StageJobCard.jsx:579) and its body/action
  branch on `stage ===` (L119-181, L719-741). The Home variant returns a compact single-line row
  early; the **default `/jobs` path is untouched** (leave the existing full-card return as-is).
- **Per-card stage in a tabless flat list (C3):** the single list has no `?tab=` context, so
  compute each job's stage with **`stageOf(job, crewByCallLog_all, matsByJobId)`**
  (AllJobsList.jsx:18-24) and pass it as the `stage` prop. **`stageOf` is module-private today —
  export it** (shared module), the same fix §11 applies to `effectiveStart`; do not inline a copy.
  Feed it the **own-dates `crewByCallLog_all`** map (stage/readiness use own-dates per §11 B2).
- **Compact-row content (C2) — enumerate, don't drop the time signals.** The full card's time
  cues live in `StageBanner` (kickoff countdown, "day N of M", staged readiness glyphs
  📋👷📦📅). An early-return row that omits them regresses §0's "both time chips." The compact
  row **carries:** status badge (STAGED/READY/etc.) · `job_num` + `job_name` · customer ·
  work-type pill · location · start date (`effectiveStart`) · crew `X/Y` · budget · a **condensed
  time signal** (kickoff countdown OR "day N of M" as applicable) · the action slot. Readiness
  glyphs collapse into the status badge.
- **Action slot on the row (round-1 fix):** surface the real per-stage button (Promote/Kickoff/
  Resume/Send-to-Billing, StageJobCard.jsx:719-741) in the row's right action slot. **`stage ===
  'active'` renders no button today** — for active rows render a **neutral fixed-width spacer**
  (NOT a second "View Job" link — that would duplicate the row's own header→`/jobs/:id` nav, per
  round-3 note) so the action column doesn't jump.
- **Reconcile the mockup's row buttons** (`VIEW JOB` / `BUILD SCHEDULE` / ⋮) with the real set:
  primary slot = the real stage action; "View Job" = the row/header→`/jobs/:id`; "Build Schedule"
  = CREW→`/schedule` path. Invent no new action (D2).
- **"1-25 of N" cap (C1, D4):** no cap exists today. **Spec:** render the first **25** rows of the
  **post-filter** set; the count `N` = size of the set **after** month + stage-dropdown + search
  filtering (so "68" can't sit over a 40-row filtered list); `VIEW ALL JOBS →` links to `/jobs`.
- **Tabless-list survivors — state each explicitly:**
  - **auto-fit widening** (Jobs.jsx:360-370) fires on `activeTab` entry; a tabless list has no
    tab → **keep it, keyed off the `ALL STAGES ▾` selection** (widen week→month→… when the current
    filter yields an empty list).
  - **2nd search scope** (picker `pickerSearch`) collapses — the single list uses the one
    drilldown `search` matching job_num/job_name/work_type (Jobs.jsx:124-130).
  - **default time filter:** mockup shows **THIS MONTH** active; current default is `'week'`
    (Jobs.jsx:188). **Spec: default Home list to `'month'`.**

## §15 Adjacent items — filed for round 3 (NOT this build) [DERIVED]
Pre-existing, out of the Home mandate; logged so the audit doesn't re-raise as new:
- `.sch-layout` `height: calc(100vh − 52px)` (App.css:661) offset may drift after the reparent —
  re-verify for `/schedule` (tied to §12, worth a glance during build).
- `loadJobs` remains unpaginated (queries.js:~490) vs the 1000-row cap — pre-existing, repo-wide.
- `StatsBar` has no realtime on `assignments`; Home numbers stale until reload (≤5 users → Low).

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-08-25. Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
This is a UI redesign — no database changes, no money, no new data being written — so the risk
isn't data corruption, it's two things: (1) the new charcoal/teal Home screen ends up looking
like the old app instead of the mockup (the exact failure you flagged), and (2) bolting the new
left sidebar onto every screen quietly breaks the layout of screens we didn't mean to touch.
Three reviewers: one on "does it actually match the mockup," one on the app-wide sidebar +
list-rebuild not breaking existing screens/behavior, one on whether the new capacity/priority
numbers are computed correctly. Medium check, not a deep one.

### Round
- Plan type: feature
- Current round: 1
- Plan revision under audit: 5dbe556 (+ this manifest commit)
- Findings trend: n/a — round 1

### Prior rounds
none — this is round 1

**Briefing for agents**: attack the plan revision under audit. No prior rounds to exclude.

### Deployment context
- **Live tenants**: 1 (HDSP; Schedule Command in prod since 2026-05-06, single tenant — multi-tenant not onboarded)
- **Prod / staging / dev**: prod-live. The **app-shell** (`AppShell` in `App.jsx`) is live on every screen for daily office use (Joe/John/Denise), so the D6 sidebar change touches live production chrome — regression risk is real, not theoretical.
- **Blocking feature flags**: none — no flag gates the Home screen or the shell; changes ship to all users on deploy.
- **Concurrency profile**: ≤5 (office staff). Home is office-facing, low concurrency. Race-window findings cap at Low.

Agents weight severity against these values. Cross-tenant findings cap at Med while live_tenants == 1. Multi-user race findings cap at Low while ≤5 concurrent. The genuine High-risk axis here is **prod UI regression on shared chrome**, not data/security.

### Time budget + finding cap
- **Time budget**: 180 min (§5 "single focused build session"; estimate — plan terminal, not an ERD lock. Audit/build terminal may adjust.)
- **Finding cap**: 18 findings (max(3, ceil(180/10)))

Synthesis MUST surface only the top-N most consequential findings. Remainder → "Quarantined findings (not actionable this loop)." For a UI-only change the real actionable set will likely be well under the cap; don't pad to fill it.

### Surface
- Total lines: ~305
- Sections: 14 (§0, §0.1, §1, §2, §3, §4, §5, §6, §7, §8, §9 + mandate + ratified decisions + scope delta)
- [LOCKED] decisions: 11 (mandate + D1/D2/D3/D4/D6/D-teal + §6.1–4 + §8 design system)
- [DESIGN-OPEN] items: 1 (display-font confirmation, §8)
- [OPEN] items: 0
- Plan-to-code ratio: ~305 : ~500 est → ~0.6:1 (well under 50:1; plan is right-sized)

### Layers touched
- UI / components (new `Home.jsx`, app-shell sidebar, Next Up / Needs Attention / At a Glance cards, StatsBar Home variant, compact job-row variant)
- Data layer (new read-only aggregates in `queries.js` for capacity / priority / at-a-glance)
- Performance / pagination (new "View All Jobs" cap vs the 1000-row PostgREST limit; `loadJobs` fetches all)

### New mechanisms introduced
- New route: `/home` (+ repoint `/` from `/jobs`)
- New screen: `src/views/Home.jsx`
- New chrome: left charcoal sidebar in `AppShell` + a per-route "full-bleed / no-sidebar" flag (exempting `/schedule`)
- New theme layer: Home-scoped token overrides (`.home-screen` / `data-screen`) — teal→primary, lighter page/card bg
- New component variant: `StageJobCard` `variant="home-compact"` (collapsed-by-default in a compact row)
- New StatsBar variant: 3 circular summary badges + per-day `X/total` + progress bar + % + TODAY
- New data aggregates: jobs-need-crews / conflicts / not-ready (Needs Attention); jobs-scheduled / crew-assignments / completion (At a Glance); top-priority job (Next Up)
- List-model swap: single "Jobs to Prepare" list + `ALL STAGES ▾` dropdown replacing picker-tiles→drilldown on Home

### Cross-system reach
- Shared Supabase DB (project pbgvgjjuhnpsumnowuym), but **read-only** for this change — no schema change, no writes beyond existing audited paths. No cross-repo schema contract touched.
- In-repo reach: the D6 sidebar in `AppShell` touches **every route's** rendered layout (Jobs, Schedule, Billing, Materials, Calendar, Daily, Schedules, Settings) — the primary regression surface.

### Irreversibility
none — UI + read-only queries only; no migration, no backfill, no public API change. Fully reversible.

### Known weak points
- **Design-system override collision (§8, D-teal):** CLAUDE.md says teal `#30cfac` is *header-brand only* and *teal text must sit on a dark background*. D-teal promotes teal to primary on Home, including on light cards. Confirm teal is used as button-FILL (dark text) not teal-text-on-light, or the standing rule is violated / contrast fails.
- **Home-scoped theme in ONE global stylesheet:** all styling is a single 6000-line `App.css` with `:root` tokens. A `.home-screen` scope that overrides tokens must not leak to other screens, and must actually win specificity — real risk of global bleed or partial application. (The exact "reskin didn't take, looks like the old app" failure this brief is guarding against.)
- **Sidebar app-wide regression:** adding the sidebar shrinks content width on 7 other live screens; each screen's outer container may assume full width. `/schedule` full-bleed exemption must be correct or the crew grid breaks.
- **List-model swap must preserve behavior:** replacing picker→drilldown with one list + dropdown must keep every stage predicate, the STAGED/READY derivation (`ready_confirmed_at` + checklist), two search scopes, time chips + auto-fit, and all `StageJobCard` actions intact.
- **Aggregate correctness / 1000-row cap:** Next Up / At a Glance / capacity numbers must use `loadJobs()` conventions (not raw selects), respect `job_crew.call_log_id` FK, and not silently truncate at 1000 rows.
- **Page-vs-component convention:** CLAUDE.md — page files are list views only; heavy panels belong in `src/components/`. `Home.jsx` should compose components, not inline everything.
- **Font [DESIGN-OPEN]:** if a new condensed display face is added for headings, it's a global asset — confirm it doesn't shift other screens.

### Open questions
- Count: 1 (§8 display-font confirmation)
- Highest-pressure: none blocking — all structural forks (D3/D6/teal) are ratified.

### Suggested attack angles (3 total)
1. **Visual fidelity + theme-scoping / framework fit** — covers UI + design system. Required reading: `docs/plans/assets/home-redesign-mockup.png`, `src/index.css`, `src/App.css` (token + `.home-*` scope), CLAUDE.md design-system rules. Specific pressure: does the Home-scoped token layer actually override cleanly in one global stylesheet without leaking or being overridden (the "still looks like the old app" failure mode)? Is teal used legally per the header-brand/dark-bg rule? Does it hit the mockup's charcoal/sand/teal/signal palette literally?
2. **App-shell + interaction-model regression** — covers UI chrome + behavior preservation. Required reading: `src/App.jsx` (AppShell, NAV_ITEMS, routes), `src/views/Jobs.jsx`, `src/components/StageJobCard.jsx`, `src/components/JobsPicker.jsx`. Specific pressure: does the app-wide sidebar break any of the 7 other live screens' layouts? Is the `/schedule` full-bleed exemption correct? Does the single-list + dropdown rebuild preserve every stage predicate, STAGED/READY derivation, search scopes, filters, and all job-card actions/panels?
3. **Data-layer aggregate correctness** — covers data layer + performance. Required reading: `src/components/StatsBar.jsx`, `src/lib/queries.js` (`loadJobs`, `isReady`), `src/lib/jobStatus.js`. Specific pressure: are the capacity (23/18/5, per-day X/total), Needs-Attention, At-a-Glance, and Next-Up numbers correctly derivable from existing data? Any N+1, raw-select bypass of `loadJobs`, `job_crew` FK mismatch, or 1000-row truncation in the new aggregates or the "View All Jobs" cap?

### Suggested agent count: 3

Rationale: 3 layers (UI, data, perf) with ≥3 novel mechanisms lands on the documented 3-agent sweet spot; cross-system reach is read-only/in-repo so it doesn't warrant a 4th, and the app-shell regression risk is folded into angle 2 rather than split out.
