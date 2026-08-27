# Plan — Unified Home/Jobs: One Screen, Menu as Anchors

Confidence tags: **[LOCKED]** = user-ratified · **[DERIVED]** = inferred from code, verify · **[DESIGN-OPEN]** = needs a call · **[BLOCKED]** = depends on unresolved item.

**Type:** feature

**Status:** PARKED (scaffolded 2026-08-27) — planned, not yet built.

**Repo:** sch-command · **Branch:** feat/home-jobs-unified

---

## §0 Baseline (observed current state) [read-verified 2026-08-27]

Two separate screens exist today, each with its own route, data load, and realtime subscriptions:

**`src/views/Home.jsx`** — the curated manager dashboard. Sections, top to bottom:
- `HomeCapacityStrip` — this week's crew capacity
- `HomePanels`: `NeedsAttention`, `NextUp`, `AtAGlance`
- `JobsToPrepare` — only the subset of jobs needing prep
- **No search box. No way to reach on-hold or finished jobs. No full job list.**

**`src/views/Jobs.jsx`** (632 lines) — the stage-management + lookup screen. Contains:
- A landing "picker" (`JobsPicker`) = a stage scoreboard: staged / scheduled / active / on-hold / complete / all
- **Cross-stage search** from the landing (`AllJobsList` filtered by number/name/work type) — find any job in any stage
- Drill-down into each stage with status filtering (`StagedCardList`, `OnHoldCardList`, `AllJobsList`)
- Date-filter pills (week / month / quarter / all / custom) + auto-fit widening
- **Recovery Bin** — restore a job deleted within the last 24h (lives ONLY here)
- Redirect table for legacy tab slugs (`pipeline`, `ready`, `billing`, etc.)

**Capabilities that exist ONLY on Jobs today** (would be lost if Jobs were simply deleted):
1. Search / find any job across all stages
2. Reach On-Hold jobs
3. Reach Complete (finished) jobs
4. Browse the full job list
5. Recovery Bin (24h restore)
6. Stage management (moving jobs staged → scheduled → active → on-hold → complete)

Both screens load the same underlying data (`loadJobs`, assignments, materials, daily logs, proposal_wtc, mobilizations) via near-identical `loadData` bodies — so merging them removes a duplicate data-load, it doesn't add one.

**Adoption note:** Schedule Command has **no live users yet**. There is zero migration/retraining risk. This is a design-for-buyers decision, not a change to an in-use workflow.

## §1 Problem / intent [LOCKED]

Two problems, one root cause (two overlapping screens):

1. **Buyer wayfinding.** In demos, prospects scan the left menu for the word "Jobs." The current split makes "where are the jobs?" a confusing question. The menu word matters more than the screen behind it.
2. **Wrong tool for two different users.** The stage pipeline is a *manager* action. Estimators just need a *fast list* to answer quick questions. Today's Jobs screen jams both together, which makes the list feel clunky ("the job screen sucks") and buries management in a lookup tool.

**Intent:** collapse Home and Jobs into **one screen** with three stacked sections. The left-menu items become **scroll anchors into the same page**, not separate routes. Each section serves a clear purpose and audience.

## §2 Proposed change [LOCKED]

**One screen, top to bottom:**

| Section | Purpose | Audience | Menu anchor |
|---|---|---|---|
| **Home dashboard** | "What needs me today" — capacity, needs-attention, next-up | Everyone | **Home** → scrolls here (top) |
| **Jobs list** | "Find any job" — search + read-only list, fast lookup | Estimators (+ all) | **Jobs** → scrolls here |
| **Management** | Stage pipeline — move jobs through staged→scheduled→active→on-hold→complete + Recovery Bin | Managers/Admin only | (in-page, gated) |

**Key behaviors (all [LOCKED] unless tagged):**
- **Menu items are anchors, not routes.** Clicking "Home" jumps to the top; clicking "Jobs" scrolls/zooms to the Jobs section. Same page. Scrolling up from Jobs reveals Home — intended, not a bug.
- **Jobs section = read-only list.** Search by number / name / work type. Shows each job's status, but estimators **cannot change stages** from here. Fast, list-first.
- **Management section is permission-gated** to manager/admin. Estimators don't render it at all — their page is shorter and faster. **[LOCKED]** (was the open question; ratified 2026-08-27).
- **Stage machinery moves OUT of the Jobs list and INTO the Management section.** The old `Jobs.jsx` scoreboard/tabs/date-pills are retired; their *useful* parts (cross-stage search, full list, the stage pipeline, the Recovery Bin) are redistributed to the Jobs and Management sections.

**Layout decision to resolve during build ([DESIGN-OPEN]):**
- The management pipeline spans five stages and potentially many jobs. It **cannot** be five long lists stacked, or the page never ends. Plan: management section holds the stages **collapsed by default, expand-on-tap** (accordion per stage), so it never blows out the page height. Sketch this before wiring.

## §3 Files to touch [DERIVED — confirm at build]

- `src/views/Home.jsx` — becomes the single unified screen; add Jobs section + gated Management section. Add anchor targets (e.g. `id="jobs"`, `id="management"` or `scrollIntoView` handlers).
- `src/views/Jobs.jsx` — retired as a route. Salvage: cross-stage search + `AllJobsList` (→ Jobs section), stage drill-downs + `OnHoldCardList`/`StagedCardList` (→ Management section), Recovery Bin (→ Management section).
- `src/App.jsx` — left-menu nav: change "Home" and "Jobs" from separate routes to same-route anchors; wire scroll-on-click. Confirm route table + any `navigate('/jobs...')` callers.
- Legacy redirects: the `TAB_REDIRECTS` map (`pipeline`, `ready`, `billing`, `ready-to-bill`, `schedule`) — decide where old bookmarks land on the unified screen.
- Permission source — locate the role/access check used elsewhere (team_members access array / role) to gate the Management section. **[DERIVED — find the canonical role gate before building.]**
- `src/components/` — `JobsPicker`, `StagedCardList`, `OnHoldCardList`, `AllJobsList`, `JobsToPrepare`, `HomePanels`, `HomeCapacityStrip` all get re-homed under the new sections.

## §4 Out of scope / deferred

- No change to JobDetail (`/jobs/:jobId`) — job cards still deep-link into it.
- No change to Schedule, Billing, Materials, Calendar, Daily, Schedules screens.
- No data-model / migration changes. (This is UI re-composition over existing reads — no DB writes change. Safe to park; no migration collision risk.)
- No redesign of the individual cards/panels — reuse as-is; this plan re-homes them, it doesn't restyle them.

## §5 Estimate / time budget [DERIVED]

Medium build. Three moves: (1) add read-only Jobs list section to Home, (2) move stage pipeline + Recovery Bin into a gated Management section, (3) rewire left-menu Home/Jobs as in-page anchors and retire the `/jobs` list route. Most of the code already exists — this is re-composition + a permission gate + anchor nav, not net-new features. Biggest unknowns: the role-gate wiring and the collapsed-by-stage management layout.

---

## Open questions to close before build
1. [DESIGN-OPEN] Management section layout — accordion collapsed-by-stage confirmed as the approach? Sketch first.
2. [DERIVED] What is the canonical manager/admin role check in this app? (team_members access array vs a role field.)
3. [DERIVED] Where do legacy `/jobs?tab=...` bookmarks and `TAB_REDIRECTS` land on the unified screen?
