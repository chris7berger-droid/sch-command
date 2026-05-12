SCH_HANDOFF_v10 — May 11, 2026
Session: Jobs IA + Send-to-Schedule Wizard cross-app planning (no code shipped)

===============================================================================
STATE OF PLAY
===============================================================================

Branch: main
Last commit on main: 0bae4b0 (sch-command implementation plan + v9 handoff)
Production: not redeployed this session — Vercel sits on 10c0261 from v8.
Continues on the work desktop tomorrow.

This was a planning-only session. Zero application code changed. Two
implementation plans were produced (one in this repo, one in
sales-command on PR #23) and two memory files were saved locally. The
output is a fully-resolved, audit-cleared design ready to execute on
the work desktop.

Note on convention: v9 was written hot earlier in the session as a
state snapshot for work-desktop pickup. It uses markdown headers,
not the established `===`-bar convention. This v10 is the formal
session close in the v8 style. v9 stays in place — it has the
same content, just different formatting.

===============================================================================
WHAT SHIPPED THIS SESSION (3 commits + 1 PR)
===============================================================================

sch-command (main):

1. bef6114 — docs(planning): Jobs IA refactor + Send-to-Schedule wizard plan
   The cross-app design contract at docs/planning/JOBS_IA_REFACTOR.md.
   261 lines. Four audit rounds (rev 1–4) closed all 3 high + 6 medium
   + 5 low + 4 medium + 3 low findings. Q1 N/A, Q2/Q3/Q4/Q5/Q7 closed
   in conversation. Q6 (multi-WTC join model) and M5 (migration
   ownership) deferred to the planning agent. Inlined the 6-gate
   deploy pattern from SC_Handoff_v83.txt:64-89 (the docs/runbooks/
   reference is vapor).

2. 0bae4b0 — docs(plans): sch-command IA refactor implementation plan
              + v9 handoff
   docs/plans/jobs_ia_refactor_implementation.md — 940 lines, 14
   sections. Produced by the sch-command planning agent. Resolves the
   sch-command-side downstream of the design contract. M5 lives in
   this repo (table-owner principle). Q6 was already resolved by the
   sales planning agent as hybrid (jobs row = card; new job_wtcs
   table = per-WTC attrs).
   Also added SCH_HANDOFF_v9.md (markdown-format state snapshot).

sales-command (PR #23):

3. 0286dfe — docs(plans): Send-to-Schedule wizard implementation plan
   docs/plans/send_to_schedule_wizard.md — 756 lines, 12 sections.
   On branch docs/send-to-schedule-wizard. PR #23 open against main:
   https://github.com/chris7berger-droid/sales-command/pull/23
   No code change. Carries the wizard component contract,
   handleSendToSchedule replacement, edge function spec (mirrors C9
   pattern on send-pay-app), and the cross-repo schema sequencing.

===============================================================================
DECISIONS LOCKED (record so they don't drift)
===============================================================================

Vocab + IA (sch-command):
  Drop Parked entirely (no Parked stage, no Parked tile).
  Tabs: Scheduled · Active · On Hold · All  (4 tabs)
  Picker tiles: Scheduled · Active · On Hold · Billing · All Jobs ·
                Live Schedule · Production Rate  (7 tiles)
  Billing tile routes to /billing (NOT a /jobs tab).
  Production Rate is a list view (PRT entries).
  Live Schedule (/schedule) is the only non-list view in the picker.

Send-to-Schedule Wizard (sales-command):
  Replaces the 1-click button at ProposalDetail.jsx:488–596.
  ONE WTC per wizard run. Steps:
    1. Select WTC          (one at a time; partial sends allowed)
    2. Confirm Start Date  (per-WTC; reads proposal_wtc.start_date)
    3. Field SOW           (read-only summary if present; "Open WTC
                            Editor →" deep-link to
                            src/pages/WTCCalculator.jsx if blank;
                            no SOW authoring inside the wizard)
    4. Material Status     (new 5-state enum)
    5. Summary + sibling   (if siblings on same proposal already in
       detection             Schedule, prompt to Join or Create New;
                            Q7 path)

Status value on insert: 'Scheduled' (no Parked bridge).
call_log.stage: wizard does NOT touch it. Remove the
ProposalDetail.jsx:588 'Parked' write.
End date: derived server-side as start_date + (field_sow.length - 1) days.
Block conditions: start_date set AND field_sow.length ≥ 1.

Q6 — Multi-WTC join model — HYBRID (sales planning agent decision):
  jobs.job_id = card identity (single FK target — billing_log,
  materials, assignments, job_changes all keep working unchanged).
  NEW job_wtcs join table holds per-WTC attrs:
    job_id (FK jobs), proposal_wtc_id, field_sow jsonb,
    material_status text, start_date date, created_at, updated_at
  Join = INSERT job_wtcs row pointing at existing jobs.job_id.
  Legacy merged rows: 0 or N job_wtcs rows; readers fall back to
  jobs.field_sow when job_wtcs empty.

M5 — Migration ownership — sch-command owns the files (table-owner).
  M1: jobs.material_status text + CHECK    (pure schema)
  M2: job_wtcs table + 4 RLS policies      (new-table RLS)
  M3: drop UNIQUE(source_proposal_id)      (after sales code switches
                                            to job_wtcs UNIQUE guard)
  M4: lazy backfill from materials_needed  (deferred)
  All paired with rollback files in NEW supabase/rollbacks/ dir.
  Pure-schema additive sequence — NOT 6-gate (no RLS tightening on
  shared anon paths).

Card label (Q4 + NEW-G):
  Single-WTC card title: "10085 - Test - <work type name>"
  Joined card title:     "10085 - Test - N work types"
  Chip below title (both): "WTC 1[, WTC 2, …]"

JobDetail (Q5):
  Drop readiness checklist entirely (logic 133–139, UI 233–310,
  conditional wrapper at line 234). Wizard guarantees readiness
  upstream; only crew remains, handled in Live Schedule.
  Drop the embedded weekly crew grid. Replace with "Schedule this
  job" button deep-linking /schedule to the job's start week.

Multi-week alert (M6-tightened):
  Pulse criterion is PER-JOB PER-WEEK. Fires only when a job spans
  multiple weeks AND this specific job has no crew assignments for
  at least one week in its span. NOT "any unassigned day"
  (which would noise-out every fresh arrival).

Scheduled list view (Q2):
  Purpose-built component src/components/ScheduledCardList.jsx —
  NOT a JobCardList mode flag. Surface: start date, days-until-
  kickoff, crew coverage ("3 of 5 days covered"), multi-week badge,
  Field SOW size. Hide billing progress / $ totals / OVERDUE /
  UNBILLED / READY-TO-INVOICE flags (irrelevant pre-kickoff).

Shipping order constraint (the non-negotiable):
  sch-command IA refactor ships FIRST or TOGETHER with the wizard.
  NEVER after. If wizard ships first, new 'Scheduled' rows land
  under the stale "Ready" tile with no list view → broken UX.

===============================================================================
OPEN THREADS (in priority order)
===============================================================================

1. Review and merge sales-command PR #23.
   https://github.com/chris7berger-droid/sales-command/pull/23
   No code in it — just the plan doc. Audit cross-reference already
   passed (4 rev rounds).

2. Execute sch-command implementation per docs/plans/
   jobs_ia_refactor_implementation.md §12 (Implementation order).
   Start: migration M1 (jobs.material_status column) → smoke verify →
   M2 (job_wtcs + RLS) → smoke verify → UI work top-down.
   Implementation lands on a feat branch. Test on Vercel preview.

3. Execute sales-command implementation per docs/plans/
   send_to_schedule_wizard.md (only AFTER sch-command IA ships).
   Edge function mirrors send-pay-app C9 pattern exactly.

4. Optional cleanup: create proper
   ~/sales-command/docs/runbooks/rls-deploy-gates.md from the inlined
   6 gates so the canonical version isn't buried in
   SC_Handoff_v83.txt. Tracked in JOBS_IA_REFACTOR.md briefing block.

===============================================================================
ARCHITECTURE NOTES (NEW — for the executor)
===============================================================================

job_wtcs table shape (per sales plan §3 and sch plan §3.2):
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
  job_id integer NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE
  proposal_wtc_id uuid REFERENCES proposal_wtc(id) ON DELETE SET NULL
  field_sow jsonb NOT NULL DEFAULT '[]'::jsonb
  material_status text                        -- see CHECK constraint
  start_date date
  created_at timestamptz NOT NULL DEFAULT now()
  updated_at timestamptz NOT NULL DEFAULT now()
  UNIQUE (proposal_wtc_id)  -- one job_wtcs row per source WTC

RLS pattern for job_wtcs (CLAUDE_RLS.md-compliant):
  USING (EXISTS (
    SELECT 1 FROM jobs j
    JOIN call_log cl ON cl.id = j.call_log_id
    WHERE j.job_id = job_wtcs.job_id
      AND cl.tenant_id = public.get_user_tenant_id()
  ))
  Matches the existing materials / assignments precedent.
  NOT the signing_token IS NOT NULL anti-pattern.

material_status enum values (snake_case storage; UI display map):
  'ordered', 'partially_ordered', 'not_ordered', 'on_hand', 'local_store_pickup'

Read-path hydration:
  loadJobs() gets a new withWTCs option (default true).
  When true, attaches j._wtcs = [{job_wtcs row}, …] via PostgREST
  select=*,call_log(*),job_wtcs(*). One JOIN query, not N+1.
  When job_wtcs is empty (legacy merged row), readers fall back to
  jobs.field_sow / jobs.materials_needed.

Legacy 'Parked'-status jobs during transition:
  Read-time normalization via normalizeJobStatus() helper —
  Parked → Scheduled for grouping/display. No destructive UPDATE.
  Optional one-time cleanup UPDATE jobs SET status='Scheduled'
  WHERE status='Parked' after 30 days, separate PR.

Blocker UNIQUE index on jobs.source_proposal_id:
  Created by add_source_columns.sql. Today's 1-click handleSendToSchedule
  relies on this for the "already sent?" check. The wizard's per-WTC
  inserts WILL fail this constraint on the second WTC.
  Sequencing: sales edge fn switches the check to job_wtcs UNIQUE
  on proposal_wtc_id BEFORE the index gets dropped (M3).

===============================================================================
VERIFICATION
===============================================================================

What was verified:
  - Audit terminal cross-checked the design doc 4 times (rev 1 → rev 4).
    Final state: 3 high + 6 medium + 5 low + 4 medium + 3 low → all
    resolved or explicitly deferred to a planning agent with constraint
    list. Last audit pass returned clean.
  - Planning agents (sales-command + sch-command) each produced their
    plan after reading the design contract and all required CLAUDE.md /
    CLAUDE_RLS.md / BACKLOG.md / recent-handoff context.
  - field-command was grep'd for Parked / jobs.status filter references
    on 2026-05-11. Zero hits. R15 closed at the plan-doc level.
  - The 6-gate deploy pattern was verified to exist (despite
    docs/runbooks/rls-deploy-gates.md not existing). Source:
    sales-command/docs/handoffs/SC_Handoff_v83.txt:64-89.

What was NOT verified (code-side):
  - No application code was written this session. No live smoke
    possible. All "verification" was design-review against existing
    code via grep + line-citation checking.
  - The implementation plans contain a smoke-test plan each
    (sales-command §6, sch-command §9) — those execute against
    application code once it's written.

===============================================================================
NEW MEMORY (saved this session)
===============================================================================

These are local to this machine
(~/.claude/projects/-Users-chrisberger/memory/) and won't sync to the
work desktop unless that dir is mirrored:

  feedback_scenario_explanations.md
    — Design-choice explanations should use concrete scenarios (real
      job numbers, WTC names) walking through a click-by-click flow,
      not abstract bullet comparisons. Saved after Chris asked for
      "more context please or simplify context please" on the
      wizard-flow option (A) vs (B) presentation.

  project_schedule_command_user_state.md
    — Office staff (Joe, John, Denise) still on legacy Apps Script.
      Chris is sole sch-command user today. UI changes don't need
      staff-training comms until the Apps Script → sch-command
      parity cutover. Risks framed as "users will be confused" are
      non-risks until then. Saved after Chris corrected the sch
      planning agent's R14 ("they have never seen this design").

The load-bearing facts from both memories are also captured in the
plans (and this handoff) — work-desktop sessions will derive them
from the committed docs even without memory sync.

===============================================================================
PROCESS NOTES
===============================================================================

The audit-terminal pattern worked well: every revision of the design
doc went through a structured findings list (H1, M1, L1, NEW-A, …)
with file-path verification and grep-grounded claims. Each round
shrunk and surfaced one new class of mistake the prior pass missed.
This is the right shape for cross-app design docs going forward.

The planning-agent pattern produced two ~800-line plans that are
materially executable. Both agents resolved the deferred questions
(Q6 hybrid, M5 ownership) with explicit pressure-testing against
call sites rather than gut calls. The pattern: hand the agent the
design contract + required reading + clear "you are NOT doing X"
boundaries.

Two corrections Chris made that shaped the final plan:
  1. The wizard does not change call_log.stage at all (proposal stays
     Sold). I had drafted three options; Chris's instinct cleaned up
     the sales-side stage vocabulary back to its natural 5.
  2. Office staff haven't seen the new app. The planning agent's R14
     ("Joe/John/Denise muscle memory on Parked tile") was assumption-
     based. Chris flagged it and we closed it.

Both corrections are now in memory so future sessions don't repeat
the assumption.

===============================================================================
NEXT SESSION FIRST MOVES
===============================================================================

On the work desktop tomorrow:

1. `cd ~/sch-command && git pull` and
   `cd ~/sales-command && git pull` — pick up tonight's commits.

2. Read SCH_HANDOFF_v9.md (markdown-format quick state) OR this v10
   (full close-out). Either gives the design picture.

3. Open the two plans:
   ~/sch-command/docs/plans/jobs_ia_refactor_implementation.md
   ~/sales-command/docs/plans/send_to_schedule_wizard.md  (PR #23)

4. Decide on PR #23: review/merge or request changes. No code in it,
   so a quick approve-and-merge is fine if the plan still reads
   well in the morning.

5. Start sch-command implementation per the plan §12 checklist:
   - Branch: feat/jobs-ia-refactor (off main)
   - First migration: M1 (jobs.material_status). Forward + rollback.
   - Test on Vercel preview before merge.
   - Resist the temptation to refactor Schedule.jsx (1092 lines) —
     plan §4 row 17 limits scope to ADDITIVE blocks only.

6. DO NOT ship sales-command wizard implementation before
   sch-command IA refactor is in prod. Shipping order is the one
   constraint that breaks UX if violated.

Safe operations next session:
  - git pull, branch off main, migration files (paired with rollbacks)
  - Vercel preview deploys, smoke testing on preview
  - Reading + grepping cross-repo

Unsafe operations to confirm before:
  - supabase db push --linked (production schema change)
  - Merging the implementation PR (large surface area)
  - Any cleanup UPDATE on legacy Parked rows (R6/R8 interactions)
