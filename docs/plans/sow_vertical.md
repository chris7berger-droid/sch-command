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
4. **Overage stamp + capture**: _(Deferred to Build 2 — see `docs/plans/build2_costs_overages_change_orders.md`.)_ A reusable marker on the job plus a captured artifact row when a downstream add pushes cost beyond the bid. Tag + capture only — the change-order workflow itself is out of scope. The design (L5) stands; only its implementation moves to Build 2.

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
| L5 | **[LOCKED — design stands] Implementation DEFERRED to Build 2** (2026-06-12). See `docs/plans/build2_costs_overages_change_orders.md`. **Scope additions beyond bid** NEVER edit the proposal. They **stamp the job** with a reusable overage marker (a standard, reusable identifier, expected frequent) and **capture the artifact** (record that money was added beyond bid). The stamp is the future hook for a change-order workflow. **The change-order workflow itself is OUT OF SCOPE — only the tag + capture.** | §8 (deferred — Build 2) |
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
- **[LOCKED 2026-06-11 — Chris ratified (A)]** Two candidate fixes: (A) make **every** `jobs.status` write also call `updateCallLogStage` via a single choke-point in `queries.js`; or (B) have Field **discover jobs via `jobs.status`** instead of `call_log.stage` (sync `jobs`, filter on `jobs.status`, drop the `call_log.stage` dependency). (A) is smaller and keeps `call_log` as master; (B) is more robust but touches the sync contract and the Field read model. **Recommend (A)** for this vertical (smaller blast radius, preserves call_log-as-master), and file (B) as a follow-up hardening. This is a **prerequisite** — it ships first (§9).

> **Amendment (round-1 audit): fix-A superseded** [AMENDMENT 2026-06-11]
>
> **Why:** the original fix-A as phrased ("make every `jobs.status` write *also call* `updateCallLogStage`") is a discipline rule, not a structural guarantee — it relies on each writer remembering to call the stage-sync. The round-1 audit found **writer-coverage** is the actual failure mode: there are **three** real `jobs.status` update-path writers, and only one of them currently stage-syncs (and even that one's `stageMap` is incomplete). A "remember to also call it" rule re-opens the gap the next time a writer is added.
>
> **Verified writer set [DERIVED — corrects the brief's list]:**
> - `JobCardList.jsx:102` — `updateJobField(jobId,'status',newStatus)` inside `updateStatus()`, then a partial `stageMap = {Scheduled, In Progress, Complete}` at `:105` (omits On Hold and anything else). **[verified :100-111]**
> - `StageJobCard.jsx:403` — `handleKickoff()` → `updateJobField(job.job_id,'status','In Progress')`, **no stage write at all**. **[verified :401-407]**
> - `StageJobCard.jsx:411` — `handleResume()` (On-Hold → 'Scheduled') → `updateJobFields(job.job_id,{status:'Scheduled', ready_confirmed_at:null})`, **no stage write** — this is the **resume-side stage write** the new approach must add. **[verified :409-421]**
> - **`App.jsx:160` is NOT a status *update* writer.** The brief named it, but `App.jsx:157-160` is an `insert([row])` of a **standalone, manually-added job** with `status:'Scheduled'` and **no `call_log_id`** (it isn't sourced from a proposal, so there is no `call_log` row to stage-sync). It is correctly out of the chokepoint's scope. **[verified App.jsx:145-164 — `supabase.from('jobs').insert([row])`, not `.update()`.]** Noted here so a reviewer doesn't expect it to route through `updateJobStatus()`.
> - `FieldSowModal.jsx:92` writes `jobs.field_sow` (not `status`) — not a status writer.
>
> **New approach (hybrid chokepoint):** introduce a single **`updateJobStatus(jobId, newStatus, changedBy, source?)`** helper in `queries.js` that (1) writes `jobs.status` via the existing audit-logged `updateJobField` path, then (2) **unconditionally** resolves and writes the paired `call_log.stage` from a complete `STATUS_TO_STAGE` map (including On Hold's in-filter target — see SCH3). **Route ALL three writers above through it** (`JobCardList:102`, `StageJobCard:403`, `StageJobCard:411`) — delete their ad-hoc `stageMap`/missing-sync code. Because stage resolution lives **inside** the helper, a future writer that calls `updateJobStatus` cannot forget to sync. Pair it with the grep gate (SCH3) so no raw `from('jobs').update({status})` / `updateJobField(_, 'status')` bypasses it.
>
> **Consistency with locked model (a):** one `jobs` row per proposal → exactly one `call_log` row per job → the helper writes exactly one `call_log.stage` per status change. No fan-out, no ambiguity about *which* call_log to sync. Stays fully consistent with §3.3 model (a) and §6.4.
>
> **Sync-rule change in the SAME step:** On Hold's chosen stage target must be in the Field `call_log.stage` filter, so `field-command/powersync-sync-rules.yaml`'s `call_log` stage filter is edited in lockstep with the helper (see SCH3 + §9). Shipping the helper without the filter edit would still drop On-Hold jobs from crew.

---

## §4 Sales Command — work breakdown

**Goal:** Sales becomes the single author of the canonical `job_wtcs` SOW, with per-day calendar dates + a "dates TBD" toggle.

### S1 — Add a per-day calendar date to the `field_sow` day shape [LOCKED L1]
- **File:** `sales-command/src/pages/WTCCalculator.jsx`, `SowTab` (`addDay` at :862; `updateDay` at :864; the day render block below it).
- Extend the day object with `date: null` (ISO `YYYY-MM-DD`) and `dates_tbd`-awareness (the toggle is WTC-level, §S2). New shape: `{ id, day_label, date: null, tasks, crew_count, hours_planned, materials }`.
- **[DERIVED — coercion guard, paired edit #1 of 2]** `updateDay` currently coerces every non-`day_label` key with `parseFloat`: `key === "day_label" ? val : parseFloat(val) || 0` **[verified at WTCCalculator.jsx:864 — exact line]**. Change the exempt set to include `date` so the ISO string isn't destroyed by `parseFloat` (a `YYYY-MM-DD` string → `NaN` → `0`):
  ```js
  ['day_label','date'].includes(key) ? val : parseFloat(val) || 0
  ```
  This is the Sales half of the paired guard; §SCH2 carries the identical edit for Schedule's `FieldSowBuilder.jsx`. **Both must ship together** — whichever app writes the `date` string into `field_sow` must not let the other strip it on a subsequent day-field edit.
- Per-day date is **optional at authoring** (Sales may seed it or leave it for Schedule). When `dates_tbd` is on (§S2), the per-day date inputs are disabled/hidden.

### S2 — Add the WTC-level "dates TBD" toggle [LOCKED L1]
- **File:** `WTCCalculator.jsx` near the Tentative Start/End block **[:373-388]**.
- Add a checkbox `Dates TBD` bound to a new field. **[LOCKED 2026-06-11 — (a) explicit `proposal_wtc.dates_tbd` column]** Storage location for the toggle: (a) a new `proposal_wtc.dates_tbd boolean` column, or (b) infer from `start_date IS NULL`. Recommend **(a) an explicit column** — inference is ambiguous (legacy rows have null dates that aren't "TBD"), and the toggle's whole point is to make "we don't know yet" a first-class, non-error state (today the date inputs are required-with-red-error **[:379,388]**; TBD must suppress that error). Add the migration in §6.
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
    field_sow: wtc.field_sow || [],   // ALWAYS an array, never undefined (NOT NULL col) — per-day, now date-bearing
    material_status: 'not_ordered',
    start_date: dates_tbd ? null : (wtc.start_date || null),
    end_date:   dates_tbd ? null : (wtc.end_date || null) }
  ```
  Respect the `job_wtcs` CHECK on `material_status` (allowed: `ordered, partially_ordered, not_ordered, on_hand, local_store_pickup`) and the UNIQUE on `proposal_wtc_id`.
- **[LOCKED L1 — NULL-safety on the "dates TBD" path]** Explicitly write `field_sow: wtc.field_sow || []` (the `[]` literal, **never `undefined`**) and `start_date`/`end_date` as `null` when `dates_tbd` is on. `job_wtcs.field_sow` stays `NOT NULL`, so an `undefined` would violate it; `job_wtcs.start_date`/`end_date` are being **dropped to nullable** (see §6.6 migration) precisely so a "dates TBD" row can insert with null dates. Without that migration the create table's `start_date NOT NULL`/`end_date NOT NULL` (`20260512120100_job_wtcs_create.sql`) would reject every TBD send. **[DERIVED: §3.3 line 71 confirms both columns are `date` NOT NULL in the create migration.]**
- **Keep writing `jobs.field_sow` as a read-only mirror** (the merged flatMap) during the transition — see §6.3 (mirror, not retire-now). Field and any legacy reader still fall back to it.
- **[DERIVED gotcha]** The dedupe guard at :517 is keyed on `source_proposal_id`; the `job_wtcs.proposal_wtc_id` UNIQUE is the per-WTC guard. A re-send must be idempotent — wrap the `job_wtcs` insert in an upsert-or-skip on the unique key, mirroring the existing `23505` handling at :582.
- **[LOCKED 2026-06-11 — Chris ratified model (a)]** One `jobs` row per proposal. Two WTCs from one proposal never need to co-exist as separate `jobs` rows, so the Jobs-IA `idx_jobs_source_proposal_id` drop (M3) is **NOT needed** for this vertical — the UNIQUE index stays. No prod-index action required. Residual is verification only: confirm no code path inserts >1 `jobs` row per proposal.

### S4 — (Soft-spot, optional) durable day/task IDs [DERIVED, see §10 R5]
- Replace `Date.now()` / `Date.now()+Math.random()` ID generation **[WTCCalculator.jsx:861-862]** with `crypto.randomUUID()` for new days/tasks so IDs don't collide across cloned/sister proposals (which clone `field_sow` verbatim, duplicating IDs). **[LOCKED 2026-06-11 — in-scope, isolated]** **in-scope but isolated** — it's a 2-line change and the per-day-date work is the moment we're already touching this shape; a duplicate-ID collision corrupts the date-mapping (two days share an `id`, so a date write hits both). If deferred, it becomes a latent corruption risk the moment Schedule writes per-day dates keyed on `id`.

---

## §5 Schedule Command — work breakdown

**Goal:** Schedule owns the calendar layer on `job_wtcs`, mutable and cost-free, and the Field SOW editor moves off the `jobs.field_sow` blob onto canonical `job_wtcs`.

### SCH1 — Point the Field SOW editor at `job_wtcs` [LOCKED L3]
- **File:** `sch-command/src/views/JobDetail.jsx` Field SOW tab **[:439-450]**, today editing `job.field_sow` via `updateJobField(job.job_id,'field_sow',...)`.
- **[Acceptance criterion — DERIVED]** Swap the job load in `JobDetail.jsx`'s `fetchData` from `loadJob(jid)` to `loadJobWithWTCs(jid)` so `job._wtcs` is populated. **[verified: JobDetail.jsx:76 currently calls `loadJob(jid)` inside the `Promise.all`; `loadJobWithWTCs` exists at queries.js:142.]** This swap is a named, testable acceptance criterion for SCH1: after it, `job._wtcs` is non-empty for any job sent post-§S3.
- **[LOCKED 2026-06-11 — calendar lives on `job_wtcs`]** the Schedule-owned calendar lives **on the `job_wtcs` row** — per-day dates inside `job_wtcs.field_sow[*].date`, plus the WTC-span `job_wtcs.start_date/end_date`. Sales' dates are only a **seed**; after send, Schedule owns them. Rationale: keeps scope + calendar co-located per WTC, one canonical row, no second join table. The alternative (a separate `job_dates` mapping table) is rejected as over-normalized for a cost-free, per-WTC concern.
- When `job._wtcs.length > 0`: render one `FieldSowBuilder` per WTC (or a WTC switcher), editing **only** `field_sow` (scope is frozen at the proposal — Schedule edits the day's `date`, `crew_count`, `hours_planned` allocation, never the bid).
- **[DERIVED — new audit-logged writer in `queries.js`]** Persist via a new **`updateJobWtcFieldSow(jobWtcId, nextFieldSow, changedBy, source = 'schedule_command')`** in `queries.js`, mirroring the existing `updateJobField`/`updateJobFields` audit-logging convention **[verified pattern: queries.js:155-188 reads-old → writes → inserts a `job_changes` row]**. It updates `job_wtcs.field_sow` (and `start_date`/`end_date` when the WTC span shifts) and writes a `job_changes` audit row keyed on the parent job's `call_log_id`. **Do not** write `job_wtcs` via a raw `supabase.from('job_wtcs').update(...)` — all Schedule per-day-date / `field_sow` writes route through this helper so the change is audit-logged like every other job write (`queries.js` is the audit chokepoint per `CLAUDE.md` "All job writes go through `updateJobField()` / `updateJobFields()`").
  - Note `job_changes` columns: `job_id, call_log_id, field, old_value, new_value, changed_by, source` **[verified queries.js:176-184]**. For a `job_wtcs` write, set `field` to something like `job_wtc.field_sow` (or include the `job_wtc_id`) and carry the parent `job_id`/`call_log_id` so the history view still attributes the change to the job.
- When `job._wtcs.length === 0` (legacy / pre-vertical job): keep the current `jobs.field_sow` edit path (`updateJobField`) as a fallback.

### SCH2 — Add the per-day date picker to `FieldSowBuilder` [LOCKED L1, L4]
- **File:** `sch-command/src/components/FieldSowBuilder.jsx` (day shape :18-22; `updateDayField` :36-37).
- Add a `<input type="date">` per day bound to `day.date`.
- **[DERIVED — coercion guard, paired edit #2 of 2 — MANDATORY, same step as §S1]** `updateDayField` today is `key === 'day_label' ? val : (parseFloat(val) || 0)` **[verified at FieldSowBuilder.jsx:37 — exact line; `updateDayField` defined :36-37]**. Change the exempt set to include `date`:
  ```js
  ['day_label','date'].includes(key) ? val : (parseFloat(val) || 0)
  ```
  Without this, Schedule's own per-day-date write (SCH2's whole point) would NaN→0 the ISO string the moment any other day field is edited. This is the Schedule half of the §S1 paired guard — it is **not optional** and lands in this step.
- This is the **calendar layer write**: moving a day's date is a normal Schedule write to `job_wtcs.field_sow[*].date`. It must **never** touch `proposal_wtc` or any financial field (the invariant gate, §10 R2).
- Surface a clear "Scope is frozen (from the sale). You're setting the calendar." affordance so the office user knows dates are editable but scope is not.

### SCH3 — Guarantee stage-sync on every status transition via a `updateJobStatus()` chokepoint [DERIVED — PREREQUISITE] [AMENDMENT: fix-A superseded — see §3.6 amendment]
- **Supersedes the original fix-A** (the "every writer also calls `updateCallLogStage`" discipline rule). The round-1 audit replaced it with a structural chokepoint because the failure mode is **writer coverage**, not a missing single call. Full rationale + verified writer set in the §3.6 amendment block.
- **New helper — `queries.js`:** add `updateJobStatus(jobId, newStatus, changedBy, source = 'schedule_command')` that:
  1. writes `jobs.status` through the existing audit-logged path (`updateJobField`, :155);
  2. **unconditionally** resolves the paired stage from a complete `STATUS_TO_STAGE` map and writes it via `updateCallLogStage` (:387) when the job has a `call_log_id`. Stage resolution lives **inside** the helper so no caller can forget it.
- **Route ALL real `jobs.status` update-path writers through it [DERIVED — verified complete set]:**
  - `JobCardList.jsx:102` (`updateStatus()`) — replace its inline `stageMap`/`updateCallLogStage` (`:104-108`) with a single `updateJobStatus(jobId, newStatus, changedBy)` call. **[verified :100-111]**
  - `StageJobCard.jsx:403` (`handleKickoff`, → 'In Progress') — currently **no stage sync**; route through `updateJobStatus`. **[verified :401-407]**
  - `StageJobCard.jsx:411` (`handleResume`, On-Hold → 'Scheduled') — currently `updateJobFields(... {status, ready_confirmed_at})` with **no stage sync**; this is the **resume-side stage write**. Route the status part through `updateJobStatus` (keep the `ready_confirmed_at: null` + `skipAuditFields` handling — either fold into the helper's signature or write `ready_confirmed_at` separately so the existing `on_hold_resume` audit source is preserved). **[verified :409-421]**
  - **NOT routed:** `App.jsx:160` is an `insert()` of a standalone job with no `call_log_id` (no proposal/call_log to sync) — correctly out of scope (see §3.6 amendment). `FieldSowModal.jsx:92` writes `field_sow`, not `status`.
- **`STATUS_TO_STAGE` map — cover every crew-visible status** (at minimum `Scheduled, In Progress, Complete, On Hold`). **[LOCKED 2026-06-11 — On Hold retains crew visibility]** 'On Hold' must map to a stage **inside** the Field `call_log.stage` sync filter so a held job is not dropped from crew mid-job. Recommended target: keep the job visible (map On Hold to a value in the filter, e.g. retain `'In Progress'`/prior, or add an explicit `'On Hold'` stage to the Field filter — see the sync-rule edit below).
- **Sync-rule edit in the SAME step [AMENDMENT]:** change `field-command/powersync-sync-rules.yaml`'s `call_log.stage` filter so On Hold's chosen target is included (the current filter is `Scheduled / In Progress / Parked / mobilized / in_progress` — §3.5). If On Hold maps to a *new* `'On Hold'` stage, add it to the filter; if it retains a prior in-filter stage, no filter change is needed but confirm explicitly. **This is a PowerSync-dashboard deploy** (same channel as F1), coordinated with the helper landing — shipping the helper without the matching filter still drops held jobs.
- **Grep gate:** after wiring, grep for every `from('jobs').update({ status`, `from('jobs').insert(` carrying `status`, and `updateJobField(*, 'status'` / `updateJobFields(*, { ... status` to confirm none bypass `updateJobStatus` (except the standalone-insert `App.jsx:160`, documented). This is the **prerequisite** for the whole vertical — without it, dated SOWs may never reach the crew (§9).

### SCH4 — Job card / JobDetail surface changes [LOCKED L4]
- The SOW lives under **Planning** (`?mode=planning`), field reality (PRT/Daily Log) under **Management** **[JobDetail.jsx:147-158]** — already correct, no IA change needed.
- Add a small **calendar-readiness** indicator on the Scheduled card / JobDetail header: "Dates TBD" badge when any `job_wtcs.start_date IS NULL` (or `dates_tbd`), so the office sees which sent jobs still need dates assigned. Reuse `ScheduledCardList`'s existing coverage chips pattern.

---

## §6 Data model & migrations

**Migration safety first.** This repo **cannot** `supabase db push` (shared ledger holds ~60 sibling migrations with no local file). Per `sch-command/CLAUDE.md` "Pushing Migrations": write the file → `node scripts/check-migration-collision.mjs` → paste into the Supabase dashboard SQL editor (BEGIN/COMMIT + `IF NOT EXISTS`/`DROP … IF EXISTS`) → record with `supabase migration repair --status applied <ts>`. **[BLOCKED until the RESUME ALERT ledger reconciliation is cleared]** — three migrations (`20260503190000`, `20260512120000`, `20260512120100`) are live-but-ledger-absent; repair them before any new push (`sch-command/CLAUDE.md` RESUME ALERT). **Pick timestamps clear of the prod ledger** (query `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 20`). **Do not run any migration as part of this plan — author files only.**

**Migration count — 3 new files across 2 repos:**
1. `proposal_wtc.dates_tbd` boolean (§6.2) — **sales-command** (`npm run db:push`).
2. `job_wtcs.start_date` / `end_date` DROP NOT NULL (§6.6) — **sch-command** (dashboard-applied). _Added round-1 audit (A1)._

(The `job_overages` table + `jobs.has_overage` migrations are **deferred to Build 2** — see `docs/plans/build2_costs_overages_change_orders.md`. The NOT-NULL drop (2) is a **prerequisite for §S3** — see §9.)

### 6.1 What already exists (no migration)
- `job_wtcs` table + RLS + the `proposal_wtc_id` UNIQUE — **already live** (`20260512120100_job_wtcs_create.sql`). Columns cover `field_sow jsonb` (NOT NULL), `start_date/end_date date` (currently **NOT NULL** — relaxed by §6.6 for the "dates TBD" path), `material_status`. **The per-day calendar date lives INSIDE `field_sow` JSONB (`field_sow[*].date`)** — no column add needed for per-day dates. **[DERIVED]**
- `jobs.material_status` — already live (`20260512120000`).

### 6.2 New: `proposal_wtc.dates_tbd` (Sales-owned) [LOCKED L1, supports §S2]
- **Repo ownership:** `proposal_wtc` is Sales-owned. **This migration belongs in sales-command**, pushed via `npm run db:push` after `scripts/check-migration-safety.sh` (`sales-command/CLAUDE.md`). Note here for completeness; the file lands in `sales-command/supabase/migrations/`.
- `ALTER TABLE public.proposal_wtc ADD COLUMN IF NOT EXISTS dates_tbd boolean NOT NULL DEFAULT false;` — pure additive, not RLS-touching. Default `false` preserves all legacy rows (dates remain required-with-tentative).

### 6.3 `jobs.field_sow` → mirror, not retire (canonical move) [LOCKED L3]
- **Decision:** make `job_wtcs.field_sow` the **canonical** downstream SOW; keep `jobs.field_sow` as a **read-only derived mirror** during the transition (Field's primary read + every legacy reader still fall back to it).
- **No DDL** — this is a write-discipline change (Sales writes both; Schedule writes only `job_wtcs`; `jobs.field_sow` is regenerated as the flatMap mirror or simply left as the last seeded value). **[LOCKED 2026-06-11 — freeze mirror after §7 ships]** Do we actively re-derive `jobs.field_sow` whenever Schedule edits `job_wtcs`, or let it go stale and rely on Field reading `job_wtcs` once §7 lands? Recommend: once Field reads `job_wtcs` (§7), stop maintaining `jobs.field_sow` (freeze it as the last sent value) and mark it deprecated — avoids a dual-write consistency burden. Until §7 ships, Field reads `jobs.field_sow`, so it must stay fresh; therefore **sequence §7 (Field) before deprecating the mirror** (§9).

### 6.4 `idx_jobs_source_proposal_id` UNIQUE stays [LOCKED 2026-06-11 — model (a)]
- **Chris ratified model (a): one `jobs` row per proposal + N `job_wtcs` children** (one schedule card per job; work types collapse into the day-centric view). The Jobs-IA per-WTC-rows lean (its "M3 drop") is **superseded for this vertical** — there is never >1 `jobs` row per proposal, so `idx_jobs_source_proposal_id` **stays** and no index DDL is needed. Residual is verification only: confirm no code path inserts >1 `jobs` row per proposal (`ProposalDetail.jsx:580` should remain a single insert).

### 6.5 Overage stamp + capture migrations — **DEFERRED to Build 2** (`job_overages` table + `jobs.has_overage`). See `docs/plans/build2_costs_overages_change_orders.md`.

### 6.6 New: DROP NOT NULL on `job_wtcs.start_date` AND `job_wtcs.end_date` (Schedule-owned) [LOCKED L1 — supports §S3 "dates TBD"] — _added round-1 audit (A1)_
- **Why:** the locked "dates TBD" toggle (L1) means a `job_wtcs` row can be created with no calendar dates. But the live create migration `20260512120100_job_wtcs_create.sql` declared `start_date date NOT NULL` and `end_date date NOT NULL` **[DERIVED: §3.3 line 71]** — so a TBD send would fail to insert. Drop the NOT NULL on both.
- **Repo ownership:** `job_wtcs` is Schedule-owned → **this migration lands in sch-command** (`supabase/migrations/`), dashboard-applied + ledger-repaired per §6's procedure (NOT `db push` — see RESUME ALERT).
- **DDL:**
  ```sql
  BEGIN;
  ALTER TABLE public.job_wtcs ALTER COLUMN start_date DROP NOT NULL;
  ALTER TABLE public.job_wtcs ALTER COLUMN end_date   DROP NOT NULL;
  COMMIT;
  ```
  Pure constraint relaxation — additive/safe (any existing row already satisfies a nullable column). `ALTER COLUMN … DROP NOT NULL` is idempotent in effect (re-running is a no-op on an already-nullable column), so no `IF` guard is needed; still wrap in `BEGIN/COMMIT`.
- **Keep `job_wtcs.field_sow` NOT NULL** — §S3 always writes `[]` when empty, so the column never needs to be nullable.
- **Procedure:** pick a timestamp clear of the prod ledger (query the ledger first), `node scripts/check-migration-collision.mjs`, paste into the Supabase dashboard SQL editor, then `supabase migration repair --status applied <ts>`. **[BLOCKED until the RESUME ALERT three-migration reconciliation is cleared — same gate as all sch-command migrations.]**
- **Sequencing:** PREREQUISITE for §S3 (Sales' first "dates TBD" send inserts null-dated rows) — see §9.

---

## §7 Field Command — work breakdown

**Goal:** Field syncs the canonical dated `job_wtcs` SOW, the stage-sync break is fixed (SCH3), and the crew sees a read-only day-centric view **grouped by calendar date**.

### F1 — Sync `job_wtcs` to Field [LOCKED L4 — PREREQUISITE for the read fix]
- **File:** `field-command/powersync-sync-rules.yaml` — add `- SELECT * FROM job_wtcs` to the `all_data` bucket. Deployed via the PowerSync dashboard (not a repo push) — note this is a **PowerSync-side deploy**, separate from Supabase migrations.
- **File:** `field-command/src/lib/schema.js` — add a `job_wtcs` `Table` definition (columns: `job_id integer, proposal_wtc_id text, work_type_id integer, work_type_name text, position integer, field_sow text (JSONB→text), material_status text, start_date text, end_date text, created_at text`). Match Supabase types; JSONB → text per the repo's "JSONB stored as text in SQLite" rule.
- **RLS note:** Field is single-tenant, syncs server-side via PowerSync; the `job_wtcs` authenticated RLS policies are scoped via `jobs → call_log.tenant_id`. Confirm PowerSync's sync role satisfies the policy (PowerSync syncs with a service-level connection per its connector — verify the bucket query returns rows under the deployed auth).

### F2 — Fix the TasksTab read + fallback [LOCKED L4]
- **File:** `field-command/src/screens/tabs/TasksTab.js` (primary read :17-20; broken fallback :23-29).
- **[DERIVED — CORRECTION to the brief: join on the LOCAL `id`, not `job_id`]** Field's `jobs` sync rule is `SELECT job_id AS id, * FROM jobs` **[verified powersync-sync-rules.yaml:21]**, and the Field PowerSync **schema does NOT declare a `job_id` column** on the `jobs` table — `schema.js`'s `jobs` Table has `call_log_id` but **no `job_id`** **[verified schema.js:139-165]**. PowerSync only materializes declared columns, so locally the jobs PK is reachable **only as `id`**; a `WHERE job_id = (SELECT job_id FROM jobs …)` would fail (the inner `job_id` isn't a queryable column). **Use the local `id`:**
  ```sql
  SELECT field_sow, start_date, end_date, position
  FROM job_wtcs
  WHERE job_id = (SELECT id FROM jobs WHERE call_log_id = ?)
  ORDER BY position
  ```
  (Here `job_wtcs.job_id` is the Supabase `jobs.job_id` value, which equals the Field-local `jobs.id` because of the `job_id AS id` alias.) Gather **all** WTCs for the job, then merge per the §F3 spec.
  - **[Schema follow-on]** F1 already adds a `job_wtcs` Table to `schema.js`; declare its `job_id` as `column.integer` so it's queryable. (Optional hardening: also declare `job_id` on the `jobs` Table so future joins can use it directly — not required for F2.)
- **DROP the `proposal_wtc` fallback entirely [DERIVED — per round-1 audit].** Remove the `SELECT … FROM proposal_wtc WHERE field_sow IS NOT NULL LIMIT 10` + `[0]` read (:23-29) — it is an **unjoined** read that `LIMIT 10`s across **all** proposals then takes `[0]`, picking an arbitrary (wrong) WTC. With `job_wtcs` synced (F1) the dated canonical SOW is available directly, so the fallback is unnecessary. Keep only **one** fallback for pre-vertical / legacy jobs that have no `job_wtcs` rows: the `jobs.field_sow` mirror (§6.3), already read as `SELECT field_sow, size, size_unit FROM jobs WHERE call_log_id = ? LIMIT 1` (:17-20). Read order: **`job_wtcs` (primary) → `jobs.field_sow` mirror (legacy fallback)**; no `proposal_wtc` path at all.

### F3 — Render day-centric grouped by calendar date [LOCKED L4]
- **File:** `TasksTab.js` render block **[:58-128]**; day selector currently keys on `day.day_label` (`Day N`) **[verified :62-64]**.
- **Precise merge spec [DERIVED — per round-1 audit].** After F2 gathers all WTCs' `field_sow` arrays, merge the days as follows:
  1. **Group BY `date`** (the ISO `YYYY-MM-DD` per-day field). All days across all work types that share a `date` collapse into **one** calendar-date group → one pill per calendar date, label e.g. "Mon Jun 16".
  2. **Within a date group, across the work types that land that day:**
     - **CONCAT** `tasks` (append all tasks from every contributing day — work types collapsed, not broken out).
     - **CONCAT** `materials` (append all materials).
     - **SUM** `crew_count` (total crew across the work types that day).
     - **SUM** `hours_planned` (total planned hours that day).
  3. **Undated days** (`date` null) do **not** merge into any dated group. Render them as **trailing `Day N (TBD)` pills after all the dated pills**, in their original sequence — so the crew still sees TBD work, anchored to its `day_label`, at the end of the date list.
- When **every** day is undated (`date` null across the board — e.g. a "dates TBD" send Schedule hasn't dated yet), fall back to the existing `Day N` sequential labels with a "Dates TBD" banner — the crew still sees the plan, just not calendar-anchored.
- **No notes/annotations on the SOW** (L4) — crew commentary stays in the PRT (`ReportTab`) / daily log. Do not add editable fields here; TasksTab is read-only.

---

## §8 Overage stamp + capture — DEFERRED to Build 2

Overage stamp/capture deferred to Build 2 — see `docs/plans/build2_costs_overages_change_orders.md`.
The L5 design decision stands; only its implementation is deferred.

---

## §9 Sequencing

**Ships first (prerequisite — without it the vertical can silently fail to reach the crew):**
1. **SCH3 — `updateJobStatus()` chokepoint + On-Hold sync-rule edit** (§5, per the §3.6 amendment). Two coupled pieces that ship **together**: (a) the `queries.js` `updateJobStatus` helper with all 3 writers (`JobCardList:102`, `StageJobCard:403`, `StageJobCard:411`) routed through it; (b) the `powersync-sync-rules.yaml` `call_log.stage` filter edit for On Hold's target (PowerSync-dashboard deploy). The helper alone is insufficient — an On-Hold job still drops from crew unless the filter includes its stage. Land + verify both before any dated SOW is expected on a phone. **[PREREQUISITE]**
2. **A1 migration — `job_wtcs.start_date`/`end_date` DROP NOT NULL** (§6.6). Dashboard-applied + ledger-repaired. **Must land before §S3** (Sales' Send-to-Schedule with "dates TBD" inserts null-dated `job_wtcs` rows; without this the insert fails). Independent of SCH3 — can be authored/applied in parallel, but gates S3. **[PREREQUISITE for S3]**
3. **F1 — sync `job_wtcs` to Field** + schema entry (§7). PowerSync dashboard deploy + Field schema. Must precede F2/F3 (can't read what isn't synced).

**Can parallelize after the prerequisites:**
- **Sales track:** S1 (per-day date) → S2 (TBD toggle + `proposal_wtc.dates_tbd` migration, §6.2) → S3 (write `job_wtcs` — gated on the §6.6 A1 NOT-NULL-drop migration above). S4 (durable IDs) lands with S1.
- **Schedule track:** SCH1 (editor → `job_wtcs`) → SCH2 (per-day date picker) → SCH4 (TBD badge). _(Overage migrations + trip logic deferred to Build 2 — they hook this same SCH1/SCH2 save path. See `docs/plans/build2_costs_overages_change_orders.md`.)_
- **Field track:** F2 (read fix) → F3 (group-by-date render). Depends on F1.

**Cross-repo ordering constraints:**
- **§6.3 mirror discipline:** keep `jobs.field_sow` fresh **until F2 ships** (Field reads it today). Only after Field reads `job_wtcs` (F2) may `jobs.field_sow` be frozen/deprecated. So: **F2 before deprecating the mirror.**
- **S3 (Sales writes `job_wtcs`) before F2 is *useful*:** Field can sync an empty `job_wtcs` set, but the dated read only pays off once Sales is writing rows. Land S3 → backfill consideration (§10 R4) → F2.

**End-to-end smoke (after all tracks):** author a 3-day SOW in Sales with 2 work types and per-day dates → Send to Schedule → confirm 2 `job_wtcs` rows with dated `field_sow` → move a day's date in Schedule, confirm `proposal_wtc` untouched → confirm the dated, date-grouped SOW renders on a Field device. _(The overage smoke step — add a day beyond bid, confirm the stamp + capture — is deferred to Build 2.)_

---

## §10 Risks / soft spots → hardening step

| # | Risk | Severity | Hardened by |
|---|------|----------|-------------|
| R1 | **Stage-sync hard-break** — `jobs.status` writes that don't sync `call_log.stage` drop the job from Field's sync filter mid-lifecycle. | High (crew can't see the job) | **SCH3** — `updateJobStatus()` chokepoint (all 3 verified writers routed through it) + complete `STATUS_TO_STAGE` map + the coupled On-Hold sync-filter edit (§3.6 amendment). PREREQUISITE, ships first. |
| R2 | **Invariant violation** — a Schedule/Field write leaks into `proposal_wtc` or a financial field, breaking "frozen at sale." | High (corrupts the bid) | **SCH1/SCH2** edit `job_wtcs.field_sow` only; add a grep gate: no `from('proposal_wtc').update` in sch/field. _(The overage read path that also relies on this invariant is deferred to Build 2.)_ |
| R3 | **Unjoined Field fallback** — `proposal_wtc … LIMIT 10` `[0]` picks the wrong WTC. | Med (wrong SOW shown) | **F2** — the `proposal_wtc` fallback is **dropped entirely** (round-1 audit); reads go `job_wtcs` (joined on local `id`) → `jobs.field_sow` mirror only. The `LIMIT 10` anti-pattern is removed, not just replaced. |
| R4 | **No backfill** — jobs sent before S3 have zero `job_wtcs`; Field's primary read is empty for them. | Med | **[LOCKED 2026-06-11 — Chris ratified: rely on fallback, NO backfill]** Old jobs stay on the `jobs.field_sow` mirror fallback (§6.3); only new sends get the dated SOW + new Field read. In-flight jobs age out; no prod data migration. |
| R5 | **Client-side ID collision** — `Date.now()`/`+Math.random()` day/task IDs collide across cloned/sister proposals; a per-day date keyed on `id` writes to two days. | Med (date corruption once Schedule writes per-day dates) | **S4** (`crypto.randomUUID()`). Recommend in-scope — the date layer makes the collision actively corrupting, not just cosmetic. |
| R6 | **Migration ledger drift** — three live-but-ledger-absent migrations abort any `db push`; new SOW migrations must be dashboard-applied + repaired. | Med (deploy aborts) | §6 procedure; clear the RESUME ALERT reconciliation first. [BLOCKED until repaired] |
| R7 | **PowerSync auth vs. `job_wtcs` RLS** — the sync role must satisfy the `jobs→call_log.tenant_id` policy or `job_wtcs` syncs empty. | Med | F1 verification step — confirm rows return under the deployed PowerSync auth before shipping F2. |
| R8 | **Mirror staleness** — if `jobs.field_sow` is frozen before Field reads `job_wtcs`, Field shows stale days. | Med | §9 ordering: F2 before deprecating the mirror. |

---

## §11 Audit manifest

_Generated by `/auditcriteria` on 2026-06-12 (round 2). Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
The SOW pipeline only — getting the day-by-day plan to flow Sales → Schedule → Field with calendar dates, cleanly and offline-safe. **No money logic in this build** — costs, the overage flag, and change-orders were split out to Build 2. Round 1 already cleared the big gaps; this round is a tighter re-check that those fixes actually took and that the trimmed plan still holds. Three reviewers: the job-status→crew-visibility sync, the database/migration changes, and the offline access rules + repo-pattern fit.

### Round
- Current round: 2
- Plan revision under audit: `9c4e23b`
- Findings trend: round 1 (6: 1H/5M) → round 2 (?) — NOT a plateau; scope SHRANK this round (overage cut to Build 2).

### Prior rounds
- Round 1: `1a7f2d0` · 1H/5M (6 findings) · pattern: `writer-coverage`

**Briefing for agents**: do NOT re-find round-1 issues. Round-1 fixes (commit `1a7f2d0`): A1 `job_wtcs` date NOT-NULL drop, A2 `parseFloat` coercion guard for `date`, A3 stage-sync `updateJobStatus()` chokepoint superseding fix-A, B1 JobDetail→`loadJobWithWTCs` + audit-logged `updateJobWtcFieldSow`, B2 F2/F3 merge spec + dropped unsynced fallback + local-`id` read. The overage/cost material (round-1 B3) was **CUT to Build 2** (commit `9c4e23b`, see `docs/plans/build2_costs_overages_change_orders.md`) — **do NOT audit it here.** Attack ONLY material new to `9c4e23b` + REGRESSION-check that the round-1 fixes actually landed.

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant onboarding not shipped (blocked, sales-command F7).
- **Prod / staging / dev**: Sales + Schedule live; Field early/limited offline. The `job_wtcs` read side is merged-but-**dormant** (no writer) — the write path is net-new.
- **Blocking feature flags**: none; multi-tenant blocked.
- **Concurrency profile**: ≤5 — office on web + crew on per-device offline phones.

Severity caps: cross-tenant → **Med**; race → **Low** (≤5 / offline-per-device); theoretical multi-tenant → **Low**. **This build has NO money write path** (overage deferred to Build 2) — it is a data-pipeline + offline-sync change only.

### Time budget + finding cap
- **Time budget**: not ERD-locked (focused plan audit).
- **Finding cap**: **6** (top-6 caused-by; remainder quarantined).

### Surface
- Total lines: 434
- Sections: 12
- [LOCKED] decisions: 29 tags · [AMENDMENT]: 3 (stage-sync fix-A superseded)
- [DESIGN-OPEN] items: 0 (comparand open moved to the Build-2 seed)
- [OPEN]/[BLOCKED]: R6 ledger BLOCKED-until-repaired
- Plan-to-code ratio: ~434 plan : est ~300–450 code across 3 repos ≈ ~1:1 (healthy)

### Layers touched
- UI / components (WTC date picker, `FieldSowBuilder` day render, JobDetail, Field `TasksTab`)
- Data layer (`queries.js` loaders/writers, `ProposalDetail` send path)
- State model (new column + per-day `date` inside `field_sow` JSONB)
- Migrations / schema (`proposal_wtc.dates_tbd`, `job_wtcs` start/end NOT-NULL drop) — overage migrations removed
- RLS / multi-tenancy (`job_wtcs` RLS vs PowerSync sync role) — `job_overages` RLS removed
- Real-time / sync (PowerSync: add `job_wtcs` to Field sync; the `call_log.stage` sync filter)
- Cross-repo (sales writer · schedule calendar owner · field reader, one shared DB)

### New mechanisms introduced
- New column: `proposal_wtc.dates_tbd` (bool); per-day `field_sow[*].date` (JSONB field)
- New write path: Sales writes canonical `job_wtcs` at Send-to-Schedule (the dormant read side's missing writer)
- New helpers: `updateJobStatus()` stage-sync chokepoint (+ `STATUS_TO_STAGE` map + coupled PowerSync filter edit); `updateJobWtcFieldSow()` audit-logged writer
- Durable `crypto.randomUUID()` day/task IDs
- New migration: drop NOT NULL on `job_wtcs.start_date`/`end_date`
- New sync rule: `job_wtcs` added to PowerSync Field buckets
- _(REMOVED this round → Build 2: `jobs.has_overage`, `job_overages` table + RLS, overage trip logic.)_

### Cross-system reach
- 3 repos on one shared Supabase DB (`pbgvgjjuhnpsumnowuym`): sales-command, sch-command, field-command
- PowerSync (offline sync to Field; the sync role is a bypass-RLS read path)
- Migration ledger cross-repo coordinated (O7 unresolved; `db push` broken here)

### Irreversibility
- Migrations: additive `dates_tbd` + a **NOT-NULL DROP** on `job_wtcs.start_date`/`end_date` — cross-repo ledger-coordinated, dashboard-applied + repair (RESUME ALERT)
- No backfill (fallback only); no destructive change; no public-API change

### Known weak points
- **R1/SCH3 stage-sync (High):** the A3 amendment routes all `jobs.status` writes through `updateJobStatus()` + edits the PowerSync filter. VERIFY the writer set is complete (`JobCardList:102`, `StageJobCard:403/411`; confirm `App.jsx:160` is correctly EXCLUDED as a no-`call_log_id` standalone insert) and On-Hold's stage target stays in-filter. One bypassing writer → job drops from the crew mid-life.
- **R7 PowerSync auth vs `job_wtcs` RLS (Med):** if the sync role doesn't satisfy `jobs→call_log.tenant_id`, `job_wtcs` syncs empty and Field shows nothing.
- **S3 re-send idempotency:** writing `job_wtcs` must upsert-or-skip on `proposal_wtc_id` UNIQUE (mirror `23505` handling) or a re-send errors/dupes.
- **Dormant-read-side premise:** "nobody writes `job_wtcs`." If a writer exists, S3 is partly redundant.
- **JSONB coercion (regression-check A2):** `field_sow[*].date` must survive the `['day_label','date'].includes(key)` guard in BOTH `WTCCalculator.jsx` and `FieldSowBuilder.jsx`.
- **NOT-NULL drop + empty write (regression-check A1):** S3 must write `field_sow: []` (never `undefined`) and null start/end on TBD.
- **Field local-`id` read (regression-check B2):** F2 must join on local `id` (sync aliases `job_id AS id`), not `job_id`.
- **Framework fit:** new writes route through `queries.js` audit-logged helpers, not raw `.update()`; `Jobs.jsx` realtime doesn't subscribe to `job_wtcs`.
- **R6 ledger drift (Med, BLOCKED):** new migrations dashboard-applied + repaired; clear RESUME ALERT first.

### Open questions
- Count: 0 design-open. Round 2 is regression-check + new-material on the trimmed plan.
- Highest-pressure: the A3 stage-sync amendment (writer-set completeness) and PowerSync `job_wtcs` RLS.

### Suggested attack angles (3 total)
1. **Stage-sync amendment + user-path** (REGRESSION-focus) — covers Data layer, sync, write paths. Reading: sch-command `queries.js` (`updateJobStatus`/`STATUS_TO_STAGE`), `JobCardList`, `StageJobCard`, `App.jsx`, `powersync-sync-rules.yaml`. Pressure: is the `jobs.status` writer set complete + correctly scoped? Does On-Hold stay in the sync filter? Did fix-A's supersession (A3) fully land, or is a writer still bypassing the chokepoint? Trace author→send→Schedule status change→Field visibility.
2. **Cross-app data model / migration** — covers Migrations, State model, schema. Reading: `20260512120100_job_wtcs_create.sql`, the `dates_tbd` + NOT-NULL-drop specs, `ProposalDetail` send, sch-command CLAUDE.md RESUME ALERT. Pressure: NOT-NULL-drop coherence + empty-`field_sow` write; re-send idempotency (upsert on `proposal_wtc_id`); `field_sow[*].date` coercion landed in both files; model (a) holds; ledger-drift deploy abort.
3. **RLS / PowerSync sync + framework-fit** — covers RLS, sync, data layer, audit logging. Reading: `powersync-sync-rules.yaml`, field-command `schema.js`/`connector.js`/`TasksTab.js`, `job_wtcs` RLS, sch-command `queries.js`. Pressure: does the sync role satisfy `job_wtcs` RLS (else Field empty)? Field local-`id` read (B2 regression); F2/F3 merge-spec correctness; new writes through audit-logged helpers; `Jobs.jsx` realtime coverage of `job_wtcs`.

### Suggested agent count: 3

Rationale: round 2 on a SHRUNK surface (overage cut) — round 1 cleared the broad gaps, so this is a tighter regression + new-material pass; the money/overage angle is gone. Bump to 4 only to split framework-fit from RLS/sync.

---

### Load-bearing claims to verify (pressure points for agents)

_Each is a riskiest assumption to verify, with a file pointer. Round 2: refreshed; the overage claim moved to Build 2._

1. **"The `job_wtcs` read side is live but dormant (nobody writes it)."** Verify `grep -rn job_wtcs sales-command/src` → 0 writers; `queries.js` + `ScheduledCardList.jsx:48-50` are the only consumers; `_wtcs` is `[]` in prod. **[Pointer: ProposalDetail.jsx:513-621; queries.js:110-146]**
2. **"Per-day dates fit inside `field_sow` JSONB, and the A2 coercion guard landed in BOTH files."** Verify `field_sow[*].date` survives `['day_label','date'].includes(key) ? val : parseFloat(val)||0` at `WTCCalculator.jsx:864` AND `FieldSowBuilder.jsx:37`. **[Pointer: WTCCalculator.jsx:861-868; FieldSowBuilder.jsx:36-37]**
3. **"The stage-sync writer set is complete (A3 amendment)."** Verify every `jobs.status` write routes through `updateJobStatus()`: `JobCardList:102`, `StageJobCard:403/411`; confirm `App.jsx:160` is correctly EXCLUDED (standalone insert, no `call_log_id`). Confirm the coupled `powersync-sync-rules.yaml` stage-filter edit + On-Hold in-filter target. **[Pointer: queries.js; JobCardList.jsx; StageJobCard.jsx:403,411; App.jsx:160; powersync-sync-rules.yaml]**
4. **[LOCKED — model (a)]** One `jobs` row per proposal + N `job_wtcs` children; `idx_jobs_source_proposal_id` stays. Verify no path inserts >1 `jobs` row per proposal. **[Pointer: §6.4; ProposalDetail.jsx:580]**
5. **"`dates_tbd` explicit column; NOT-NULL dropped on `job_wtcs` dates; S3 writes `field_sow: []` not `undefined`."** Verify the migration + write discipline (TBD → null start/end; empty SOW → `[]`). **[Pointer: §6.2, §6.6, §S3; WTCCalculator.jsx:373-388]**
6. **"Field's PowerSync auth satisfies `job_wtcs` RLS, and Field reads on local `id`."** Verify the sync role returns `job_wtcs` rows under `jobs→call_log.tenant_id`; verify F2 joins on local `id` (sync aliases `job_id AS id`), not `job_id`. **[Pointer: 20260512120100_job_wtcs_create.sql RLS; field-command schema.js, TasksTab.js, connector.js]**
7. **"Migrations dashboard-applied + repaired; `db push` unavailable; three migrations need pre-repair."** Verify the RESUME ALERT ledger state before authoring any new timestamp. **[Pointer: sch-command/CLAUDE.md RESUME ALERT + Pushing Migrations]**

---

## §12 Out of scope (explicit)

- **Costs, overage stamp/capture, and the change-order workflow → Build 2** (`docs/plans/build2_costs_overages_change_orders.md`). Scope-cut from this vertical 2026-06-12; the SOW pipeline (dates, canonical `job_wtcs` write, Field read) ships alone.
- The **change-order workflow** that consumes overage stamps (re-pricing, CO proposal, customer approval). _(Deferred to Build 2 along with the overage tag + capture it consumes.)_ **[LOCKED L5]**
- A **cross-app shared SOW editor** / "edit routes home from Schedule." Nothing edits the proposal post-sale. **[LOCKED L6]**
- **Per-crew sync filtering** in Field (the `job_crew`-scoped buckets TODO in the sync rules) — orthogonal to this vertical.
- Running any migration, pushing, or deploying — this is a planning doc only.
- **Deferred (round-1 audit): O1–O6, ADJ1–ADJ4 — out of this revision's scope.** The round-1 audit raised additional observations (O1–O6) and adjacent items (ADJ1–ADJ4) that this revision pass (the 6 caused-by findings A1/A2/A3/B1/B2/B3) did **not** address. They remain noted by the audit for a future pass; their content is not reproduced or resolved here.
