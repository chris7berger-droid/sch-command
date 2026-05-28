# Staged / Ready Tile Split + Per-Job Card Redesign

_Draft v0.1, 2026-05-27. Owner: Chris + plan author. Source: ERD Loop #27 (`sch-command-ideation`). Scope: `/jobs` landing page tile split + the per-stage list card template across all stages. Status: DRAFT — pending audit, then commit on `feat/staged-ready-cards`._

Tags: **[LOCKED]** (decided in ERD loop conversation) · **[DERIVED]** (from current code) · **[OPEN]** (open question — needs decision before build) · **[DESIGN-OPEN]** (subsystem deferred to a separate loop).

Related: builds on the IA settled in `jobs_landing_sections_redesign.md` (Loop #26). This loop further splits the Section 1 "Ready" tile into **Staged + Ready** and redesigns the per-job card template that renders inside every stage list.

---

## §1 Problem statement

**[LOCKED]** Today's `Ready` tile (Loop #26 redesign) is a single bucket that holds every job with `getJobStatus === 'Scheduled'`. In practice this bucket does two different jobs at once:

1. **Fresh arrivals from Sales Command** — `jobs.status='Parked'` (normalizes to `'Scheduled'` per `src/lib/jobStatus.js:11`) written by the send-to-schedule handler. These have no Field SOW, no crew assignment, often no date set, and incomplete materials. The office still has prep work to do.
2. **Fully-prepped jobs waiting to kick off** — SOW built, crew assigned, materials handled, date locked. The crew could roll trucks tomorrow.

The Ready tile's copy ("Date set, materials decided. Awaiting crew assignment + kickoff." — `src/components/JobsPicker.jsx:79`) describes #2 but the filter (`Jobs.jsx:369` — `getJobStatus(j) === 'Scheduled'`) catches both. Result: the office can't scan the tile to know if it represents "work to do to get jobs ready" or "jobs ready to start."

This loop:
- Splits the Section 1 `Ready` tile into **Staged** (prep work outstanding) + **Ready** (all prep complete, awaiting kickoff)
- Moves the existing `Production Complete` tile from Section 1 → Section 2 (Job Management Stages)
- Redesigns the per-job card that renders inside every stage list, replacing the existing `Job Planning` / `Job Management` button row with a unified scorecard-based card template

The cross-app entry contract (`CLAUDE.md`: "Sales Command: Approve proposal → Send to Schedule (inserts jobs row, status='Parked')") is unchanged. Field SOW and crew are not required at entry — by design, sch-command is where that prep work happens. The split simply makes that prep work visible.

---

## §2 Tile split — Staged vs Ready

### §2.1 Landing page changes [LOCKED]

Section 1 (Job Crew & Schedule Stages) tile order becomes:
```
Staged · Ready · Active · On Hold · All Jobs · Live Schedule
```

Section 2 (Job Management Stages) gains **Production Complete** (moved from Section 1):
```
Ready to Bill · Production Complete · Budget · Production Rate Trackers · Daily Logs
```

### §2.2 Promotion criteria — `isReady` checklist [LOCKED]

A job is **Ready** when ALL of the following are true; otherwise **Staged**:

```js
isReady =
     job.ready_confirmed_at != null              // office clicked [ Promote to Ready ] (see §3.12)
  && job.field_sow != null                       // Field SOW exists
  && (job.scheduled_start || job.start_date) != null  // date is set
  && jobCrewRows.length >= 1                     // at least one job_crew row
  && (
       materialRows.length === 0                 // no materials needed (default)
       || materialRows.every(m => m.status === 'Ordered' || m.status === 'In Stock')
     )                                           // OR all materials handled
```

Note the column gate (`ready_confirmed_at != null`) is part of the predicate alongside the four base items. This is what reconciles the manual-promotion decision (§3.9) with the read-time derivation (§2.3) — see §3.12 for the column spec and clearing rules.

**Materials "decided" signal** = no rows in `Not Ordered` or `Delayed`. Source: `src/views/Materials.jsx:33` STATUS_OPTIONS = `['Not Ordered', 'Ordered', 'In Stock', 'Delayed']`.

**`matCount === 0` default** = "no materials needed" treated as decided. Labor-only jobs don't get stuck in Staged. Tradeoff acknowledged: can't distinguish "intentionally no materials" from "forgot to upload SOW." A future `jobs.no_materials_needed` boolean could disambiguate; deferred until it causes real confusion.

### §2.3 Underlying status column unchanged [LOCKED]

Both Staged and Ready sit on top of `jobs.status='Scheduled'` (and legacy `'Parked'` which normalizes per `jobStatus.js:11`). **No new status value.** Staged/Ready is a derived bucketing computed at read time from the four base checklist items + the `ready_confirmed_at` gate (§2.2).

One additive column ships with this loop — `jobs.ready_confirmed_at` (§3.12) — to persist the office's [ Promote to Ready ] click. A second additive column — `jobs.hold_reason` (§3.11) — ships for On Hold banner text. No changes to the `status` enum, no destructive migrations.

### §2.4 Tile counts [DERIVED]

Compute in `JobsPicker.jsx` alongside the existing `counts.scheduled`:

```js
const stagedCount  = jobs.filter(j => getJobStatus(j) === 'Scheduled' && !isReady(j, jobCrew, materials)).length
const readyCount   = jobs.filter(j => getJobStatus(j) === 'Scheduled' &&  isReady(j, jobCrew, materials)).length
// stagedCount + readyCount === existing counts.scheduled (invariant)
```

`JobsPicker` needs to load `job_crew` and `materials` to compute `isReady`. Today it only loads `jobs`, `assignments`, `billingLog`. Add two queries.

**Pagination required for both new loads.** PostgREST caps at 1000 rows (per [[supabase-row-limit]] memory and `CLAUDE.md`). Implement via `.range()` in a paginating helper that auto-orders, doesn't throw, and signals partial loads:

**Loader signature corrected** (round-3 D2 + round-4 F2): the previous round-3 fix over-corrected by rebuilding the entire builder (filter + order) per page. The actual fix needed is just to call `.range()` on a fresh chain per page — `.select()`, `.order()`, and filter chains are idempotent in `@supabase/postgrest-js` v2 and can be reused across iterations. `.range()` mutates internal request state and must be the last call.

```js
// in src/lib/queries.js
export async function loadAllRows(tableName, selectStr, {
  orderBy,                        // REQUIRED — caller must specify; no default
  orderAsc = true,
  filterFn,                       // optional: (builder) => builder for .eq / .in / .gt / etc.
} = {}) {
  if (!orderBy) throw new Error(`loadAllRows(${tableName}): orderBy is required`)
  const PAGE = 1000
  const all = []
  // Build the filter+order chain once; rebuild only the .range() per page.
  // Round-4 F2: snapshotting outside the loop avoids reapplying filterFn
  // (which could carry side effects in callers).
  let chain = supabase.from(tableName).select(selectStr)
  if (filterFn) chain = filterFn(chain)
  chain = chain.order(orderBy, { ascending: orderAsc })

  for (let from = 0; ; from += PAGE) {
    // VERIFY against @supabase/postgrest-js v2: if reused-chain .range()
    // turns out to repeat the first page (round-3 D2's concern), revert
    // to per-page rebuild. Add a dev-only assertion on chunk 2 that
    // first row's PK differs from chunk 1's first row.
    const { data, error } = await chain.range(from, from + PAGE - 1)
    if (error) return { data: all, error, partial: true }
    all.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return { data: all, error: null, partial: false }
}
// usage — every call MUST pass an explicit orderBy (round-3 D4):
const { data: jobCrew, error: e1, partial: p1 } =
  await loadAllRows('job_crew', 'id, job_id, team_member_id', { orderBy: 'id' })
const { data: materials, error: e2, partial: p2 } =
  await loadAllRows('materials', 'id, job_id, status', { orderBy: 'id' })
if (e1 || e2) showSyncWarning('Counts may be stale — partial data loaded')
```

`job_crew.team_member_id` (NOT `crew_id`) is the actual column, verified at `src/views/JobDetail.jsx:96` (`select('id, team_member_id, role, team_members(name)')`).

**Caller contract**: `JobsPicker` and `Jobs.jsx` render last-known counts on partial-load and surface a small sync-warning chip near the tile section title. Prevents a brief network hiccup from blanking the dashboard.

**No `orderBy` default.** Tables without a stable `id` column (composite-PK tables like `assignments`) must order on whatever stable tuple they have. Forcing the caller to specify prevents silent-skip-and-double-count bugs.

**isReady performance — pre-index child rows.** Calling `isReady(job, jobCrew, materials)` naively re-scans the full child arrays per job → O(jobs × (crew + materials)). On a 600-job board with 200 crew rows and 500 materials rows that's 420k ops per render. Pre-index once per `loadData`:

```js
const jobCrewByCallLog = jobCrew.reduce((m, r) => {
  (m[r.job_id] ||= []).push(r); return m         // job_crew.job_id is call_log.id
}, {})
const materialsByJobId = materials.reduce((m, r) => {
  (m[r.job_id] ||= []).push(r); return m
}, {})
function isReady(job) {
  const crew = jobCrewByCallLog[job.call_log_id] || []
  const mats = materialsByJobId[job.job_id]      || []
  return baseChecklistPasses(job, crew, mats) && job.ready_confirmed_at != null
}
```

Reduces per-job lookup to O(1).

**Realtime debounce + stale-bail (round-4 F3) — required.** Per §9, `JobsPicker`'s realtime channels (`jobs`, `job_crew`, `materials`) all invoke `loadData()` on any change. A CSV import of 500 materials would fire 500 channel events in rapid succession; without debouncing, the browser tab freezes. The debounce alone isn't enough — concurrent in-flight loadData calls race their `setState`s and the pre-indexed Maps end up half-rebuilt. Add request-id pattern to cancel stale loads:

```js
import { useMemo, useRef, useCallback } from 'react'

// Debounce helper — no lib dependency.
function useDebounced(fn, ms) {
  return useMemo(() => {
    let t
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms) }
  }, [fn, ms])
}

// Inside JobsPicker / Jobs.jsx
const reqIdRef = useRef(0)
const loadData = useCallback(async () => {
  const reqId = ++reqIdRef.current
  const [jobsRes, jobCrewRes, materialsRes, ...] = await Promise.all([...])
  if (reqId !== reqIdRef.current) return     // a newer load started; bail
  setJobs(jobsRes.data || [])
  setJobCrew(jobCrewRes.data || [])
  setMaterials(materialsRes.data || [])
  // …rebuild pre-indexed Maps from the fresh data
}, [])
const debouncedLoad = useDebounced(loadData, 300)
// then in each channel:
.on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, debouncedLoad)
```

300ms is the lower bound that absorbs a CSV burst without making single-row edits feel laggy. Request-id pattern ensures that even if two loadData calls overlap (e.g., one fired by debounce, one by initial mount, one by a route change), only the latest writes state.

**Existing loads — known divergence at >1000 rows** (round-4 F5): the existing three loads in `Jobs.jsx:149-157` (`assignments`, `billing_log`, `team_members`) and `JobsPicker`'s `jobs` load all use raw `.select('*')` without `.range()`. They are unpaginated today and would silently truncate at 1000 rows. **Without paginating them in this loop, Staged/Ready tile counts can diverge from per-card display** once any of those tables exceeds 1000 rows: tile counts use the same loadData (capped at 1000), but per-card iteration walks `filteredJobs` which is also capped — so the divergence is consistent in the truncated view, but real prod state above the cap is invisible to both. Documented contract: **tile counts are accurate for the first 1000 jobs only**; backlog item `T2 — paginate sch-command load paths` must ship before HDSP exceeds that threshold. (Today's HDSP volume is well under 1000.) Backlog item also in §10 Q7.

### §2.5 Staged tile sub-line copy [LOCKED]

Variant C — icon-coded counts matching the per-card banner format:

```
📋 3 · 📦 3 · 👷 4 · 📅 2
```

Where each count = number of Staged jobs missing that checklist item. Icons map 1:1 to the PLANNING scorecards on the per-job card, so the user learns one icon set.

### §2.6 Staged tile description [LOCKED]

```
Just arrived from Sales. Build Field SOW, assign crew, decide materials.
```

### §2.7 Ready tile copy [LOCKED]

Description updates to reflect stricter filter:
```
All prep complete. Awaiting kickoff.
```

Sub-line keeps existing logic (`startingThisWeek` or `multiWeekAlertCount`) — unchanged from current `JobsPicker.jsx:80-86`.

---

## §3 Per-job card template — Option D, three-panel collapse

### §3.1 Structure [LOCKED]

Card has three persistent regions and three collapsible panels:

```
┌─ banner row (status + missing icons + countdown)
├─ identity row (Job · Customer · Work Types — three equal bubbles)
├─ panel toggles (PLANNING · MANAGEMENT · DETAILS — three buttons)
│   └─ PLANNING panel    (collapsed by default)
│   └─ MANAGEMENT panel  (collapsed by default)
│   └─ DETAILS panel     (collapsed by default)
└─ stage action button (always visible at bottom — varies by stage)
```

Default state: all three panels collapsed. User clicks any panel toggle to open it. **Panels are independent toggles**, not radios — multiple can be open simultaneously. Panels render in fixed order (Planning → Management → Details) regardless of click sequence.

### §3.2 Card height by panel state [DERIVED]

| Panels open | Approx. height |
|---|---|
| None | ~140px |
| One | ~210px |
| Two | ~290px |
| All three | ~370px |

Office gets to choose density per card. Default-collapsed satisfies the "3 clicks through simple obvious screens beats 1 click on a complicated screen" principle (CLAUDE.md).

### §3.3 Banner row [LOCKED]

Format varies per stage. All banners are always-visible (no hover, no click required).

| Stage | Banner |
|---|---|
| Staged | `STAGED · missing 📋 + 👷 + 📦 + 📅` (only icons for actually-missing items) + right-aligned countdown if date set: `· kicks off in 12d` |
| Ready | `READY · kicks off in 3d` |
| Active | `ACTIVE · day 4 of 18 · on target` *(or `⚠ 2d behind`)* |
| On Hold | `ON HOLD · 14d · supplier delay` *(reason from `jobs.hold_reason`)* |
| Production Complete | `COMPLETE · finished 6d ago · ⚠ $156K unbilled` *(warning icon if billed < 100%)* |

Icon → checklist item map for the Staged banner:
- 📋 = Field SOW missing
- 📦 = Materials not decided (any row in `Not Ordered` or `Delayed`)
- 👷 = No `job_crew` rows
- 📅 = No `scheduled_start` or `start_date`

### §3.4 Identity row [LOCKED]

Three equal-width bubbles, always visible:

| Bubble | Source field |
|---|---|
| **JOB** | `jobs.job_num` + `jobs.job_name` |
| **CUSTOMER** | `call_log.customer_name` (joined) |
| **WORK TYPES** | `jobs.work_type` (single) OR aggregated WTC labels from `job_wtcs` (multi-GC) — see `jobCardLabel.js` |

Bubble visual: linen card background, dark border (`#1c1814`), `border-radius: 10px`, Barlow Condensed bold uppercase for the value. Per the design system in CLAUDE.md.

### §3.5 PLANNING panel — scorecards [LOCKED]

When open, shows five scorecards. Each scorecard is clickable (open target listed). Color state per scorecard's "satisfied/unsatisfied" semantics.

| Scorecard | Label | Value | Color state | Click target |
|---|---|---|---|---|
| 📋 SOW | SOW | ✓ or ✗ | green if `field_sow != null`, red otherwise | Field SOW modal (`FieldSowBuilder.jsx`) |
| 📦 MTRL | MTRL | ✓ or count of `Not Ordered + Delayed` rows | green if `matCount===0` or all `Ordered/In Stock`, red otherwise | Materials modal |
| 👷 CREW | CREW | `assigned / needed` *(e.g. `2/4`)* | green if `assigned >= 1`, red if `assigned === 0` | Crew assignment modal (`JobCrewScheduler.jsx`) |
| 📅 DAYS | DAYS | total work days *(see §4.1)* | neutral (informational) | per-job schedule modal (read-only date range) |
| 🚚 MOBS | MOBS | count of mobilizations *(see §6)* | neutral | **stub until §6 ships** — render as disabled / "Coming soon"; once `job_mobilizations` table exists, route to `/jobs/:jobId/mobilizations`. Mirrors the §7 FILES stub pattern |

### §3.6 MANAGEMENT panel — scorecards [LOCKED]

When open, shows six scorecards:

| Scorecard | Label | Value | Color state | Click target |
|---|---|---|---|---|
| 💵 PROP | PROP | `$284K` (from `jobs.amount`) | neutral | **no click** — passive readout |
| 📊 BILLED | BILLED | `45%` from `billing_log` sum | green if 100%, amber if partial, red if 0% and Complete | route `/billing` scrolled to this job |
| 📊 PRT | PRT | `on target` / `⚠ 2d behind` | green/amber per §3.10 threshold | Production tab content in modal |
| 📅 LOGS | LOGS | count of daily logs | neutral | Daily Log viewer modal |
| 📎 FILES | FILE | count of attachments | neutral | Attachments panel **[DESIGN-OPEN — see §7]** |
| 📝 NOTES | NOTE | char count or "—" | neutral | inline-expand on the card (in place, no navigation) |

### §3.7 DETAILS panel — text rows [LOCKED]

When open, shows three text rows:

| Row | Source | Format |
|---|---|---|
| CREW | `job_crew` joined to `crew.name` | `Troy · Marco · Diego` (middot-separated) |
| SOW | see below — aggregates across all `job_wtcs` rows | per-WTC sub-lines for multi-GC; single line for single-WTC / legacy |
| NOTES | `jobs.notes` | full text, no truncation |

**SOW aggregation rule — corrected to the actual daily shape.**

`field_sow` is a jsonb **array of per-day records**, not phase blocks. Each element is one day. Verified shape per `src/components/FieldSowBuilder.jsx:115-137`:

```js
{
  day_label:      string,    // e.g. 'Day 1' or 'Mon 6/3'
  crew_count:     number,
  hours_planned:  number,
  tasks:          [{ description, pct_complete }, ...],
  materials:      [{ material_id, name, qty_planned, ... }, ...]
}
```

Existing card pattern (`ScheduledCardList.jsx:56`) renders this as `${arr.length} days · ${crewSize}-man crew`. The card SOW row matches that pattern and adds day labels for context:

```js
function sowRowsForCard(job) {
  const wtcs = Array.isArray(job._wtcs) ? job._wtcs : []
  if (wtcs.length === 0) {
    // Legacy merged-row job (no job_wtcs children); fall back to parent
    const days = Array.isArray(job.field_sow) ? job.field_sow : []
    return days.length ? [{ label: null, days }] : []
  }
  return wtcs
    .slice()
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(w => ({ label: w.work_type_name, days: Array.isArray(w.field_sow) ? w.field_sow : [] }))
}

function formatDays(days) {
  if (days.length === 0) return '—'
  // First N day labels (truncate at 3) + total count
  const labels = days.slice(0, 3).map(d => d.day_label || '?')
  const more = days.length > 3 ? ` … (${days.length} days)` : ` (${days.length} day${days.length !== 1 ? 's' : ''})`
  return labels.join(' · ') + more
}
```

Render:
- Single-WTC / legacy:
  ```
  SOW   Day 1 · Day 2 · Day 3 (3 days)
  ```
- Multi-WTC:
  ```
  SOW   [Painting]    Day 1 · Day 2 (2 days)
        [Floor coat]  Day 1 · Day 2 · Day 3 … (5 days)
        [Touch-up]    Day 1 (1 day)
  ```

The previous draft's `phaseName (Nd)` format was based on an imagined phased shape that doesn't exist in the codebase. Drop it.

### §3.8 Panel toggle behavior [LOCKED]

- Each toggle button is independent (not a radio group)
- Click an open toggle → collapses it
- Click a closed toggle → opens it
- Panels stack in fixed Planning → Management → Details order regardless of click order
- Toggle state is **per-card** and **session-local** (no persistence across page reloads in v1; revisit if user testing surfaces a need)
- Toggled-open state is **NOT** reflected in URL — keeps URLs clean

### §3.9 Stage action button — always visible [LOCKED]

Rendered below the panels regardless of which panels are open. One button per stage:

| Stage | Button | Enabled when | Effect |
|---|---|---|---|
| Staged | `[ Promote to Ready ]` | all four base checklist items pass (§2.2) — else disabled/greyed | **Writes `now()` to `jobs.ready_confirmed_at`**. Card moves to Ready tile. Manual promotion chosen over auto so office has a beat to review before promoting. See §3.12 for column + clearing rules |
| Ready | `[ Kickoff ]` | always | Sets `jobs.status = 'In Progress'`. Card moves to Active tile |
| Active | *(no button)* | — | Promotion to Complete is driven by Field Command finishing the job |
| On Hold | `[ Resume ]` | always | Sets `jobs.status = 'Scheduled'` **AND** sets `ready_confirmed_at = NULL` in the same `updateJobFields` call. Card returns to Staged for re-confirmation, even if the four base items still pass. Rationale: time has passed; office should re-verify before promoting. **Audit deduplication (round-4 B3)**: the `updateJobFields` audit loop must EXCLUDE `ready_confirmed_at` from its per-field audit insert when bundled with a status change away from `'On Hold'` — the AFTER trigger (§3.12) writes a single `'on_hold_resume'` row, which is the canonical record. Without the exclusion, one Resume click produces 3 `job_changes` rows (status + ready_confirmed_at app-layer + trigger). Implement in `queries.js` as a per-call skip-list passed to the audit helper |
| Production Complete | `[ Send to Billing ]` | always | Hands off to billing pipeline. Existing flow — confirm exact behavior with existing `/billing` integration |

**No "Open Job" button.** Card header (Job # + name) is clickable to navigate to existing `/jobs/:jobId?mode=management` view, which now serves only as a deep-history/audit-log surface. The card itself replaces the previous Planning + Management button row.

### §3.10 PRT "behind target" rule [LOCKED]

Source: per-job PRT data. Today only the single-job loader `loadPRTsForJob()` exists in `src/lib/queries.js:187` — calling it once per visible Active card produces N+1 reads and will throttle on busy boards.

**Required: add `loadPRTsForCallLogIds(callLogIds[])` bulk loader.** Mirrors the single-job loader exactly (same SELECT, same order, same FK semantics) plus chunked `.in()` to stay under the PostgREST URL length cap, plus pagination per §2.4:

```js
// in src/lib/queries.js — mirrors loadPRTsForJob (queries.js:187)
export async function loadPRTsForCallLogIds(callLogIds) {
  if (!callLogIds || callLogIds.length === 0) {
    return { data: new Map(), error: null, partial: false }
  }
  const CHUNK = 100  // PostgREST URL cap — UNVERIFIED, see RPC fallback below
  const chunks = []
  for (let i = 0; i < callLogIds.length; i += CHUNK) {
    chunks.push(callLogIds.slice(i, i + CHUNK))
  }
  // Round-4 F1: Promise.allSettled, not Promise.all. Bail-on-first-error
  // discards every successful chunk; allSettled lets us return partial data
  // with a sync warning. Matches the loadAllRows {data, error, partial} contract.
  const settled = await Promise.allSettled(chunks.map(ids =>
    supabase
      .from('daily_production_reports')
      .select('id, job_id, wtc_id, report_date, submitted_by, tasks, materials_used, hours_regular, hours_ot, photos, notes, status, approved_by, approved_at, created_at, tenant_id, team_members:submitted_by(id, name)')
      .in('job_id', ids)
      .order('report_date', { ascending: false })
  ))
  const byCallLogId = new Map()
  let firstError = null
  let rejected = 0
  for (const r of settled) {
    if (r.status === 'fulfilled' && !r.value.error) {
      for (const row of (r.value.data || [])) {
        const arr = byCallLogId.get(row.job_id) || []
        arr.push(row)
        byCallLogId.set(row.job_id, arr)
      }
    } else {
      rejected++
      if (!firstError) firstError = r.status === 'fulfilled' ? r.value.error : r.reason
    }
  }
  // Round-4 F6: defensive re-sort. Per-chunk ordering is preserved by PostgREST,
  // but merge order across chunks is parallel-arrival-order, not report_date desc.
  // Cheap correctness insurance — at most ~N log N per parent on PRT-heavy jobs.
  for (const [k, arr] of byCallLogId) {
    arr.sort((a, b) => (b.report_date || '').localeCompare(a.report_date || ''))
    byCallLogId.set(k, arr)
  }
  return { data: byCallLogId, error: firstError, partial: rejected > 0 }
}
```

Use `job.call_log_id` as the lookup key (per `queries.js:184` comment: "daily_production_reports.job_id is FK to call_log.id, NOT jobs.job_id"). O(1) per-card lookup.

**Chunk-100 URL length cap is unverified (round-4 F4).** Two acceptable resolutions:
- **Measure once in dev**: `console.log(builder.url.toString().length)` on a real chunk-100 call against PRT data. PostgREST caps at ~8KB for some proxies, lower for others. 100 UUIDs at 36 chars + JSON formatting + base URL ≈ 4–5KB; should be safe but verify on actual deploy infrastructure.
- **Switch to RPC** (preferred long-term): define `prts_for_call_logs(ids uuid[]) RETURNS SETOF daily_production_reports` and call `supabase.rpc('prts_for_call_logs', { ids: [...] })`. POST body has no URL cap; eliminates chunking entirely. Worth the migration for any list view that might exceed 100 active jobs.

Defer the RPC migration to the implementation loop; ship chunk-100 + verification measurement for v1.

Threshold rule (3+ PRTs):
```
behind = sum(actual) < sum(target) by >10% across last 3 PRTs
```

Behavior by PRT count:

| PRT count | Banner |
|---|---|
| 0 | `ACTIVE · day N of M · no PRTs yet` (neutral) |
| 1 | `ACTIVE · day N of M · 1 PRT submitted` (neutral — insufficient data) |
| 2 | `ACTIVE · day N of M · ⚠ trending behind` *(if 2-PRT actual < 2-PRT target by >10%)* or `on track (2 PRTs)` |
| 3+ | apply documented `>10%` rule; show `on target` or `⚠ Nd behind` |

Threshold and window can be tuned post-launch.

### §3.11 `jobs.hold_reason` — new column [LOCKED]

```sql
ALTER TABLE jobs ADD COLUMN hold_reason text;
```

- Set when office flips `status` → `'On Hold'`. Free-text input on hold action.
- Cleared (set to NULL) when status flips back to non-`'On Hold'`.
- Surfaced in the On Hold stage banner: `ON HOLD · 14d · {hold_reason}`.

**`jobs.updated_at` trigger — must be added in this migration, not "verified."** Grep of `supabase/migrations/` for `updated_at.*trigger|set_updated_at|moddatetime|trigger.*updated` returned zero matches against `jobs`. The trigger does not exist today. Same gate applies to §3.12's `ready_confirmed_at`. Include in the same migration:

```sql
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

CREATE TRIGGER jobs_set_updated_at_trg
BEFORE UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
```

If `jobs.updated_at` column itself doesn't exist yet, also `ALTER TABLE public.jobs ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();` — check before drafting.

Migration ledger: new timestamp, coordinate per `o7_migration_coordination.md` cross-repo convention (see §6.4).

### §3.12 `jobs.ready_confirmed_at` — new column + hybrid enforcement [LOCKED]

Persists the office's [ Promote to Ready ] click so the Staged↔Ready bucketing reconciles read-time derivation (§2.3) with manual confirmation (§3.9).

```sql
ALTER TABLE jobs ADD COLUMN ready_confirmed_at timestamptz;
```

#### §3.12.1 Hybrid enforcement model [LOCKED]

**App layer SETS, DB trigger CLEARS.** The [ Promote to Ready ] button writes the timestamp via `updateJobField()` so audit logging captures actor + source (`job_changes` row with `field='ready_confirmed_at'`, `new_value=<now>`, `changed_by=<user>`, `source='manual_promotion'`). The trigger clears it on any base-checklist transition true→false, regardless of write origin (raw modal write, PowerSync sync from Field Command, sales-command cross-repo write, On-Hold→Resume cleanup, bulk migration, etc.).

This closes six attack vectors that app-layer-only would miss:
1. Raw writes from `FieldSowModal` / `Materials` views that bypass `updateJobField`
2. PowerSync `job_crew` writes originating in Field Command (the sch-command app never sees them)
3. Sales-command writes to `jobs.scheduled_start` / `jobs.field_sow` via cross-repo flows
4. On-Hold→Resume that lands a previously-promoted job back in the bucket without re-confirmation
5. Race window between mutation and the app-layer helper's read-then-write
6. Bulk paths (multi-row updates, migration scripts) where calling a per-row helper would explode into N round-trips

#### §3.12.2 DB trigger spec [LOCKED]

Five round-3 audit hardenings folded in: (C1) audit-log auto-demotes; (C2) gate the BEFORE trigger with `WHEN` so it never fires on a Promote SET; (E1) `SECURITY DEFINER` + locked `search_path` + explicit tenant filter on the checklist function; (E3) child-table triggers become `FOR EACH STATEMENT` with transition tables so a 500-row CSV import fires one re-eval per affected parent, not 500.

```sql
-- ── 1. Helper: returns true iff all four base checklist items pass.
-- SECURITY DEFINER so service-role / trigger contexts can read child tables
-- consistently, with an explicit tenant filter inside the body to prevent
-- cross-tenant comparison when called from a trigger fired by another tenant.
-- Locked search_path prevents shadowing attacks.
CREATE OR REPLACE FUNCTION public.job_base_checklist_passes(p_job public.jobs)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id     uuid;
  v_has_crew      boolean;
  v_has_materials boolean;
BEGIN
  IF p_job.field_sow IS NULL THEN RETURN false; END IF;
  IF COALESCE(p_job.scheduled_start, p_job.start_date) IS NULL THEN RETURN false; END IF;

  -- Resolve tenant via the call_log chain; abort if mismatched.
  SELECT cl.tenant_id INTO v_tenant_id
    FROM public.call_log cl
   WHERE cl.id = p_job.call_log_id;
  IF v_tenant_id IS NULL THEN RETURN false; END IF;  -- orphan job → never Ready

  SELECT EXISTS (
    SELECT 1 FROM public.job_crew jc
     JOIN public.call_log cl ON cl.id = jc.job_id     -- job_crew.job_id FKs to call_log.id
    WHERE jc.job_id = p_job.call_log_id
      AND cl.tenant_id = v_tenant_id
  ) INTO v_has_crew;
  IF NOT v_has_crew THEN RETURN false; END IF;

  -- Materials decided = no rows OR no rows in ('Not Ordered', 'Delayed').
  -- Filter materials by jobs.tenant via the parent join.
  SELECT NOT EXISTS (
    SELECT 1 FROM public.materials m
     JOIN public.jobs j ON j.job_id = m.job_id
     JOIN public.call_log cl ON cl.id = j.call_log_id
    WHERE m.job_id = p_job.job_id
      AND cl.tenant_id = v_tenant_id
      AND m.status IN ('Not Ordered', 'Delayed')
  ) INTO v_has_materials;
  RETURN v_has_materials;
END;
$$;

-- ── 2. BEFORE UPDATE trigger on jobs: clear ready_confirmed_at if checklist
-- now fails. Gated by WHEN so it ONLY fires when the column itself is NOT
-- being touched by the UPDATE statement (round-4 B1 hardening). Without
-- the IS NOT DISTINCT FROM clause, a re-Promote-with-same-value or
-- concurrent SET race could self-null. The flag set via SET LOCAL gives
-- the AFTER trigger (§3.12.2 step 3) a way to distinguish auto-demote
-- from manual_clear (round-4 B2).
CREATE OR REPLACE FUNCTION public.jobs_clear_ready_confirmed_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.job_base_checklist_passes(NEW) THEN
    -- Flag the auto-demote for the AFTER trigger (round-4 B2).
    -- SET LOCAL is transaction-scoped; auto-clears at commit/rollback.
    PERFORM set_config('my.auto_demote', 'true', true);
    NEW.ready_confirmed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER jobs_clear_ready_confirmed_at_trg
BEFORE UPDATE ON public.jobs
FOR EACH ROW
WHEN (
  OLD.ready_confirmed_at IS NOT NULL
  AND NEW.ready_confirmed_at IS NOT NULL
  AND NEW.ready_confirmed_at IS NOT DISTINCT FROM OLD.ready_confirmed_at   -- round-4 B1
)
EXECUTE FUNCTION public.jobs_clear_ready_confirmed_at();

-- ── 3. AFTER UPDATE audit trigger on jobs: log every ready_confirmed_at
-- transition. Sources distinguished (round-4 B2 + D2):
--   'trigger_set'           — service-role direct SET (no app-layer audit)
--   'trigger_auto_demote'   — BEFORE clear trigger fired (flag set via SET LOCAL)
--   'on_hold_resume'        — bundled status change from 'On Hold'
--   'manual_clear'          — explicit NULL write w/o status change or auto-flag
-- Actor role recorded alongside sub (round-4 D1) so JWT-forwarding edge fns
-- and service-role writes are auditable separately.
CREATE OR REPLACE FUNCTION public.jobs_log_ready_demote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor       uuid;
  v_actor_role  text;
  v_source      text;
  v_auto_demote boolean;
BEGIN
  -- Actor sub + role from JWT claims; both can be NULL for service-role.
  BEGIN
    v_actor      := (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid;
    v_actor_role := current_setting('request.jwt.claims', true)::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_actor      := NULL;
    v_actor_role := NULL;
  END;

  -- Read the BEFORE-trigger auto-demote flag (round-4 B2). Missing = false.
  BEGIN
    v_auto_demote := current_setting('my.auto_demote', true)::boolean;
  EXCEPTION WHEN OTHERS THEN
    v_auto_demote := false;
  END;

  -- Transition: non-NULL → NULL (demote path)
  IF NEW.ready_confirmed_at IS NULL
     AND OLD.ready_confirmed_at IS NOT NULL THEN
    v_source := CASE
      WHEN v_auto_demote THEN 'trigger_auto_demote'
      WHEN NEW.status <> OLD.status AND OLD.status = 'On Hold' THEN 'on_hold_resume'
      ELSE 'manual_clear'
    END;
    INSERT INTO public.job_changes (job_id, call_log_id, field, old_value, new_value, changed_by, source)
    VALUES (
      NEW.job_id,
      NEW.call_log_id,
      'ready_confirmed_at',
      OLD.ready_confirmed_at::text,
      NULL,
      COALESCE(v_actor::text, 'system'),
      v_source || ':' || COALESCE(v_actor_role, 'service_role')   -- round-4 D1: encode role in source
    );

  -- Transition: NULL → non-NULL (SET path — round-4 D2)
  -- App-layer Promote also writes its own job_changes row via updateJobField.
  -- This trigger row is bypass-proof: a direct service-role SET still gets
  -- audit-logged here even when the app-layer write doesn't fire.
  ELSIF NEW.ready_confirmed_at IS NOT NULL
        AND OLD.ready_confirmed_at IS NULL THEN
    INSERT INTO public.job_changes (job_id, call_log_id, field, old_value, new_value, changed_by, source)
    VALUES (
      NEW.job_id,
      NEW.call_log_id,
      'ready_confirmed_at',
      NULL,
      NEW.ready_confirmed_at::text,
      COALESCE(v_actor::text, 'system'),
      'trigger_set:' || COALESCE(v_actor_role, 'service_role')
    );
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER jobs_log_ready_demote_trg
AFTER UPDATE OF ready_confirmed_at ON public.jobs
FOR EACH ROW
WHEN (OLD.ready_confirmed_at IS DISTINCT FROM NEW.ready_confirmed_at)
EXECUTE FUNCTION public.jobs_log_ready_demote();

-- ── 4. Child-table triggers: FOR EACH STATEMENT with transition tables.
-- One re-eval per affected parent per statement, regardless of row count.
-- A 500-material CSV import fires N parent re-evals where N = DISTINCT job_id
-- in the import, not 500.
--
-- Round-4 C1: transition tables are only available for the matching event.
-- A DELETE-statement trigger can't reference new_rows; an INSERT-statement
-- trigger can't reference old_rows. Body must branch on TG_OP.
--
-- Round-4 C2: tenant scoping — if called from an authenticated session,
-- only affect parents in the caller's tenant. Service-role path is the
-- escape hatch (PowerSync, sales-command edge fns) and logs source so
-- audit can filter.
CREATE OR REPLACE FUNCTION public.job_crew_recheck_parents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_tenant uuid;
BEGIN
  v_caller_tenant := public.get_user_tenant_id();   -- NULL for service-role

  IF TG_OP = 'INSERT' THEN
    WITH affected AS (
      SELECT DISTINCT job_id AS call_log_id FROM new_rows
    ),
    parents AS (
      SELECT j.* FROM public.jobs j
       JOIN affected a ON a.call_log_id = j.call_log_id
       JOIN public.call_log cl ON cl.id = j.call_log_id
      WHERE j.ready_confirmed_at IS NOT NULL
        AND (v_caller_tenant IS NULL OR cl.tenant_id = v_caller_tenant)
    )
    UPDATE public.jobs j
       SET ready_confirmed_at = NULL
      FROM parents p
     WHERE j.job_id = p.job_id
       AND NOT public.job_base_checklist_passes(p);

  ELSIF TG_OP = 'DELETE' THEN
    WITH affected AS (
      SELECT DISTINCT job_id AS call_log_id FROM old_rows
    ),
    parents AS (
      SELECT j.* FROM public.jobs j
       JOIN affected a ON a.call_log_id = j.call_log_id
       JOIN public.call_log cl ON cl.id = j.call_log_id
      WHERE j.ready_confirmed_at IS NOT NULL
        AND (v_caller_tenant IS NULL OR cl.tenant_id = v_caller_tenant)
    )
    UPDATE public.jobs j
       SET ready_confirmed_at = NULL
      FROM parents p
     WHERE j.job_id = p.job_id
       AND NOT public.job_base_checklist_passes(p);

  ELSE   -- UPDATE: both tables available
    WITH affected AS (
      SELECT DISTINCT job_id AS call_log_id FROM new_rows
      UNION
      SELECT DISTINCT job_id AS call_log_id FROM old_rows
    ),
    parents AS (
      SELECT j.* FROM public.jobs j
       JOIN affected a ON a.call_log_id = j.call_log_id
       JOIN public.call_log cl ON cl.id = j.call_log_id
      WHERE j.ready_confirmed_at IS NOT NULL
        AND (v_caller_tenant IS NULL OR cl.tenant_id = v_caller_tenant)
    )
    UPDATE public.jobs j
       SET ready_confirmed_at = NULL
      FROM parents p
     WHERE j.job_id = p.job_id
       AND NOT public.job_base_checklist_passes(p);
  END IF;
  RETURN NULL;
END;
$$;

-- Three triggers — one per event, each with the matching transition table.
CREATE TRIGGER job_crew_recheck_ready_insert_trg
AFTER INSERT ON public.job_crew
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.job_crew_recheck_parents();

CREATE TRIGGER job_crew_recheck_ready_update_trg
AFTER UPDATE ON public.job_crew
REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.job_crew_recheck_parents();

CREATE TRIGGER job_crew_recheck_ready_delete_trg
AFTER DELETE ON public.job_crew
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.job_crew_recheck_parents();

CREATE OR REPLACE FUNCTION public.materials_recheck_parents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_tenant uuid;
BEGIN
  v_caller_tenant := public.get_user_tenant_id();   -- NULL for service-role

  IF TG_OP = 'INSERT' THEN
    WITH affected AS (SELECT DISTINCT job_id FROM new_rows),
    parents AS (
      SELECT j.* FROM public.jobs j
       JOIN affected a ON a.job_id = j.job_id
       JOIN public.call_log cl ON cl.id = j.call_log_id
      WHERE j.ready_confirmed_at IS NOT NULL
        AND (v_caller_tenant IS NULL OR cl.tenant_id = v_caller_tenant)
    )
    UPDATE public.jobs j SET ready_confirmed_at = NULL
      FROM parents p
     WHERE j.job_id = p.job_id AND NOT public.job_base_checklist_passes(p);

  ELSIF TG_OP = 'DELETE' THEN
    WITH affected AS (SELECT DISTINCT job_id FROM old_rows),
    parents AS (
      SELECT j.* FROM public.jobs j
       JOIN affected a ON a.job_id = j.job_id
       JOIN public.call_log cl ON cl.id = j.call_log_id
      WHERE j.ready_confirmed_at IS NOT NULL
        AND (v_caller_tenant IS NULL OR cl.tenant_id = v_caller_tenant)
    )
    UPDATE public.jobs j SET ready_confirmed_at = NULL
      FROM parents p
     WHERE j.job_id = p.job_id AND NOT public.job_base_checklist_passes(p);

  ELSE   -- UPDATE
    WITH affected AS (
      SELECT DISTINCT job_id FROM new_rows
      UNION
      SELECT DISTINCT job_id FROM old_rows
    ),
    parents AS (
      SELECT j.* FROM public.jobs j
       JOIN affected a ON a.job_id = j.job_id
       JOIN public.call_log cl ON cl.id = j.call_log_id
      WHERE j.ready_confirmed_at IS NOT NULL
        AND (v_caller_tenant IS NULL OR cl.tenant_id = v_caller_tenant)
    )
    UPDATE public.jobs j SET ready_confirmed_at = NULL
      FROM parents p
     WHERE j.job_id = p.job_id AND NOT public.job_base_checklist_passes(p);
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER materials_recheck_ready_insert_trg
AFTER INSERT ON public.materials
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.materials_recheck_parents();

CREATE TRIGGER materials_recheck_ready_update_trg
AFTER UPDATE ON public.materials
REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.materials_recheck_parents();

CREATE TRIGGER materials_recheck_ready_delete_trg
AFTER DELETE ON public.materials
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.materials_recheck_parents();

-- ── 5. Trigger fire order (round-4 H1): document explicitly. PG fires
-- triggers in alphabetical order by name within the same event timing.
-- Current order on jobs UPDATE:
--   BEFORE: jobs_clear_ready_confirmed_at_trg (gate via WHEN)
--           jobs_set_updated_at_trg
--   AFTER:  jobs_log_ready_demote_trg (gate via WHEN OF column)
-- The set_updated_at trigger fires AFTER the clear trigger because 'c' < 's'.
-- This is intentional — clear runs first so updated_at reflects the post-clear state.
-- If a future migration adds e.g. 'jobs_aaa_*', re-verify ordering.
```

**Why `SECURITY DEFINER`**: the recheck triggers UPDATE `jobs.ready_confirmed_at` on rows the calling user may not own (e.g., PowerSync sync from a field crew triggers an office-tenant parent re-eval). Definer-mode runs as the migration owner with the explicit tenant filter as the safety net. The locked `search_path = public, pg_temp` prevents a tenant-installed function-shadow attack.

**Why three separate statement-triggers per child table** (INSERT / UPDATE / DELETE): `REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows` syntax requires the trigger event match the transition table. Combined triggers are not supported.

#### §3.12.3 App layer — SET path only [LOCKED]

Only the [ Promote to Ready ] button writes a non-NULL value, and it writes via `updateJobField()` so audit logging fires.

**Signature correction** (round-3 D3): `updateJobField`'s 5th argument is a **string** `source`, not an options object. Passing an object writes the literal `'[object Object]'` to `job_changes.source`. Verify the signature in `queries.js` before wiring the call.

```js
// In the Staged card action button onClick (sketch):
await updateJobField(
  job.job_id,
  'ready_confirmed_at',
  new Date().toISOString(),
  changedBy,
  'manual_promotion'              // 5th arg is a string (source), NOT an options object
)
```

No app-layer clearing helper is needed. The clear trigger (§3.12.2) handles every auto-clear case; the audit trigger logs the demote with `source='trigger_auto_demote'` so the demote is visible in `job_changes` even though no app code wrote it. On Hold → Resume uses `'on_hold_resume'` source via the audit trigger's CASE.

#### §3.12.4 Idempotency + edge cases [LOCKED]

- Re-clicking [ Promote to Ready ] when `ready_confirmed_at` is already set harmlessly overwrites with a fresh timestamp (audit log gains a row; otherwise no behavior change).
- A job that arrives from sales-command with a non-NULL `ready_confirmed_at` (shouldn't happen since sales doesn't write that column) would be auto-cleared by the trigger if the four base items don't pass — defense in depth.
- On-Hold→Resume returns the job to `status='Scheduled'`. The trigger does not fire on `status` changes alone; whether the job lands in Staged or Ready depends purely on the existing `ready_confirmed_at` value at hold-time. If the office wants the held job to require re-confirmation, set `ready_confirmed_at = NULL` explicitly in the hold transition — recommend yes, document in §3.9's On Hold row.

---

## §4 Derived data — Work Days, Crew, Materials

### §4.1 Total Work Days [LOCKED]

Calendar days from `effectiveStart` to `effectiveEnd`, excluding weekends **unless** an `assignments` row exists on that weekend day:

```js
function totalWorkDays(job, assignments) {
  const start = effectiveStart(job), end = effectiveEnd(job)
  if (!start || !end) return null
  let n = 0
  const cursor = new Date(start + 'T00:00:00')
  const endD   = new Date(end   + 'T00:00:00')
  while (cursor <= endD) {
    const dow = cursor.getDay()
    const isWeekend = (dow === 0 || dow === 6)
    if (!isWeekend) n++
    else {
      const dayStr = fmtD(cursor)
      if (assignments.some(a => a.job_id === job.job_id && a.date === dayStr)) n++
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return n
}
```

Under the mobilizations model (§6), this becomes the sum across all mobs for the job.

### §4.2 Crew assigned count [DERIVED]

`assigned` = count of distinct `job_crew.team_member_id` rows for the job's `call_log_id` (per CLAUDE.md: `job_crew.job_id` is FK to `call_log.id`, not `jobs.job_id`; per `JobDetail.jsx:96`: the column is `team_member_id`, not `crew_id`).
`needed` = `jobs.crew_needed` if set, else `field_sow[0].crew_size`, else `1`.
Display: `assigned / needed`, e.g. `2/4`.

### §4.3 Materials counts [DERIVED]

`matCount` = `materials.filter(m => m.job_id === job.job_id).length`
`pendingCount` = rows where `status` is `'Not Ordered'` or `'Delayed'`
`isMaterialsDecided` = `matCount === 0 || pendingCount === 0`

---

## §5 List view (per-stage)

### §5.1 Sort order — Staged [LOCKED]

**Nearest start_date ascending, NULL first.**

- Jobs missing `scheduled_start` / `start_date` (📅 in the missing-icons banner) bubble to the top — forces the office to set a date.
- Jobs with dates sort soonest first — "what fires next" is the morning triage question.

### §5.2 Sort order — Ready [OPEN]

Same `nearest start_date asc, NULL first`? Likely yes, but no explicit lock from the loop conversation. Recommend matching Staged for consistency.

### §5.3 Sort order — Active, On Hold, Production Complete [OPEN]

Not discussed. Recommend:
- Active: nearest end_date asc (jobs closest to wrap up first)
- On Hold: longest-paused first (stale-first surfaces forgotten work)
- Production Complete: nearest finish date desc (most-recently-completed first)

---

## §6 Mobilizations — new child table [LOCKED design, DESIGN-OPEN scope]

### §6.1 Motivation [LOCKED]

Today a job has a single `start_date` / `end_date` pair on the `jobs` row. The office models multi-visit jobs (e.g., "do main coat 6/1–6/8, return 6/15–6/16 for final coat") by creating duplicate job entries — polluting the database, breaking billing reconciliation, and making per-job reporting noisy.

Mobilizations as a child table fixes this:
- One `jobs` row per job (no duplicates)
- N `job_mobilizations` rows per job, each with its own date range
- Each mobilization has a stable identifier (`M1`, `M2`, ...) usable in crew comms ("M2 starts Monday")

### §6.2 Schema — Option C, hybrid override [LOCKED]

Mirrors the `job_wtcs` pattern (migration `20260512120100`) **exactly**: single `job_id` FK only, no `call_log_id` column on the child table, no `tenant_id` column. Tenant scoping enforced via RLS through `JOIN jobs ON job_id, JOIN call_log ON jobs.call_log_id`. Same applies to §7's `job_attachments`.

**Why single FK** (drops `call_log_id` from the previous draft): a dual FK lets an attacker insert a row where `job_id` and `call_log_id` disagree — `job_id` points to a job in tenant A, `call_log_id` points to a call_log in tenant B. With both columns present, the RLS check on the call_log column passes (tenant B owns that call_log) while the actual job lives in tenant A. Result: cross-tenant data pollution. The dual-FK shape also lets a malicious UPDATE re-parent a mob from one job to another by flipping just `call_log_id`. Single FK + JOIN closes both vectors and exactly matches `job_wtcs`.

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.job_mobilizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      int8 NOT NULL REFERENCES public.jobs(job_id) ON DELETE CASCADE,
  label       text NOT NULL,            -- 'M1', 'M2', ...
  ordinal     int  NOT NULL,            -- sort order: 1, 2, 3, ...
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  crew_size   int,                      -- NULL = inherit jobs.crew_needed
  field_sow   jsonb,                    -- NULL = inherit jobs.field_sow
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, ordinal),
  UNIQUE (job_id, label),
  CHECK (start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS idx_job_mobilizations_job_id
  ON public.job_mobilizations(job_id);

COMMENT ON TABLE public.job_mobilizations IS
  'Per-mobilization date blocks for a job (hybrid override). NULL crew_size '
  'or field_sow means inherit the parent jobs.crew_needed or jobs.field_sow.';

-- updated_at maintenance via shared trigger fn (added in §3.11 migration)
CREATE TRIGGER job_mobilizations_set_updated_at_trg
BEFORE UPDATE ON public.job_mobilizations
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ── RLS ────────────────────────────────────────────────────
ALTER TABLE public.job_mobilizations ENABLE ROW LEVEL SECURITY;

-- Scope via JOIN jobs -> call_log.tenant_id chain.
-- Mirrors job_wtcs (20260512120100) exactly.
CREATE POLICY job_mob_select_authenticated
  ON public.job_mobilizations
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.jobs j
        JOIN public.call_log cl ON cl.id = j.call_log_id
       WHERE j.job_id = job_mobilizations.job_id
         AND cl.tenant_id = public.get_user_tenant_id()
    )
  );

CREATE POLICY job_mob_insert_authenticated
  ON public.job_mobilizations
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.jobs j
        JOIN public.call_log cl ON cl.id = j.call_log_id
       WHERE j.job_id = job_mobilizations.job_id
         AND cl.tenant_id = public.get_user_tenant_id()
    )
  );

CREATE POLICY job_mob_update_authenticated
  ON public.job_mobilizations
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.jobs j
        JOIN public.call_log cl ON cl.id = j.call_log_id
       WHERE j.job_id = job_mobilizations.job_id
         AND cl.tenant_id = public.get_user_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.jobs j
        JOIN public.call_log cl ON cl.id = j.call_log_id
       WHERE j.job_id = job_mobilizations.job_id
         AND cl.tenant_id = public.get_user_tenant_id()
    )
  );

CREATE POLICY job_mob_delete_authenticated
  ON public.job_mobilizations
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.jobs j
        JOIN public.call_log cl ON cl.id = j.call_log_id
       WHERE j.job_id = job_mobilizations.job_id
         AND cl.tenant_id = public.get_user_tenant_id()
    )
  );

COMMIT;
-- jobs.field_sow + jobs.crew_needed remain as defaults
-- Reads use COALESCE(mob.field_sow, jobs.field_sow), etc.
```

**Stable-label policy** (alongside the `UNIQUE (job_id, label)` constraint):

- Labels are stable identifiers used in crew comms ("M2 starts Monday"). Once assigned, never renumber on deletion.
- Deletion of M2 leaves a gap: M1, M3, M4 (not M1, M2, M3).
- New mobs append at the next available ordinal/label — M5 in the example above, not a reused M2.
- UI should warn before deleting (gap is permanent).

**Hybrid rationale:** common case (M2 = continuation of M1, same scope) just reads parent — no duplication. Edge case (M2 = different scope, e.g., "final coat only") overrides on the mob row. Reads always need `COALESCE` but that's a one-line query helper.

### §6.3 Implications outside this loop [DESIGN-OPEN]

The mobilizations table is its own build, not part of the card-design loop. Downstream changes required before mobs are live:

- `jobs.start_date` / `jobs.end_date` become **derived** (`min(mob.start), max(mob.end)`). Either drop them as columns or leave them as denormalized cache with a trigger to keep in sync. Recommend leaving them and adding a trigger to start; drop later if dual-write proves painful.
- `assignments.job_id` could optionally gain a `mobilization_id` FK so crew assignments belong to a specific mob. Without this, "which mob is this crew on?" requires date-range inference.
- `billing_log` could optionally gain a `mobilization_id` FK so progress billing per mob is natural.
- `JobCrewScheduler.jsx` needs to render multi-block schedules (today assumes one contiguous range).
- `Calendar.jsx`, `Daily.jsx`, `Schedule.jsx` all need to render multi-block jobs without artifacts.
- Field Command (mobile app, separate repo) needs to know which mobilization a crew is clocking into. Coordinate with `field-command` repo owner.
- **PowerSync sync rules — `job_mobilizations` is BLOCKED from sync rules until PowerSync rules are refactored to per-tenant buckets.** Today's PowerSync rules (per `field-command` CLAUDE.md) use broad `SELECT *` patterns that effectively grant cross-tenant read access once a table is added. Naively adding `job_mobilizations` to those rules would leak every tenant's mobilization data to every crew device — recreating the exact attack surface that this plan's RLS spec (§6.2) closes at the Postgres layer. **Build order**: refactor PowerSync sync rules to per-tenant scoped buckets FIRST (separate loop, field-command repo), then add `job_mobilizations` to the refactored rules. Until both ship, Field Command must NOT query `job_mobilizations` — sch-command UI surfaces mobs only.

**Plan: build mobs as its own ERD loop after card design lands.** Card design renders `MOBS` scorecard with derived count = 1 today (from `jobs.start/end_date`); once table ships in sch-command, count comes from `job_mobilizations` and card renders unchanged. PowerSync exposure of mobs is a separate downstream loop gated on per-tenant bucket refactor.

### §6.4 Migration ledger + push procedure [OPEN]

Migration timestamp TBD. Coordinate with `o7_migration_coordination.md` and check `supabase_migrations.schema_migrations` before drafting.

**Required**: push via `npm run db:push` (the collision-check wrapper), NOT raw `supabase db push`. Per `CLAUDE.md`:

> Always use `npm run db:push` instead of raw `supabase db push`. The wrapper runs a collision check against the prod ledger before pushing — it catches timestamp collisions across repos sharing the same Supabase project.

**Ledger has reverted rows**: per `CLAUDE.md` RESUME ALERT, two timestamps were reverted from the prod ledger on 2026-05-12 (`20260512120000_jobs_material_status_additive`, `20260512120100_job_wtcs_create`). Before any `db push` in this repo, run:

```
supabase migration repair --status applied 20260512120000 20260512120100
```

Otherwise `db push` will see them as not-applied locally, skip them silently, and any code expecting the schema will look fine but downstream pushes drift. Same gate applies to §3.11 (`hold_reason`), §3.12 (`ready_confirmed_at`), §6.2 (`job_mobilizations`), and §7 (`job_attachments`) migrations.

---

## §7 Attachments — new subsystem [DESIGN-OPEN]

No attachments system exists in sch-command today. Grep for `attachment|file_url|files\.` in `src/` returned zero matches. Needed for the 📎 FILES scorecard to be functional.

Per the audit, the storage layer must be fully spec'd before the FILES scorecard can be marked ready — a permissive storage bucket policy today (`storage_job_attachments_delete_policy`, scoped to the bucket only, callable by any tenant) is in scope to drop in the same migration that adds the table-level policies. Verify the existing policy via the Supabase storage policy list; if absent, skip the DROP.

#### §7.1 Table — `job_attachments` [LOCKED design, DEFERRED build]

Single-FK shape matching §6.2 / `job_wtcs`. No `tenant_id`, no `call_log_id` — scope via `JOIN jobs ON job_id, JOIN call_log`:

```sql
CREATE TABLE IF NOT EXISTS public.job_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       int8 NOT NULL REFERENCES public.jobs(job_id) ON DELETE CASCADE,
  label        text,
  file_path    text NOT NULL,                      -- '{tenant_id}/{call_log_id}/{uuid}-{filename}'
  file_size    bigint,
  mime_type    text,
  uploaded_by  uuid REFERENCES public.team_members(id),
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (file_path)
);
CREATE INDEX idx_job_attachments_job_id ON public.job_attachments(job_id);

-- 4 policies — same JOIN pattern as §6.2.
ALTER TABLE public.job_attachments ENABLE ROW LEVEL SECURITY;
-- [SELECT/INSERT/UPDATE/DELETE policies elided — copy §6.2 verbatim, swap table name]
```

#### §7.2 Storage path schema [LOCKED]

Files live in a single shared `job-attachments` bucket. Path schema embeds the tenant for the storage policy:

```
{tenant_id}/{call_log_id}/{uuid}-{original_filename}
```

- First path segment = `tenant_id` — the only segment storage RLS can read via `storage.foldername(name)[1]`
- Second segment = `call_log_id` — for human navigation in the storage UI
- Third segment = `{uuid}-{filename}` — UUID prevents collisions, original filename preserved for download

#### §7.3 Storage bucket + policies [LOCKED]

Three round-3 audit hardenings folded in: (C3) the actual prod DELETE policy name is `"Authenticated can delete job-attachments"` (quoted, with spaces) — DROP unconditional, no `IF EXISTS` (silent-no-op risk if the name doesn't match). (A3) UPDATE policy dropped entirely; rename/move ops are out of scope and the policy only adds attack surface. (A5) Bucket is created + asserted private inside the migration.

```sql
-- ── 0. Connection-role guard (round-4 E3). The Supabase pooler can run
-- migrations under unexpected roles in some recovery / branch / preview
-- scenarios. Fail loudly rather than silently mis-apply storage state.
DO $$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'job-attachments bucket migration requires postgres role (got: %)', current_user;
  END IF;
END $$;

-- ── 1. Create bucket (private). DO NOTHING on conflict (round-4 E1) — if
-- the bucket already exists with public=true, the upsert version silently
-- flipped it to false, neutering the assertion below. With DO NOTHING the
-- assertion catches a pre-existing public bucket and forces operator
-- intervention.
INSERT INTO storage.buckets (id, name, public)
VALUES ('job-attachments', 'job-attachments', false)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_exists boolean;
  v_public boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'job-attachments'),
         (SELECT public FROM storage.buckets WHERE id = 'job-attachments')
    INTO v_exists, v_public;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'job-attachments bucket missing after insert';
  END IF;
  IF v_public IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'job-attachments bucket is public=% — manual fix required before re-running migration', v_public;
  END IF;
END $$;

-- ── 2. DROP the legacy bucket-only DELETE policy. Verify the exact policy
-- name before running this migration:
--   SELECT polname FROM pg_policy WHERE polrelid = 'storage.objects'::regclass;
-- The current prod name is the bracketed string below. Unconditional drop
-- (no IF EXISTS) — if the name doesn't match, the migration fails loudly
-- rather than silently leaving the hole open.
DROP POLICY "Authenticated can delete job-attachments" ON storage.objects;

-- ── 3. 3 tenant-scoped policies on storage.objects (SELECT/INSERT/DELETE).
-- No UPDATE policy — rename/move is out of scope and only adds attack
-- surface. Files are immutable post-upload; re-upload to change.
CREATE POLICY job_attachments_storage_select
  ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'job-attachments'
    AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
  );

CREATE POLICY job_attachments_storage_insert
  ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'job-attachments'
    AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
  );

CREATE POLICY job_attachments_storage_delete
  ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'job-attachments'
    AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
  );
```

`(storage.foldername(name))[1]` returns the first `/`-separated segment of the object path. Cast to `text` because `get_user_tenant_id()` returns `uuid`.

#### §7.3a Per-job authorization contract [LOCKED]

Round-4 E2 forces this decision. Two options, must pick:

**Option I (chosen for v1) — tenant-wide office sharing.** Anyone authenticated in tenant T can SELECT / INSERT / DELETE attachments for ANY job in tenant T. The path schema's `{tenant_id}` segment is the only gate. Matches today's `job_changes` / `materials` / `assignments` semantics — sch-command has never had per-job ACLs.

**Option II — per-job authorization via call_log JOIN.** Tighten the storage policies to also verify the second path segment (`{call_log_id}`) against a per-user authorization table. Requires designing that table; out of scope for this loop.

Documented choice: **Option I**. The 3 storage policies in §7.3 already implement this. If office staff later need per-job access control (e.g., subcontractor-specific job folders), tighten via Option II in a follow-up loop without changing the path schema.

Spelled out so reviewers / future loops don't assume per-job security where there is none.

#### §7.4 Build scope [DESIGN-OPEN]

- Migration writes both the table (§7.1) + the storage policies (§7.3) atomically.
- Upload UI (drag-drop or file picker) inside the FILES scorecard click target.
- Download / preview UI same surface.
- Cross-app: Field Command read access — likely yes for crew refs. Same RLS gates apply (tenant scoping via call_log chain).
- Push via `npm run db:push` per §6.4 — applies to both the table migration and the storage policy migration if they end up split.

**Plan: card design ships 📎 FILES scorecard as a stub** showing count 0 with click target disabled or showing "Coming soon." Attachments subsystem gets its own loop, but §7.1–§7.3 are spec'd here so the loop can ship without re-design.

---

## §8 Implementation order (suggested) [DERIVED]

Not part of this design loop; sketched here to inform whoever picks up the build loop.

1. **Migrations — re-bundled to ONE transactional migration** (round-4 A1, reverses round-3 F5). The split-for-partial-recovery narrative was wrong: `supabase db push` wraps each file in its own transaction, so a mid-file failure on `+1` commits `+0` AND writes it to the ledger — recreating the exact RESUME ALERT drift. Atomicity from a single transaction gives recovery for free: anything fails, whole thing rolls back, ledger stays clean.

   **Three migrations total, in deploy order:**

   1. **Storage migration FIRST** — `<14-digit-ts>_job_attachments_storage.sql` covers §7.1 (table), §7.3 (bucket + privacy assertion + named DROP + 3 storage policies). Runs first so a name-mismatch failure on the DROP doesn't leave jobs-columns half-applied.
   2. **Jobs migration SECOND** — `<14-digit-ts>_staged_ready_jobs_and_triggers.sql` covers everything in §3.11 + §3.12 in one transaction:
      - jobs columns: `ready_confirmed_at`, `hold_reason`, `updated_at` (if absent)
      - SQL functions: `tg_set_updated_at()`, `job_base_checklist_passes()`, `jobs_clear_ready_confirmed_at()`, `jobs_log_ready_demote()`, `job_crew_recheck_parents()`, `materials_recheck_parents()`
      - Triggers: BEFORE clear (with §3.12 round-4 B1 WHEN gate), AFTER demote-log, set_updated_at, statement-level child triggers on `job_crew` + `materials` (with §3.12 round-4 C1 TG_OP conditionals)
      - `CHECK (status IN (...))` constraint on `materials.status` to close the JS-whitelist vs SQL-blacklist drift surfaced in §8a (round-4 G1)
      - `ALTER TABLE job_changes ENABLE ROW LEVEL SECURITY` + tenant-scoped SELECT policy (round-4 D3) — SECURITY DEFINER writers bypass it; reads stay tenant-scoped
   3. **Mobilizations migration THIRD** — `<14-digit-ts>_job_mobilizations.sql` covers §6.2 (table + 4 RLS policies + indexes). Independent of the others; can ship in same or different release window.

   **14-digit timestamps required** (NOT `+N` suffix). The `+N` prefix collides with `scripts/check-migration-collision.mjs:11` regex. Use the format `YYYYMMDDHHmmss` per existing convention.

   **CROSS-REPO COORDINATION — REQUIRED before push** (round-4 A4):

   `sales-command` owns `supabase/migrations/20260420120000_storage_job_attachments_delete_policy.sql` in git. Any future `db reset` / CI fresh-env / DR seed in any repo re-applies that file → silently re-opens the tenant-wide DELETE hole the §7.3 DROP closed. **Two acceptable paths:**

   - **(a) Deletion migration in sales-command** — same release window, ship a migration in `sales-command/supabase/migrations/` that drops the legacy policy and removes the original file. Timestamp must be coordinated against ledger; cross-repo migration coordination doc is `~/sales-command/docs/plans/o7_migration_coordination.md`.
   - **(b) Idempotent re-create in sch-command** — sch-command's migration drops the legacy policy AND re-creates a tightened policy under the same name `"Authenticated can delete job-attachments"` (using the §7.3 tenant-segment gate). sales-command's replay would then become a no-op (`CREATE POLICY ... IF NOT EXISTS` semantics don't exist in PG; use `DROP POLICY IF EXISTS ... ; CREATE POLICY ...` pattern in both repos so each is idempotent).

   Recommend **(a)** — single source of truth in sales-command; sch-command stays the consumer. Requires sync with sales-command owner.

   Apply via `npm run db:push`. Ledger repair gate (§6.4) runs before the first push.
2. **Compute `isReady`** in `queries.js` — `loadAllRows()` helper (§2.4), then `baseChecklistPasses(job, crew, mats)` and `isReady(job)` using pre-indexed Maps. **Do NOT change the `loadJobs({ withWTCs })` default** (round-3 F1). The default stays `false`; only the new call sites (`JobsPicker.jsx` for tile counts, `StageJobCard.jsx` for the SOW row) pass `withWTCs: true` explicitly. Changing the default would silently regress perf and contract on `Calendar.jsx`, `Schedule.jsx`, `Materials.jsx`, `Daily.jsx`, `Billing.jsx`, `Schedules.jsx` — most of which don't render WTC data and don't want the extra join.
3. **Tile split** in `JobsPicker.jsx` — load `job_crew` + `materials` via paginating helper, add Staged tile before Ready, update Ready tile copy + filter, move Production Complete to Section 2. Counts derive from `isReady`. Surface `{ partial, error }` from §2.4 as a sync-warning chip.
4. **Card list components** — actual surfaces in the repo today (verified `ls src/components/`):
   - `ScheduledCardList.jsx` — renders the Ready tile's list. Split into **Staged list** + **Ready list**. Either parameterize with a `mode` prop or extract a shared `StageJobCard.jsx` and create new `StagedCardList.jsx` (does not exist today). Recommend the latter — file separation matches the tile split.
   - `JobCardList.jsx` — currently the Complete + All Jobs list. Either parameterize with `stage` to render the new Option D card, or extract `StageJobCard.jsx` and have JobCardList use it. Today this is also wrapped by `OnHoldCardList.jsx` (next item).
   - `OnHoldCardList.jsx` — verified at file head: imports `JobCardList from './JobCardList'`, uses it inside a `<>` wrapper plus a "Resume to Scheduled" affordance. The OnHold list shares cards with JobCardList, so card-template changes flow through automatically. Add the new Resume behavior: `updateJobFields(jobId, { status: 'Scheduled', ready_confirmed_at: null })` per §3.9's revised On Hold row.
   - **New** `StagedCardList.jsx` and **new** `CompleteCardList.jsx` — neither exists today (verified). `CompleteCardList` may not need to exist if Production Complete moves to Section 2 and reuses an existing surface there; confirm with §2.1.
5. **Sort + filter routing** in `Jobs.jsx` — add `'staged'` to `VALID_TABS`, route `?tab=staged` → `StagedCardList`, update `?tab=scheduled` filter to `isReady && getJobStatus==='Scheduled'`. Sort by `start_date asc, NULL first` on both.
6. **Stage action buttons + banner** — `StageJobCard.jsx` props include `stage`; renders banner per §3.3, panels per §3.5–§3.7, bottom action per §3.9. The Staged [ Promote to Ready ] button writes `ready_confirmed_at` via `updateJobField(..., 'manual_promotion')`.
7. **PRT bulk loader** (`loadPRTsForCallLogIds`) per §3.10, banner pill on Active cards.
8. **Realtime channel coverage** — extend `Jobs.jsx:171` to also subscribe to `job_crew` + `materials` changes, OR document an explicit eventual-consistency contract for Staged/Ready counts (see §11).
9. **Mobilizations** as a separate loop (see §6.3) — includes PowerSync sync-rules update for field-command.
10. **Attachments** as a separate loop (see §7) — migration + storage policies are spec'd; only build remains.

---

## §8a SQL ↔ JS parity test fixture [LOCKED]

`isReady()` (JS, §2.4) and `job_base_checklist_passes()` (SQL, §3.12) must agree row-for-row. They are written in different languages by different authors at different times and **will drift**. The JS uses a whitelist (`status === 'Ordered' || status === 'In Stock'` is decided); the SQL uses a blacklist (`status NOT IN ('Not Ordered', 'Delayed')` is decided). For known status values these are equivalent. For unknown status values (typo, new enum, NULL, empty string) they diverge — JS rejects, SQL accepts.

Add a parity test before merging:

```js
// tests/staged_ready_parity.test.js (or wherever the build loop puts tests)
const fixtures = []
const sowOpts      = [null, [{ day_label: 'Day 1' }]]
const dateOpts     = [null, '2026-06-01']
const crewOpts     = [0, 1, 2]
const materialOpts = [
  [],                                                       // 0 rows
  [{ status: 'Not Ordered' }],
  [{ status: 'Ordered' }],
  [{ status: 'In Stock' }],
  [{ status: 'Delayed' }],
  [{ status: 'Ordered' }, { status: 'Delayed' }],
  [{ status: 'In Stock' }, { status: 'In Stock' }],
  [{ status: 'unknown' }],                                  // ← whitelist/blacklist divergence
  [{ status: null }],                                       // ← whitelist/blacklist divergence
]

for (const sow of sowOpts)
  for (const date of dateOpts)
    for (const crewCount of crewOpts)
      for (const mats of materialOpts)
        fixtures.push({ sow, date, crewCount, mats })

// For each fixture: build a temp jobs row + job_crew rows + materials rows,
// then assert JS isReady() === SQL SELECT job_base_checklist_passes(j).
```

Expected outcome: align the JS to use the blacklist (`!status || ['Ordered', 'In Stock'].includes(status) ||` is wrong — instead `!['Not Ordered', 'Delayed'].includes(status)`), or add a CHECK constraint on `materials.status` that pins the enum. The plan adopts BOTH: blacklist alignment in code + the CHECK constraint ships in the same jobs migration (§8 step 1 round-4 G1).

**Runner spec (round-4 G2)**: parity fixture is not optional, must run in CI.

- **Framework**: Vitest (already present in dev deps if `npm test` works; add if not).
- **Postgres**: local Supabase container via `supabase start` (Docker required). Test file boots schema from `supabase/migrations/`, seeds tenant + call_log + jobs row, runs the fixture matrix.
- **Test location**: `tests/staged_ready_parity.test.js`.
- **Per-fixture assertion**: build temp rows → `await supabase.rpc('jb_test', { ... })` returns SQL result for `job_base_checklist_passes(j)` → assert equal to JS `baseChecklistPasses(job, crew, mats)`.
- **CI gate**: GitHub Actions workflow `.github/workflows/test.yml` runs `npm test` on every PR. Required check on any PR touching `supabase/migrations/` or `src/lib/queries.js`. Use branch protection rule to enforce.
- **Don't merge §8a-spec without runner**: implementation loop ships the test + the workflow + the branch protection in the same PR as the migration. If the parity test isn't gating CI, the drift it's designed to catch lands in main between test runs.

---

## §9 Realtime channels [LOCKED]

`Jobs.jsx:171` today subscribes only to `postgres_changes` on `public.jobs` and triggers `loadData()` on any change. With Staged/Ready counts depending on `job_crew` and `materials`, those tables also need realtime coverage — otherwise the dashboard drifts until the next manual reload (or the next `jobs` change happens to coincide).

Add two additional channels:

```js
useEffect(() => {
  const channels = [
    supabase.channel('jobs-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, loadData)
      .subscribe(),
    supabase.channel('job-crew-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_crew' }, loadData)
      .subscribe(),
    supabase.channel('materials-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'materials' }, loadData)
      .subscribe(),
  ]
  return () => channels.forEach(c => supabase.removeChannel(c))
}, [loadData])
```

**Cost / contract**: each channel is a long-lived websocket subscription. Three channels per open `/jobs` tab is acceptable. If realtime cost becomes an issue, fall back to the **eventual-consistency contract**: counts are accurate as of the last `jobs` change; child-table writes refresh on the next `jobs` write or the next manual reload (target ≤30s drift). Today's single-channel implementation already has this contract for billing data without complaint; extending it to job_crew/materials is acceptable degradation if needed.

Recommend: ship with all three channels. Strip back only if observability shows the cost is real.

---

## §10 Open questions

| # | Question | Owner |
|---|---|---|
| 1 | Sort orders for Ready / Active / On Hold / Production Complete (§5.2, §5.3) | Chris |
| 2 | Mobilizations migration timestamp + cross-repo coordination plan (§6.4) | Chris + sales-command owner |
| 3 | Attachments table shape + Storage bucket policy (§7) | Chris (separate loop) |
| 4 | `Send to Billing` exact behavior on Production Complete — does it create a billing_log row, set a flag, or navigate? Confirm vs today's `/billing` integration | Chris |
| 5 | Does `jobs.start_date` / `jobs.end_date` stay as denormalized cache once mobs ship, or get dropped? (§6.3) | Chris (decide during mobs loop) |
| 6 | Should panel toggle state persist across page reloads (per-user pref) or stay session-local? (§3.8) | Chris (revisit post-launch) |
| 7 | Pagination audit pass on existing sch-command load paths (`Jobs.jsx:149-157`: `jobs`, `assignments`, `billing_log`, `team_members`). All currently unpaginated and would silently truncate at 1000 rows. File as backlog `T2 — paginate sch-command load paths` | Chris (separate backlog item) |
| 8 | ~~`withWTCs: true` default~~ — withdrawn per round-3 F1; default stays `false`. New call sites opt in explicitly | resolved |
| 9 | ~~Verify policy name before DROP~~ — resolved: round-3 C3 confirmed name is `"Authenticated can delete job-attachments"` and DROP is now unconditional | resolved |
| 10 | **Cross-repo coordination with sales-command owner**: pick path (a) deletion migration in sales-command OR (b) idempotent re-create in sch-command (§8 step 1 round-4 A4). Required before push | Chris + sales-command owner |
| 11 | **search_path drift** (round-4 H2): new SECURITY DEFINER fns in §3.12 use `SET search_path = public, pg_temp`; sales-command's canonical helpers use `SET search_path = public` (no `pg_temp`). Either align all new fns to drop `pg_temp`, OR file a tracker to update sales-command's helpers to add it. Don't leave silent drift between repos | Chris (decide before push) |

---

## §11 Locked decisions summary

For quick scan by the build loop:

- ✓ New tile **Staged** in Section 1, before Ready
- ✓ **Production Complete** moves Section 1 → Section 2
- ✓ Promotion: `isReady` checklist (§2.2) — four base items + `ready_confirmed_at` gate (§3.12). No change to `jobs.status` enum
- ✓ Materials decided = no `Not Ordered` / `Delayed` rows (§2.2); `matCount === 0` default = decided
- ✓ Card = Option D, three-panel collapse (Planning / Management / Details), all closed default, multi-open allowed, fixed render order (§3)
- ✓ Banner format: always-visible icon-coded missing items + stage countdown (§3.3)
- ✓ Three identity bubbles: Job · Customer · Work Types (§3.4)
- ✓ Scorecards: 5 Planning + 6 Management (§3.5, §3.6), click targets per table; MOBS + FILES stub until §6/§7 ship
- ✓ DETAILS panel SOW row uses **actual daily shape** from `FieldSowBuilder.jsx:115-137` (`{day_label, crew_count, hours_planned, tasks[], materials[]}`); per-WTC sub-lines for multi-GC; legacy fallback to `jobs.field_sow`. Phased `(Nd)` format dropped — not in the data (§3.7)
- ✓ Stage action button always visible at bottom (§3.9). On Hold `[ Resume ]` also nulls `ready_confirmed_at` so resumed jobs require re-confirmation
- ✓ Staged promotion = manual `[ Promote to Ready ]` button (not auto), writes `jobs.ready_confirmed_at` via `updateJobField` (audit-logged with `source='manual_promotion'`)
- ✓ No "Open Job" button — card header clickable instead
- ✓ PRT behind threshold: `actual < target by >10% across last 3 PRTs` (§3.10); bulk `loadPRTsForCallLogIds(ids[])` mirrors single-job SELECT verbatim from `queries.js:191`, chunks `.in()` at 100 UUIDs, preserves `.order('report_date' desc)`; documented behavior at 0/1/2 PRTs
- ✓ New `jobs.hold_reason` column (§3.11)
- ✓ New `jobs.ready_confirmed_at` column (§3.12) with **hybrid enforcement**: app-layer SETs via [ Promote to Ready ] (5th arg is string `'manual_promotion'`, not an object — round-3 D3); DB trigger CLEARs on any base-checklist transition true→false. BEFORE trigger gated with `WHEN (OLD ... AND NEW ... AND NEW IS NOT DISTINCT FROM OLD)` so re-Promote-with-same-value, concurrent SET races, and Promote SETs all bypass clearing (round-4 B1). BEFORE trigger sets `SET LOCAL my.auto_demote=true` flag (round-4 B2) read by the AFTER trigger to distinguish `trigger_auto_demote` from `manual_clear` and from `on_hold_resume`. AFTER trigger now logs **both** non-NULL→NULL transitions AND NULL→non-NULL SETs (round-4 D2) with `source='trigger_set:<role>'` for service-role bypass-proofing. JWT role encoded in source string (round-4 D1). `job_base_checklist_passes()` declared `SECURITY DEFINER SET search_path = public, pg_temp` with explicit tenant filter via call_log JOIN (round-3 E1; H2 search_path drift open in §10). Child-table triggers converted to `FOR EACH STATEMENT` with `REFERENCING NEW TABLE / OLD TABLE` transition tables (round-3 E3); function body branches on `TG_OP` (round-4 C1 — DELETE-only triggers can't reference new_rows); tenant-scoped via `get_user_tenant_id()` with service-role escape hatch (round-4 C2). Resume action's `updateJobFields` audit loop skips `ready_confirmed_at` to avoid triple-write (round-4 B3). Trigger fire order documented in §3.12.2 (round-4 H1)
- ✓ Mobilizations table: Option C hybrid override (§6.2). **Single FK to `jobs.job_id`** — no `call_log_id`, no `tenant_id`. Mirrors `job_wtcs` exactly. RLS scoped via `JOIN jobs ON job_id JOIN call_log`. Closes cross-tenant pollution + UPDATE-loophole attacks. Four-policy RLS spec included. `UNIQUE (job_id, label)` + stable-label policy (deletion leaves gaps, never renumber)
- ✓ Attachments (§7) fully spec'd despite deferred build: single-FK table, path schema `{tenant_id}/{call_log_id}/{uuid}-{filename}`, **3 storage policies** (SELECT/INSERT/DELETE — UPDATE dropped per round-3 A3, files immutable post-upload), gating on `(storage.foldername(name))[1] = get_user_tenant_id()::text`. Bucket created via `INSERT ... ON CONFLICT DO NOTHING` (round-4 E1 — `DO UPDATE` neutered the privacy assertion); assertion RAISEs on missing or public bucket. Connection-role guard at top of migration (round-4 E3): `IF current_user <> 'postgres' THEN RAISE EXCEPTION` catches Supabase pooler mode-switch failures. Legacy DROP statement is **unconditional** and uses the actual prod policy name `"Authenticated can delete job-attachments"` (round-3 C3). Per-job authorization contract spelled out in §7.3a: **Option I — tenant-wide office sharing** (round-4 E2); per-job ACLs deferred to follow-up loop if needed
- ✓ All new loads use `.range()` pagination via `loadAllRows(tableName, selectStr, { orderBy, filterFn })` helper (§2.4). Signature now builds filter+order chain ONCE outside the loop and only rebuilds `.range()` per page (round-4 F2 — round-3's full-rebuild over-corrected; reused chain is fine, only `.range()` is mutating). Dev-only assertion on chunk 2 validates the assumption. `orderBy` is **required**, no default (round-3 D4). Returns `{data, error, partial}`, surfaces sync warning on partial. Existing unpaginated loads documented as a known divergence at >1000 rows (round-4 F5): tile counts accurate only for first 1000 jobs; backlog T2 must ship before HDSP exceeds threshold
- ✓ `isReady` performance: pre-index `jobCrew` + `materials` as `Map<job_id, rows[]>` once per `loadData`; O(1) per-job lookup
- ✓ Migrations **re-bundled to ONE transactional jobs migration** (round-4 A1, reverses round-3 F5 — split actually amplified RESUME ALERT drift). Three migrations total in deploy order: storage FIRST, jobs SECOND, mobilizations THIRD. 14-digit timestamps required (NOT `+N` suffix — collides with `scripts/check-migration-collision.mjs:11` per round-4 A1). All push via `npm run db:push` after ledger repair gate (§6.4). Cross-repo coordination with sales-command owner required before push (round-4 A4 — sales-command owns the legacy storage policy file)
- ✓ `jobs.updated_at` trigger does **NOT exist today** — ADD `tg_set_updated_at()` fn + `jobs_set_updated_at_trg` in the same migration as `hold_reason` / `ready_confirmed_at`. Reused by `job_mobilizations`
- ✓ `loadJobs({ withWTCs })` default stays `false` (round-3 F1 reverses prior round-2 decision). Only `JobsPicker` and `StageJobCard` opt in explicitly; Calendar/Schedule/Materials/Daily/Billing/Schedules unaffected
- ✓ Realtime channels extended: subscribe to `job_crew` + `materials` in addition to `jobs` so Staged/Ready counts don't drift (§9). `loadData` debounced at **300ms** in the channel handler so CSV imports of 500 rows don't freeze the tab (round-3 E5), AND wrapped in request-id stale-bail (round-4 F3) so concurrent loads can't half-rebuild the pre-indexed Maps. Fallback contract: eventual consistency ≤30s if realtime cost grows
- ✓ PowerSync sync rules — `job_mobilizations` **BLOCKED from sync rules** until PowerSync is refactored to per-tenant buckets (round-3 C4). Today's broad `SELECT *` patterns would leak mob data cross-tenant. Field Command must NOT query `job_mobilizations` until both ship. Sch-command UI surfaces mobs only in the interim (§6.3)
- ✓ SQL ↔ JS parity test fixture (§8a) required pre-merge with Vitest + local Supabase + GitHub Actions CI gate (round-4 G2). Branch protection rule enforces `npm test` on any PR touching `supabase/migrations/` or `src/lib/queries.js`. Plan adopts both fixes: JS aligns to blacklist + CHECK constraint on `materials.status` ships in same jobs migration (round-4 G1)
- ✓ PRT bulk loader uses `Promise.allSettled` (round-4 F1 — bail-on-first-error discarded successful chunks); returns `{data, error, partial}`; defensive re-sort by `report_date desc` after merge (round-4 F6 — parallel-arrival order doesn't preserve sort). Chunk-100 URL length unverified — measure in dev OR migrate to RPC `prts_for_call_logs(ids uuid[])` (round-4 F4)
- ✓ `job_changes` table gets `ENABLE ROW LEVEL SECURITY` + tenant-scoped SELECT policy in same jobs migration (round-4 D3). SECURITY DEFINER writers bypass; reads stay tenant-scoped
- ✓ §8 step 4 corrected: `OnHoldCardList` wraps `JobCardList` (not a peer); `StagedCardList` + `CompleteCardList` don't exist today and must be created
- ✓ Staged tile sub-line: `📋 N · 📦 N · 👷 N · 📅 N` (§2.5)
- ✓ Staged sort: nearest `start_date` asc, NULL first (§5.1)
- ✓ Total Work Days: weekdays + scheduled weekends, summed across mobs (§4.1)
- ✓ `job_crew.team_member_id` (NOT `crew_id`) per `JobDetail.jsx:96` — all references corrected (round-3 D1)

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-05-27. Consumed by `/multiagentaudit` to size the adversarial audit pass._

### Round
- Current round: 4
- Plan revision under audit: `d6b3a4a` (Plan revision pass 3 — round-3 audit response)

### Prior rounds
- Round 1: `c7d780b` · 3H/4M/3L · pattern: `unknown` (commit message predates pattern-tag convention; original audit synthesis: `RLS-blind-spot`)
- Round 2: `f59fe72` · 9H/8M/1L · pattern: `unknown` (original audit synthesis: `enforcement-layer-mismatch`)
- Round 3: `d6b3a4a` · 4C/8H + accepted highs · pattern: `unknown` (original audit synthesis: `trigger-side-effects+code-bombs`)

**Briefing for agents**: do NOT re-find issues from prior rounds. Each round's revision-pass commit message is the canonical record of what was addressed. Round 3 was the most invasive — full trigger rewrite (BEFORE+AFTER+statement-level), storage migration changes, loader signature change, migration split. Round-4 attack surface is concentrated in those new mechanisms. Attack ONLY material new to `d6b3a4a`.

### Surface
- Total lines: 1276
- Sections: 12 (now includes §8a parity test)
- [LOCKED] decisions: 32
- [DESIGN-OPEN] items: 5
- [OPEN] items: 5

### Layers touched
- UI / components (debounce hook, panel toggles, scorecards)
- Data layer (queries.js — `loadAllRows` rewritten, `loadPRTsForCallLogIds`, `isReady`, debounce wiring)
- State model (jobs columns + Staged↔Ready bucketing + auto-demote audit trail)
- RLS / multi-tenancy (JOIN-through-call_log pattern across 2 new tables + storage)
- Storage (private bucket assertion + 3 policies + named unconditional DROP)
- Migrations / schema (3 split timestamps; 4 SQL functions; 8+ triggers including statement-level w/ transition tables)
- Cross-repo (sales-command writes that traverse new triggers; PowerSync explicitly BLOCKED from mobs)
- Real-time / sync (debounced 3-channel subscription + ≤30s eventual-consistency fallback)
- Audit logging (new `jobs_log_ready_demote_trg` AFTER trigger writing to `job_changes`; JWT-claim actor resolution)
- Performance / N+1 / pagination (statement-level triggers, chunked `.in()`, pre-indexed Maps, 300ms debounce)
- Testing (parity test fixture spec'd in §8a, not yet implemented)

### New mechanisms introduced
- New columns: `jobs.ready_confirmed_at timestamptz`, `jobs.hold_reason text`, `jobs.updated_at timestamptz` (if absent — to verify)
- New tables: `public.job_mobilizations`, `public.job_attachments`
- New SQL functions: `tg_set_updated_at()`, `job_base_checklist_passes(jobs)` SECURITY DEFINER, `jobs_clear_ready_confirmed_at()` SECURITY DEFINER, `jobs_log_ready_demote()` SECURITY DEFINER, `job_crew_recheck_parents()` SECURITY DEFINER, `materials_recheck_parents()` SECURITY DEFINER
- New triggers: `jobs_set_updated_at_trg` (BEFORE row), `jobs_clear_ready_confirmed_at_trg` (BEFORE row + WHEN gate), `jobs_log_ready_demote_trg` (AFTER row + OF column + WHEN gate), `job_crew_recheck_ready_insert_trg` (AFTER statement w/ transition tables; plus update + delete variants), `materials_recheck_ready_insert_trg` (AFTER statement w/ transition tables; plus update + delete variants), `job_mobilizations_set_updated_at_trg`
- New RLS policies: 4 on `job_mobilizations`, 4 on `job_attachments`, 3 on `storage.objects` (SELECT/INSERT/DELETE — UPDATE dropped) + 1 unconditional DROP of legacy named policy
- New JS helpers: `loadAllRows(tableName, selectStr, {orderBy, filterFn})`, `loadPRTsForCallLogIds()`, `isReady()`, `baseChecklistPasses()`, `sowRowsForCard()`, `formatDays()`, `useDebounced(fn, ms)`
- New routes: `/jobs?tab=staged`, `/jobs/:jobId/mobilizations` (stubbed)
- New realtime channels: `job-crew-changes`, `materials-changes` (debounced)
- New storage assets: `job-attachments` bucket (asserted private via `DO $$` RAISE EXCEPTION)
- New test fixture: §8a parity matrix (crew × material × SOW × date combos)

### Cross-system reach
- **sales-command** — send-to-schedule writes still traverse the new triggers; trigger-WHEN-gate (round-3 C2) only protects Promote SET, not other field updates. Verify sales-command's `updateJobField` calls don't accidentally fire `jobs_clear_ready_confirmed_at_trg`
- **field-command** — `job_crew` writes from PowerSync now fire statement-level `job_crew_recheck_ready_insert_trg`. PowerSync explicitly BLOCKED from `job_mobilizations` (§6.3 round-3 C4) until per-tenant bucket refactor
- **PowerSync** — sync-rule blocking is a documentary gate, not enforced by code; an over-eager rule update would still leak
- **Supabase Storage** — private bucket creation runs in same migration; unconditional named DROP of legacy policy fails loudly if name differs
- **Service-role write paths** — all 4 new SECURITY DEFINER functions inherit elevated privileges; explicit tenant filter inside the body is the only safety net

### Irreversibility
- 3 split migration timestamps (all additive at column/table level, destructive at storage-policy level due to unconditional named DROP):
  1. `+0_jobs_columns.sql` — additive
  2. `+1_jobs_fns_and_triggers.sql` — additive
  3. `+2_child_triggers.sql` — additive
  4. (Separate) `job_mobilizations` migration — additive
  5. (Separate) `job_attachments` + storage policies migration — **destructive on storage.objects** (named DROP)
- Ledger-coordinated (CLAUDE.md RESUME ALERT; repair gate documented in §6.4)
- No data backfill required (new columns default NULL)
- No public API change in this loop
- Cross-repo schema contract change BLOCKED: PowerSync sync rules must NOT add `job_mobilizations` until refactor lands (§6.3 enforcement is humans-only)

### Known weak points
- **`WHEN` clause on BEFORE trigger** (§3.12 C2 fix) excludes Promote SETs (`OLD IS NULL`) and explicit clears (`NEW IS NULL`). But the trigger STILL fires on any UPDATE where both are non-NULL and the row is in a doomed state — including UPDATEs that touched fields unrelated to the checklist. Side effect: a benign `UPDATE jobs SET notes='x'` on a Staged-but-promoted-then-broken job will silently null the timestamp. Is this intentional?
- **AFTER audit trigger `source` CASE** (§3.12 C1 fix) detects On Hold → Resume by checking `OLD.status = 'On Hold'` AND `NEW.status <> OLD.status`. If the UPDATE clears `ready_confirmed_at` WITHOUT changing status (e.g. admin manual clear, BEFORE-trigger auto-clear), source is `trigger_auto_demote`. Correct? Or should there be a third source like `manual_clear`?
- **`current_setting('request.jwt.claims', true)` actor resolution** can return NULL for service-role writes (PowerSync, edge fns, server-side sales-command). Source then becomes `'system'`. Adversarial: can an attacker spoof JWT claims at the PostgREST layer to assign blame?
- **Statement-level triggers with `REFERENCING NEW TABLE / OLD TABLE`** require PostgreSQL 10+; assume Supabase is on PG13+ but not stated. Also: `REFERENCING` syntax interacts oddly with `INSERT ... ON CONFLICT DO UPDATE` — verify whether ON CONFLICT triggers the INSERT or UPDATE statement-trigger
- **`job_base_checklist_passes()` reads `call_log.tenant_id` to derive `v_tenant_id`** — if call_log row is missing (orphan job), function returns false, which silently demotes the parent. Is that the desired behavior or a data-integrity flag?
- **Unconditional storage DROP** (§7.3 C3 fix) fails the entire migration if prod policy name differs. Per audit, the name is `"Authenticated can delete job-attachments"`. The verification query is documented but the migration doesn't run it pre-DROP — a stale plan author could push, fail, and need ledger surgery. Should the migration include a pre-flight assertion?
- **Bucket assertion `DO $$` block** raises if bucket is missing OR public. But the upsert runs first, so a stale `public=true` row gets flipped to false BEFORE the assertion — which then passes. The assertion only catches the case where the upsert itself failed, which is rare. Tighten to assert on insert path?
- **Parity test fixture (§8a)** is spec'd but not gated on CI. Without enforcement, the SQL/JS drift it's meant to catch will land in main between test-write and next test-run. Should the migration block on a parity check?
- **300ms realtime debounce** (round-3 E5) — chosen "lower bound." No test for CSV imports of 5000+ rows; debounce could still freeze under sustained burst. Worth a stress-test scenario in the build loop?
- **`loadAllRows` rewrite** (D2) requires every existing call site to be migrated to the new `(tableName, selectStr, opts)` signature. Plan doesn't enumerate call sites; missed site = silent old-API call = potential infinite loop
- **§7.3 storage UPDATE policy removal** (A3) — assumes files are immutable. Verify no existing or planned attachment-rename UI in any sibling repo

### Open questions
- Count: 5 (§10 — Q1, Q2, Q3, Q4, Q5; Q6 + Q7 + Q8 + Q9 marked resolved/withdrawn)
- Highest-pressure for adversarial agents:
  - Q4 — `Send to Billing` exact behavior on Production Complete (still undefined contract; potential RLS hole if it crosses tenant)
  - Q3 — Attachments build scope deferred but storage migration runs now; verify the DROP doesn't break sibling repos that depend on the legacy policy

### Suggested attack angles (3 total)

1. **Trigger semantics + audit-log faithfulness** — covers state model, audit logging, real-time. Required reading: §3.9, §3.12 (all of .1 / .2 / .3 / .4), §8a parity fixture, §9 channels + debounce, existing `src/lib/queries.js` (esp. `updateJobField` 5-arg signature), `job_changes` schema. Specific pressure:
   - Does `WHEN (OLD IS NOT NULL AND NEW IS NOT NULL)` actually block all Promote-SET self-nulls, or is there a path where Promote also touches another checklist field and re-fires?
   - `source` CASE in `jobs_log_ready_demote()` — enumerate every code path that clears `ready_confirmed_at` and assert each maps to a correct source value (manual clear w/o status change should arguably be `manual_clear`, not `trigger_auto_demote`)
   - JWT-claim actor: spoofing at PostgREST, service-role writes (sales-command edge fns, PowerSync workers), null-actor handling
   - `INSERT ... ON CONFLICT` against statement-level triggers — INSERT or UPDATE statement-trigger? Both?
   - 300ms debounce + 3 channels under sustained burst (PowerSync bulk sync of 1000+ child rows)
   - §8a parity fixture: confirm the actual `materials.status` enum domain in prod (CHECK constraint, app-layer allowlist, neither?) — JS whitelist vs SQL blacklist divergence depends on real domain

2. **SECURITY DEFINER + RLS bypass surface** — covers RLS, storage, multi-tenancy, cross-repo. Required reading: §3.12 (all SECURITY DEFINER functions), §6.2 (job_mobilizations RLS), §7.1–§7.3 (job_attachments + storage), `CLAUDE_RLS.md`, `20260512120100_job_wtcs_create.sql`. Specific pressure:
   - 4 functions declared SECURITY DEFINER inherit migration-owner privileges. The locked `search_path = public, pg_temp` blocks shadow-fn attacks, but does the body's tenant filter actually catch every cross-tenant call path? E.g., a service-role UPDATE on `job_crew` row in tenant A whose parent is in tenant B
   - Storage DROP is now unconditional + named. What sibling-repo policy migrations might conflict? cross-repo grep for the legacy policy name
   - `DO $$` bucket-privacy assertion — can it be bypassed by upserting after the assertion? (Assertion runs as part of migration, but a follow-up `UPDATE storage.buckets SET public=true` flips it. No `IMMUTABLE` lock.)
   - PowerSync sync-rules BLOCK is documentary only — if a future loop adds `job_mobilizations` to the existing broad SELECT rules without doing the per-tenant refactor first, RLS is silently bypassed for crews
   - Service-role writes (sales-command edge fns) can write `jobs.ready_confirmed_at` directly, bypassing the `updateJobField` audit log. The AFTER trigger still fires the demote-log row but the SET event has no audit row at all

3. **Migration safety + loader correctness** — covers migrations/schema, data layer, performance. Required reading: §8 step 1 (3-timestamp split), §6.4 (ledger gate), §2.4 (loadAllRows rewrite), §3.10 (PRT bulk loader), §9 (debounce), CLAUDE.md RESUME ALERT, existing `npm run db:push` wrapper. Specific pressure:
   - 3-timestamp split: if `+0` (columns) succeeds but `+1` (triggers) fails mid-statement, the columns exist with NO trigger coverage. Is there a transactional wrapper? What's the recovery procedure?
   - Unconditional named DROP fail-mode: migration aborts, ledger left partial — same RESUME ALERT scenario the split was meant to avoid
   - `loadAllRows` new signature — enumerate every existing call site in sch-command and verify migration plan. Any missed site silently runs the old 1-arg API
   - `orderBy` required — what's the default behavior of the wrapper when caller forgets? Plan says throws; verify the throw is at call-time, not first-page-time (cost of failure)
   - PRT bulk loader chunk-100: PostgREST URL cap is ~2-4KB depending on proxy; 100 UUIDs at 36 chars each plus formatting = ~4KB. Real measurement?
   - Pre-indexed Maps: stale-by-one-tick scenario. Realtime debounce fires loadData(), Map rebuilds, but in the gap another channel event arrives and triggers a re-render against the half-rebuilt Maps

### Suggested agent count: 3

Rationale: same 3-angle split as round-1 (state-model / RLS / data-layer) because round 3's changes concentrated in those exact areas — each angle now has substantially more new surface to attack. Splitting into 4 would create overlap on triggers (state-model + RLS both want them); collapsing to 2 would short the migration-safety angle which is now genuinely meatier (3-timestamp split + unconditional DROP + loader-signature change).
