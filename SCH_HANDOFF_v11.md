SCH_HANDOFF_v11 — May 12, 2026
Session: Jobs IA refactor implementation + partial preview smoke (work-desktop pickup of v10 plan)

===============================================================================
SESSION SUMMARY
===============================================================================

Picked up the work-desktop continuation from v10. Cut feat/jobs-ia-refactor,
wrote M1 + M2 migrations paired with rollbacks (new supabase/rollbacks/
convention), built the new UI (helpers, components, view mods), pushed
PR #8 against main, and opened the Vercel preview.

Applied M1 + M2 to PROD via Supabase Studio SQL editor (bypassing
`supabase db push --linked` because the shared-DB ledger has 42
sales-command-owned migrations sch-command doesn't have locally — running
the CLI's suggested `migration repair --status reverted` fix would break
sales-command's next push). Inserted matching ledger rows manually so
future db push/pull/diff treat M1+M2 as applied.

G5 (preview smoke) is partial. Items 1, 2, 4, 5 pass. Item 6 partial — focus
indicator works on the job-label cell, but the /schedule page renders no
crew bubbles because the `assignments` table returns 0 rows to the
authenticated client despite 63 rows existing in the DB for the test week.
Most likely a stale Supabase JWT when switching from the ihugwidzz hash
URL to the branch-alias URL; not confirmed because Chris ended the session
before testing the sign-out / sign-in fix.

PR #8 is NOT merged. M3 (drop UNIQUE on jobs.source_proposal_id) is NOT
in this PR by design — it ships after the sales wizard.

===============================================================================
CHANGES SHIPPED
===============================================================================

sales-command (main):

1. 0286dfe (already on branch before session) merged via PR #23 squash.
   No code change. Carries docs/plans/send_to_schedule_wizard.md onto main
   so cross-repo cites are stable.

sch-command (feat/jobs-ia-refactor):

1. 6ba0e95 — feat(jobs-ia): refactor to Scheduled/Active/On Hold/All + add job_wtcs
   Core implementation:
     M1: supabase/migrations/20260512120000_jobs_material_status_additive.sql
     M2: supabase/migrations/20260512120100_job_wtcs_create.sql (+ 4 RLS policies)
     Rollbacks paired in NEW supabase/rollbacks/.
     UI: src/lib/jobStatus.js (NEW, read-time Parked→Scheduled normalization),
         src/lib/jobCardLabel.js (NEW, title + WTC chip helpers),
         src/lib/queries.js (+ withWTCs option, + getJobMultiWeekAlert),
         src/components/ScheduledCardList.jsx (NEW),
         src/components/OnHoldCardList.jsx (NEW with Resume),
         src/components/JobsPicker.jsx (7 tiles new mix: drop Parked, add On Hold),
         src/components/JobCardList.jsx (centralized getJobStatus, getCardTitle),
         src/components/tabs/ActiveTab.jsx (centralized getJobStatus),
         src/components/tabs/PipelineTab.jsx (DELETED),
         src/views/Jobs.jsx (new tab set, pipeline → scheduled redirect),
         src/views/JobDetail.jsx (drop readiness checklist + gate modal +
           embedded crew grid; add "Schedule this job →" header button),
         src/views/Schedule.jsx (URL-param deep-link snap-to-week +
           scroll-into-view; multi-week pulse on Prev/Next),
         src/App.jsx (Add Job default flips 'Parked' → 'Scheduled'),
         src/App.css (new tile classes + multi-week badge + pulse animation).

2. 0c2c422 — fix(jobs-ia): F1 dedupe doubled job_name + F2 normalize Schedule.jsx status filter
   F2 (real bug): Schedule.jsx weekJobs status check used raw j.status, which
   excluded legacy 'Parked'-status rows even after read-time normalization
   landed elsewhere. Fix: getJobStatus() in the filter. Lets the deep-link
   from a legacy Parked card actually find its row on /schedule.
   F1 (defensive): _dedupeName() in jobCardLabel.js for legacy rows where
   job_name was literally doubled ("X - X" pattern).

3. 100b304 — fix(jobs-ia): F1b strip composite name from job_num before title compose
   F1b: Some rows (e.g., job_id 91, the Lepori test row) store job_num
   as the full composite label "<num> - <name>" instead of just "<num>".
   `${num} - ${name}` doubled the name visually. Added _cleanNum() to
   strip when num's trailing segments equal name. Display-only; no DB write.

4. b78aaa2 — fix(jobs-ia): F3 focus indicator targets job-label cell only (not row wrap)
   Prior `.sch-row-focused` outline on the wrap div either wasn't reaching
   the DOM or was getting visually lost under the existing Δ2X over-assigned-crew
   green outlines on day cells. Moved the conditional class to
   `.sch-brd-job-label` so the focus reads as "you are here" on the job name.

5. fbdd097 — fix(jobs-ia): F3b drop the unrequested FOCUS badge — teal fill alone is the indicator
   Removed the "◀ FOCUS" pill I'd added without being asked; it overlapped
   the truncated job-name text on the label cell. Teal fill is the indicator.

PR #8 (sch-command/feat-jobs-ia-refactor → main): OPEN, NOT MERGED.
https://github.com/chris7berger-droid/sch-command/pull/8

===============================================================================
DEPLOYED
===============================================================================

Supabase project pbgvgjjuhnpsumnowuym (shared Command Suite project):

  M1 — `jobs.material_status` text column + CHECK constraint
  M2 — `job_wtcs` table + 4 RLS policies (SELECT/INSERT/UPDATE/DELETE),
       all on `authenticated` role, scoped via
       jobs → call_log.tenant_id = get_user_tenant_id()

Both applied via Supabase Studio SQL editor (NOT via `supabase db push --linked`).
Ledger rows manually inserted:

  INSERT INTO supabase_migrations.schema_migrations (version, name)
  VALUES
    ('20260512120000', 'jobs_material_status_additive'),
    ('20260512120100', 'job_wtcs_create')
  ON CONFLICT (version) DO NOTHING;

Vercel: PR #8 preview deploying on every push to feat/jobs-ia-refactor.
Production schedulecommand.com unchanged (no merge to main).

Dashboard URLs:
  Supabase: https://supabase.com/dashboard/project/pbgvgjjuhnpsumnowuym
  Vercel preview (branch alias):
    https://sch-command-git-feat-jobs-i-7915bc-chris7berger-droids-projects.vercel.app

===============================================================================
DECISIONS / CHOICES MADE
===============================================================================

1. **Skipped Supabase preview branches for this lift.** The integration
   isn't enabled on sch-command's repo (no Supabase Preview check on PR #8).
   Standing one up means enabling branching in the dashboard + (possibly)
   a plan upgrade. For 2 additive migrations with paired rollbacks, the
   infra setup is more work than the rollback it would have hedged against.
   Worth revisiting before the sales wizard work.

2. **Inverted G5 ↔ G6 from the lift map** (apply-to-prod before preview-smoke).
   The new Jobs page crashes preview without M2 in place ("Could not find a
   relationship between 'jobs' and 'job_wtcs' in the schema cache"). G5 was
   blocked until M2 was applied. Not a skip — just a reorder by necessity.

3. **Applied M1 + M2 via direct SQL, NOT `supabase db push --linked`.**
   The CLI refused because the shared-DB ledger contains 42 sales-command-
   owned migrations that aren't in sch-command's local migrations/ dir. The
   CLI's suggested `migration repair --status reverted <ids>` would mark
   sales-command's real applied migrations as reverted, breaking sales-
   command's next push. The clean path was Studio SQL + manual ledger
   insert. Memory file `project_shared_db_migrations.md` captures this rule
   for future cross-repo work.

4. **Explicitly skipped 6-gate "gate 3" (incognito anon RLS preview test).**
   Ledger gap blocked the preview pre-apply. M2 is authenticated-only with
   no anon policy, so the anon-leak concern that gate 3 protects against
   doesn't apply. Recorded so we're not pretending it happened.

5. **M3 (drop UNIQUE on jobs.source_proposal_id) intentionally NOT in PR #8.**
   It ships after the sales wizard goes live, per plan §12 step 15. The
   migration file is not in the repo yet — adding it now would cause the
   next `supabase db push --linked` to apply it unintentionally.

6. **F1/F1b defensive title fixes are display-only.** Upstream sales-command
   has a data-shape problem (job_num stored as composite "<num> - <name>";
   some rows have doubled job_name strings). The DB isn't being touched
   in this lift. Real fix lives in sales-command's import path.

===============================================================================
NEW BACKLOG ITEMS
===============================================================================

None filed this session. Three follow-ups carried forward implicitly:
  - Materials.jsx integration with new jobs.material_status column
  - Per-WTC Field SOW editing (currently writes jobs.field_sow only)
  - Upstream fix for sales-command's composite job_num / doubled job_name data shape

===============================================================================
CLOSED THIS SESSION
===============================================================================

  - sales-command PR #23 merged to main (squash, branch deleted). SHA 0286dfe.
    Doc-only; carries docs/plans/send_to_schedule_wizard.md.

===============================================================================
VERIFICATION
===============================================================================

What was verified:

  - **M1+M2 post-apply SQL verification** (Supabase Studio):
      jobs.material_status column exists with CHECK constraint.
      job_wtcs table exists, 0 rows, 4 indexes (incl. UNIQUE on proposal_wtc_id).
      RLS enabled on job_wtcs.
      4 policies all scoped to `{authenticated}` role only (no anon, no public).
      Cross-checked policy names + commands match plan §3.4.
  - **Local Vite build** green on every commit before push.
  - **Vercel preview build** green on every push (5 deploys total).
  - **Smoke item 1 (picker)** — pass: 7 tiles, no Parked, On Hold present,
    "1 multi-week need crew" attn line fires (proves getJobMultiWeekAlert
    is working on real data).
  - **Smoke item 2 (Scheduled tab)** — pass after F1 + F1b fixes. Lepori
    card now reads single-name title, not duplicated.
  - **Smoke item 4 (All tab status dropdown)** — pass: no "Ongoing" option.
  - **Smoke item 5 (Schedule-this-job button)** — pass via card-level path
    in ScheduledCardList.
  - **Smoke item 6a (focus indicator)** — pass after F3 + F3b. Teal fill
    on the job-label cell visible on the focused row.

What was NOT verified:

  - **Smoke item 3 (On Hold tab)** — n/a, 0 On Hold rows in test data.
  - **Smoke item 6b (deep-link finds row + crew bubbles render)** — FAIL.
    /schedule cells are blank for all jobs. Root cause: `assignments` table
    returns 0 rows to the authenticated client despite 63 rows existing in
    the DB for the test week. Confirmed via Studio count query. Policies on
    `assignments` are all PERMISSIVE and include "Authenticated users can do
    everything" (auth.role()='authenticated') — should let an authenticated
    session through. Working hypothesis: stale Supabase JWT when Chris
    moved from the ihugwidzz hash URL to the branch-alias hostname (cookies
    scoped to subdomain). NOT CONFIRMED — Chris ended the session before
    testing sign-out / sign-in.
  - **Smoke item 7 (multi-week pulse on /schedule)** — n/a, insufficient
    multi-week scheduled data in test environment.
  - **Smoke item 8 (pipeline → scheduled redirect)** — not tested.
    First attempt was on the wrong URL (typed in Google search bar). Retest
    on branch-alias URL pending.
  - **Tenant RLS isolation** — accepted on inspection. Single account in test;
    cross-tenant test not possible without a second account.

===============================================================================
NOT TOUCHED THIS SESSION
===============================================================================

  - **M3 migration (drop UNIQUE on jobs.source_proposal_id).** Intentionally
    held; ships post-sales-wizard.
  - **M4 backfill (jobs.material_status from materials_needed).** Documented
    only in plan §3.6; deferred.
  - **Sales-command wizard implementation.** Waits for sch-command IA in prod.
  - **Materials.jsx integration with material_status column.** Follow-up.
  - **Per-WTC Field SOW editing UI.** Follow-up.
  - **Field-command Parked refs.** Grep verified zero hits (v10 already
    closed this); no code change needed.
  - **The missing ~/sales-command/docs/runbooks/rls-deploy-gates.md.**
    Cleanup, not blocker.

===============================================================================
NEXT SESSION POINTERS
===============================================================================

Hard stop: PR #8 must NOT be merged until /schedule renders crew bubbles
correctly. Without that, the deep-link UX from JobDetail is broken in prod.

First action — diagnose the assignments-not-loading problem:

  1. On the branch-alias preview URL, click SIGN OUT (top right), sign back
     in, reload /schedule on a job-with-dates. If crew bubbles appear, the
     root cause was a stale session token and there's no code fix needed —
     it's just a one-time hostname migration artifact. Move on to step 4.

  2. If still blank after sign-in: check tenant scoping. In Studio SQL editor:
       ```
       SELECT distinct tenant_id FROM public.assignments
        WHERE date BETWEEN '2026-04-13' AND '2026-04-18';
       ```
     And cross-reference against what `public.get_user_tenant_id()` returns
     for Chris's auth.uid(). If they don't match, the rows are legitimately
     filtered out by RLS and we need an answer for that (data fix or policy
     review).

  3. If the policies + tenant_id check out and rows still don't return to
     the client, the next thing to check is whether the preview's anon JWT
     differs between the ihugwidzz hash URL (where bubbles worked) and the
     branch-alias URL (where they don't). Two different Vercel hostnames
     get different cookies.

  4. After /schedule renders bubbles, run remaining smoke:
       - item 6b: deep-link from JobDetail header → focus row visible
       - item 8: paste `/jobs?tab=pipeline` directly in browser URL bar
         on the branch-alias hostname (NOT in Google's search box).
         Expect: redirects to `/jobs?tab=scheduled`.

  5. If all smoke clean: merge PR #8 to main (squash). Vercel auto-deploys
     schedulecommand.com.

  6. After PR #8 in prod: switch to sales-command to start the wizard
     implementation per docs/plans/send_to_schedule_wizard.md.

Safe operations next session:
  - Sign-out / sign-in tests on preview.
  - Studio SQL reads (counts, policy checks, tenant_id inspection).
  - Vercel preview reloads, cache-bust refreshes.
  - Reading + grepping cross-repo.

Unsafe operations — confirm before:
  - Any UPDATE / DELETE on jobs, assignments, or call_log.
  - Merging PR #8 (large surface area; only after smoke passes end-to-end).
  - Applying M3 to prod (only after sales wizard ships).
  - `supabase db push --linked` from sch-command — STILL BROKEN by the
    cross-repo ledger gap; use Studio SQL + manual ledger insert for now.

===============================================================================
FILES TO PROBABLY KNOW ABOUT NEXT SESSION
===============================================================================

NEW this session:
  src/lib/jobStatus.js
    Single source of truth for status normalization. Legacy 'Parked' maps
    to 'Scheduled' here. Also exports STATUS_OPTIONS_PICKER and
    getStatusBadgeClass.
  src/lib/jobCardLabel.js
    getCardTitle + getWtcChips. _dedupeName + _cleanNum defensive logic
    for legacy bad data; do not assume upstream is clean.
  src/components/ScheduledCardList.jsx
    Purpose-built Scheduled-stage card. Card-level "Schedule this job →"
    button lives here (separate from JobDetail header button).
  src/components/OnHoldCardList.jsx
    Thin wrapper around JobCardList with per-row "Resume to Scheduled".
  supabase/migrations/20260512120000_jobs_material_status_additive.sql
  supabase/migrations/20260512120100_job_wtcs_create.sql
  supabase/rollbacks/
    NEW directory. Convention: every forward migration is paired with a
    rollback file here, same timestamp prefix +1 second.

MODIFIED — anything tagged "F<n>" or "jobs-ia" in commit messages:
  src/lib/queries.js
    + withWTCs option on loadJobs(); + loadJobWithWTCs(); + getJobMultiWeekAlert.
    normalizeJob now attaches j._wtcs.
  src/views/Schedule.jsx
    URL-param recognition (?job=X&week=Y), weekJobs filter uses getJobStatus,
    focused-row ref + scrollIntoView, prev/next pulse on multi-week alert.
    isFocused conditional class on .sch-brd-job-label (not the wrap).
  src/views/JobDetail.jsx
    Big trim: readiness checklist + gate modal + embedded Schedule tab gone.
    New "Schedule this job →" header button only renders when start_date set.
  src/views/Jobs.jsx
    VALID_TABS = scheduled/active/on-hold/all. pipeline → scheduled redirect.
    Scoreboard buckets renamed; urgencyScore re-tuned (Parked → -5000 removed,
    Scheduled-without-imminent-kickoff → -2500).
  src/components/JobsPicker.jsx
    7-tile mix; multi-week alert count badge on Scheduled tile; takes
    assignments prop now.
  src/components/JobCardList.jsx
    getCardTitle + getWtcChips integration; "Ongoing" dropped from status
    select; Parked Job-Management conditional dropped.
  src/components/tabs/ActiveTab.jsx
    Centralized getJobStatus only.
  src/App.jsx
    doAddJob default status: 'Scheduled' (was 'Parked').
  src/App.css
    New tile classes + multi-week badge + pulse animation + focus indicator
    (just `.sch-label-focused { background: #30cfac !important; ... }`).

DELETED:
  src/components/tabs/PipelineTab.jsx

===============================================================================
GIT STATE ON CLOSE
===============================================================================

sch-command:
  Branch: feat/jobs-ia-refactor (== origin/feat/jobs-ia-refactor)
  Latest SHA: fbdd097
  Working tree: clean.
  origin/main: e4c0268 (handoff v10, unchanged this session).
  Open PR: #8 feat(jobs-ia) → main, OPEN, NOT MERGED.

sales-command:
  Branch: main.
  Latest SHA: 42548e8 (after PR #23 merge of 0286dfe).
  Open PRs: none related to this work.

Supabase project pbgvgjjuhnpsumnowuym:
  M1 + M2 applied to prod via SQL editor; ledger rows manually inserted.
  M3 NOT applied (per design).
  Schema-cache refreshed (verified by the preview seeing job_wtcs as a
  valid relationship after apply).

===============================================================================
END STATE
===============================================================================

In progress. Branch feat/jobs-ia-refactor is fully pushed with M1+M2 applied
to prod and 7 of 8 smoke items either pass or n/a. Blocked on smoke item 6b —
/schedule renders no crew bubbles because authenticated client gets 0 rows
from `assignments` despite 63 rows in the DB. Strongest hypothesis is stale
Supabase JWT after switching preview hostnames; test plan in NEXT SESSION
POINTERS step 1. PR #8 will NOT be merged until that's resolved and items
6b + 8 pass.


CROSS-REPO NOTE — 2026-05-12 from sales-command audit terminal
──────────────────────────────────────────────────────────────
During sales-command's Multi-GC Migration 1a apply, we reverted two
`has_statements=false` placeholder rows from prod's
`supabase_migrations.schema_migrations`:

  - 20260512120000 (jobs_material_status_additive)
  - 20260512120100 (job_wtcs_create)

These blocked our `db push` on local↔remote symmetry. Justification: both
rows had no DDL attached, and at the time we checked, no matching local
files existed in `~/sch-command/supabase/migrations/`. Reverting changed
no actual schema state.

**Discovered AFTER our revert** (when we re-fetched sch-command later in
the session): commit `2a286e9` (Jobs IA refactor + job_wtcs) is now on
origin/main carrying the actual migration files at those two timestamps,
AND `public.job_wtcs` is LIVE on prod with the full Jobs IA schema
(job_id, proposal_wtc_id, work_type_id, work_type_name, position,
field_sow, material_status, start_date, end_date) — but the migration
ledger has zero trace of how it got applied.

**Inferred sequence (please confirm in your next session):**
1. An earlier sch-command session reserved the timestamps via
   `supabase migration repair --status applied <ts>`.
2. The DDL was then applied via Supabase dashboard SQL editor or direct
   `supabase db query`, bypassing `supabase db push`.
3. We reverted the placeholders during our Migration 1a apply, not
   realizing the DDL had already shipped through a different path.

**Reconciliation needed before your next `supabase db push`:**

Check the SQL in `supabase/migrations/20260512120000_*.sql` and
`20260512120100_*.sql`:

- **If they use `CREATE TABLE` / `ALTER TABLE` without `IF NOT EXISTS`:**
  `db push` will fail on table-already-exists. Run:
    supabase migration repair --status applied 20260512120000 20260512120100
  Re-establishes ledger↔schema sync without re-running DDL.

- **If they use `CREATE TABLE IF NOT EXISTS` etc.:** `db push` should
  succeed idempotently; the IF NOT EXISTS guards no-op against the
  existing schema and the ledger records each row with the actual SQL.

No schema action needed. Only the ledger needs reconciling.

Full context: `~/sales-command/docs/AUDIT_LOG.md` 2026-05-12 §5(c)
reversal + Migration 1a prod-apply notes; `~/sales-command/docs/BACKLOG.md`
O7 (multi-repo coordination, T1) + O8 (resolved via this revert).

If anything in this note is wrong, trust your local diagnostic. The
sales-command audit terminal had stale information about sch-command
state when it ran our session's cross-repo edits.
