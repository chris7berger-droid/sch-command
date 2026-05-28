SCH_HANDOFF_v13 — May 28, 2026
Session: Staged/Ready cards — take a dead-on-arrival build to working (diagnose + fix + deploy + verify)

===============================================================================
SESSION SUMMARY
===============================================================================

Took over the staged-ready-cards build mid-stream after Chris reported it
"looked like shit, no functionality." Diagnosis: the build was faithful to the
plan, but two layers were missing. (1) Data feeds weren't wired — crew names,
LOGS count, BILLED color all rendered dashes/UUIDs. (2) The §3.12 DB migration
was never created — `jobs.ready_confirmed_at` / `hold_reason` / `updated_at`
did not exist in prod, so Promote-to-Ready silently failed and the Ready tile
could never populate. Confirmed the columns absent with a read-only PostgREST
probe.

Fixed the data wiring; pointed each scorecard at the right tool (MTRL → new
in-card MaterialsModal, DAYS → read-only modal, CREW → Crew Schedule
deep-link, SOW left on FieldSowModal pending a design decision); fixed the
work-days weekend calc (§4.1). Wrote the §3.11/§3.12 migration and deployed it
via the Supabase dashboard SQL editor — `supabase db push` does NOT work from
sch-command (shared-ledger divergence), which is now documented. Repointed the
CREW readiness signal from `job_crew` (Field Command clock-ins, post-kickoff)
to `assignments` (office scheduling) so the office can actually satisfy the
Promote gate. Made NOTES an inline editable note.

Chris smoke-tested on preview: CREW shows assignments, NOTES saves,
Promote→Ready moves the job, demote-on-change works. Primary objective met.
Also built a new `/buildvsplan` command (build-vs-plan verification gate) and
seeded a Command Suite shared-data-contract design doc. Frontend lives on
`feat/staged-ready-cards` (NOT merged to main); two DB migrations are LIVE in
prod.

This session began from a broken-build report, not a formal /erd-start — no
ERD loop number was locked.

===============================================================================
CHANGES SHIPPED
===============================================================================

sch-command (feat/staged-ready-cards — pushed to origin, NOT merged to main):

1. a5c5995 — Wire StageJobCard data gaps: crew names, LOGS count, BILLED-complete
   Card markup/CSS matched the plan but feeds were missing. CREW names resolved
   from already-loaded team_members; LOGS count from daily_log_entries; BILLED
   turns red on Complete+0%. Threaded through both card lists.

2. b066b55 — Add in-card MaterialsModal; MTRL opens it (not Field SOW)
   Root cause: MTRL navigated to JobDetail planning, which ignores ?tab and
   defaults to Field SOW. New self-contained MaterialsModal (reuses mat-* CSS),
   live-saves status/arrival/notes.

3. 0eec2d2 — DAYS opens read-only schedule modal (plan §3.6)
   New DaysModal (date range + working-day list). Removed dead goSchedule.

4. 87a5ad6 — CREW → Crew Schedule deep-link; fix work-days weekend calc (§4.1)
   CREW deep-links to /schedule?job=&week= (existing focus highlight). Fixed
   totalWorkDays to exclude BOTH weekend days unless an assignment exists
   (was counting every Saturday); threaded assignments as a per-job date set.

5. f8ddcaf — Add jobs readiness migration (§3.11/§3.12) — file only
   Columns + base-checklist fn + clear/demote/recheck triggers + NOT VALID
   materials.status CHECK. job_changes RLS deliberately carved out.

6. a71c408 — Add audit handoff for the migration pre-push review

7. ad73bcb — Correct push procedure to 3-timestamp repair (audit NO-GO)
   Audit caught that db push applies ALL ledger-absent migrations in order;
   20260503190000 (non-idempotent) would abort before the target. Repair THREE.

8. f4fd7c6 — Fix CLAUDE.md Pushing Migrations: db push doesn't work here
   Documents shared-ledger divergence + the dashboard-SQL-editor path.

9. e561a93 — Repoint CREW signal job_crew → assignments (frontend + DB migration)
   Frontend: crewByCallLog now derives from assignments. DB migration
   20260528133000 repoints job_base_checklist_passes + recheck triggers.

10. 73d52b1 — NOTES bubble: inline editable note (view + add/edit + save)

11. 7f96096 — Add Command Suite shared-data-contract design seed + surface it
    docs/plans/command_suite_shared_data_contract.md + CLAUDE.md pointer +
    auto-memory entry.

Also (separate repos):
  - claude-commands: new /buildvsplan command (build-vs-plan verification gate).
  - claude-personal-state (memory): feedback_buildvsplan_gate,
    feedback_handoff_name_repo, project_command_suite_data_contract.

===============================================================================
DEPLOYED
===============================================================================

Supabase prod (shared project ref pbgvgjjuhnpsumnowuym) — applied via the
**dashboard SQL editor** (db push does not work from sch-command), recorded in
the ledger via `supabase migration repair --status applied`:

  - 20260528120000_jobs_ready_confirmed_hold_reason_triggers  → LIVE
    Adds ready_confirmed_at / hold_reason / updated_at + §3.12 triggers.
  - 20260528133000_repoint_crew_readiness_to_assignments      → LIVE
    Crew readiness now reads assignments, not job_crew.

Also repaired into the ledger (live-but-absent, per RESUME ALERT + audit):
  20260503190000, 20260512120000, 20260512120100.

Frontend: NOT deployed to prod. Lives on feat/staged-ready-cards (Vercel
preview only). schedulecommand.com still shows the v12 cards.

===============================================================================
DECISIONS / CHOICES MADE
===============================================================================

1. **db push doesn't work from sch-command — dashboard SQL editor is the path.**
   The shared ledger holds ~60 sibling-repo migrations absent locally; db push
   aborts on the sync pre-check. This is why every prior sch migration was
   dashboard-applied. CLAUDE.md "Pushing Migrations" corrected to document it.

2. **Repair THREE timestamps before any push, not two.** Audit caught that
   20260503190000 (non-idempotent RLS policy migration) is also live-but-absent;
   db push would hit it first and abort. RESUME ALERT updated.

3. **CREW readiness signal: job_crew → assignments.** job_crew is Field Command
   clock-ins, populated only post-kickoff and never written by sch-command — so
   it can't gate pre-kickoff readiness (original plan §2.2 flaw). The office
   assigns crew via the Schedule (assignments). Repointed card + JS gate + DB
   function + recheck triggers.

4. **job_changes RLS carved out of the migration.** §11 D3 called for a
   SELECT-only RLS enable, but job_changes is inserted client-side
   (queries.js:176,229,407) — that would default-deny all audit logging. Per
   CLAUDE_RLS.md it needs the 10-step additive→drop gate. Ships separately.

5. **materials.status CHECK as NOT VALID.** Enforces new/updated rows without
   full-table validation, so dirty legacy data can't roll back the migration.

6. **CREW connects via deep-link, not a rebuilt tool.** The deleted
   JobCrewScheduler wrote assignments anyway; the Schedule view already has the
   crew tool + a ?job=&week= deep link. Don't rebuild.

7. **/buildvsplan created.** Plan-time audits (/auditcriteria, /runaudit) audit
   the plan, before code — they can't catch build-execution gaps (missing
   migration, miscoded formula). The new gate runs after build, before smoke:
   spec-vs-code + LIVE-schema existence probe + data-wiring, tiered punch-list.

8. **SOW port deferred — blocked on a design decision.** Reusing Sales Command's
   WTCCalculator is the right move, BUT field_sow lives in 3 places (card reads
   job_wtcs[], Field reads jobs.field_sow, Sales authors proposal_wtc). Building
   the port now would land it where Field Command can't see it. Needs the
   canonical-field_sow decision from the shared-data contract first.

9. **STRATEGIC REFRAME — one app, four drivers (Chris, end of session).** The
   suite began as 4 separately-sellable apps; ~3/4 through the build Chris
   concluded that can't deliver the experience he wants — it's now ONE product
   with four drivers. This shrinks the shared-data contract: most cross-app pain
   (ownership turf, SOW cross-domain auth, copy-vs-reference drift) is an
   artifact of the old model and should be designed out, not contracted around.
   The only real boundary left is Field's offline-first mobile runtime
   (web ↔ offline-mobile sync). Unlocks shared component library, unified auth,
   live references, eventually a monorepo. Does NOT change shipped work or the
   running 4-repo system — reframes the design premise. Captured in
   docs/plans/command_suite_shared_data_contract.md + memory.

===============================================================================
NEW BACKLOG ITEMS / FOLLOW-UP LOOPS
===============================================================================

sch-command has no docs/BACKLOG.md; captured as design seeds / follow-up loops:

  - **Shared-data contract design session.** docs/plans/command_suite_shared_data_contract.md.
    Resolve: canonical field_sow location, jobs.notes→Field view-only, BILLED
    source-of-truth (billing_log vs invoices), copy-vs-reference for
    send-to-schedule. Unblocks the next two.
  - **SOW builder port** (reuse WTCCalculator in-app) — blocked on contract
    decision #1 (canonical field_sow).
  - **Files / §7 attachments** — add files in sch, view-only in Field Command.
    Storage bucket + RLS + job_attachments table + PowerSync rules. Own loop.
  - **job_changes RLS** — its own 10-step RLS deploy (carved out, #4 above).
  - **Per-repo CLAUDE.md contract pointer** — add the shared-data 4-question
    block to sales/field/AR CLAUDE.md (only sch has it; memory covers surfacing).
  - **WORK TYPES "—"** on cards lacking structured WTC data — cosmetic; needs
    source data, not code.

===============================================================================
CLOSED THIS SESSION
===============================================================================

  - **Primary objective: staged/ready cards now functional.** The build that
    was dead-on-arrival (missing schema + unwired data + unsatisfiable crew
    gate) now works end-to-end. Verified by Chris's preview smoke test.
    No formal ERD loop number (session started from a bug report).

===============================================================================
VERIFICATION
===============================================================================

What was verified (Chris, on Vercel preview):
  - CREW scorecard shows assigned crew (from assignments); count green.
  - Promote to Ready works — moves the job to the Ready tile (was a no-op).
  - NOTES opens, edits, saves; char count updates.
  - Migrations applied cleanly in dashboard ("Success. No rows returned").
  - Column existence confirmed live via read-only PostgREST probe (200s).

What was NOT verified:
  - **Full /buildvsplan run** — skipped; the equivalent 3-agent plan-vs-build
    sweep was already run this session and its findings fixed.
  - **Demote-on-material-flip** edge + the ON CONFLICT DO UPDATE upsert
    interaction (audit non-blocking note) — not explicitly exercised.
  - **Production frontend** — branch not merged; schedulecommand.com unchanged.
  - SOW port, attachments, cross-app flows beyond PRT/logs — deferred.

===============================================================================
NOT TOUCHED THIS SESSION
===============================================================================

  - **SOW port / WTCCalculator reuse** — blocked on the contract decision.
  - **Attachments (§7), Mobilizations (§6)** — deferred stubs, by design.
  - **Sales / Field / AR repos** — read-only inspection for the data-flow map;
    no edits. Their CLAUDE.md files do NOT yet carry the contract pointer.
  - **Merge to main** — frontend stayed on the branch pending Chris's take-live
    decision.

===============================================================================
NEXT SESSION POINTERS
===============================================================================

**First decision:** merge feat/staged-ready-cards to main (take the cards live
on schedulecommand.com for office staff) or keep iterating on the branch. The
DB migrations are already live in prod (additive/harmless ahead of the
frontend). Smoke was green on preview.

Then the headline follow-up is the **shared-data contract design session** —
it unblocks the SOW port and frames attachments + BILLED. That's a design loop
(planning), not a build.

Safe operations:
  - Reading/grepping; browser visits to the preview/prod URLs; npm run dev.
Unsafe — confirm first:
  - Any migration push: db push does NOT work here. Use the dashboard SQL
    editor, and repair the THREE ledger-absent timestamps first (see RESUME
    ALERT). Then `migration repair --status applied <new ts>`.
  - Editing sales/field/AR while their sessions may be active.

===============================================================================
FILES TO PROBABLY KNOW ABOUT NEXT SESSION
===============================================================================

NEW:
  supabase/migrations/20260528120000_jobs_ready_confirmed_hold_reason_triggers.sql
  supabase/migrations/20260528133000_repoint_crew_readiness_to_assignments.sql
    Both LIVE in prod via dashboard. Source of record for the schema.
  src/components/MaterialsModal.jsx — in-card materials editor (MTRL bubble).
  src/components/DaysModal.jsx — read-only per-job schedule (DAYS bubble).
  docs/plans/command_suite_shared_data_contract.md — design seed (open).
  AUDIT_HANDOFF_jobs_readiness_migration.md — the pre-push audit mandate.

MODIFIED:
  src/components/StageJobCard.jsx — scorecard wiring, NotesPanel, work-days,
    CREW/DAYS/MTRL handlers, assignment-based crew.
  src/views/Jobs.jsx — crewByCallLog now from assignments; dropped job_crew
    load + teamNameById; realtime job_crew→assignments channel; logs +
    assignment-date maps.
  src/components/StagedCardList.jsx, OnHoldCardList.jsx — thread new props.
  CLAUDE.md — Shared-Data Contract section; corrected Pushing Migrations;
    RESUME ALERT now 3-timestamp repair.

Other repos:
  ~/.claude-commands/buildvsplan.md — the new gate command.

===============================================================================
GIT STATE ON CLOSE
===============================================================================

sch-command:
  Branch: feat/staged-ready-cards (== origin, pushed).
  Latest SHA: 7f96096 — Add Command Suite shared-data-contract design seed.
  Ahead of main: 22 commits (this session + earlier plan/build commits).
  Working tree: clean (handoff doc to be committed next).
  Open PRs: none. main: unchanged from v12 era.
  Prod DB: two new migrations LIVE + ledger reconciled.

===============================================================================
END STATE
===============================================================================

Primary objective met — staged/ready cards functional, smoke-green on preview,
two DB migrations live in prod. Frontend on feat/staged-ready-cards, NOT merged
to main — awaiting take-live decision. Shared-data contract design loop +
SOW/attachments captured as the next work. db-push-from-sch-command trap and
the build-vs-plan gap both now documented + tooled.
