SCH_HANDOFF_v6 — May 3, 2026
Session: Picker merge, Production Rate page, M2 daily-log stack (RLS → reader)

===============================================================================
WHAT WAS DONE
===============================================================================

1. JobsPicker landing merged to production (PR #3, commit de24cd8)
   - PR #3 had been sitting open since 2026-05-02, never merged. Picker code
     existed only on feat/jobs-picker; main only had SCH_HANDOFF_v5 doc.
     Vercel had been building previews from the branch but production stayed
     on the pre-picker tab landing.
   - Squash-merged with --delete-branch; Vercel auto-deployed main.

2. M2 (PRT approval queue) DROPPED — replaced by Production Rate scan view
   - Original M2 plan: /approvals page, status state machine, approve/reject
     flow, audit, manager-only via team_members.role check, additive migration
     for rejection_reason + CHECK constraint on status.
   - Chris reframed: Field Command's in-app crew alerts handle PRT quality at
     the input side. An internal Schedule approval flow would be ignored by
     office staff and add noise. Cross-job VISIBILITY is still valuable.
   - Verified nothing in sch-command code gates on status='approved' (3 sites,
     all display-only). Removal is non-event for downstream consumers.
   - Replacement: /production-rate cross-job scan view.

3. Production Rate page shipped (PR #4 merged, c46a3f3)
   - New /production-rate route + nav link
   - 7th JobsPicker tile (purple #b86bff accent), routes to /production-rate
   - loadRecentPRTs(days=14) in queries.js — joins call_log:job_id for
     display_job_number/job_name on each row
   - List rows show: date, job_num + job_name, submitter, hours, task/photo
     counts, target-vs-actual rate badge (✓ on track / ⚠ N of M behind /
     no rate data — falls back when target_pct/actual_pct missing)
   - Click row → existing PRTDetail (no fork)
   - DELIBERATELY DEFERRED to picker-flow-mapping work: filter chips (today/
     7d/14d/behind-only), sort by severity vs date, tile count semantics
     (currently neutral in-progress count)

4. M2 (renumbered) — Daily Log reader stack shipped (Steps 1-3 in one session)

   Step 1 — RLS tighten on daily_log_entries (record file PR #5 merged)
   - BEFORE: single "Allow all for now" policy — cmd=ALL, qual=true,
     with_check=true. Same anti-pattern shape as 2026-04-26 sales-command
     incident (anon AND authenticated had unrestricted CRUD).
   - Pre-flight via Supabase JS client (anon key): table count = 0 rows,
     no production data to migrate. Risk-free.
   - Cross-repo grep confirmed: sales-command and AR-Command-Center don't
     reference daily_log_entries. Schedule sole reader, Field sole writer.
   - Field's CLAUDE.md says single-tenant, no tenant_id — simpler than
     memory note suggested. Skipped tenant-id work.
   - Applied 4 SQL changes via Supabase dashboard (CLI db push blocked by
     27 unrelated migrations from sales-command on shared DB):
       a. Added "daily_log_select_authenticated" — SELECT auth all rows
       b. Added "daily_log_insert_own" — INSERT auth where employee_id =
          (select id::text from team_members where auth_id = auth.uid())
       c. Added "daily_log_update_own" — same own-row check on UPDATE
       d. Dropped "Allow all for now"
       (No DELETE policy = deletes forbidden, audit integrity)
   - 6-gate shortened to 4-gate: empty table + no production users + Field
     not yet writing real data = "overlap window" verification was moot.
     Old policy was permissive; once new ones were live, drop was safe.
   - VERIFIED: anon INSERT post-drop returns RLS error code 42501.
   - Record file at supabase/migrations/20260503190000_daily_log_update_policy.sql
     (doc-only — sch-command can't db push to shared DB).

   Step 2 — PowerSync sync streams (no work needed)
   - Asked Chris for current sync rules YAML; daily_log_entries was ALREADY
     in the all_data bucket. Field's CLAUDE.md sync streams list is stale
     (only lists 5 streams; actual rules publish 8 including job_crew, jobs,
     daily_log_entries).
   - No data flowing yet because no Field-side writes have happened — Chris
     is the only Field user (testing) and hasn't gone through the daily log
     entry flow.

   Step 3 — Schedule reader on JobDetail (PR #6 merged)
   - New "Daily Log" tab in MANAGEMENT_TABS, between Production and Billing
   - loadDailyLogsForJob(callLogId) in queries.js — filters by call_log.id
   - teamMap fetched via existing loadTeamMemberMap() — resolves
     daily_log_entries.employee_id (text uuid) → team_members.name
   - Render: cards grouped by date, each shows entry-type pill (SOD green,
     MOD orange, EOD cyan, OTHER dark), author name, timestamp, notes,
     R2 photo grid (clickable, opens in new tab)
   - Empty state: "No daily log entries yet" until Field writers exist

5. Pre-flight learnings about CLI capabilities (relevant to future work)
   - supabase CLI v2.95.4 installed, authenticated. Project visible.
   - `supabase db query` runs LOCAL only — useless for our remote-only setup
   - `supabase db push` blocked from sch-command by shared-DB migration
     history (27 prior migrations from sales-command not in local repo)
   - PRACTICAL CLI WORKAROUNDS:
     · Anon JS client (`@supabase/supabase-js` + .env.local) for read+write
       queries on tables with permissive RLS (good for verification probes)
     · Dashboard SQL editor for arbitrary queries and migrations
     · ONE STATEMENT AT A TIME in dashboard editor — multi-statement DDL
       returns "syntax error at or near 'create'" on the second statement
     · For RLS verification, attempting an INSERT with anon client gives
       a clear pass/fail signal (RLS error 42501 = blocked correctly)

===============================================================================
WHAT WAS NOT DONE
===============================================================================

- Picker em-dash stubs still visible to office staff in production:
  Parked "— ready to schedule", Active "— behind target", Billing
  "— waiting 2+ days". Will be addressed in picker-flow-mapping work
  alongside the rest of the tile attention signals.
- M3 (time punches per-job tab) not started.
- M4 (Daily.jsx hours overlay) still blocked on crew-identity decision.
- On Hold return path not addressed (still no clickable surface for
  paused jobs — was on v4/v5 next-session lists).
- Pipeline tab split (Parked vs Scheduled separate destinations) not
  addressed.
- Operations rebrand decision not made.
- Field crew onboarding not done (Jonah/Troy as team_members with
  auth_id) — required before Field has any real-world writers.
- Cross-job daily log scan view (analog of /production-rate but for
  daily logs) not built — separate decision.
- Field Command's CLAUDE.md sync streams list is stale; not fixed
  this session (Field repo, separate workstream).

===============================================================================
NEXT SESSION — PRIORITIES
===============================================================================

1. Picker-flow-mapping — the user-flagged design pass for navigation from
   each picker tile. Settles tile attention signals, Production Rate
   sort/filter/count, back/sideways patterns. Most user-visible cleanup
   left in the app.

2. Field crew onboarding playbook — when Jonah and Troy are ready to
   actually use Field Command:
   · Add team_members rows for each (role: Foreman, Crew)
   · Link auth_id (each gets a Supabase Auth user)
   · Verify INSERT works under tightened RLS
   This is small but on the critical path for getting real Field data.

3. Pipeline tab split (Parked + Scheduled separate) — still mixed in
   the existing Pipeline destination. Picker tiles point at separate
   semantic buckets but the destination is a mash-up.

4. M3 — Time punches per-job tab. Likely roll up raw punches to per-
   employee-per-date rows. New tab on JobDetail similar shape to
   Daily Log.

5. M4 unblock — crew-identity decision. crew.name (text) vs
   team_members.id (uuid) mismatch on Daily.jsx joins.

===============================================================================
CRITICAL RULES (unchanged)
===============================================================================

- All job reads/writes through src/lib/queries.js — never raw
  supabase.from('jobs')
- Crew ops use call_log_id, not job_id (FK mismatch)
- Page files = list views only; detail/modals/wizards stay in
  src/components/
- PostgREST caps at 1000 rows — paginate with .range() if needed
- RLS changes: read CLAUDE_RLS.md first, follow 6-gate (or shortened
  variant when justified). Apply via dashboard SQL editor ONE
  STATEMENT AT A TIME, then commit a record-of-changes file to
  supabase/migrations/ even if `supabase db push` can't run it
- Cross-repo migration check: sales-command, field-command, and
  AR-Command-Center share the same Supabase DB — grep for table names
  before changing policies

===============================================================================
FILES CHANGED THIS SESSION
===============================================================================

PR #3 (de24cd8) — JobsPicker landing (merged from yesterday's branch)
  src/components/JobsPicker.jsx           — NEW (6 stage tiles)
  src/views/Jobs.jsx                      — picker routing, back-bar, ?tab=all
  src/App.css                             — picker styles

PR #4 (c46a3f3) — Production Rate page
  src/views/ProductionRate.jsx            — NEW (cross-job PRT list)
  src/lib/queries.js                      — loadRecentPRTs(days)
  src/components/JobsPicker.jsx           — added 7th tile (Production Rate)
  src/App.jsx                             — /production-rate route + nav item
  src/App.css                             — pr-* styles, jh-tile-rate accent

PR #5 (RLS record) — daily_log_entries tighten
  supabase/migrations/20260503190000_daily_log_update_policy.sql — NEW
    (doc-only; SQL was applied via dashboard)

PR #6 (Daily Log reader)
  src/lib/queries.js                      — loadDailyLogsForJob(callLogId)
  src/views/JobDetail.jsx                 — daily-log tab, fetch, render
  src/App.css                             — jd-dl-* styles

===============================================================================
HANDOFF NOTES
===============================================================================

- Production state: schedulecommand.com /jobs no-tab → 7-tile picker;
  /production-rate → cross-job PRT scan; /jobs/:id (management mode) →
  Daily Log tab between Production and Billing
- daily_log_entries RLS state: SELECT auth-all, INSERT/UPDATE own-rows
  only (employee_id ↔ team_members.id where auth_id = auth.uid()), no
  DELETE. Anon blocked. Verified.
- Memory updated: project_schedule_command.md reflects M2-as-shipped,
  M3/M4 still pending. RLS Notes section added.
- Open PRs: none (all merged). Branches deleted.
- The CLI workaround (anon client for verification probes) was useful;
  worth remembering for future RLS gate tests
