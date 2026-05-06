SCH_HANDOFF_v7 — May 5, 2026
Session: Picker IA cleanup + Job Planning embedded scheduler + Field SOW builder

===============================================================================
STATE OF PLAY
===============================================================================

Branch: refactor/remove-lifecycle-tabs (NOT MERGED — preview only)
Last commit: 4a9aa5d
Vercel preview: live on the branch URL
Main: untouched at 522a3b9 (SCH_HANDOFF_v6 baseline)

Chris stopped mid-test on the per-day materials picker and said "that's not
it." Direction unclear — could be UX (picker doesn't feel right), data
(wrong source for materials), or something else. Ask before changing.

===============================================================================
WHAT SHIPPED THIS SESSION (10 commits, all on branch)
===============================================================================

1. refactor(jobs): remove lifecycle tab bar; route Ready/Billing tiles to
   canonical pages (37ed56b)
   - The PIPELINE/READY/ACTIVE/BILLING tab bar inside /jobs?tab=... was
     redundant with top-nav (ReadyTab embedded <Schedule />, BillingTab
     embedded <Billing /> — same components as /schedule and /billing).
   - Killed JobsTabBar.jsx, ReadyTab.jsx, BillingTab.jsx.
   - Picker Ready tile now navigate('/schedule'); Billing tile navigate('/billing').
   - Pipeline / Active / All Jobs still live under /jobs?tab=... (real new views).
   - Replaced LEGACY_TAB_SLUG_MAP with TAB_REDIRECTS so old bookmarks
     (?tab=ready|schedule|billing|ready-to-bill) hard-redirect.

2. refactor(jobs): hide date filter + scoreboard on Pipeline view (13b7b88)
   - Pipeline shows parked jobs which already bypass date filter.
   - Cross-stage scoreboard (Active/On Hold/Complete) is noise on a
     single-stage view; picker tiles cover that role.
   - Pipeline now: search bar → back-to-picker bar → Bin (alone on the row)
     → INCOMING JOBS cards.
   - Active and All Jobs unchanged — still get full shell chrome.
   - NOTE: Bin button left on Pipeline floating right of an empty
     scoreboard slot. Chris hasn't said whether to keep, hide, or relocate.

3. feat(jobs-picker): ← All stages back button on Schedule, Billing,
   Production Rate (dbe85e2)
   - Pipeline / Active / All Jobs already had it (in Jobs.jsx).
   - Added inline jh-back-bar at top of /schedule, /billing, /production-rate.
   - Always shown, even when arrived from top nav (clicking always returns
     to picker, which is a valid action regardless).

4. refactor(jobs): hide Job Management on Parked jobs (cb82470)
   - Job Planning = Schedule, Materials, Field SOW (setup before work)
   - Job Management = Overview, Production, Daily Log, Billing, History
     (during/after work — empty state on Parked)
   - PipelineTab parked card: dropped Job Management button (Planning only).
   - JobCardList (All Jobs view): hides Job Management button when
     status === 'Parked'; other statuses keep both.
   - JobDetail page: JOB MANAGEMENT tab group hidden when job.status === 'Parked'.
   - KNOWN EDGE CASE NOT HANDLED: if user views a non-parked job on a
     management tab (e.g., Billing), then navigates to a parked job, the
     persisted `tab` state may leave them on a tab whose group is hidden.
     Worst case: see content with no tab nav. Fix only if it bites.

5. feat(job-planning): use Schedule view as the Schedule tab (0096ecf)
   - Replaced JobCrewScheduler in JobDetail's Schedule tab with the
     existing /schedule view (drag crew → modal → assign).
   - Added `embedded` prop to Schedule that hides the ← All stages back bar.
   - Other jobs visible for context (per Chris: helps make informed crew
     decisions).
   - JobCrewScheduler.jsx is now UNUSED but kept in the repo for one
     preview cycle in case we revert.

6. feat(schedule): sidebar legend + conflict marking in assign modal (1f7614f)
   - Sidebar: "23 avail" → "23 free this week" + small legend
     (Free / Booked / Sick / Off) below the title. Dot CSS classes
     already encoded these states; legend just makes them readable.
   - Assign modal: each in-range day button now checks for same-crew
     assignments on the same date in OTHER jobs. Conflicts get red border,
     small job-num label below the date, tooltip with the conflict.
     Off/sick/no-show days also flagged.

7. fix(schedule): assign modal starts with no days pre-selected (da591fa)
   - Was pre-selecting every in-range day (lots of green pre-checked).
   - Flipped to opt-in: only existing assignments are pre-selected.
   - New crew assignments start empty; click each day to allocate.

8. feat(job-planning): guidance modal when Send Job Plan button clicked
   while gated (397edad)
   - Button used to be HTML-disabled — silent no-op left users guessing.
   - Removed `disabled` HTML attr but kept `disabled` CSS class
     (opacity 0.4 still signals gated state).
   - Click on gated button opens modal listing the unmet gates with
     one-click jumps to the relevant tab.

9. feat(field-sow): editable Field SOW builder in Job Planning (a40ebbe)
   - The Field SOW tab was read-only (rendered job.field_sow as cards) and
     the Sales SOW text was prominent — Chris's intent was always for
     Schedule team to OWN the field plan after handoff (Option 1 in the
     scope discussion).
   - New <FieldSowBuilder /> component matches Sales Command's WTC Field
     SOW data shape: day_label, tasks: [{description, pct_complete}],
     crew_count, hours_planned, materials.
   - Cross-day pct_complete cap (e.g., if Day 1 has "Prime: 60%", Day 2
     caps "Prime" at 40%). Same getCommittedPct logic as Sales.
   - Datalist autocomplete on task description from prior days.
   - Save writes via updateJobField('field_sow', ...) for audit log.
   - Sales SOW demoted to a collapsed <details> at the bottom.

10. feat(field-sow): per-day materials editor with picker from job
    materials (4a9aa5d) — THE ONE CHRIS REJECTED
    - Added <DayMaterials /> sub-component with picker.
    - Picker pulls from the job's materials table (passed in as
      availableMaterials prop, sourced from JobDetail's `materials` state).
    - "+ Custom material…" option for one-off entries not in the materials list.
    - Per-material fields match Sales: qty_planned, mils, coverage_rate,
      mix_time, mix_speed, cure_time.
    - Save shape preserves both material_id (Schedule source) and
      wtc_material_id (Sales source) for round-trip compatibility.
    - Chris saw it and said "Ok that's not it" — DO NOT iterate on this
      without asking what specifically is wrong. Possible angles:
        a. Picker UX feels clunky inside the Job Planning context
        b. Wrong material source — maybe should be a global product
           catalog, not job materials
        c. Fields wrong — maybe Schedule team doesn't need the mix-time/
           cure-time level of detail (that's Sales' WTC-builder polish)
        d. Layout: materials grid too dense, breaks at narrow widths
        e. Whole thing should be a modal, not inline

===============================================================================
ARCHITECTURE NOTES (NEW — record so they don't drift)
===============================================================================

Picker IA (after this session):
  /jobs (no ?tab= param)              → JobsPicker landing
  /jobs?tab=pipeline                  → PipelineTab (parked/incoming)
  /jobs?tab=active                    → ActiveTab
  /jobs?tab=all                       → JobCardList (All Jobs)
  /schedule                           → Schedule view (also linked from
                                         picker Ready and Live Schedule tiles
                                         and from top nav Crew Schedule)
  /billing                            → Billing view (picker Billing tile +
                                         top-nav Billing)
  /production-rate                    → ProductionRate view
  /jobs?tab=ready|schedule|...        → 308 redirect to canonical page

Schedule view modes:
  <Schedule />                        → standalone, with ← All stages back bar
  <Schedule embedded />               → embedded inside Job Planning Schedule
                                         tab; back bar hidden

Job Planning gates (JobDetail.jsx:121-127):
  scheduleReady    = assignments.length > 0
  materialsReady   = materials_needed === false || (true && materials.length > 0)
  materialsDecided = materials_needed != null
  fieldSowReady    = field_sow && field_sow.length > 0
  allReady         = readyCount === 3

When allReady: clicking Send Job Plan to Schedule sets job.status='Scheduled'
and call_log.stage='Scheduled'. When !allReady: opens the gate guidance modal.

Field SOW data shape (preserved across Sales ↔ Schedule):
  field_sow: [
    { day_label, crew_count, hours_planned,
      tasks: [{ description, pct_complete }],
      materials: [{ material_id, wtc_material_id, name, kit_size,
                    qty_planned, mils, coverage_rate,
                    mix_time, mix_speed, cure_time }]
    }
  ]

  Snapshot model: Schedule edits write to jobs.field_sow only. They do NOT
  back-propagate into Sales Command's per-WTC sources (proposal_wtc.field_sow).
  If a Sales user pulls the proposal back and re-sends, Schedule's edits get
  overwritten by the flattened WTC field_sow. Pull-back guard is FOLLOW-UP
  in Sales Command (not done).

===============================================================================
OPEN THREADS (in priority order)
===============================================================================

1. **Per-day materials editor — Chris rejected current implementation.**
   Need to ask what specifically is wrong before changing. See commit #10
   notes above for theories.

2. **Pull-back guard in Sales Command.** When a proposal is pulled back
   from approved → editable, and Schedule has already edited field_sow,
   the re-send will overwrite Schedule's work. Need a warn-or-block flow
   in sales-command's pull-back code path. Touches a different repo.

3. **Bin button placement on Pipeline view.** Currently floating right of
   an empty scoreboard slot. Decide: keep, hide, or move next to search.

4. **JobCrewScheduler.jsx is dead code.** Kept this preview cycle in case
   the embedded Schedule view is rejected. Delete after Chris confirms
   the new flow holds.

5. **JobDetail tab persistence across job navigation.** When tab state
   carries from a non-parked job (Billing) to a parked job (Management
   group hidden), user lands on a tab with no nav buttons. Clamp tab to
   a planning tab when status === 'Parked'.

6. **Conflict marking on the Schedule grid itself** (not just the modal).
   Modal warns on assign, but the existing crew-row day cells in the grid
   don't visibly flag double-bookings. Worth adding to match.

7. **Send Job Plan to Schedule from Sales side.** The trigger that used
   to do this was dropped (project memory: project_field_sow_transfer.md).
   Manual Send to Schedule is the sole path. The Job Plan gate flow is
   downstream of that — once schedule office finishes the planning, the
   "Send Job Plan to Schedule" advances stage to Scheduled. No work needed
   here unless Chris wants to revisit.

===============================================================================
PROCESS NOTES
===============================================================================

- New memory: feedback_stay_scoped.md (don't extend changes to adjacent
  screens unless asked) and feedback_terse_default.md (terse responses
  unless explicitly asked for depth). Both saved this session.
- Local main was 5+ commits behind origin/main at session start —
  pulled origin to get the picker landing + lifecycle tabs that this
  session then refactored away. Worth checking pull state at session start.
- Branch refactor/remove-lifecycle-tabs has not been merged. PR not
  opened. Vercel preview on the branch URL is the only place these
  changes are visible.

===============================================================================
NEXT SESSION FIRST MOVES
===============================================================================

1. Ask Chris what specifically was wrong with the materials editor (don't
   guess — the rejection had no detail).
2. Decide whether to merge refactor/remove-lifecycle-tabs to main or
   continue iterating on the branch.
3. If merging: open PR, write merge commit, deploy to prod, verify on
   schmybiz.com.
4. Pick up open thread #1 (materials) based on Chris's feedback.
