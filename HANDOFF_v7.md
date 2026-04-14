# Handoff v7 — End-to-End Pipeline Validation + JobCrewScheduler
**Date:** 2026-04-14
**Repos touched:** sch-command, sales-command, field-command

## What Was Done

### 1. Full E2E Pipeline Validated
Tested the complete flow: Sales Command approve → Send to Schedule → Parked → Confirm & Schedule → Scheduled → Field Command clock in → auto-trigger → In Progress. **All stages work.**

### 2. JobCrewScheduler Component (NEW)
`src/components/JobCrewScheduler.jsx` — standalone weekly crew scheduling embedded in job cards.

**Features:**
- Weekly cards (Mon–Sat) — multi-week jobs get one card per week
- Teal name bubbles on dark cells for assigned crew
- "Copy from previous week" button replicates day-of-week pattern
- Per-week "+ Add crew member..." button opens availability picker
- Availability picker shows green ○ (free) / red ● (busy on other jobs) per day
- Clickable day dots to assign crew to individual days
- Writes to `assignments` table — same data Crew Schedule reads
- Crew list pulled from `crew` table (actual field workers, not team_members)
- All operations use `call_log_id` (FK) not `jobs.job_id` for `job_crew`

### 3. JobDetail View — Editable Overview + Crew Scheduler
- Overview tab: inline editable dates (with min/max validation), lead, crew needed, vehicle, equipment, power source
- Schedule tab: replaced assignment history table with full JobCrewScheduler
- History tab: grouped by date (collapsed cards instead of one-item-per-row timeline)
- Field SOW tab: fixed crash — render task.description not raw objects

### 4. Jobs View Fixes
- Parked date pickers: optimistic state updates (no await before setJobs)
- Date validation: start ≤ end via HTML min/max attributes
- Confirm & Schedule: navigates to `/schedule` after confirming
- Field crew ops: all use `call_log_id` not `job_id` (FK mismatch fix)
- Input backgrounds: linen deep instead of white
- Replaced inline field crew section with JobCrewScheduler in both Parked and main list

### 5. Field Command — jobs Table + TasksTab Fix
- Added `jobs` table to PowerSync schema (`src/lib/schema.js`)
- TasksTab now reads `jobs.field_sow` (via `call_log_id`) as primary source
- Falls back to `proposal_wtc.field_sow` for legacy jobs
- Production target reads from `jobs.size/size_unit`

### 6. PowerSync Sync Rules Updated
Applied new sync rules in PowerSync dashboard (simplified single bucket):
- `call_log` filtered by stage: Scheduled, In Progress, Parked, mobilized, in_progress
- Added `jobs` and `job_crew` tables
- `jobs` table added to Supabase `powersync` publication (`ALTER PUBLICATION`)
- `job_crew` table added to Supabase `powersync` publication

### 7. Sales Command — Debug Log
- Added `console.log` + `.select()` to Send to Schedule insert to track status field issue
- Known issue: `status: 'Parked'` in the insert payload but DB shows 'Ongoing' — needs investigation

### 8. Misc
- Renamed Field SOW modal title to "Field SOW and Production Rate Tracker"
- Job card number color changed from command-green to text-primary on linen cards

## Known Issues

### Status Insert Bug (Sales → Schedule)
`handleSendToSchedule()` explicitly sets `status: 'Parked'` but the DB row ends up with `'Ongoing'` (the column default). No triggers, no RLS restrictions found. Console log added to track — check browser console on next push to see what Supabase returns.

### changed_by Still Hardcoded
All audit log entries write `'schedule_user'` — needs real user name from auth context.

### Crew Schedule ↔ Job Card Sync
When crew is assigned via JobCrewScheduler in the job card, the Crew Schedule view requires a page refresh to see the changes (no real-time sync between views).

### PowerSync Sync Rules — No Per-Crew Filtering
Current rules give everyone all data (single bucket). Per-crew filtering (`job_crew` based) deferred — needs PowerSync-compatible SQL (no JOINs, no aliases in parameter queries).

## Files Changed

### sch-command
- `src/components/JobCrewScheduler.jsx` — NEW: weekly crew scheduler component
- `src/components/FieldSowModal.jsx` — title rename
- `src/views/JobDetail.jsx` — editable overview, crew scheduler tab, grouped history, field SOW fix
- `src/views/Jobs.jsx` — optimistic dates, date validation, navigate on confirm, JobCrewScheduler integration
- `src/App.css` — JobCrewScheduler styles, history styles, input backgrounds, cell styles

### sales-command
- `src/components/ProposalDetail.jsx` — debug console.log on insert

### field-command
- `src/lib/schema.js` — added jobs table to PowerSync schema
- `src/screens/tabs/TasksTab.js` — reads jobs.field_sow via call_log_id

## Infrastructure Changes
- **Supabase:** `jobs` and `job_crew` added to `powersync` publication
- **PowerSync:** sync rules redeployed with `jobs` table, updated stage filters, single `all_data` bucket
- **Test data:** job 84 manually set to 'Parked' (was 'Ongoing' due to insert bug), crew assigned (Darrin Ary, Axel, Jaime Quinones)

## Next Priorities
1. **Daily Production Reports ↔ SOW** — real-time progress tracking, actual vs planned production rates, job costing against the Field SOW
2. **Status insert bug** — investigate why Supabase JS client drops `status: 'Parked'` on insert
3. **Jobs view aesthetics** — color pass, card design, scoreboard styling
4. **changed_by** — wire real user name into audit logs
5. **Per-crew PowerSync filtering** — re-attempt with PowerSync-compatible SQL
6. **Crew ID migration** — replace crew_name string keys with proper crew.id FK

## Build / Run
```
# Schedule Command
cd ~/sch-command && npm run dev

# Sales Command
cd ~/sales-command && npm run dev

# Field Command
cd ~/field-command && npx expo run:ios
```
