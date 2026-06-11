# Field SOW Vertical — Cross-App Implementation Plan

_Draft v0.1, 2026-06-11. Owner: Plan subagent (read-only at draft time). Scope: the end-to-end "Field SOW" vertical across the three Command Suite apps that touch a scope of work — Sales authors it, Schedule dates it, Field consumes it read-only. This is an **implementation** plan; the design is already locked (see §2). Companion / prior art: `docs/plans/jobs_ia_refactor_implementation.md` (the Jobs IA refactor that already landed the **read side** of `job_wtcs` in this repo), `docs/plans/command_suite_shared_data_contract.md` (the source-of-truth / canonical-location contract this plan instantiates)._

**Confidence tags used throughout:**
- **[LOCKED]** — design-decided upstream; do not relitigate.
- **[DERIVED]** — inferred from reading current code; cited file:line.
- **[DESIGN-OPEN]** — a real decision remains; flagged explicitly, needs Chris.
- **[BLOCKED]** — needs external input (a deploy, a sibling-repo coordination, a ledger repair) before it can proceed.

---

## §1 Overview

A "Field SOW" is the per-day plan of work for a job: which days, what work types, what materials, how many crew, how many hours. It is authored once in Sales Command inside the WTC (Work Type Calculator), travels downstream at "Send to Schedule," gets calendar dates attached in Schedule Command, and is consumed read-only by the crew in Field Command.

Today that pipeline is **half-wired**. The Jobs IA refactor (already merged to `main`) built the *read side* of a canonical per-WTC representation (`job_wtcs`) in this repo — `loadJobs({ withWTCs })`, `loadJobWithWTCs()`, `jobCardLabel.js`, `ScheduledCardList.jsx`, and `getJobMultiWeekAlert()` all consume `job._wtcs` **[DERIVED: queries.js:79,103,110-146,355; ScheduledCardList.jsx:48-50; jobCardLabel.js header]**. But **nobody writes `job_wtcs`** — Sales' "Send to Schedule" still writes only the merged `jobs.field_sow` blob, so `_wtcs` is always `[]` in production and the read side is dormant **[DERIVED: `grep job_wtcs` in sales-command/src → 0 hits; ProposalDetail.jsx:533 flatMaps into a single jobs.field_sow]**.

This plan finishes the vertical:

1. **Sales** starts writing `job_wtcs` (the canonical downstream SOW), adds a **per-day calendar date** to each `field_sow` day, and adds a **"dates TBD" toggle** for when the schedule isn't known at sale.
2. **Schedule** takes ownership of the calendar layer (which date each day lands on) on the `job_wtcs` row, mutable and cost-free, never touching the frozen bid.
3. **Field** syncs the canonical `job_wtcs` SOW, fixes the stage-sync hard-break that can prevent a job from ever reaching the crew, and renders the read-only SOW **grouped by calendar date** (work types collapsed).
4. **Overage stamp + capture**: a reusable marker on the job plus a captured artifact row when a downstream add pushes cost beyond the bid. Tag + capture only — the change-order workflow itself is out of scope.

The vertical respects one hard invariant: **the proposal (`proposal_wtc`) is frozen at sale and is never written downstream.** Scope and cost are immutable. Calendar dates are a separate, Schedule-owned layer.

---

## §2 The locked design [LOCKED]

These are design decisions made upstream. They are **not** open in this plan. Each maps to one or more implementation sections below.

| # | Decision | Implements in |
|---|---|---|
| L1 | **One author.** Sales builds the `field_sow` scope (days, work types, materials, hours) in the WTC and optionally seeds per-day **calendar dates**, with a **"dates TBD" toggle** when unknown. | §4 (Sales), §6 (data model) |
| L2 | **Frozen at sale.** Scope and cost are immutable downstream forever. Schedule and Field NEVER write `proposal_wtc`. | §5, §7 (invariant gate), §10 (risks) |
| L3 | **Two layers, two owners.** *Scope* = Sales-owned, frozen. *Calendar* (which date each day lands on) = Schedule-owned once the job is sent; mutable, cost-free. Moving a date is a normal Schedule write that never touches the bid. | §5 (Schedule), §6 (canonical location) |
| L4 | **Field read view.** Read-only, **day-centric grouped by calendar date**, work types collapsed (a crew may do multiple work types in one day). No notes/annotations on the SOW — crew commentary goes to a PRT or daily log. | §7 (Field) |
| L5 | **Scope additions beyond bid** NEVER edit the proposal. They **stamp the job** with a reusable overage marker (a standard, reusable identifier, expected frequent) and **capture the artifact** (record that money was added beyond bid). The stamp is the future hook for a change-order workflow. **The change-order workflow itself is OUT OF SCOPE — only the tag + capture.** | §8 (overage) |
| L6 | **No cross-app shared SOW editor.** Nothing edits the proposal post-sale, so there is NO "edit routes home from Schedule." | Whole plan; explicitly NOT built |

**Consequence for sequencing:** because nothing writes back to `proposal_wtc`, the only shared-write surface is `job_wtcs` (canonical) and `jobs` (mirror). The directionality is strictly forward: Sales writes the seed, Schedule owns the calendar layer thereafter, Field reads. This matches the Command Suite data contract's "one writer per crossing field" rule (`docs/plans/command_suite_shared_data_contract.md`).

---

## §3 Current-state ground truth (verified by reading code)

Everything in this section is **[DERIVED]** with citations. The plan steps below are written against this reality, not against the (possibly drifted) line numbers in the task brief.

### 3.1 Sales — how a Field SOW is authored
- The `field_sow` day shape is created in `WTCCalculator.jsx` `SowTab.addDay()`: `{ id: Date.now(), day_label: "Day N", tasks: [...], crew_count: 0, hours_planned: 0, materials: [] }` **[sales-command/src/pages/WTCCalculator.jsx:862]**. **There is no per-day date field.**
- Task IDs: `{ id: Date.now() + Math.random(), ... }` **[WTCCalculator.jsx:861]**; day IDs: `Date.now()` **[:862]**. Both are client-side, non-durable — collide across cloned/sister proposals (the L-risk in §10).
- WTC-level dates exist: a **required** "Tentative Start Date" + "Tentative End Date" pair of `<input type="date">` **[WTCCalculator.jsx:373-388]**, stored on `proposal_wtc.start_date` / `proposal_wtc.end_date` **[:1941-1942; CLAUDE.md proposal_wtc column ref]**. They are required-with-a-tentative-fallback, **not** toggleable. **No "dates TBD" toggle exists today** **[grep `dates_tbd|TBD` in sales-command/src → 0 hits]**.

### 3.2 Sales — Send to Schedule
- `handleSendToSchedule()` **[ProposalDetail.jsx:513-621]**:
  - Dedupe guard: `jobs.source_proposal_id == p.id` maybeSingle **[:517]**.
  - Merges all WTCs into **one** `jobs` row: `field_sow = wtcList.flatMap(w => w.field_sow || [])` **[:533]**, `work_type = names.join(",")` **[:530]**, dates from the first WTC that has them **[:542-544]**.
  - `status: "Parked"` **[:566]**.
  - Inserts `materials` rows (`status: "Not Ordered"`) **[:601]**.
  - Sets `call_log.stage = "Parked"` **[:613]**.
  - **Does NOT insert any `job_wtcs` rows.** **[grep job_wtcs in ProposalDetail → 0 hits]**

### 3.3 Schedule — the `job_wtcs` read side already exists (dormant)
- `loadJobs({ withWTCs })` left-joins `job_wtcs(*)` and attaches `j._wtcs` **[queries.js:110-146]**; legacy rows get `_wtcs = []` **[:79]**.
- `loadJobWithWTCs(jobId)` selects `*, call_log(...), job_wtcs(*)` **[queries.js:142-146]**.
- `ScheduledCardList.jsx` prefers `wtcs[0].field_sow`, falls back to `job.field_sow` **[:48-50]**.
- `jobCardLabel.js` builds title/chips from `_wtcs`, falling back to comma-split `job.work_type` for legacy rows.
- `getJobMultiWeekAlert(job, assignments, today)` exists **[queries.js:355]**.
- The `job_wtcs` table migration is present and live: `supabase/migrations/20260512120100_job_wtcs_create.sql` — columns `id, job_id (FK jobs ON DELETE CASCADE), proposal_wtc_id (FK proposal_wtc ON DELETE RESTRICT, UNIQUE), work_type_id, work_type_name, position, field_sow jsonb, material_status, start_date date, end_date date, created_at` + 4 authenticated RLS policies scoped via `jobs.call_log_id → call_log.tenant_id`. **[file read in full]**
- **Net:** the schema + read path are in place. The vertical needs (a) a **writer** (Sales), (b) **per-day dates** inside `field_sow` (the table only has WTC-level `start_date`/`end_date`), and (c) a **Schedule-owned mutate path** for the calendar layer.

### 3.4 Schedule — JobDetail already has Planning/Management + Field SOW
- `JobDetail.jsx` reads `?mode=planning|management` **[:52-53]**, `PLANNING_TABS = [Field SOW, Materials]` **[:147-150]**, `MANAGEMENT_TABS = [Overview, Production, Daily Log, Billing, History]` **[:152-158]**.
- The Field SOW tab renders `<FieldSowBuilder value={job.field_sow} onSave={... updateJobField(job.job_id,'field_sow',...)}>` **[:439-450]** — i.e. **today it edits the `jobs.field_sow` blob, NOT `job_wtcs`.** This is the seam where the calendar layer must move to `job_wtcs`.
- `FieldSowBuilder.jsx` day shape mirrors Sales: `day_label, tasks, crew_count, hours_planned, materials` — **no date field** **[FieldSowBuilder.jsx:18-22]**.
- "Schedule this job →" deep-link already present in the header **[JobDetail.jsx:171-178]**.
- Status→stage sync: `JobCardList.updateStatus()` writes `jobs.status` then maps `{Scheduled, In Progress, Complete}` → `call_log.stage` **[JobCardList.jsx:100-111]**. **The map omits 'On Hold' and any other status; a transition outside the map updates `jobs.status` but leaves `call_log.stage` stale.** This is the hard-break vector (see §3.6).

### 3.5 Field — what syncs and how the SOW is read
- PowerSync sync rules **[field-command/powersync-sync-rules.yaml]** sync `call_log` filtered by `stage IN ('Scheduled','In Progress','Parked','mobilized','in_progress')`, plus `proposal_wtc`, `team_members`, `job_crew`, `jobs` (`SELECT job_id AS id, * FROM jobs`), `time_punches`, `daily_production_reports`, `daily_log_entries`. **`job_wtcs` is NOT synced.**
- `TasksTab.js` reads `SELECT field_sow, size, size_unit FROM jobs WHERE call_log_id = ? LIMIT 1` **[:17-20]**, falling back to `SELECT field_sow, size, unit FROM proposal_wtc WHERE field_sow IS NOT NULL LIMIT 10` then taking `wtcRows[0]` **[:23-29]**. The fallback is **unjoined** — `LIMIT 10` over all proposals then `[0]` picks an arbitrary WTC, not this job's. **[confirmed :23-34]**
- TasksTab renders **day-centric** but keyed on `day.day_label` (`Day N`), not a calendar date **[:62-64, 72]**.
- Field schema **[schema.js]** has `call_log`, `proposal_wtc`, `team_members`, `job_crew`, `jobs` mapping; **no `job_wtcs` table defined** — adding the sync requires a schema entry too.
- JobDetailScreen tab labels: `['TIME CLOCK','FIELD SOW','REPORT']`, FIELD SOW → `<TasksTab>` **[JobDetailScreen.js:13,25]**.

### 3.6 The stage-sync hard-break, precisely [DERIVED]
The brief says Field filters `call_log` by Sales-vocab `stage` while Schedule moves jobs via `jobs.status`. Reading both sides, the **real** state is subtler than "the job never syncs":
- Send-to-Schedule sets `call_log.stage = 'Parked'` **[ProposalDetail.jsx:613]**, and `'Parked'` **is** in the Field sync filter — so a freshly-sent job **does** sync to Field immediately.
- The break is on **transitions**: `JobCardList.updateStatus()` only stage-syncs `{Scheduled, In Progress, Complete}` **[JobCardList.jsx:105]**. There are status writes elsewhere that don't sync stage at all (e.g. `updateJobField(jobId,'status',...)` paths that aren't routed through `updateStatus`, and the 'On Hold' transition which has no map entry). When `jobs.status` changes without a matching `call_log.stage` write, Field's view of the job **goes stale or drops** (e.g. a job set to a stage outside the sync filter disappears from crew; a job whose stage never advances past 'Parked' shows the wrong lifecycle).
- **[DESIGN-OPEN — pick one, see §5.3]** Two candidate fixes: (A) make **every** `jobs.status` write also call `updateCallLogStage` via a single choke-point in `queries.js`; or (B) have Field **discover jobs via `jobs.status`** instead of `call_log.stage` (sync `jobs`, filter on `jobs.status`, drop the `call_log.stage` dependency). (A) is smaller and keeps `call_log` as master; (B) is more robust but touches the sync contract and the Field read model. **Recommend (A)** for this vertical (smaller blast radius, preserves call_log-as-master), and file (B) as a follow-up hardening. This is a **prerequisite** — it ships first (§9).

---

## §4 Sales Command — work breakdown

**Goal:** Sales becomes the single author of the canonical `job_wtcs` SOW, with per-day calendar dates + a "dates TBD" toggle.

### S1 — Add a per-day calendar date to the `field_sow` day shape [LOCKED L1]
- **File:** `sales-command/src/pages/WTCCalculator.jsx`, `SowTab` (`addDay` at :862; `updateDay` at :864; the day render block below it).
- Extend the day object with `date: null` (ISO `YYYY-MM-DD`) and `dates_tbd`-awareness (the toggle is WTC-level, §S2). New shape: `{ id, day_label, date: null, tasks, crew_count, hours_planned, materials }`.
- `updateDay` currently coerces every non-`day_label` key with `parseFloat` **[:864]** — add `date` to the string-passthrough branch alongside `day_label` so the ISO string isn't NaN'd.
- Per-day date is **optional at authoring** (Sales may seed it or leave it for Schedule). When `dates_tbd` is on (§S2), the per-day date inputs are disabled/hidden.

### S2 — Add the WTC-level "dates TBD" toggle [LOCKED L1]
- **File:** `WTCCalculator.jsx` near the Tentative Start/End block **[:373-388]**.
- Add a checkbox `Dates TBD` bound to a new field. **[DESIGN-OPEN]** Storage location for the toggle: (a) a new `proposal_wtc.dates_tbd boolean` column, or (b) infer from `start_date IS NULL`. Recommend **(a) an explicit column** — inference is ambiguous (legacy rows have null dates that aren't "TBD"), and the toggle's whole point is to make "we don't know yet" a first-class, non-error state (today the date inputs are required-with-red-error **[:379,388]**; TBD must suppress that error). Add the migration in §6.
- When `dates_tbd` is true: the Tentative Start/End inputs and all per-day `date` inputs are disabled, the required-red treatment is suppressed, and Send-to-Schedule seeds `job_wtcs.start_date/end_date` and per-day `date` as NULL (Schedule fills them).

### S3 — Make "Send to Schedule" write canonical `job_wtcs` rows [LOCKED L1, L3]
- **File:** `sales-command/src/components/ProposalDetail.jsx`, `handleSendToSchedule()` **[:513-621]**.
- After the `jobs` row insert returns `newJobId` **[:589]**, insert **one `job_wtcs` row per WTC** (not the flatMapped merge). For each `wtc` in `wtcList`:
  ```
  { job_id: newJobId,
    proposal_wtc_id: wtc.id,
    work_type_id: wtc.work_type_id,
    work_type_name: wtc.work_types?.name,
    position: index,
    field_sow: wtc.field_sow || [],   // per-day, now date-bearing
    material_status: 'not_ordered',
    start_date: dates_tbd ? null : wtc.start_date,
    end_date:   dates_tbd ? null : wtc.end_date }
  ```
  Respect the `job_wtcs` CHECK on `material_status` (allowed: `ordered, partially_ordered, not_ordered, on_hand, local_store_pickup`) and the UNIQUE on `proposal_wtc_id`.
- **Keep writing `jobs.field_sow` as a read-only mirror** (the merged flatMap) during the transition — see §6.3 (mirror, not retire-now). Field and any legacy reader still fall back to it.
- **[DERIVED gotcha]** The dedupe guard at :517 is keyed on `source_proposal_id`; the `job_wtcs.proposal_wtc_id` UNIQUE is the per-WTC guard. A re-send must be idempotent — wrap the `job_wtcs` insert in an upsert-or-skip on the unique key, mirroring the existing `23505` handling at :582.
- **[DESIGN-OPEN]** Multi-WTC sends and the legacy `jobs.source_proposal_id` UNIQUE index. The Jobs-IA plan called for dropping `idx_jobs_source_proposal_id` (its M3) so two WTCs from one proposal can co-exist. Confirm whether that drop **already shipped** before relying on multi-row sends here; if not, it is a prerequisite (see §6.4 + §9). **[BLOCKED on verifying prod index state — query the ledger / `pg_indexes`.]**

### S4 — (Soft-spot, optional) durable day/task IDs [DERIVED, see §10 R5]
- Replace `Date.now()` / `Date.now()+Math.random()` ID generation **[WTCCalculator.jsx:861-862]** with `crypto.randomUUID()` for new days/tasks so IDs don't collide across cloned/sister proposals (which clone `field_sow` verbatim, duplicating IDs). **[DESIGN-OPEN: in-scope for this vertical or deferred?]** Recommend **in-scope but isolated** — it's a 2-line change and the per-day-date work is the moment we're already touching this shape; a duplicate-ID collision corrupts the date-mapping (two days share an `id`, so a date write hits both). If deferred, it becomes a latent corruption risk the moment Schedule writes per-day dates keyed on `id`.

---

## §5 Schedule Command — work breakdown

**Goal:** Schedule owns the calendar layer on `job_wtcs`, mutable and cost-free, and the Field SOW editor moves off the `jobs.field_sow` blob onto canonical `job_wtcs`.

### SCH1 — Point the Field SOW editor at `job_wtcs` [LOCKED L3]
- **File:** `sch-command/src/views/JobDetail.jsx` Field SOW tab **[:439-450]**, today editing `job.field_sow` via `updateJobField(job.job_id,'field_sow',...)`.
- Load the job with `loadJobWithWTCs(jobId)` (already exists, queries.js:142) so `job._wtcs` is populated.
- **[DESIGN-OPEN — calendar layer physical location]** The brief's recommendation (which this plan adopts): the Schedule-owned calendar lives **on the `job_wtcs` row** — per-day dates inside `job_wtcs.field_sow[*].date`, plus the WTC-span `job_wtcs.start_date/end_date`. Sales' dates are only a **seed**; after send, Schedule owns them. Rationale: keeps scope + calendar co-located per WTC, one canonical row, no second join table. The alternative (a separate `job_dates` mapping table) is rejected as over-normalized for a cost-free, per-WTC concern.
- When `job._wtcs.length > 0`: render one `FieldSowBuilder` per WTC (or a WTC switcher), editing **only** `field_sow` (scope is frozen at the proposal — Schedule edits the day's `date`, `crew_count`, `hours_planned` allocation, never the bid). Persist via a new `updateJobWtcFieldSow(jobWtcId, nextFieldSow, changedBy)` in `queries.js` that updates `job_wtcs.field_sow` (and `start_date/end_date` when the span shifts), with audit logging.
- When `job._wtcs.length === 0` (legacy / pre-vertical job): keep the current `jobs.field_sow` edit path as a fallback.

### SCH2 — Add the per-day date picker to `FieldSowBuilder` [LOCKED L1, L4]
- **File:** `sch-command/src/components/FieldSowBuilder.jsx` (day shape :18-22; `updateDayField` :36-38).
- Add a `<input type="date">` per day bound to `day.date`. `updateDayField` already string-passes `day_label`; add `date` to that branch (mirror of §S1).
- This is the **calendar layer write**: moving a day's date is a normal Schedule write to `job_wtcs.field_sow[*].date`. It must **never** touch `proposal_wtc` or any financial field (the invariant gate, §10 R2).
- Surface a clear "Scope is frozen (from the sale). You're setting the calendar." affordance so the office user knows dates are editable but scope is not.

### SCH3 — Guarantee stage-sync on every status transition [DERIVED — PREREQUISITE]
- **File:** `sch-command/src/lib/queries.js` (`updateJobField`/`updateJobFields` at :155/:191; `updateCallLogStage` at :387) and the callers in `JobCardList.jsx:100-111`, plus any other `status`-writing path (`Jobs.jsx`, `JobDetail.jsx`).
- Implement fix (A) from §3.6: a single choke-point so **any** `jobs.status` write also writes the corresponding `call_log.stage`. Extend the `stageMap` to cover all statuses that must be crew-visible (at minimum: `Scheduled, In Progress, Complete, On Hold`) and decide the stage value for each. **[DESIGN-OPEN]** What `call_log.stage` should 'On Hold' map to, given the Field sync filter (`Scheduled / In Progress / Parked / mobilized / in_progress`)? Options: keep the prior stage (job stays visible), or a new `On Hold` stage **added to the Field filter**. Recommend: map 'On Hold' to retain visibility (do not drop from crew mid-job) — confirm with Chris.
- Add a guard/test: grep for every `from('jobs').update({ status` and every `updateJobField(*, 'status'` to ensure none bypass the choke-point. This is the **prerequisite** for the whole vertical — without it, dated SOWs may never reach the crew (§9).

### SCH4 — Job card / JobDetail surface changes [LOCKED L4]
- The SOW lives under **Planning** (`?mode=planning`), field reality (PRT/Daily Log) under **Management** **[JobDetail.jsx:147-158]** — already correct, no IA change needed.
- Add a small **calendar-readiness** indicator on the Scheduled card / JobDetail header: "Dates TBD" badge when any `job_wtcs.start_date IS NULL` (or `dates_tbd`), so the office sees which sent jobs still need dates assigned. Reuse `ScheduledCardList`'s existing coverage chips pattern.

---

## §6 Data model & migrations

**Migration safety first.** This repo **cannot** `supabase db push` (shared ledger holds ~60 sibling migrations with no local file). Per `sch-command/CLAUDE.md` "Pushing Migrations": write the file → `node scripts/check-migration-collision.mjs` → paste into the Supabase dashboard SQL editor (BEGIN/COMMIT + `IF NOT EXISTS`/`DROP … IF EXISTS`) → record with `supabase migration repair --status applied <ts>`. **[BLOCKED until the RESUME ALERT ledger reconciliation is cleared]** — three migrations (`20260503190000`, `20260512120000`, `20260512120100`) are live-but-ledger-absent; repair them before any new push (`sch-command/CLAUDE.md` RESUME ALERT). **Pick timestamps clear of the prod ledger** (query `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 20`). **Do not run any migration as part of this plan — author files only.**

### 6.1 What already exists (no migration)
- `job_wtcs` table + RLS + the `proposal_wtc_id` UNIQUE — **already live** (`20260512120100_job_wtcs_create.sql`). Columns cover `field_sow jsonb`, `start_date/end_date date`, `material_status`. **The per-day calendar date lives INSIDE `field_sow` JSONB (`field_sow[*].date`)** — no column add needed for per-day dates. **[DERIVED]**
- `jobs.material_status` — already live (`20260512120000`).

### 6.2 New: `proposal_wtc.dates_tbd` (Sales-owned) [LOCKED L1, supports §S2]
- **Repo ownership:** `proposal_wtc` is Sales-owned. **This migration belongs in sales-command**, pushed via `npm run db:push` after `scripts/check-migration-safety.sh` (`sales-command/CLAUDE.md`). Note here for completeness; the file lands in `sales-command/supabase/migrations/`.
- `ALTER TABLE public.proposal_wtc ADD COLUMN IF NOT EXISTS dates_tbd boolean NOT NULL DEFAULT false;` — pure additive, not RLS-touching. Default `false` preserves all legacy rows (dates remain required-with-tentative).

### 6.3 `jobs.field_sow` → mirror, not retire (canonical move) [LOCKED L3]
- **Decision:** make `job_wtcs.field_sow` the **canonical** downstream SOW; keep `jobs.field_sow` as a **read-only derived mirror** during the transition (Field's primary read + every legacy reader still fall back to it).
- **No DDL** — this is a write-discipline change (Sales writes both; Schedule writes only `job_wtcs`; `jobs.field_sow` is regenerated as the flatMap mirror or simply left as the last seeded value). **[DESIGN-OPEN]** Do we actively re-derive `jobs.field_sow` whenever Schedule edits `job_wtcs`, or let it go stale and rely on Field reading `job_wtcs` once §7 lands? Recommend: once Field reads `job_wtcs` (§7), stop maintaining `jobs.field_sow` (freeze it as the last sent value) and mark it deprecated — avoids a dual-write consistency burden. Until §7 ships, Field reads `jobs.field_sow`, so it must stay fresh; therefore **sequence §7 (Field) before deprecating the mirror** (§9).

### 6.4 Verify/retire `idx_jobs_source_proposal_id` UNIQUE [DERIVED — possible prerequisite]
- Multi-WTC sends (§S3) need either (a) the single merged `jobs` row + N `job_wtcs` children (current model — one `jobs` row per proposal, so the UNIQUE is fine) **[DERIVED: ProposalDetail still inserts one jobs row]**, or (b) one `jobs` row per WTC (the Jobs-IA "M3 drop" path). **This plan uses model (a)** — one `jobs` row per proposal, N `job_wtcs` children — so **the `idx_jobs_source_proposal_id` UNIQUE does NOT need to drop.** Confirm no code path now inserts >1 jobs row per proposal. **[DESIGN-OPEN: confirm model (a) is the intended shape with Chris; the Jobs-IA doc leaned toward per-WTC jobs rows.]**

### 6.5 New: overage stamp + capture (Schedule-owned) — see §8 for the data shape.

---

## §7 Field Command — work breakdown

**Goal:** Field syncs the canonical dated `job_wtcs` SOW, the stage-sync break is fixed (SCH3), and the crew sees a read-only day-centric view **grouped by calendar date**.

### F1 — Sync `job_wtcs` to Field [LOCKED L4 — PREREQUISITE for the read fix]
- **File:** `field-command/powersync-sync-rules.yaml` — add `- SELECT * FROM job_wtcs` to the `all_data` bucket. Deployed via the PowerSync dashboard (not a repo push) — note this is a **PowerSync-side deploy**, separate from Supabase migrations.
- **File:** `field-command/src/lib/schema.js` — add a `job_wtcs` `Table` definition (columns: `job_id integer, proposal_wtc_id text, work_type_id integer, work_type_name text, position integer, field_sow text (JSONB→text), material_status text, start_date text, end_date text, created_at text`). Match Supabase types; JSONB → text per the repo's "JSONB stored as text in SQLite" rule.
- **RLS note:** Field is single-tenant, syncs server-side via PowerSync; the `job_wtcs` authenticated RLS policies are scoped via `jobs → call_log.tenant_id`. Confirm PowerSync's sync role satisfies the policy (PowerSync syncs with a service-level connection per its connector — verify the bucket query returns rows under the deployed auth).

### F2 — Fix the TasksTab read + fallback [LOCKED L4]
- **File:** `field-command/src/screens/tabs/TasksTab.js`.
- **Primary read:** `SELECT field_sow, start_date, end_date FROM job_wtcs WHERE job_id = (SELECT job_id FROM jobs WHERE call_log_id = ?) ORDER BY position` — gather **all** WTCs for the job, then merge their `field_sow` days by calendar `date` (L4: group by date, collapse work types).
- **Replace the broken fallback** `SELECT … FROM proposal_wtc WHERE field_sow IS NOT NULL LIMIT 10` + `[0]` **[:23-29]** with a **joined** fallback: `SELECT field_sow FROM jobs WHERE call_log_id = ? LIMIT 1` (the mirror, §6.3), and only then a properly-joined `proposal_wtc` read keyed to this job's proposal — never an unjoined `LIMIT 10`.
- **[DERIVED]** Field's `jobs` sync aliases `job_id AS id` (`SELECT job_id AS id, * FROM jobs`), so the local `jobs` row's PK is `id` but `job_id` is also present — use `job_id` to join `job_wtcs.job_id`. Verify the column survives the alias.

### F3 — Render day-centric grouped by calendar date [LOCKED L4]
- **File:** `TasksTab.js` render block **[:58-128]**.
- Today the day selector keys on `day.day_label` (`Day N`) **[:62-64]**. Change to **group all WTCs' days by `date`** (ISO), one pill per **calendar date**, label e.g. "Mon Jun 16". Within a date, list all tasks/materials across whatever work types land that day — **work types collapsed**, not broken out (a crew may do multiple work types in one day).
- When dates are TBD (`date` null across the board), fall back to the `Day N` sequential labels with a "Dates TBD" banner — the crew still sees the plan, just not calendar-anchored.
- **No notes/annotations on the SOW** (L4) — crew commentary stays in the PRT (`ReportTab`) / daily log. Do not add editable fields here; TasksTab is read-only.

---

## §8 Overage stamp + capture [LOCKED L5 — tag + capture ONLY]

**Trip condition:** a downstream add (a day, a material, a cost) that pushes the job's committed cost **beyond what was bid**. Detected in Schedule when an edit to `job_wtcs` (or `materials`) would exceed the frozen proposal total. The bid total is read from the frozen proposal — never recomputed against it.

### 8.1 The reusable marker (the "stamp")
- A **standard, reusable** flag on the job. Recommend a boolean + metadata on `jobs`: `jobs.has_overage boolean NOT NULL DEFAULT false`. It is the same identifier across all such jobs (L5: "unique identifier, standard across all such jobs, expected frequent"), and is the future hook a change-order workflow keys off. **[Schedule-owned table → migration in this repo, dashboard-applied per §6.]**

### 8.2 The captured artifact (the record that money was added beyond bid)
- A new Schedule-owned table `job_overages`:
  ```
  id uuid PK default gen_random_uuid()
  job_id int8 NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE
  call_log_id int8           -- master-record key, mirrors the queries.js convention
  kind text NOT NULL         -- 'day' | 'material' | 'cost'
  description text
  amount_over_bid numeric NOT NULL
  created_by text            -- who
  created_at timestamptz NOT NULL DEFAULT now()  -- when
  ```
  + 4 authenticated RLS policies scoped via `jobs.call_log_id → call_log.tenant_id` (copy the exact pattern from `20260512120100_job_wtcs_create.sql`). One row per overage event; the `jobs.has_overage` flag is set true on first insert.
- **Out of scope (L5):** the change-order workflow that consumes these rows (creating a CO proposal, re-pricing, customer approval). This plan only **stamps + captures**. The audit manifest (§11) flags this boundary so a reviewer doesn't expect CO logic.

### 8.3 Where the trip fires
- In the Schedule Field SOW editor (§SCH1/SCH2): on a save that adds a day/material whose cost exceeds the frozen bid, set `jobs.has_overage = true` and insert a `job_overages` row. **Do not block the save** (L5: capture, don't gate) and **do not write `proposal_wtc`** (L2). **[DESIGN-OPEN]** Exact cost-comparison basis (committed `job_wtcs` cost vs. `proposals.total`, accrual-style) — needs Chris to confirm the comparand, mirroring the QB "verify on accrual basis" rule. Tag, don't guess.

---

## §9 Sequencing

**Ships first (prerequisite — without it the vertical can silently fail to reach the crew):**
1. **SCH3 — stage-sync choke-point** (§5). Pure Schedule-side; no schema. Land + verify before any dated SOW is expected on a phone. **[PREREQUISITE]**
2. **F1 — sync `job_wtcs` to Field** + schema entry (§7). PowerSync dashboard deploy + Field schema. Must precede F2/F3 (can't read what isn't synced).

**Can parallelize after the prerequisites:**
- **Sales track:** S1 (per-day date) → S2 (TBD toggle + `proposal_wtc.dates_tbd` migration, §6.2) → S3 (write `job_wtcs`). S4 (durable IDs) lands with S1.
- **Schedule track:** SCH1 (editor → `job_wtcs`) → SCH2 (per-day date picker) → SCH4 (TBD badge). Overage (§8) migrations + trip logic land after SCH1/SCH2 (they hook the same save path).
- **Field track:** F2 (read fix) → F3 (group-by-date render). Depends on F1.

**Cross-repo ordering constraints:**
- **§6.3 mirror discipline:** keep `jobs.field_sow` fresh **until F2 ships** (Field reads it today). Only after Field reads `job_wtcs` (F2) may `jobs.field_sow` be frozen/deprecated. So: **F2 before deprecating the mirror.**
- **S3 (Sales writes `job_wtcs`) before F2 is *useful*:** Field can sync an empty `job_wtcs` set, but the dated read only pays off once Sales is writing rows. Land S3 → backfill consideration (§10 R4) → F2.
- **Overage (§8)** is independent of the date layer mechanically but shares the SCH save path — land after SCH1/SCH2.

**End-to-end smoke (after all tracks):** author a 3-day SOW in Sales with 2 work types and per-day dates → Send to Schedule → confirm 2 `job_wtcs` rows with dated `field_sow` → move a day's date in Schedule, confirm `proposal_wtc` untouched → confirm the dated, date-grouped SOW renders on a Field device → add a day beyond bid in Schedule, confirm `jobs.has_overage` + a `job_overages` row, and `proposal_wtc` still frozen.

---

## §10 Risks / soft spots → hardening step

| # | Risk | Severity | Hardened by |
|---|------|----------|-------------|
| R1 | **Stage-sync hard-break** — `jobs.status` writes that don't sync `call_log.stage` drop the job from Field's sync filter mid-lifecycle. | High (crew can't see the job) | **SCH3** (choke-point + full stageMap). PREREQUISITE, ships first. |
| R2 | **Invariant violation** — a Schedule/Field write leaks into `proposal_wtc` or a financial field, breaking "frozen at sale." | High (corrupts the bid) | **SCH1/SCH2** edit `job_wtcs.field_sow` only; add a grep gate: no `from('proposal_wtc').update` in sch/field. §8.3 never writes the bid. |
| R3 | **Unjoined Field fallback** — `proposal_wtc … LIMIT 10` `[0]` picks the wrong WTC. | Med (wrong SOW shown) | **F2** replaces with a job-joined read; drops the `LIMIT 10` anti-pattern. |
| R4 | **No backfill** — jobs sent before S3 have zero `job_wtcs`; Field's primary read is empty for them. | Med | F2/F3 keep the `jobs.field_sow` mirror fallback (§6.3); optionally one-time backfill `job_wtcs` from existing `proposal_wtc` per sent job. **[DESIGN-OPEN: backfill or rely on fallback?]** |
| R5 | **Client-side ID collision** — `Date.now()`/`+Math.random()` day/task IDs collide across cloned/sister proposals; a per-day date keyed on `id` writes to two days. | Med (date corruption once Schedule writes per-day dates) | **S4** (`crypto.randomUUID()`). Recommend in-scope — the date layer makes the collision actively corrupting, not just cosmetic. |
| R6 | **Migration ledger drift** — three live-but-ledger-absent migrations abort any `db push`; new SOW migrations must be dashboard-applied + repaired. | Med (deploy aborts) | §6 procedure; clear the RESUME ALERT reconciliation first. [BLOCKED until repaired] |
| R7 | **PowerSync auth vs. `job_wtcs` RLS** — the sync role must satisfy the `jobs→call_log.tenant_id` policy or `job_wtcs` syncs empty. | Med | F1 verification step — confirm rows return under the deployed PowerSync auth before shipping F2. |
| R8 | **Mirror staleness** — if `jobs.field_sow` is frozen before Field reads `job_wtcs`, Field shows stale days. | Med | §9 ordering: F2 before deprecating the mirror. |

---

## §11 Audit manifest

Riskiest assumptions / load-bearing claims a reviewer should independently verify (each with a file pointer). Sized for an adversarial plan audit (`/runaudit`).

1. **"The `job_wtcs` read side is already live but dormant (nobody writes it)."** Verify: `grep -rn job_wtcs sales-command/src` returns 0 writers; `queries.js:79,103,110-146` + `ScheduledCardList.jsx:48-50` are the only consumers; `_wtcs` is `[]` in prod. If a writer exists, §S3 is partly redundant. **[Pointer: ProposalDetail.jsx:513-621; queries.js:110-146]**
2. **"Per-day calendar dates fit inside `field_sow` JSONB — no column/table add needed."** Verify the `field_sow[*]` day objects can carry `date` without breaking `WTCCalculator.jsx:864` (`parseFloat` coercion) or `FieldSowBuilder.jsx:36`. If a separate mapping table is actually required, §6.1/§SCH1 change materially. **[Pointer: WTCCalculator.jsx:861-868; FieldSowBuilder.jsx:18-22,36]**
3. **"The stage-sync break is on transitions, not first-send."** Verify Send-to-Schedule sets `stage='Parked'` (in the Field filter) **[ProposalDetail.jsx:613]** AND that `JobCardList.updateStatus` is NOT the only status writer — enumerate every `jobs.status` write across sch-command and confirm which bypass `updateCallLogStage`. If first-send also breaks, §9 ordering is wrong. **[Pointer: JobCardList.jsx:100-111; queries.js:387; powersync-sync-rules.yaml]**
4. **"Model (a): one `jobs` row per proposal + N `job_wtcs` children — the `idx_jobs_source_proposal_id` UNIQUE does NOT need to drop."** Verify against prod `pg_indexes` and the Jobs-IA plan's M3 (which assumed per-WTC `jobs` rows). If the intended model is one `jobs` row per WTC, §6.4/§S3 invert. **[Pointer: §6.4; jobs_ia_refactor_implementation.md §3 (Q6); ProposalDetail.jsx:580]**
5. **"`dates_tbd` should be an explicit `proposal_wtc` column, not inferred from null dates."** Verify legacy null-date rows would be mis-classified as TBD under inference. **[Pointer: WTCCalculator.jsx:373-388; §6.2]**
6. **"Field's PowerSync auth satisfies `job_wtcs` RLS."** Verify the sync role returns `job_wtcs` rows under the `jobs→call_log.tenant_id` policy; single-tenant Field has no `tenant_id` locally. If it syncs empty, F2/F3 show nothing. **[Pointer: 20260512120100_job_wtcs_create.sql RLS; field-command schema.js; connector.js]**
7. **"Overage capture must NOT block the save and must NOT touch `proposal_wtc`."** Verify the §8.3 trip path against the sales-command "hiding a field is not guarding the save" and "fail safe not silent" rules — the cost comparand and the non-blocking behavior are [DESIGN-OPEN]. **[Pointer: §8.3; sales-command/CLAUDE.md Data Integrity Rules 6-7]**
8. **"Migrations are dashboard-applied + repaired; `db push` is unavailable here, and three migrations need pre-repair."** Verify the RESUME ALERT ledger state before authoring any new timestamp. **[Pointer: sch-command/CLAUDE.md RESUME ALERT + Pushing Migrations]**

---

## §12 Out of scope (explicit)

- The **change-order workflow** that consumes overage stamps (re-pricing, CO proposal, customer approval). §8 tags + captures only. **[LOCKED L5]**
- A **cross-app shared SOW editor** / "edit routes home from Schedule." Nothing edits the proposal post-sale. **[LOCKED L6]**
- **Per-crew sync filtering** in Field (the `job_crew`-scoped buckets TODO in the sync rules) — orthogonal to this vertical.
- Running any migration, pushing, or deploying — this is a planning doc only.
