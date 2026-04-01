# Handoff — Schedule Command

**Date:** 2026-04-01
**Last commit:** App access gate for schedule permission

## What Was Done This Session (v3)

### 1. Homebrew + GitHub CLI Installed
- Homebrew installed at /opt/homebrew/bin/brew
- GitHub CLI (`gh`) installed and authenticated as chris7berger-droid
- Note: `brew` and `gh` require full path (`/opt/homebrew/bin/`) unless
  PATH is updated in shell profile

### 2. Resend Domains Verified
- All three domains confirmed Verified in Resend dashboard:
  scmybiz.com, schmybiz.com, hdspnv.com
- DNS records (DKIM TXT + SPF TXT) fully propagated

### 3. SMTP API Key — Still Missing
- Supabase SMTP Settings password field is empty
- This means forgot-password emails won't send (Supabase can't auth with Resend)
- Invites work fine (they use edge functions + Resend API directly)
- Fix: paste a Resend API key into Supabase → Auth → Email → SMTP Settings → Password

### 4. RLS Tightened — All 7 Tables
- Replaced wide-open `anon_all_*` policies with `authenticated`-only policies
- Tables: jobs, crew, assignments, crew_status, work_types, materials, billing_log
- Each table has SELECT, INSERT, UPDATE, DELETE policies for authenticated role
- SQL saved in `rls_tighten.sql` for reference

### 5. Localhost Login Bypass Removed
- App.jsx no longer skips login on localhost
- Login required on all environments (dev + prod)

### 6. Vercel SPA Routing Fixed
- Added `vercel.json` with rewrites so client-side routes work on refresh
- Without this, direct navigation to /jobs, /schedule, etc. returned Vercel 404

### 7. App Access Gate
- `getCurrentTeamMember()` now fetches `apps` column from team_members
- After login, checks if `team_members.apps` includes `"schedule"`
- Shows styled "Access Denied" screen with Sign Out button if not authorized
- Three-state teamMember: `undefined` (loading), `false` (not found), object (ok)
- Works with the multi-app architecture built in Sales Command v43

### 8. Chris's auth_id Linked
- team_members row for chris@hdspnv.com now has auth_id linked to
  chris7berger@gmail.com Supabase auth user (c5539eac-4518-4f64-8183-362ffcbded76)
- apps set to `["sales", "schedule"]`

## Files Changed (this session)
- `vercel.json` — new, SPA rewrites for Vercel
- `rls_tighten.sql` — new, RLS policy migration script
- `src/App.jsx` — removed dev bypass, added access gate + loading states
- `src/lib/auth.js` — added `apps` to team_members select

## Commits This Session (oldest to newest)
- f979c4f  feat: tighten RLS — replace anon_all policies with authenticated-only
- ac5a785  fix: add vercel.json rewrites for SPA client-side routing
- faa2ee6  feat: app access gate — only members with "schedule" in apps can log in

All pushed to main, deployed via Vercel.

## Known Issues
- **SMTP password empty** — forgot-password emails won't send until Resend API key
  is pasted into Supabase SMTP settings
- **406 console error** — team_members query uses `.single()`, returns 406 when no
  row matches; harmless but noisy (could switch to `.maybeSingle()`)
- **Vercel DNS Change Recommended** — Vercel suggests switching schmybiz.com from
  CNAME to A record; not blocking, cosmetic warning

## What's Next
1. **SMTP API key** — paste Resend key into Supabase SMTP password (30 seconds)
2. **Bug hunt** — go through all 7 views and fix issues
3. **Send Schedules** — build crew card flipper for SMS/text
4. **Rename Supabase project** — display name from "sales-command" to "command-suite"
5. **Share Team page / invite flow** with Schedule Command (from SC v43)

## Architecture Notes
- **Separate repos, shared DB** — correct pattern for the Command Suite
- Repos: `sales-command` (scmybiz.com), `sch-command` (schmybiz.com)
- Shared Supabase project: `pbgvgjjuhnpsumnowuym`
- Auth: Supabase Auth, single user pool across all apps
- Multi-app access: `tenant_config.apps` (tenant subscription),
  `team_members.apps` (per-member access). Apps: sales, schedule, field, ar
- RLS: authenticated-only on all 7 scheduling tables (no tenant_id filter yet)
- Deploy: Vercel auto-deploy on push to main

## Domain Reference
- **scmybiz.com** — Sales Command
- **schmybiz.com** — Schedule Command
- **sccmybiz.com** — Sub Con Command (landing page)

## Session Prompt for Next Claude Code Session
Continue building Schedule Command. Read HANDOFF.md for context.
RLS is locked down, app access gate is live. Next: paste Resend API key
into Supabase SMTP, then bug hunt across all 7 views.
