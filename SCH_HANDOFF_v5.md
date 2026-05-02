SCH_HANDOFF_v5 — May 2, 2026
Session: Jobs picker landing — 6-tile entry point for /jobs

===============================================================================
WHAT WAS DONE
===============================================================================

1. Jobs Picker landing (PR #3 — feat/jobs-picker, OPEN)
   - New component src/components/JobsPicker.jsx — 6 tiles in a responsive grid
     (Parked, Ready, Active, Billing, All Jobs, Live Schedule)
   - Tile click routes to existing tab key via setActiveTab(); back link
     ("← All stages") clears ?tab= and returns to picker
   - Picker shows when /jobs has no ?tab= param. Old default was 'pipeline';
     pipeline is now an explicit destination, no longer the implicit landing
   - New ?tab=all destination — renders JobCardList against all filteredJobs.
     'all' is NOT in JOBS_TABS array (no button in tab bar) — reachable only
     from the picker
   - Live Schedule tile → navigates to /schedule (existing weekly grid)
   - Origin: jobs-screen-mockup.html (Chris's gold standard from earlier today),
     restyled to match production's dark/linen theme rather than mockup's light
     linen

2. Theme matching (no new design tokens introduced)
   - Tile surface: var(--bg-card) linen, 1px ink border, subtle shadow
   - Per-stage left-border accent (4px):
     · Parked   → #d4a017 (gold — matches existing .jh-score.pk)
     · Ready    → var(--warning) #e67e22
     · Active   → var(--command-green) #5BBD3F
     · Billing  → var(--cyan) #0891b2
     · All Jobs → var(--header-dark) #1c1814
     · Live Sch → #30cfac (header brand teal)
   - Tile count: JetBrains Mono 28px, color-matched to stage accent
   - Tile name: Barlow Condensed uppercase
   - Tile body: Barlow body, 12px

3. Live counts vs stubs
   - Real: parked, scheduled, in-progress, complete totals; jobs.length total;
     "X starting this week" on the Ready tile (filters Scheduled with
     scheduled_start || start_date in current Mon–Sun)
   - Stub (em dash): "ready to schedule", "behind target", "waiting 2+ days" —
     need readiness gates, target progress %, and billing_log timestamps to
     compute. Deferred until those signals exist

4. Architecture decisions confirmed in session
   - Picker REPLACES the pipeline-default landing (option a in clarifying Qs)
   - Theme matches existing dark/linen app (option b — restyle in dark theme,
     not adopt mockup's light linen)
   - Pipeline tile still routes to existing PipelineTab (Parked + Scheduled
     mixed) — the Pipeline split into separate Parked + Scheduled destinations
     is deferred. The current routing keeps Parked tile honest at status-count
     level even if the destination tab still mixes
   - All Jobs tile stacks ALL filteredJobs in JobCardList — no per-stage
     section headers yet (mockup's "All Jobs" view shows 4 stacked sections)

5. Strategic conversation (no code change)
   - Chris is reframing the Sub Con Command suite as ONE product (with 4 named
     modules) rather than 4 separately-sellable apps
   - Identified separability artifacts in code: team_members.apps[] gate,
     4 separate domains/Vercel projects, 4 separate auth flows, no shared
     top nav, duplicated design tokens per repo
   - No code action taken — Chris paused the marketing/product discussion and
     redirected back to picker work. Artifact list lives in this handoff for
     future reference

===============================================================================
WHAT WAS NOT DONE
===============================================================================

- PR #3 NOT merged — opened only. Awaiting Chris's preview deploy review and
  merge decision
- Did not browser-test in production-like conditions. Build was clean and
  Chris approved on dev based on description, not full UI walk-through
- Did not split Pipeline tab into separate Parked + Scheduled destinations
  (still mixed in the existing tab)
- Did not implement the mockup's stacked all-stages "All Jobs" view — current
  ?tab=all is a flat list. Per-stage section headers within ?tab=all are
  follow-up work
- "Attention" lines on Parked/Active/Billing tiles still show em dashes —
  need real signals (readiness gate state, target progress %, billing
  pending-age) before they go live
- Live Schedule tile is a counter + click-through only. No inline crew board
  preview / today's-assignments strip yet
- Did not address suite-as-one-product separability artifacts. Chris paused
  that thread; not on the immediate roadmap
- Did not address On Hold return path (still no clickable surface for
  paused jobs — was on the v4 next-session list, untouched)

===============================================================================
NEXT SESSION — PRIORITIES
===============================================================================

1. Merge PR #3 if browser-test on Vercel preview looks good
2. M2 — DPR/PRT approval queue (still the named next milestone from v4)
   - Likely lands inside ?tab=active or a new /approvals route
   - Needs additive migration: rejection_reason text + CHECK constraint on status
3. Wire real "attention" signals on the picker tiles:
   - Parked → readiness checklist completion (count Parked jobs with all gates clear)
   - Active → behind-target needs a target % definition (don't have one)
   - Billing → needs a "moved to billing at" timestamp (billing_log doesn't
     have this directly — may need to derive from latest status change in job_changes)
4. On Hold return path — scoreboard tile click-through, search return, or 5th
   tab. v4's pending decision still pending
5. Pipeline split — make Parked tile go to Parked-only view, separate from
   Scheduled. Today's tile→Pipeline-tab routing keeps them mixed
6. Live Schedule tile — upgrade from counter to inline weekly preview
   (collapsed crew board, top 5 rows, click → /schedule)

===============================================================================
CRITICAL RULES (unchanged)
===============================================================================

- All job reads/writes through src/lib/queries.js
- Crew ops use call_log_id, not job_id
- Page files = list views only; detail/modals/wizards stay in src/components/
- PostgREST caps at 1000 rows — paginate with .range() if needed
- RLS changes: read CLAUDE_RLS.md first, follow 6-gate deploy pattern

===============================================================================
FILES CHANGED THIS SESSION
===============================================================================

PR #3 (feat/jobs-picker — OPEN, not yet merged):
  src/components/JobsPicker.jsx   — NEW (6 tiles, useMemo counts, navigate)
  src/views/Jobs.jsx              — picker routing, back-bar, ?tab=all handler
  src/App.css                     — appended .jh-picker / .jh-tile / .jh-back-bar styles

main branch:
  SCH_HANDOFF_v5.md               — this file

===============================================================================
HANDOFF NOTES
===============================================================================

- PR #3: https://github.com/chris7berger-droid/sch-command/pull/3
- Branch: feat/jobs-picker (1 commit, 97c8a6d)
- main is at 1d06fcf (unchanged from end of v4 session) — picker is NOT in
  production yet
- Picker URL state: /jobs (no params) → picker; /jobs?tab=parked|ready|active|billing|all
  → that tab with back-link
- Mockup file: /Users/chrisberger/jobs-screen-mockup.html — picker design
  origin. Light-linen theme; production picker uses existing dark/linen tokens
  instead. The mockup's stacked-all-stages "All Jobs" view is NOT what shipped
- Chris's brand-doc question: there is no separate brand doc; design tokens
  live in CLAUDE.md (Design System section) and the actual var(--*) tokens
  in src/index.css :root
- Chris paused the suite-as-one-product separability conversation. Don't
  reopen unsolicited
