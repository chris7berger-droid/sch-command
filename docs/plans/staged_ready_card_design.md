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
     job.field_sow != null                      // Field SOW exists
  && (job.scheduled_start || job.start_date) != null  // date is set
  && jobCrewRows.length >= 1                    // at least one job_crew row
  && (
       materialRows.length === 0                // no materials needed (default)
       || materialRows.every(m => m.status === 'Ordered' || m.status === 'In Stock')
     )                                          // OR all materials handled
```

**Materials "decided" signal** = no rows in `Not Ordered` or `Delayed`. Source: `src/views/Materials.jsx:33` STATUS_OPTIONS = `['Not Ordered', 'Ordered', 'In Stock', 'Delayed']`.

**`matCount === 0` default** = "no materials needed" treated as decided. Labor-only jobs don't get stuck in Staged. Tradeoff acknowledged: can't distinguish "intentionally no materials" from "forgot to upload SOW." A future `jobs.no_materials_needed` boolean could disambiguate; deferred until it causes real confusion.

### §2.3 Underlying status column unchanged [LOCKED]

Both Staged and Ready sit on top of `jobs.status='Scheduled'` (and legacy `'Parked'` which normalizes per `jobStatus.js:11`). **No new status value, no migration.** Staged/Ready is a derived bucketing computed at read time from the four checklist items above.

### §2.4 Tile counts [DERIVED]

Compute in `JobsPicker.jsx` alongside the existing `counts.scheduled`:

```js
const stagedCount  = jobs.filter(j => getJobStatus(j) === 'Scheduled' && !isReady(j, jobCrew, materials)).length
const readyCount   = jobs.filter(j => getJobStatus(j) === 'Scheduled' &&  isReady(j, jobCrew, materials)).length
// stagedCount + readyCount === existing counts.scheduled (invariant)
```

`JobsPicker` needs to load `job_crew` and `materials` to compute `isReady`. Today it only loads `jobs`, `assignments`, `billingLog`. Add two queries.

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
| 🚚 MOBS | MOBS | count of mobilizations *(see §6)* | neutral | route `/jobs/:jobId/mobilizations` |

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
| SOW | `jobs.field_sow` or `job_wtcs[0].field_sow` | `Demo (3d) · Install (15d) · Final coat (2d)` (phases summary) |
| NOTES | `jobs.notes` | full text, no truncation |

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
| Staged | `[ Promote to Ready ]` | `isReady === true` (else disabled/greyed) | Office confirms; card moves to Ready tile. **Manual promotion** chosen over auto so office has a beat to review before promoting |
| Ready | `[ Kickoff ]` | always | Sets `jobs.status = 'In Progress'`. Card moves to Active tile |
| Active | *(no button)* | — | Promotion to Complete is driven by Field Command finishing the job |
| On Hold | `[ Resume ]` | always | Sets `jobs.status = 'Scheduled'`. Card returns to either Staged or Ready depending on `isReady` |
| Production Complete | `[ Send to Billing ]` | always | Hands off to billing pipeline. Existing flow — confirm exact behavior with existing `/billing` integration |

**No "Open Job" button.** Card header (Job # + name) is clickable to navigate to existing `/jobs/:jobId?mode=management` view, which now serves only as a deep-history/audit-log surface. The card itself replaces the previous Planning + Management button row.

### §3.10 PRT "behind target" rule [LOCKED]

Source: per-job PRT data from `loadPRTsForJob()` (`src/lib/queries.js`).

```
behind = sum(actual) < sum(target) by >10% across last 3 PRTs
```

Banner shows `on target` (green) or `⚠ Nd behind` (amber) per this rule. Threshold and window can be tuned post-launch.

### §3.11 `jobs.hold_reason` — new column [LOCKED]

```sql
ALTER TABLE jobs ADD COLUMN hold_reason text;
```

- Set when office flips `status` → `'On Hold'`. Free-text input on hold action.
- Cleared (set to NULL) when status flips back to non-`'On Hold'`.
- Surfaced in the On Hold stage banner: `ON HOLD · 14d · {hold_reason}`.

Migration ledger: new timestamp, coordinate per `o7_migration_coordination.md` cross-repo convention.

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

`assigned` = count of distinct `job_crew.crew_id` rows for the job's `call_log_id` (per CLAUDE.md: `job_crew.job_id` is FK to `call_log.id`, not `jobs.job_id`).
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

```sql
CREATE TABLE job_mobilizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      int  NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
  call_log_id uuid NOT NULL REFERENCES call_log(id) ON DELETE CASCADE,
  label       text NOT NULL,            -- 'M1', 'M2', ...
  ordinal     int  NOT NULL,            -- sort order: 1, 2, 3, ...
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  crew_size   int,                      -- NULL = inherit jobs.crew_needed
  field_sow   jsonb,                    -- NULL = inherit jobs.field_sow
  notes       text,
  tenant_id   uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, ordinal),
  CHECK (start_date <= end_date)
);
-- jobs.field_sow + jobs.crew_needed remain as defaults
-- Reads use COALESCE(mob.field_sow, jobs.field_sow), etc.
```

**Hybrid rationale:** common case (M2 = continuation of M1, same scope) just reads parent — no duplication. Edge case (M2 = different scope, e.g., "final coat only") overrides on the mob row. Reads always need `COALESCE` but that's a one-line query helper.

### §6.3 Implications outside this loop [DESIGN-OPEN]

The mobilizations table is its own build, not part of the card-design loop. Downstream changes required before mobs are live:

- `jobs.start_date` / `jobs.end_date` become **derived** (`min(mob.start), max(mob.end)`). Either drop them as columns or leave them as denormalized cache with a trigger to keep in sync. Recommend leaving them and adding a trigger to start; drop later if dual-write proves painful.
- `assignments.job_id` could optionally gain a `mobilization_id` FK so crew assignments belong to a specific mob. Without this, "which mob is this crew on?" requires date-range inference.
- `billing_log` could optionally gain a `mobilization_id` FK so progress billing per mob is natural.
- `JobCrewScheduler.jsx` needs to render multi-block schedules (today assumes one contiguous range).
- `Calendar.jsx`, `Daily.jsx`, `Schedule.jsx` all need to render multi-block jobs without artifacts.
- Field Command (mobile app, separate repo) needs to know which mobilization a crew is clocking into. Coordinate with `field-command` repo owner.

**Plan: build mobs as its own ERD loop after card design lands.** Card design renders `MOBS` scorecard with derived count = 1 today (from `jobs.start/end_date`); once table ships, count comes from `job_mobilizations` and card renders unchanged.

### §6.4 Migration ledger [OPEN]

Migration timestamp TBD. Coordinate with `o7_migration_coordination.md` and check `supabase_migrations.schema_migrations` before drafting.

---

## §7 Attachments — new subsystem [DESIGN-OPEN]

No attachments system exists in sch-command today. Grep for `attachment|file_url|files\.` in `src/` returned zero matches. Needed for the 📎 FILES scorecard to be functional.

Scope outside this loop:
- New table `job_attachments` (id, job_id, call_log_id, label, file_path, file_size, mime_type, uploaded_by, uploaded_at, tenant_id, RLS)
- Supabase Storage bucket (per-tenant or shared with RLS policy)
- Upload UI (drag-drop or file picker)
- Download / preview UI in the FILES scorecard click target
- Cross-app: does Field Command need read access to job attachments? Likely yes for crew refs.

**Plan: card design ships 📎 FILES scorecard as a stub** showing count 0 with click target disabled or showing "Coming soon." Attachments subsystem gets its own loop.

---

## §8 Implementation order (suggested) [DERIVED]

Not part of this design loop; sketched here to inform whoever picks up the build loop.

1. **Compute `isReady`** in `queries.js` — needs `job_crew` + `materials` joined onto loaded jobs. Add helper `isJobReady(job, jobCrew, materials)`.
2. **Tile split** in `JobsPicker.jsx` — add Staged tile before Ready, update Ready tile copy + filter, move Production Complete to Section 2. Counts derive from `isReady`.
3. **Sort + filter** in `Jobs.jsx` — add new tab `staged` to `VALID_TABS`, route `?tab=staged` to a new card list filtered by `!isReady && getJobStatus==='Scheduled'`, update `?tab=scheduled` to filter `isReady && getJobStatus==='Scheduled'`. Sort by `start_date asc, NULL first` on both.
4. **Card template** as new component `StageJobCard.jsx` — replaces the per-stage list cards in `ScheduledCardList.jsx`, `JobCardList.jsx`, `OnHoldCardList.jsx`. Card props include `stage` so banner + action button vary correctly.
5. **`jobs.hold_reason`** migration + edit UI on the On Hold flow.
6. **PRT threshold** computation in a helper, banner pill on Active cards.
7. **Mobilizations** as a separate loop (see §6.3).
8. **Attachments** as a separate loop (see §7).

---

## §9 Open questions

| # | Question | Owner |
|---|---|---|
| 1 | Sort orders for Ready / Active / On Hold / Production Complete (§5.2, §5.3) | Chris |
| 2 | Mobilizations migration timestamp + cross-repo coordination plan (§6.4) | Chris + sales-command owner |
| 3 | Attachments table shape + Storage bucket policy (§7) | Chris (separate loop) |
| 4 | `Send to Billing` exact behavior on Production Complete — does it create a billing_log row, set a flag, or navigate? Confirm vs today's `/billing` integration | Chris |
| 5 | Does `jobs.start_date` / `jobs.end_date` stay as denormalized cache once mobs ship, or get dropped? (§6.3) | Chris (decide during mobs loop) |
| 6 | Should panel toggle state persist across page reloads (per-user pref) or stay session-local? (§3.8) | Chris (revisit post-launch) |

---

## §10 Locked decisions summary

For quick scan by the build loop:

- ✓ New tile **Staged** in Section 1, before Ready
- ✓ **Production Complete** moves Section 1 → Section 2
- ✓ Promotion: `isReady` checklist (§2.2), no schema change to `jobs.status`
- ✓ Materials decided = no `Not Ordered` / `Delayed` rows (§2.2); `matCount === 0` default = decided
- ✓ Card = Option D, three-panel collapse (Planning / Management / Details), all closed default, multi-open allowed, fixed render order (§3)
- ✓ Banner format: always-visible icon-coded missing items + stage countdown (§3.3)
- ✓ Three identity bubbles: Job · Customer · Work Types (§3.4)
- ✓ Scorecards: 5 Planning + 6 Management (§3.5, §3.6), click targets per table
- ✓ Stage action button always visible at bottom (§3.9)
- ✓ Staged promotion = manual `[ Promote to Ready ]` button (not auto)
- ✓ No "Open Job" button — card header clickable instead
- ✓ PRT behind threshold: `actual < target by >10% across last 3 PRTs` (§3.10)
- ✓ New `jobs.hold_reason` column (§3.11)
- ✓ Mobilizations table: Option C hybrid override (§6.2)
- ✓ Staged tile sub-line: `📋 N · 📦 N · 👷 N · 📅 N` (§2.5)
- ✓ Staged sort: nearest `start_date` asc, NULL first (§5.1)
- ✓ Total Work Days: weekdays + scheduled weekends, summed across mobs (§4.1)
