# Handoff v5 — Command Suite Cross-App Session
**Date:** 2026-04-14
**Repos touched:** sales-command, sch-command, field-command

## What Was Done

### 1. Field Command — CLAUDE.md created
- Full project context: stack, PowerSync config, schema, design system, build commands
- Located at `~/field-command/CLAUDE.md`

### 2. Schedule Command — Bug Hunt (3 issues resolved)
- **`.single()` → `.maybeSingle()`** on team_members query in `src/lib/auth.js:34` — fixed 406 console error
- **Test job #79 deleted** from `jobs` table — no related records existed
- **Password reset** — rewired Login.jsx to call shared `reset-password` edge function instead of broken Supabase SMTP

### 3. Password Reset — Multi-App Edge Function
- Updated `sales-command/supabase/functions/reset-password/index.ts`
- Detects calling origin (salescommand.app vs schedulecommand.com/schmybiz.com)
- Sends branded email: correct app name, from address, redirect URL
- CORS origins include: salescommand.app, scmybiz.com, schedulecommand.com, schmybiz.com
- Deployed to Supabase

### 4. Domain Setup — schedulecommand.com
- **Vercel**: schedulecommand.com + www added to sch-command project
- **DNS**: A records pointing to 76.76.21.21 (propagated)
- **Resend**: schedulecommand.com added as sending domain, DNS records added, DKIM verified (domain verification may still be pending)
- **Supabase**: Redirect URLs added for schedulecommand.com + www
- **Note**: Also added missing salescommand.app redirect URLs to Supabase

### 5. Per-Crew Job Filtering — In Progress
**Database:**
- Created `job_crew` table: `id` (uuid PK), `job_id` (int FK call_log), `team_member_id` (uuid FK team_members), `role` ('lead'|'crew'), `created_at`
- Unique constraint on (job_id, team_member_id)
- Indexed on team_member_id and job_id
- RLS off (consistent with other sch-command tables in dev)

**Schedule Command UI (sch-command):**
- Field Crew assignment section added to expanded job detail in Jobs.jsx
- Dropdown to assign team_members, chips with L/C role badge, remove button
- Role toggle (click L/C badge to switch lead↔crew)
- Data loads on job expand, saves immediately to `job_crew`
- CSS in App.css (`.jh-field-crew-*`, `.jh-fc-*`)

**Field Command app (field-command):**
- `job_crew` added to PowerSync schema in `src/lib/schema.js`
- `powersync-sync-rules.yaml` written with 3 buckets:
  - `global` — team_members (everyone)
  - `admin_all` — Admin/Manager get all tables unfiltered
  - `crew_assigned` — crew gets only assigned jobs + own punches/reports
- **Sync rules NOT YET applied** in PowerSync dashboard

**Test data:**
- Chris Berger assigned to job 44 (Tim Milton) as crew in `job_crew`

## What's NOT Done (pick up here)

### Immediate — Per-Crew Filtering Completion
1. **Apply sync rules in PowerSync dashboard** — paste `powersync-sync-rules.yaml` into PowerSync Cloud > Field Command > Sync Rules
2. **Decide the Mobilization workflow** — How does `job_crew` get populated in production?
   - Option A: Manual only (office assigns via Jobs UI — current state)
   - Option B: Auto-populate from `assignments` table (when crew is scheduled on Crew Schedule, they auto-get `job_crew` access)
   - Option C: Mobilization queue (new "Mobilize" button creates `job_crew` rows from the crew schedule)
3. **Crew onboarding** — Field crew (Ramirez, Little, Loomis, etc.) are only in the `crew` table, not `team_members`. They need `team_members` rows + Supabase Auth accounts to use Field Command. The `invite-user` edge function exists in Sales Command for this.

### Architecture Question (open)
The `assignments` table (crew_name + job_id + date) is for daily scheduling. `job_crew` (team_member_id + job_id + role) is for standing job access. These serve different purposes but overlap:
- Should `job_crew` auto-sync when someone is first scheduled on a job via `assignments`?
- Or should Mobilization be an explicit step that creates `job_crew` rows?
- How does a Job Lead get designated — at mobilization time, or separately?

### Next Priorities (from session start)
3. Per-crew job filtering — **finish** (sync rules + mobilization workflow)
4. Mobilizations — Jobs → Mobilization → Crew Schedule flow
5. Schedule Command bug hunt across remaining 6 views
6. Field Command: photo viewer, web dashboard scaffold

## Files Changed

### sales-command
- `supabase/functions/reset-password/index.ts` — multi-app CORS + dynamic branding

### sch-command
- `src/lib/auth.js` — .single() → .maybeSingle()
- `src/views/Login.jsx` — edge function password reset
- `src/views/Jobs.jsx` — field crew assignment UI
- `src/App.css` — field crew styles
- `supabase/` — linked to project (auto-generated .temp files)

### field-command
- `CLAUDE.md` — new (project context)
- `src/lib/schema.js` — added job_crew table
- `powersync-sync-rules.yaml` — new (3-bucket sync rules)

## Infrastructure Changes
- **Supabase**: `job_crew` table created, test job #79 deleted, `reset-password` edge function redeployed
- **Vercel**: schedulecommand.com + www domains added to sch-command
- **DNS**: A records for schedulecommand.com → 76.76.21.21
- **Resend**: schedulecommand.com domain added + DNS records configured

## Build / Run
```
# Schedule Command
cd ~/sch-command && npm run dev

# Field Command
cd ~/field-command && npx expo run:ios

# Sales Command
cd ~/sales-command && npm run dev
```
