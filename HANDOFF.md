# Handoff — Schedule Command

**Date:** 2026-03-30
**Last commit:** Login fixes, work type dropdown, data migration, Resend domains

## What Was Done This Session (v2)

### 1. Login Page Fixes
- SCH crosshair icon now has black (#1c1814) background fill
- "Command" text in "Schedule Command" has black pill background with teal text
- Added "Remember Me" checkbox between password and Sign In button

### 2. Resend Domain Setup
- Added `scmybiz.com` and `schmybiz.com` as sending domains in Resend
- DNS records (DKIM TXT + SPF TXT) added on Namecheap for both
- Both domains pending verification (DNS propagating)
- Once verified, forgot password and auth emails will work from proper domains

### 3. Supabase Auth URL Configuration
- Added redirect URLs to shared Supabase project:
  - `http://localhost:5174/**`
  - `https://www.schmybiz.com/**`
  - `https://sch-command.vercel.app/**`

### 4. Data Migration (Fresh from Google Sheets)
- Imported live production data from Google Sheets CSVs:
  - 62 jobs, 23 crew, 722 assignments, 42 crew statuses, 21 materials, 26 billing entries, 16 work types
- Used service role key to bypass RLS for import
- Old stale migration data was cleared first

### 5. RLS Policies for Anon Access (Dev/Temp)
- Added `anon_all_*` policies on all 7 scheduling tables via SQL Editor
- Allows unauthenticated reads/writes for dev — **must be tightened before prod**

### 6. Work Type Picker Redesign (Crew Schedule)
- Replaced checkbox chip grid with collapsible dropdown
- "Work Types" is now a button that toggles open/closed (saves screen space)
- Clickable list items with checkbox icons (no Cmd-click needed)
- Selected work types display as dark pills with green text next to the button

### 7. Dev Environment
- Repo cloned to `~/sch-command`
- `.env.local` created with shared Supabase credentials
- Localhost dev bypass: skips login on `localhost` (App.jsx)
- Vite dev server: `http://localhost:5174/`

## Files Changed (this session)
- `src/App.css` — login styles, remember me, work type dropdown/button/tags CSS
- `src/App.jsx` — localhost login bypass for dev
- `src/components/Logo.jsx` — black fill on SCH icon
- `src/views/Login.jsx` — "Command" pill class, remember me checkbox
- `src/views/Schedule.jsx` — work type collapsible dropdown with tags
- `src/lib/supabase.js` — no change (service role approach reverted)

## Known Issues
- **Forgot password not working** — Resend domains (scmybiz.com, schmybiz.com) pending DNS verification
- **RLS wide open** — anon_all policies on scheduling tables need to be replaced with authenticated-only policies
- **Login bypass** — localhost skips auth, uses anon key; data loads because of anon RLS policies
- Send Schedules is still a placeholder

## What's Next
1. **Verify Resend domains** — check scmybiz.com and schmybiz.com status, test forgot password
2. **Tighten RLS** — replace anon_all policies with authenticated-only
3. **Remove localhost login bypass** once auth is working
4. **Continue bug hunt** — go through all 7 views
5. **Send Schedules** — build crew card flipper for SMS/text
6. **Rename Supabase project** — from "sales-command" to "command-suite" (display name only)

## Architecture Notes
- **Separate repos, shared DB** — correct pattern for the Command Suite
- Repos: `sales-command` (scmybiz.com), `sch-command` (schmybiz.com), landing page in sales-command (sccmybiz.com)
- Shared Supabase project: `pbgvgjjuhnpsumnowuym`
- Each app can be sold independently; shared DB enables cross-app data sync
- DB triggers sync Sales → Schedule (proposal sold → job created)

## Domain Reference
- **scmybiz.com** — Sales Command
- **schmybiz.com** — Schedule Command
- **sccmybiz.com** — Sub Con Command (landing page)

## All v1 Items Remain Current
Everything from the previous handoff is still accurate:
- Shared DB migration, auth, RLS, branding, design system
- Contract amount editor, Field SOW modal
- DB triggers (create_job_on_sold, sync_job_amount)
