SCH_HANDOFF_v4 — May 2, 2026
Session: IA reframe — Jobs as lifecycle spine via tabs, then label cleanup

===============================================================================
WHAT WAS DONE
===============================================================================

1. Jobs Tab IA — Pipeline | Schedule | Active | Ready to Bill (PR #1, MERGED ee3ce7a4)
   - Lifted Jobs.jsx body into src/components/tabs/PipelineTab.jsx
   - Hoisted data fetch, realtime subscription, search, date filter, scoreboard,
     and restore bin up to Jobs.jsx shell
   - Added JobsTabBar.jsx + URL state via useSearchParams (?tab=...)
   - Pipeline tab default; pipeline omitted from URL
   - Schedule tab embeds <Schedule /> weekly grid (no fork)
   - Ready to Bill tab embeds <Billing /> 3-column RTB pipeline (no fork)
   - Active tab filters to status = In Progress (M2 approval queue lands here next)
   - Pipeline tab filters to status in (Parked, Scheduled) — Parked cards in
     INCOMING JOBS section, Scheduled cards via shared JobCardList
   - Extracted <JobCardList /> from PipelineTab so Pipeline + Active share one
     card renderer (expand state, status update, billing actions, JobDetail nav)
   - Shell scoreboard + filters auto-hide on Schedule + Ready to Bill tabs
     to prevent visual doubling against the embedded view's own header
   - /schedule, /billing direct routes preserved in App.jsx for back-compat
   - JobDetail navigation unchanged from any card

2. Tab Label Cleanup — Pipeline | Ready | Active | Billing (PR #2, MERGED b0de8a1)
   - Renamed Schedule tab → Ready (drops "Schedule" from tab IA — it's a view,
     not a domain)
   - Renamed Ready to Bill tab → Billing (resolves Ready/Ready-to-Bill collision)
   - Slug changes: ?tab=schedule → ?tab=ready, ?tab=ready-to-bill → ?tab=billing
   - File renames: ScheduleTab.jsx → ReadyTab.jsx, ReadyToBillTab.jsx → BillingTab.jsx
   - Legacy slug redirect via useEffect in Jobs.jsx — old links don't 404
   - LEGACY_TAB_SLUG_MAP exported from JobsTabBar; remove once no live URLs use old slugs
   - Pipeline tab kept as "Pipeline" (broader bucket — Parked + Scheduled)
   - Tab bodies unchanged: Ready still embeds <Schedule />, Billing still
     embeds <Billing />

3. Mockup-vs-Current Diff Captured (PR #2 description)
   - Read /Users/chrisberger/jobs-screen-mockup.html
   - Captured 8-row table of mockup patterns vs current implementation in PR #2
     description under "Deferred to follow-up — gap vs IA mockup"
   - This artifact is the durable record of today's IA work — lives in PR #2
     body, not just terminal transcript

4. Soak Review Agent Created Then Disabled
   - Originally scheduled a one-time remote agent for 2026-05-16 to assess
     2-week soak (bug reports + usage data) before the three deferred decisions
   - Disabled (enabled: false) per Chris's correction — solo designer-as-user
     means he'll know within days, doesn't need a scheduled multi-agent assessment
   - Routine ID trig_019cG8yfSCN1rZRJALKRurBp; full delete via
     https://claude.ai/code/routines if desired
   - Saved feedback memory: don't offer /schedule soak reviews on solo projects

5. Memory Updated
   - feedback_schedule_jobs_ia.md — On Hold needs return path, Complete is
     search-only, Chris self-paces rename/nav decisions
   - feedback_no_soak_offers.md — don't offer scheduled soak reviews when Chris
     is the designer and primary user

===============================================================================
WHAT WAS NOT DONE
===============================================================================

- Did not browser-test either PR before merge — production builds were clean
  but UI was not driven from terminal. Vercel preview links available on PRs.
- Did not implement any of the mockup direction beyond label rename (picker
  landing screen, stage-aware cards, one primary action per card, Operations
  rebrand all deferred — see PR #2 deferred section)
- Did not split Pipeline into Parked + Ready-as-cards (would make Ready show
  Scheduled-status job cards instead of weekly grid — bigger content change)
- Did not address On Hold return path (acknowledged as follow-up by Chris)
- Did not address Operations rename or /schedule top-nav removal (Chris
  self-paces these)

===============================================================================
NEXT SESSION — PRIORITIES
===============================================================================

1. M2 — DPR/PRT approval queue inside Active tab
   - New /approvals view OR mounted inside ?tab=active
   - Status state machine: submitted/approved/rejected
   - Audit row to job_changes
   - Manager-only via team_members.role check
   - Additive migration: rejection_reason text column + CHECK constraint on status
   - Documented in project memory as M2 (next milestone after M1 PRT reader)

2. On Hold return path
   - Currently On Hold + Complete jobs are not tab-surfaced (only counted on scoreboard)
   - Complete is intentionally search-only
   - On Hold needs a clickable surface before paused jobs go stale
   - Options: scoreboard tile click-through, search return, or 5th tab
   - Decide shape; verify against any soak observations Chris has by then

3. Mockup direction layering (only when ready)
   - PR #2 description has the 8-row deferred table as backlog
   - Highest-value next layer: stage-aware card bodies (readiness for Parked,
     date+crew for Ready, progress+PRT for Active, amount+wait for Billing)
   - Picker landing screen if the IA continues to feel like a firehose

4. Operations rebrand + /schedule top-nav cleanup (Chris self-paces)
   - Originally promised soak; soak removed (Chris is sole user)
   - Spawn fresh planning agent when ready

===============================================================================
CRITICAL RULES (unchanged from CLAUDE.md / SCH_HANDOFF_v3)
===============================================================================

- All job reads/writes through src/lib/queries.js — never raw supabase.from('jobs')
- Crew ops use call_log_id, not job_id (FK mismatch)
- Page files = list views only; detail/modals/wizards stay in src/components/
- PostgREST caps at 1000 rows — paginate with .range() if needed
- RLS changes: read CLAUDE_RLS.md first, follow 6-gate deploy pattern

===============================================================================
FILES CHANGED THIS SESSION
===============================================================================

PR #1 (ee3ce7a4) — IA reframe:
  src/views/Jobs.jsx                       — rewrote as shell with tabs + scoreboard
  src/components/JobsTabBar.jsx            — NEW (tab bar component, JOBS_TABS)
  src/components/JobCardList.jsx           — NEW (shared card renderer for Pipeline + Active)
  src/components/tabs/PipelineTab.jsx      — NEW (Parked + Scheduled)
  src/components/tabs/ScheduleTab.jsx      — NEW (embeds <Schedule />)
  src/components/tabs/ActiveTab.jsx        — NEW (In Progress)
  src/components/tabs/ReadyToBillTab.jsx   — NEW (embeds <Billing />)
  src/App.css                              — added .jh-tabs and .jh-tab styles

PR #2 (b0de8a1) — Label cleanup:
  src/components/tabs/ScheduleTab.jsx      — RENAMED to ReadyTab.jsx
  src/components/tabs/ReadyToBillTab.jsx   — RENAMED to BillingTab.jsx
  src/components/JobsTabBar.jsx            — new labels + LEGACY_TAB_SLUG_MAP
  src/views/Jobs.jsx                       — legacy slug redirect, new component imports
  src/App.css                              — comment update only

===============================================================================
HANDOFF NOTES
===============================================================================

- Both PRs squash-merged to main; main is at b0de8a1
- /jobs URL state: ?tab=ready, ?tab=active, ?tab=billing (pipeline omitted)
- Legacy ?tab=schedule and ?tab=ready-to-bill auto-redirect (don't 404)
- On Hold + Complete jobs visible on scoreboard but NOT in any tab card list
- Pipeline contains Parked + Scheduled (broader than just Parked)
- Ready tab CONTENT today = weekly crew grid (not Scheduled-status cards yet)
- Billing tab CONTENT today = 3-column RTB pipeline (not per-job send-to-finance cards yet)
- Mockup direction lives in PR #2 description (deferred follow-up table)
