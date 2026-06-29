# Schedule Command

## RESUME ALERT (set 2026-05-14 from sales-command session)

**Migration coordination (items 1–2) is RESOLVED 2026-06-29 by the migration
consolidation** — all migrations moved to `command-suite-db`; this repo no longer
pushes, so cross-repo timestamp/ledger coordination no longer applies here. See
"Database Migrations" below and `~/sales-command/docs/plans/shared_migrations_consolidation.md`.

Remaining (non-migration):

3. **Sibling audit (non-blocking, ~15min).** Sales-command's Multi-GC plan adds a `'Signed'` proposal status (`~/sales-command/docs/plans/multi_gc_allocation.md`). Confirm any sch-command UI that reads `proposals.status` default-renders unknown statuses. Worth a sweep before sales-command ships that part; not a blocker for sch-command work.

---

## Command Suite Shared-Data Contract

The 4 apps (Sales, Schedule, Field, AR) share ONE Supabase DB. Any data that
crosses app boundaries must have a declared **source of truth** (one writer),
**canonical location** (no drifting copies), **copy-vs-reference** policy, and
**sync pipe** (PostgREST web vs PowerSync for Field). Before wiring any
cross-app field, answer those four — don't assume where data lives or who owns
it. Full contract + open decisions: `docs/plans/command_suite_shared_data_contract.md`.

## What This Is
Schedule Command is a React + Vite web app for managing construction crew scheduling. Part of the Command Suite (Sales, Schedule, Field, AR) under the Sub Con Command brand. Replaces a live Google Apps Script version used daily by office staff. The Apps Script stays live until v2 reaches full parity.

## Team
- **Chris** — developer and primary user
- **Office staff** — Joe, John, Denise
- **Field manager** — Jonah
- **Field crew** — Troy + others

## Repos & URLs
- **Repo:** chris7berger-droid/sch-command (main branch)
- **Production:** https://schedulecommand.com (Vercel)
- **Sales Command:** https://salescommand.app (repo: sales-command)
- **Field Command:** React Native/Expo mobile app (repo: field-command)

## Tech Stack
- **React** (Vite) — frontend, SPA with react-router-dom
- **Supabase** — database, auth, realtime (shared with Sales + Field Command)
- **Vercel** — hosting, preview deploys on feature branches
- **PowerSync** — offline sync for Field Command (sync rules in PowerSync dashboard)

## Supabase Project (shared across Command Suite)
- **Project ID:** pbgvgjjuhnpsumnowuym
- **URL:** https://pbgvgjjuhnpsumnowuym.supabase.co
- **Anon key:** in .env.local

## Architecture

### Data Layer — queries.js
All job reads/writes go through `src/lib/queries.js`:
- `loadJobs()` / `loadJob(jobId)` — fetches jobs with call_log join, normalizes flat
- `updateJobField()` / `updateJobFields()` — updates with automatic audit logging to `job_changes`
- `updateCallLogStage()` — stage transitions with audit logging
- **call_log is the master record** — jobs table extends it for scheduling fields
- `job_crew.job_id` is FK to `call_log.id` (NOT `jobs.job_id`) — critical for all crew operations

### App Structure
- `src/App.jsx` — shell with auth, access gate, nav, modals (add job/crew, work types, crew list, export)
- `src/views/` — page-level components (list views)
- `src/components/` — extracted detail views, modals, reusable pieces
- `src/lib/` — supabase client, auth, queries, sync, toast, exports

### Views (all 7 built)
| View | Route | Lines | Purpose |
|------|-------|-------|---------|
| Jobs | `/jobs` | 796 | Scoreboard + job list, Parked cards, status management |
| JobDetail | `/jobs/:jobId` | 447 | Editable overview, crew scheduler, billing, materials, history |
| Schedule | `/schedule` | 1092 | Weekly crew grid board with assignments |
| Billing | `/billing` | 739 | 3-column RTB pipeline (Pending/Confirmed/Invoiced) |
| Materials | `/materials` | 532 | Per-job materials tracker with status |
| Calendar | `/calendar` | 425 | Monthly job date ranges |
| Daily | `/daily` | 927 | Daily crew status grid |
| Schedules | `/schedules` | 655 | Mobile crew card flipper for copy/text |

### Key Components
- `JobCrewScheduler.jsx` — weekly crew scheduling with day bubbles, availability picker, copy-from-previous-week
- `FieldSowModal.jsx` — field scope of work viewer/editor
- `StatsBar.jsx` — job count stats across statuses

## Database Tables

### Schedule-owned tables
- **jobs** — job_id, call_log_id (FK), job_num, job_name, start_date, end_date, status, crew_needed, work_type, vehicle, equipment, power_source, lead, notes, amount, prevailing_wage, sow, field_sow, size, size_unit, color, deleted, deleted_at, plus billing fields
- **crew** — name, team, phone, archived
- **assignments** — job_id, crew_name, date
- **crew_status** — crew_name, status, date (unique on crew_name+date)
- **materials** — job_id, ordinal, name, status, arrival_date, notes
- **billing_log** — job_id, date, percent, cumulative_percent, type, notes, invoiced, invoiced_date
- **job_changes** — audit log: job_id, call_log_id, field, old_value, new_value, changed_by, source
- **job_crew** — crew assignment FK table (uses call_log_id, not job_id)

### Shared tables (owned by Sales Command)
- **call_log** — master record for all jobs across the suite
- **work_types** — name, cost_code, tenant_id, sales_sow
- **team_members** — auth, apps access array

## Workflow (cross-app pipeline)
```
Sales Command: Approve proposal → Send to Schedule (inserts jobs row, status='Parked')
Schedule Command: Parked → Confirm & Schedule → Scheduled
Field Command: Clock in → auto-trigger → In Progress → DPR submission
```

## Database Migrations — moved to `command-suite-db`

**sch-command no longer owns or pushes migrations.** As of 2026-06-29 all Command
Suite migrations live in the dedicated repo **`command-suite-db`**
(`github.com/chris7berger-droid/command-suite-db`) — one source of truth matching
the shared project's one ledger. This retires the old dashboard-SQL-editor +
`repair --status applied` workaround that the cross-repo ledger split forced.

To make a database change: author and push it from `command-suite-db`
(`npm run db:push` there), not here. The collision-check tooling relocated to that
repo, and this repo is unlinked from the Supabase project.

There is no `supabase/` dir here anymore — the migrations + rollbacks were removed
2026-06-29 (§9 decision) and live only in `command-suite-db`. This repo is unlinked
from the Supabase project. Plan + 4-round audit:
`~/sales-command/docs/plans/shared_migrations_consolidation.md`. `repair --status
reverted` on a live ledger entry remains forbidden.

## Design System (Command Suite)

### Colors
- Background: warm linen tones — `#b5a896` (base), `#c8bcaa` (cards), `#a89b88` (deep) — NO white backgrounds
- Dark header/nav: `#1c1814`
- Header accent: teal `#30cfac` (header brand only)
- Content accent: Command Green `#5BBD3F` (buttons, tags, status indicators in content areas)
- Text: `#1c1814` (headings), `#2d2720` (body), `#6b6358` (light), `#887c6e` (faint/labels)
- Teal text must always sit on a dark background (pill/badge)

### Typography
- Display/headings: Barlow Condensed — bold, uppercase, letter-spacing 0.04-0.08em
- Body: Barlow — normal weight
- Numbers/mono: JetBrains Mono

### Components
- Cards: linen card background, `1px solid rgba(28,24,20,0.18)` borders, `border-radius: 10px`, subtle box-shadow
- Buttons: green accent for content, teal for header brand only
- Inputs: linen deep background, never white
- Pills/badges: colored border-left or background based on status
- Crosshatch linen texture is a core brand element, not just flat color

### General Rules
- Warm, muted, professional — NO bright whites, NO harsh borders
- Everything feels like linen/parchment with dark accents
- Philosophy: "3 clicks through simple obvious screens beats 1 click on a complicated screen"

## Critical Rules
- Always use `loadJobs()` from queries.js — never raw `supabase.from('jobs').select('*')`
- All job writes go through `updateJobField()` / `updateJobFields()` for audit logging
- Crew ops use `call_log_id` not `job_id` (FK mismatch)
- Deploy edge functions with `--no-verify-jwt` to avoid 401s
- Test on localhost before pushing; flag shared-element changes
- Use Vercel preview deploys on feature branches
- Page files are list views only; detail/modals/wizards go in `src/components/`
- PostgREST caps at 1000 rows — paginate with `.range()` if needed

## Handoff Docs
Session handoff docs use the naming convention `SCH_HANDOFF_v{N}.md` with incrementing version numbers. Always reference the latest handoff doc for current state.

## Build / Run
```bash
cd ~/sch-command && npm run dev
```

---

## Security Rules

1. **Row Level Security (RLS) policies** — before writing or editing ANY SQL
   that touches RLS, policies, anon access, public pages, or token-gated
   reads, read `CLAUDE_RLS.md` in the repo root. It contains the rules for
   correct policy patterns, the 2026-04-26 sales-command incident
   anti-pattern, and the 6-gate deploy requirements. The anti-pattern in
   `CLAUDE_RLS.md` is the most common RLS mistake — do not write policies
   that match it.
