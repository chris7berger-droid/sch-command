SCH_HANDOFF_v12 — May 12, 2026
Session: G5 smoke completion + race condition fix + PR #8 merge to main

===============================================================================
SESSION SUMMARY
===============================================================================

Picked up from v11's blocker: /schedule rendering no crew bubbles on the
Vercel preview despite 63 assignment rows existing in the DB. Walked through
the full diagnostic chain — ruled out stale JWT (sign-out/sign-in), RLS
policy misconfiguration (all PERMISSIVE, broad authenticated policy present),
and tenant scoping (tenant_id matches). Confirmed via direct curl that the
Supabase API returns 63 rows with the same JWT the preview sends.

Root cause: a race condition in Schedule.jsx. The deep-link flow
(/schedule?job=X&week=Y) triggers two rapid weekOffset changes — first the
default current week, then the target week. Two concurrent requests fire;
if the empty current-week response resolves after the valid target-week
response, it overwrites crew assignments with []. Fixed by splitting
fetchWeekData/applyWeekData with a stale-response guard in the auto-load
effect. Manual reloads after mutations are unaffected.

After the fix deployed to the preview, all remaining smoke items passed
(6b deep-link focus, 8 pipeline→scheduled redirect). PR #8 squash-merged
to main. Vercel auto-deploys schedulecommand.com.

===============================================================================
CHANGES SHIPPED
===============================================================================

sch-command (feat/jobs-ia-refactor → main, squash-merged as PR #8):

1. 44cba43 — fix(schedule): guard against stale week-data response on deep-link load
   Split loadWeekData into fetchWeekData + applyWeekData. The useEffect
   that fires on week changes now uses a stale flag in its cleanup — when
   the week changes mid-flight, the old response is discarded instead of
   overwriting the new valid data. The 5 manual reload call sites (after
   assignment saves, crew status changes, etc.) continue to use
   loadWeekData() directly without the guard.

Squash-merged to main as:
  2a286e9 — feat(jobs-ia): Scheduled/Active/On Hold/All refactor + job_wtcs (#8)

===============================================================================
DECISIONS / CHOICES MADE
===============================================================================

1. **Race condition was the root cause, not JWT/RLS/tenant scoping.**
   The v11 handoff hypothesized a stale Supabase JWT from hostname
   migration. Diagnostic chain ruled that out: JWT was valid
   (role=authenticated, correct sub/aud), all assignment policies are
   PERMISSIVE, and curl from the same machine with the same JWT returned
   63 rows. The actual cause was client-side: two concurrent requests from
   the deep-link weekOffset dance, with the empty response arriving last.

2. **Production worked, preview didn't — same DB, same auth.** This
   isolated the problem to the preview's code path. Production (main)
   doesn't have the deep-link feature, so it never triggers the dual-
   request race. The race existed from the first commit (6ba0e95) but
   only manifested when using the ?job=&week= URL params.

3. **Kept loadWeekData as a direct fetch+apply for manual reloads.**
   The stale guard is only needed in the auto-load useEffect (where
   React's effect lifecycle creates the race). Manual reloads from user
   actions (saving assignments, changing crew status) don't have competing
   requests, so they bypass the guard for simplicity.

===============================================================================
NEW BACKLOG ITEMS
===============================================================================

None filed this session. Follow-ups from v11 still carried forward:
  - Materials.jsx integration with new jobs.material_status column
  - Per-WTC Field SOW editing (currently writes jobs.field_sow only)
  - Upstream fix for sales-command's composite job_num / doubled job_name data shape

===============================================================================
CLOSED THIS SESSION
===============================================================================

  - PR #8 (feat/jobs-ia-refactor → main) squash-merged. SHA 2a286e9.
    Full Jobs IA refactor + race condition fix.

===============================================================================
VERIFICATION
===============================================================================

What was verified:

  - **G5 smoke item 6b (deep-link finds row + crew bubbles render)** — PASS.
    After the race condition fix deployed to preview, /schedule?job=87&week=
    2026-04-13 renders crew bubbles for all 9 jobs in the April 13-18 week.
    Focus indicator (teal fill on job-label cell) visible on the targeted row.
  - **G5 smoke item 8 (pipeline → scheduled redirect)** — PASS.
    /jobs?tab=pipeline on the branch-alias preview URL redirects to
    /jobs?tab=scheduled.
  - **Direct API test via curl** — 63 rows returned from Supabase REST API
    for assignments in the April 13-18 date range using Chris's JWT.
    Confirmed the database and RLS are functioning correctly.
  - **Vite build** green after the fix commit.
  - **Vercel preview build** green after push.

What was NOT verified:

  - **Production (schedulecommand.com) post-merge smoke.** PR #8 merged and
    Vercel auto-deploys, but no manual verification of the production deploy
    was done this session. Chris ended the session after approving the merge.
  - **Smoke item 3 (On Hold tab)** — still n/a, 0 On Hold rows in test data.
  - **Smoke item 7 (multi-week pulse on /schedule)** — still n/a, insufficient
    multi-week scheduled data in test environment.
  - **Tenant RLS isolation** — accepted on inspection. Single account in test.

===============================================================================
NOT TOUCHED THIS SESSION
===============================================================================

  - **M3 migration (drop UNIQUE on jobs.source_proposal_id).** Intentionally
    held; ships post-sales-wizard.
  - **M4 backfill (jobs.material_status from materials_needed).** Deferred.
  - **Sales-command wizard implementation.** Next major work item.
  - **Materials.jsx integration with material_status column.** Follow-up.
  - **Per-WTC Field SOW editing UI.** Follow-up.

===============================================================================
NEXT SESSION POINTERS
===============================================================================

First action: verify schedulecommand.com production deploy is live and
crew bubbles render on /schedule. Quick spot-check — should take 30 seconds.

After that, switch to sales-command to start the Send-to-Schedule wizard
implementation per docs/plans/send_to_schedule_wizard.md. The sch-command
IA is now in prod, which was the prerequisite for the wizard work.

Safe operations next session:
  - Production spot-check (read-only page loads).
  - Reading + grepping cross-repo (sales-command wizard plan).
  - Local dev on sales-command.

Unsafe operations — confirm before:
  - Applying M3 to prod (only after sales wizard ships).
  - `supabase db push --linked` from sch-command — STILL BROKEN by the
    cross-repo ledger gap; use Studio SQL + manual ledger insert for now.

===============================================================================
FILES TO PROBABLY KNOW ABOUT NEXT SESSION
===============================================================================

MODIFIED this session:
  src/views/Schedule.jsx
    fetchWeekData / applyWeekData / loadWeekData split. The auto-load
    useEffect uses a stale flag to discard responses from superseded
    week changes. Lines ~170-200.

Everything else from v11's file list is unchanged — the squash merge
folded all prior feat/jobs-ia-refactor commits into 2a286e9 on main.

===============================================================================
GIT STATE ON CLOSE
===============================================================================

sch-command:
  Branch: feat/jobs-ia-refactor (local, 1 commit ahead of origin — the
    handoff v12 commit, not yet pushed).
  origin/main: 2a286e9 (PR #8 squash merge).
  Working tree: clean.
  Open PRs: none.

sales-command:
  Not touched this session.

Supabase project pbgvgjjuhnpsumnowuym:
  No changes this session. M1 + M2 remain applied from v11.

===============================================================================
END STATE
===============================================================================

Merged and deploying. PR #8 landed on main, Vercel auto-deploys
schedulecommand.com. Production spot-check deferred to next session.
Ready for sales-command wizard work.
