# SCH_HANDOFF_v1 — Baseline + changed_by Fix
**Date:** 2026-04-16
**Repos:** sch-command

## Purpose
First handoff doc under the new `SCH_HANDOFF_v{N}` naming convention (matching Sales Command's `SC_Handoff_v{N}` pattern). Consolidates everything from HANDOFF_v7 and the 7 commits since, plus session work done today.

## What's Built (Complete)

### All 7 Views — Functional
1. **Jobs** (`/jobs`) — scoreboard (Ongoing/On Hold/Complete counts), expandable job cards, Parked section with date pickers, P1/P2/CO labels, proposal tags, realtime subscription
2. **Job Detail** (`/jobs/:jobId`) — editable overview (dates, lead, crew, vehicle, equipment, power), crew scheduler tab (JobCrewScheduler), billing tab, materials tab, field SOW tab, grouped history tab
3. **Schedule** (`/schedule`) — weekly crew grid board with drag-and-drop assignment
4. **Billing** (`/billing`) — 3-column RTB pipeline (Pending / Confirmed / Invoiced)
5. **Materials** (`/materials`) — per-job materials tracker with status
6. **Calendar** (`/calendar`) — monthly job date ranges
7. **Daily** (`/daily`) — daily crew status grid
8. **Schedules** (`/schedules`) — mobile crew card flipper for copy/text

### Cross-App Pipeline — Working E2E
Sales approve → Send to Schedule → Parked → Confirm & Schedule → Scheduled → Field Command clock in → auto-trigger In Progress

### Infrastructure
- Vercel linked, preview deploys enabled
- Auth + app access gate (team_members.apps must include "schedule")
- Realtime subscription on jobs table (no manual refresh needed)
- PowerSync sync rules: jobs + job_crew in publication, single all_data bucket
- queries.js data layer with audit logging (job_changes table)
- Export system: week schedule, job list, billing report, materials list, daily status

### App Shell
- Header: logo, sync dot, action buttons (Refresh, + Job, + Crew, Work Types, Crew List, Send Schedules, Export, Sign Out)
- Nav: Jobs, Crew Schedule, Calendar, Daily, Materials, Billing, Schedules
- Modals: Add Job, Add Crew, Work Types CRUD, Crew List (edit/archive/delete), Export menu

## Session Work (2026-04-16)

### 1. CLAUDE.md — Full Rewrite
Old CLAUDE.md still said "No UI views built yet". Rewrote to reflect current state: all 7 views, architecture, database schema, workflow pipeline, design system, critical rules, handoff doc convention.

### 2. Status Insert Bug — RESOLVED (was fixed in SC v70)
Root cause: a Postgres trigger `create_job_on_sold()` was auto-creating job rows with hardcoded `status: 'Ongoing'` before the manual Send to Schedule insert. Trigger was dropped in Sales Command v70. Manual "Send to Schedule" is now the sole path. Tested and passing on Vercel preview.

### 3. changed_by — Wired to Real User Name
Created `src/lib/user.jsx` — `UserProvider` context + `useUser()` hook (follows existing sync/toast context pattern). Wrapped `AppShell` in `<UserProvider teamMember={teamMember}>`. All 4 view files (Jobs, JobDetail, Schedule, Billing) now use `const changedBy = user?.name || 'schedule_user'` instead of hardcoded `'schedule_user'`. Audit logs in `job_changes` table will now record the actual team member name (e.g., "Berger, Chris"). Falls back to `'schedule_user'` if context is missing.

**Files changed:**
- `src/lib/user.jsx` — NEW
- `src/App.jsx` — import UserProvider, wrap AppShell
- `src/views/Jobs.jsx` — useUser() + changedBy
- `src/views/JobDetail.jsx` — useUser() + changedBy
- `src/views/Schedule.jsx` — useUser() + changedBy
- `src/views/Billing.jsx` — useUser() + changedBy

**Testing:** Build passes, dev server runs clean. Needs manual login + change to verify `changed_by` column in `job_changes` shows real name.

## Known Issues

### 1. Crew Schedule ↔ Job Card Sync
When crew is assigned via JobCrewScheduler in a job card, the Crew Schedule view requires a page refresh to see changes (no cross-view realtime sync).

### 2. Send Schedules Placeholder
The "Send Schedules" modal is a placeholder — needs to open the Schedules view card sender or implement SMS/text sending.

## Remaining Work to Finish

### Must-Have for Parity (Apps Script replacement)
| # | Item | Effort | Notes |
|---|------|--------|-------|
| ~~1~~ | ~~Status insert bug fix~~ | ~~Small~~ | DONE — trigger dropped in SC v70 |
| ~~2~~ | ~~Wire real changed_by~~ | ~~Small~~ | DONE — UserProvider context, this session |
| 3 | **Jobs view aesthetics** | Medium | Color pass, card design polish, scoreboard styling — partially started |
| 4 | **Daily Production Reports ↔ SOW** | Large | Real-time progress tracking, actual vs planned production rates, job costing against Field SOW |
| 5 | **Send Schedules — crew text/SMS** | Medium | Card flipper to text crew their weekly schedule |

### Nice-to-Have / Deferred
| # | Item | Notes |
|---|------|-------|
| 6 | Per-crew PowerSync filtering | Needs PowerSync-compatible SQL (no JOINs in parameter queries) |
| 7 | Crew ID migration | Replace `crew_name` string keys with proper `crew.id` FK across assignments, crew_status, job_crew |
| 8 | Cross-view realtime sync | Crew Schedule auto-updates when JobCrewScheduler changes assignments |

## Files Changed Since HANDOFF_v7
```
1ae49c0 feat: simplify expanded job card — actions only, detail in Job Detail
bd08998 fix: use #30cfac hex for proposal tag — --teal var not defined
6b17f1c fix: show P/CO tags on main job list, not just Parked cards
4e6381f feat: P1/P2 and CO labels on Parked job cards
5c912aa feat: Realtime subscription on jobs table — no more manual refresh
a64afc1 feat: simplify Parked card, fix Confirm navigation, add proposal tag
b3d3f14 chore: link Vercel project for preview deploys
```

## Codebase Stats
- 28 commits total
- ~7,164 lines across views + components + lib
- Largest files: Schedule.jsx (1092), Daily.jsx (927), Jobs.jsx (796), Billing.jsx (739)
