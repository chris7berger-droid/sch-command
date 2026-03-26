# Handoff — Schedule Command

**Date:** 2026-03-26
**Last commit:** Shared DB, auth, branding, design system overhaul

## What Was Done This Session

### 1. Shared Database (Sales Command + Schedule Command)
- **Migrated all 6 scheduling tables** (jobs, crew, assignments, crew_status, materials, billing_log) into the Sales Command Supabase project (`pbgvgjjuhnpsumnowuym`)
- **Old Supabase project** (`tzwhgspgpyzhhwwjzugb`) is now unused — safe to delete
- Both apps point to the same database
- `.env.local` and `migrate.mjs` updated to use shared project credentials
- **51 jobs, 23 crew, 519 assignments, 31 crew statuses, 21 materials, 23 billing log entries** migrated from CSV

### 2. Sales-to-Schedule Sync (Database Triggers)
Three Postgres triggers created on the shared DB:

- **`trg_create_job_on_sold`** — When a proposal status changes to "Sold", auto-creates a job in the `jobs` table with:
  - job_num, job_name from call_log
  - amount from proposals.total
  - work_type names from proposal_wtc → work_types
  - prevailing_wage, start_date, end_date from proposal_wtc
  - field_sow (jsonb) combined from all WTCs
  - Materials auto-populated into the materials table
  - call_log_id FK linking back to sales-command
  - Skips if job already exists for that call_log (no duplicates)

- **`trg_sync_job_amount`** — When proposals.total changes on a Sold proposal, updates jobs.amount automatically

### 3. Schema Changes
- Added `field_sow JSONB` column to jobs table
- Added `call_log_id BIGINT REFERENCES call_log(id)` to jobs table
- Added index on `jobs.call_log_id`

### 4. Authentication
- **Supabase auth wired up** — same team_members + auth system as Sales Command
- `src/lib/auth.js` — getSession, onAuthStateChange, signIn, signOut, getCurrentTeamMember
- `src/views/Login.jsx` — branded login page with forgot/reset password flows
- App.jsx gates all content behind login
- Sign Out button in header actions row
- Same credentials work for both Sales Command and Schedule Command

### 5. Row Level Security
- RLS enabled on all 6 scheduling tables
- Policy: authenticated users can do everything (SELECT, INSERT, UPDATE, DELETE)
- Unauthenticated requests get nothing
- Database triggers still work (run as service role)

### 6. Branding — "Schedule Command"
- Renamed from "Schedule Commander" to "Schedule Command"
- **SCH crosshair icon** (SVG, matches Sales Command's SC icon)
- Header uses teal `#30cfac` accent (matching Sales Command brand)
- Content areas keep green `#5BBD3F` for buttons, tags, status indicators
- Favicon updated to SCH crosshair
- `src/components/Logo.jsx` — ScheduleCommandMark + AppWordmark components

### 7. Design System Overhaul
- **Linen background** updated to match Sales Command (`#b5a896` base, `#c8bcaa` cards)
- **Borders softened**: `2px solid` → `1px solid` with lower opacity throughout
- **Border radius**: `4px` → `8-10px` (rounder, softer cards)
- **Box shadows added**: `0 2px 8px rgba(28,24,20,0.07)` on cards, search, scoreboards
- **Scrollbar** styled to match (teal thumb)
- CLAUDE.md updated with full design system reference

### 8. Contract Amount Editor
- Jobs expanded detail: Contract field is now an editable input with Save button
- Saves directly to Supabase `jobs.amount`
- Progress bar appears once a job has a contract amount

### 9. Field SOW Modal
- `src/components/FieldSowModal.jsx` — renders field_sow jsonb as printable PDF
- Day-by-day view: tasks (with checkboxes), materials per day, crew count, hours
- Branded header (SCH, dark/teal)
- Print button opens new window with print dialog
- "Field SOW" button appears on expanded job cards that have field_sow data

## Files Changed
- `CLAUDE.md` — updated name, shared DB, design system reference
- `index.html` — title updated
- `migrate.mjs` — points to shared DB, fixes for amount parsing, FK ordering
- `public/favicon.svg` — SCH crosshair icon
- `src/App.css` — design system overhaul (borders, radius, shadows, login styles)
- `src/App.jsx` — auth gate, sign out, branding, Logo import
- `src/index.css` — color variables updated, scrollbar, autofill styles
- `src/views/Jobs.jsx` — contract amount editor, Field SOW button, FieldSowModal import

## New Files
- `src/lib/auth.js` — auth helpers
- `src/views/Login.jsx` — login page
- `src/components/Logo.jsx` — SCH icon + wordmark
- `src/components/FieldSowModal.jsx` — field SOW print modal

## What's Next
1. **Vercel deploy** — import repo, set env vars, deploy
   - Env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
   - Set up custom domain (e.g., schedule.scmybiz.com)
2. **Delete old Supabase project** (`tzwhgspgpyzhhwwjzugb`) — no longer needed
3. **Test the Sold trigger** — mark a proposal as Sold in Sales Command, verify job appears in Schedule Command
4. **Finish Send Schedules** — replace alert placeholder with actual SMS/text flow
5. **Polish pass** — consistent error toasts, mobile responsiveness
6. **Add Supabase redirect URL** — add the Vercel domain to Supabase auth allowed redirect URLs (for password reset)

## Database Triggers (on shared Supabase)
- `create_job_on_sold()` — fires on `proposals` UPDATE of status
- `sync_job_amount()` — fires on `proposals` UPDATE of total

## Known Issues
- None blocking deployment
- Send Schedules is still a placeholder alert
- Some views have minor inline style inconsistencies
