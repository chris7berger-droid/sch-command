# SCH_HANDOFF_v31 — DMS-1 Phase 3 SHIPPED + LIVE (Schedule SOW read + warehouse Logistics)

**Repo:** sch-command · **Branch:** `main` · **Date:** 2026-07-31
**Production:** https://schedulecommand.com — LIVE.
**Cross-repo:** sales-command (Step 0 + UX) + command-suite-db (one additive migration, applied).
Spine: `command-suite-db/docs/MASTER_SCHEDULE.md`. Plan: `docs/plans/daily_material_schedule_phase3_build.md`.

> **Numbering:** v29 was this build's mid-session pause handoff; v30 is the parallel deposit
> session's (multi-deposit fix). This picks up v31.

---

## 1. Session summary

Built and shipped **DMS-1 Phase 3** end to end (plan → build → 3-terminal review gate → deploy →
live smoke). Phase 3 is the Schedule-side read of the SOW plus the warehouse **Logistics** workspace:
a read-only SOW tab, a needed-vs-ordered material tracker with a covered/short/can't-tell flag,
truck/equipment/power assignment, a Settings page to manage those asset lists, and spec confirm/lock
with a typed-reason override. Spanned three repos (sch-command bulk, one Sales reach-back for per-task
size/unit, one additive command-suite-db migration). The build went through buildvsplan (T4),
code-review (T5), and security-review (T6) — all green — then deployed in the locked order
Sales → migration → Schedule. Two preview-only bugs were caught and fixed before prod. Chris
live-smoked the final site. All three feature branches deleted; repos clean on main. Two mid-build
scope questions (warehouse-add attach point, finalize scope) were ratified by Chris; one grain premise
in the plan was found false and corrected. Phases 4 (the printable crew ticket) and 5 (retire the old
`materials` table) remain — the rest of the big DMS build.

## 2. Changes shipped

**sch-command (main, this session — grouped by phase of work):**
- `e8f9cfa` premise-check folded into plan §0/§1 + filed DMS-4. Verified live before building:
  `job_material_lines` empty; `materials` never in `supabase_realtime` (board-freeze pre-existing).
- `ff13067`/`cd22681` Steps 1–2 — Schedule task size/unit passthrough + read-only SOW tab (extracted
  shared `FieldSowView`).
- `859175d` §2 — `src/lib/sowMaterials.js` pure rollup (coverage parse + needed math + stable grouping)
  + `sowMaterials.verify.mjs` (26/26; proves same-material-across-days counts once).
- `4872dbb` folded ratifications (REG-4 one-row-per-need grain; DMS-5 gate defer).
- `eee7cad`/`5d28166`/`4a68514`/`cdb3fc2` Step 3 — job_material_lines writer/reader/warehouse-edit +
  fail-closed gate; shared `LogisticsMaterials`; repointed EVERY `materials` reader + realtime channel
  (re-grep clean); nav Materials→Logistics.
- `9736fda` Step 4 warehouse add (unassigned `wh_` row). `af6bfab` Step 5 job_assets assignment.
  `412edf7` Step 6 Settings asset-list editor (+/settings route). `0038c27` Step 7 confirm/lock +
  overrideSpec. `c4eae87` Step 8 proposed-vs-actual labels.
- `73c583b` filed SEC-5. `9b2fe99` T4 fix (drop 'unit' from hasAnySpec). `ddecf9a` T5 fixes (4 Low).
- `b22805a` merged origin/main (deposit session) — code auto-merged clean, only the v30 handoff collided.
- `e0ba02e` **fix: undecidedMats ReferenceError** (blank planning screen — my T5 fix left a dangling ref).
- `44eb3bc` **fix: Logistics modal vanishing on write** (made the board's realtime/onJobUpdate refresh
  background so it stops unmounting open modals).
- `f172572` filed DMS-6 (warehouse-add price/note/job-costing).

**sales-command (main):** `b74963c` Step 0 per-task size+unit; `6249888` SQFT/LF as a visible two-button
toggle (the dropdown read as a static label); `fcbc45a` removed the redundant day-level Sq Ft/Linear Ft
(size is per-task now — traced end-to-end first, nothing computed on the day fields).

**command-suite-db (main):** migration `20260731130000_dms1_phase3_material_tracker_and_job_assets.sql`
(+ rollback) — additive: 4 cols on job_material_lines, new `job_assets` (verbatim RLS chain +
cross-tenant asset_id trigger), realtime publication add. Timestamp was deconflicted from `…120000`
(the deposit migration) to `…130000`.

## 3. Deployed

- **Project ref:** pbgvgjjuhnpsumnowuym. Deploy order (locked, no same-deploy): Sales → migration → Schedule.
- **sales-command** → scmybiz.com (Vercel, main). Task size/unit + toggle + day-field removal live.
- **command-suite-db migration `20260731130000`** → applied to prod. **Applied via the Supabase management
  API (execute path), NOT `npm run db:push`** — the CLI `db push` needed the DB password and the
  interactive prompt kept failing; once Chris reset the password it went via CLI. Ledger recorded the
  **exact** version `20260731130000` (verified). Rehearsed clean twice (idempotent, no anon exposure).
- **sch-command** → schedulecommand.com (Vercel, main @ `44eb3bc` + DMS-6). No edge fns, no config.

## 4. Decisions

- **REG-4 — one row per real need, not "3 days = 3 rows."** The plan's grain rested on a false premise:
  `wtc_material_id` collides across days on the proposal path (the DB author's own header confirmed it),
  so per-day rows are physically impossible there. Ratified: key on the stable logical need. Why it
  matters: it's what makes the warehouse edit one Ordered box per material and avoids the N× overcount.
- **DMS-5 — deferred the server-side ready-gate move.** The DB `job_base_checklist_passes` + 3 triggers
  still read the dead `materials` table (stale-lenient). Deferred to Phase 5 (a function rewrite is a
  different risk class than an additive migration). Verified safe: nothing trusts the stored
  `ready_confirmed_at` without a live recompute (all 3 repos + all DB views/policies/cols checked).
- **R5 — warehouse-add is unassigned.** A hand-added material is a standalone tracker row (`wh_` key),
  not written to the frozen SOW; warehouse types Ordered directly. R7 — finalize is labels-only (the
  board already IS the finalized schedule).
- **Migration applied via API.** Chose the authenticated management-API path over fighting the CLI
  password prompt, but controlled the ledger version to keep it aligned with the repo + the deposit
  session's ledger.

## 5. Verification

- **Build:** every step `npx vite build` green. **Rollup:** `node src/lib/sowMaterials.verify.mjs` 26/26.
- **Review gate:** T4 buildvsplan (0 blockers), T5 code-review (0 blockers, 4 Low fixed in-flow),
  T6 security-review (0 exploitable-today) — all against the migration file as source of truth.
- **Migration:** verified against prod after apply — 4 cols, job_assets table + 4 RLS policies +
  2 triggers, realtime membership, ledger version all present.
- **Live smoke (Chris, on prod):** SOW tab, Logistics open, status change persists, add-material,
  Settings nav — all confirmed working. The two preview bugs were caught on the branch's Vercel preview
  **before** prod (not on the live site).
- **NOT verified:** the full §5 smoke script's multi-WTC + deliberate-SHORT/CAN'T-TELL matrix and the
  print-gate predicate under real print (Phase 4). Old jobs (no per-task size) correctly read "can't-tell".

## 6. Not touched this session

- **Phase 4** (the printable Material Order Summary + per-day crew ticket + Print PDF) — the real payoff,
  not started; needs its own plan.
- **Phase 5** (retire legacy `materials` table + backfill + verify vs job 6618) — includes executing DMS-5.
- SEC-5 (/settings not role-gated), DMS-4 (dead assignments realtime channel) — filed, deferred.

## 7. Next session pointers

1. **Phase 4 is plan-first** — stand up a planning terminal + `/erd-start` before building. It's the crew
   ticket/print output and the master schedule has a bigger warehouse vision behind it (receiving, pull
   tickets, sign-off/release). Roughly a full build cycle like Phase 3.
2. Before any DB work: migrations only via command-suite-db; rehearse (`./scripts/rehearse.sh`) before push.
3. DMS-6 (warehouse-add price + note + job-costing) is a plan-mode item — decide the job-costing wiring
   + whether warehouse-adds attach to a SOW day/task.
4. The command-suite-db DB password was rotated at close (it had appeared in a session transcript).

## 8. Files to probably know about next session

- `src/lib/sowMaterials.js` — the pure rollup (coverage parse + grouping + reasons); `verify.mjs` beside it.
- `src/lib/queries.js` — `syncJobMaterialLines`/`updateJobMaterialLineField`/`addWarehouseMaterialLine`,
  job_assets + tenant-asset CRUD, `materialsDecided` (single-source gate helper), fail-closed `baseChecklistPasses`.
- `src/components/LogisticsMaterials.jsx` / `LogisticsAssets.jsx` — the warehouse views.
- `src/components/FieldSowBuilder.jsx` — Step 7 confirm/lock/overrideSpec + SPEC_KEYS + materialBlocksPrint.
- `src/views/Jobs.jsx` — `loadData({ background })`: refreshes are background so open modals survive.
- `command-suite-db/supabase/migrations/20260731130000_*.sql` — the Phase-3 migration (live).

## 9. Git state on close

- Branch `main`, all three DMS-1 Phase 3 feature branches deleted (local + remote). Repos clean on main.
- sales-command `main` + command-suite-db `main` also carry this session's work, on main, pushed.
- Resume pointer (`~/.claude-commands/active-work.txt`) updated to "DMS-1 Phase 3 SHIPPED + LIVE".
- No open PRs from this work. Parallel deposit session's branches are theirs — not touched.

## 10. End state

Merged, deployed, live-smoked — DMS-1 Phase 3 done. Phases 4 (crew ticket) and 5 (retire `materials`) remain, plan-first.

## 11. Phase 3 ideation — locked design decisions (moved here 2026-08-02)

These were captured during the 2026-07-30 Phase 3 ideation session. Decisions 1–5 + the
flag scheme shipped as Phase 3; decisions 6–7 are the "Needed" math foundation that feeds
Phase 4. Preserved here (lifted out of the ERD loop journal, which is not their home).

1. **SOW = one live record, four ownership STAGES** (Sales → Scheduling → Logistics → Field), NOT four IDs/snapshots — no unique identifier, settled. Sales authors the first draft of everything (incl. proposed dates/allocations/mobilization); each downstream stage finalizes its slice (scheduler → dates/crew; warehouse → materials/status). Two Schedule roles kept distinct on purpose — Crew Allocator (time/labor) vs Warehouse Manager (materials/fulfillment) — one person in small shops but the structure must not conflate them. Logistics = trucks + equipment + materials. Reuse EXISTING statuses (Not Ordered/Ordered/In Stock/Delayed) — do NOT expand. No inventory-counting system built; Phase 2 laid the piping (each SOW material carries catalog_id + coverage_rate + day sqft/lf → enough to compute needed-qty). Materials modal stays a job-specific area but becomes a WINDOW onto the SOW material list (no drifting copy). Modal gets ONE new read-only column: Needed (= sqft ÷ coverage, computed/locked); existing Qty → renamed Ordered (editable); the gap is the signal.

2. **Confirm/lock logic (simplifies DMS-2).** Sales confirms → spec LOCKS for that job; nobody downstream edits a confirmed coverage rate. Warehouse adding MORE of an already-confirmed material inherits the lock (no reconfirm). A BRAND-NEW or SWAPPED material comes in unconfirmed → must be confirmed in Schedule → can't print to crew until confirmed. Nothing unconfirmed ever leaves Sales (Send gate blocks it). Consequence: dissolves most of DMS-2 — reset-on-edit only matters for unconfirmed/warehouse-added items. Escape hatch: warehouse CAN override a locked Sales-confirmed spec but must type a REQUIRED reason; logs who/when/old→new/why; re-confirms as warehouse-confirmed (still prints); reason shows downstream so it's never silent.

3. **Trucks + equipment + power (rest of Logistics).** Today they're 3 free-text boxes (jobs.vehicle / equipment / power_source). Each becomes a DROPDOWN sourced from customer-built lists in Settings. On a job the warehouse picks from the list and marks each Available / Unavailable, PER-JOB (Unavailable = not free for THIS job), PICK-MANY. Same "readiness at a glance" idea as materials, no order/inventory baggage.

4. **Two-role layout resolved — driver is VISIBILITY, not one-person-does-both.** One job home shows everything — crew, dates, materials, trucks, equipment, power — on one screen; nobody hunts across pages. Editing stays in its lane (warehouse edits materials/trucks, scheduler edits crew/dates; locked fields keep hands off each other's work). The Materials area stays the warehouse's dedicated workspace but its data also surfaces on the job home. Fits the "Job Detail is home" rule. Unified read, scoped edit.

5. **Job-home layout (preserves existing JobDetail tabs).** NEW "SOW" tab under JOB PLANNING = read-only view of what Sales authored (scope, per-day scope notes, specs mils/coverage/cure) — both roles read, nobody edits SOW here. RENAME "Materials" tab → "Logistics" (widened for materials + trucks + equipment + power). Overview stays the scheduler's room. Logistics content = MATERIALS table (Material/Kit/Needed/Ordered/Status/Flag + Add) AND TRUCKS/EQUIPMENT/POWER (dropdowns from Settings, Available/Unavailable, per-job, pick-many, + Add).

   **Flag scheme (3-state):** green ✓ covered (Ordered ≥ Needed); red ⚠ SHORT N (Ordered < Needed); amber ? CAN'T TELL when Needed can't compute (missing coverage/sqft) — flag loudly, never hide as a dash. Missing data is critical per job.

6. **[Feeds Phase 4] The "Needed" math + per-task size (crux, confirmed against the original Excel model).** Verified in WTCCalculator.jsx: task = {id, description, pct_complete}; DAY carries sq_ft/linear_ft; materials tag to a task via task_ref. So percentage-of-completion-per-task already exists. MISSING PIECE: a task carries NO size — size sits on the DAY — so "task is 40% done" has no "40% of what." FIX (matches Chris's original Excel): each task gains a SIZE (number) + a UNIT toggle (Square Feet / Linear Feet) next to the existing %. Then Needed = task size × today's % ÷ coverage, summed across days; the unit tells the math which measurement to divide by. Cross-check: Sales already types a bid qty per material → task-%-derived total validates against it. NOTE: this is a SALES-SIDE authoring add — reaches back into the shipped Phase 2 Sales SOW screen, not just Schedule.

7. **[Feeds Phase 4] How to land the Sales-side task-size add.** One initiative, two slices: tiny sales-command change (size+unit per task) + the sch-command Schedule work (Needed math + Logistics). Same plan doc (the DMS spine), not a side quest. SEQUENCE: Sales FIRST — Schedule's Needed can't compute until tasks carry a size (same receiving-side-ready-first lesson as Phase 2's deploy order). LOW RISK: task size+unit lives inside field_sow jsonb (additive, NO migration, app-code only). Old SOWs already sent lack task sizes → show ? CAN'T TELL until re-entered (grandfathered by the flag).
