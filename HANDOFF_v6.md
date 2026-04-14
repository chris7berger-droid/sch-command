# Handoff v6 — Sales → Schedule → Field Workflow Refactor
**Date:** 2026-04-14
**Repos touched:** sch-command, sales-command, field-command

## What Was Done

### Architecture Change: call_log as Master Record
The `jobs` table in Schedule Command was a denormalized copy of Sales data that drifted after push. This session refactored the entire pipeline:

- **`jobs` is now a schedule extension** of `call_log` — shared fields (job_name, job_num, customer, address, prevailing_wage) are read from `call_log` via join, not copied
- **New shared data layer** (`src/lib/queries.js`) — `loadJobs()` joins jobs→call_log with fallback for legacy rows (null call_log_id)
- **All 7 views refactored** to use `loadJobs()` instead of direct `jobs` queries
- **Audit logging** — every job field edit writes to `job_changes` table with old/new values

### New Status Progression
```
Sales Approved → Parked → Scheduled → In Progress → On Hold → Complete
     (Sales)      (Schedule Builder)   (auto from Field Command)
```

### Database Changes (already applied to prod)
- `jobs` table: added `call_log_id` (int FK), `scheduled_start` (date), `scheduled_end` (date)
- `job_changes` audit table: id, job_id, call_log_id, field, old_value, new_value, changed_by, changed_at, source
- Backfilled 11 existing jobs with `call_log_id` from `source_call_log_id`
- Postgres trigger `trg_auto_in_progress` on `time_punches` — auto-sets jobs.status and call_log.stage to 'In Progress' on first clock_in
- Migration SQL saved at `~/sch-command/migration_workflow_refactor.sql`

### Schedule Command (sch-command)
1. **`src/lib/queries.js`** (NEW) — `loadJobs()`, `loadJob()`, `updateJobField()`, `updateJobFields()`, `updateCallLogStage()`
2. **`src/views/JobDetail.jsx`** (NEW) — Full detail view at `/jobs/:jobId` with 6 tabs: Overview, Schedule, Billing, Materials, Field SOW, History
3. **`src/views/Jobs.jsx`** — Parked/Incoming Jobs section (dark background, always visible regardless of date filter), "View Detail" button, new status options, scoreboard includes Parked count
4. **All 7 views** — switched to `loadJobs()`, dates use `scheduled_start`/`scheduled_end` with fallback, writes go through audit-logged functions
5. **`src/views/Schedule.jsx`** — optimistic UI updates (local state updates before DB round-trip), status filter includes Scheduled/In Progress
6. **`src/App.jsx`** — added `/jobs/:jobId` route, imported JobDetail
7. **`src/App.css`** — Parked section styles, JobDetail view styles (linen cards, dark active tabs, timeline), View Detail button

### Sales Command (sales-command)
- **`src/components/ProposalDetail.jsx`** — `handleSendToSchedule()` now sets `call_log_id`, `status: 'Parked'`, `scheduled_start`/`scheduled_end`. Updates `call_log.stage = 'Parked'`. Legacy fields still copied for backward compat.

### Field Command (field-command)
- **HomeScreen.js, JobListScreen.js, WelcomeScreen.js** — stage filter updated from `'mobilized'/'in_progress'` to include `'Scheduled'/'In Progress'` (with backward compat)

## Date Architecture
- **Bid dates** stay on `proposal_wtc.start_date`/`end_date` — sales forecast, never overwritten
- **Scheduled dates** on `jobs.scheduled_start`/`scheduled_end` — crew reality, editable by schedule team
- When pushed from Sales, bid dates are copied into scheduled dates as starting point
- All views use `effectiveStart(j)` / `effectiveEnd(j)` which checks scheduled dates first, falls back to legacy

## What's NOT Done

### PowerSync Sync Rules
The sync rules on PowerSync dashboard need updating to filter `call_log` by new stage values ('Scheduled', 'In Progress'). Currently still filtering for old values. Update at: dashboard.powersync.com > Field Command > Sync Rules

### Standalone Job Creation
The `+ Job` button in App.jsx still creates jobs without `call_log_id`. This is fine for now (suite-first approach). Standalone mode will need a job creation flow that writes to `call_log` directly.

### `changed_by` placeholder
All audit log entries currently write `'schedule_user'` as `changed_by`. This should be replaced with the actual team member name from the auth context (available via `getCurrentTeamMember()`).

### Job Detail View Polish
The detail view works but could use:
- Editable fields in Overview tab (inline edit like Schedule view)
- Customer link to Sales Command
- Photo gallery tab (when Field Command photos land)

## Files Changed

### sch-command
- `src/lib/queries.js` — NEW shared data layer
- `src/views/JobDetail.jsx` — NEW detail view
- `migration_workflow_refactor.sql` — NEW migration (already applied)
- `src/App.jsx` — route + import
- `src/App.css` — parked section, detail view, view button styles
- `src/views/Jobs.jsx` — parked section, loadJobs, audit logging, new statuses
- `src/views/Schedule.jsx` — loadJobs, optimistic updates, scheduled dates
- `src/views/Billing.jsx` — loadJobs, audit logging
- `src/views/Daily.jsx` — loadJobs, new status filter
- `src/views/Materials.jsx` — loadJobs, new status filter
- `src/views/Calendar.jsx` — loadJobs, scheduled dates
- `src/views/Schedules.jsx` — loadJobs, scheduled dates

### sales-command
- `src/components/ProposalDetail.jsx` — thin Parked insert, call_log.stage update

### field-command
- `src/screens/HomeScreen.js` — stage filter
- `src/screens/JobListScreen.js` — stage filter
- `src/screens/WelcomeScreen.js` — stage filter

## Build / Run
```
# Schedule Command
cd ~/sch-command && npm run dev

# Sales Command
cd ~/sales-command && npm run dev

# Field Command
cd ~/field-command && npx expo run:ios
```

## Next Priorities
1. Wire actual user name into `changed_by` (replace 'schedule_user')
2. Update PowerSync sync rules for new stage values
3. Test full end-to-end: Sales approve → Push → Parked → Confirm → Scheduled → Field punch → In Progress
4. Job Detail view: inline editing, customer link
5. Mobilization workflow: how does `job_crew` get populated in production?
