SCH_HANDOFF_v12 — May 26, 2026
Session: Jobs landing two-section redesign (ERD Loop #26 — plan + audit + build + take-live)

===============================================================================
SESSION SUMMARY
===============================================================================

Picked up sch-command after 14 days dormant (last work was v11's PR #8 area
on 2026-05-12; main has since absorbed that work). One ERD loop, start to
finish: redesigned the /jobs landing page (JobsPicker.jsx) into two labeled
sections — Job Crew & Schedule Stages (6 tiles) + Job Management Stages
(4 tiles) — added three new tiles (Production Complete, Budget stub, Daily
Logs), and applied label-only renames (Scheduled → Ready; Billing → Ready
to Bill; Production Rate → Production Rate Trackers). Stage 2 kept the
"Active" label to avoid a name collision with the Live Schedule tile.

Workflow: plan terminal wrote docs/plans/jobs_landing_sections_redesign.md
to a feature branch; audit terminal returned 2 Med + 4 Low findings; all
resolved with [LOCKED] amendments D8/D9/D10 before commit. Build terminal
executed §5 implementation in parallel, smoked locally, pushed to feat
branch. Plan terminal fast-forward-merged feat/jobs-landing-sections to
main and pushed. Vercel auto-deploys schedulecommand.com.

ERD Loop #26 closed at 16:51: success 10/10, elapsed 1h 3m vs 1hr
predicted, fear ("you give me bad code and I spend days fixing it") didn't
happen.

===============================================================================
CHANGES SHIPPED
===============================================================================

sch-command (feat/jobs-landing-sections — fast-forward merged to main):

1. 768c2c5 — Plan: Jobs landing two-section redesign (ERD Loop #26)
   Wrote durable plan doc to docs/plans/jobs_landing_sections_redesign.md.
   Locks D1–D7 design decisions (label-only rename, two-section layout,
   Production Complete as crew lens, Ready to Bill as manager lens, no
   invoicing in Schedule, Budget as stub, JobDetail as the "manage 100%"
   surface). Audit pass amended the plan with D8 (Ready to Bill descriptor
   "Complete, not fully billed" instead of mirroring Billing.jsx Pending),
   D9 (no helper extraction — inline only), D10 (Daily Logs count = "—"
   for v1). Audit history table appended at §9.

2. 7bd708b — Build: Jobs landing two-section redesign (§5 steps 3–7)
   JobsPicker.jsx restructured into two <section> blocks with section
   headers. New tiles: Production Complete (Section 1, count from
   getJobStatus === 'Complete'), Budget stub (Section 2, no count),
   Daily Logs (Section 2, no count, routes to existing /daily). Label
   renames per §2 (Scheduled → Ready, Billing → Ready to Bill with
   descriptor "Complete, not fully billed", Production Rate → Production
   Rate Trackers). Ready-to-bill count formula inlined in JobsPicker per
   D9. New stub view src/views/Budget.jsx (~10 LOC). /budget route wired
   in App.jsx. CSS in App.css: .jh-picker-section + .jh-picker-section-title.
   Jobs.jsx: VALID_TABS adds 'complete'; Complete tab render block;
   billingLog now passed to <JobsPicker>. No helper extraction (D9 keeps
   Jobs.jsx:53, JobCardList.jsx:34, and Billing.jsx:53 getBilledToDate
   untouched).

Fast-forward merge: 98bf587..7bd708b → origin/main pushed.

===============================================================================
DEPLOYED
===============================================================================

schedulecommand.com (Vercel production): auto-deploying from main as of the
merge push at ~16:50 PT. No edge functions, no DB migrations, no
infrastructure changes. No Supabase work.

Dashboard URL:
  https://schedulecommand.com/jobs (target verification surface)

===============================================================================
DECISIONS / CHOICES MADE
===============================================================================

1. **Two-section layout, not flat grid.** Splits tiles by ownership
   perspective: Section 1 is the crew/scheduler surface (production
   states), Section 2 is the manager surface (billing, margin, oversight).
   At 7 flat tiles users couldn't see at a glance which were stage
   indicators vs management views. Labeled sections make ownership obvious.

2. **Label-only renames; URL slugs + DB statuses untouched.** (D1)
   Scheduled → Ready, Billing → Ready to Bill, Production Rate → Production
   Rate Trackers all change the visible card text only. `getJobStatus()`
   return strings ('Scheduled', 'In Progress', 'Complete') and URL params
   (?tab=scheduled, ?tab=active) stay unchanged. No redirects, no
   bookmark breakage, no cross-app shape changes for Sales/Field Command
   consumers reading status strings.

3. **Stage 2 stays "Active" — NOT renamed to "Live".** (D2)
   Original concept had Active → Live. But the Live Schedule tile also
   stays in the picker. Two tiles both leading with "Live" creates visual
   confusion. User chose to preserve "Active" so Live Schedule keeps its
   name.

4. **Production Complete (crew lens) + Ready to Bill (manager lens) with
   intentional overlap.** (D3) A job appears in BOTH Production Complete
   (crew off site) AND Ready to Bill (billing not yet 100%) until billing
   reaches 100%. One card per owner perspective, not per status combo.
   "Complete" has two definitions in construction (crew-complete vs
   billing-complete) — don't smash them into one bucket.

5. **Schedule Command does NOT generate invoices.** (D4)
   "Ready to Bill" is a staging queue, not an invoice generator. Invoicing
   lives in sales-command today; eventually in AR Command when that gets
   built. Cross-app boundary best practice: each tool owns its own concern.

6. **Budget tile lands as stub view this loop.** (D5)
   Card is real and discoverable; clicked view = "Coming soon — wired
   when Field Command DPRs ship." Real margin view needs DPR data flowing
   from Field Command (RN/Expo, not yet shipped to crews). 1hr ERD
   budget couldn't cover the real margin view. Stub now, real view
   later.

7. **"Manage 100%" bar = today's pattern.** (D7)
   Card → list of jobs → click → JobDetail.jsx. JobDetail already covers
   crew, billing, materials, history. No new in-card actions added.
   Zero new components beyond the Budget stub.

8. **Ready to Bill formula stays simple; descriptor renamed to match.**
   (D8 — audit MED-1 resolution) Formula:
   `getJobStatus === 'Complete' && billed < 100`. Billing.jsx's full
   Pending logic (week-relative end_date filter, partials, paused
   partials, no_bill exclusion, dedup) is genuinely more accurate but
   would require extracting a shared helper across files. Honest label
   ("Complete, not fully billed") beats a misleading count from
   borrowed Pending logic. Mirroring Billing.jsx Pending is deferred
   to a consolidation loop.

9. **No helper extraction this loop.** (D9 — audit MED-2 resolution)
   `getBilledTotal` is duplicated in Jobs.jsx:53, JobCardList.jsx:34,
   and Billing.jsx:53 (as `getBilledToDate` — same function, different
   name). Three-call-site consolidation is its own loop. Inlined the
   billing-percent formula in JobsPicker.jsx instead. Stay scoped.

10. **Daily Logs tile count = "—" for v1.** (D10 — audit OPEN-1
    resolution) Same Budget rationale: card lands now, data source
    (daily log count per day) is its own loop.

11. **Fast-forward merge, no PR.** Build terminal pushed directly to
    feat branch; plan terminal did the FF merge to main. No PR was
    opened. Justification: 2-commit feature, planned + audited + smoked,
    no schema or RLS surface, single-file primary diff. Future similar
    work that touches more surface area should still open a PR.

===============================================================================
NEW BACKLOG ITEMS
===============================================================================

None filed as formal IDs (sch-command doesn't yet have a docs/BACKLOG.md).
Three follow-ups carried forward implicitly by the plan §6 Out of scope:

  - **Real Budget view.** Replace src/views/Budget.jsx stub with per-job
    margin dashboard (contract value vs cost-to-date, hours budgeted vs
    actual, % billed). Blocked on Field Command DPR shipping (need actual
    labor hours from the field).
  - **Daily Logs tile count source.** Pick (a) jobs with log today, (b)
    jobs missing log today (recommended for manager signal — surfaces
    the gap), (c) leave as "—".
  - **Billing helper consolidation.** Extract single `getBilledTotal` to
    src/lib/billingHelpers.js. Replace 3 duplicate call sites including
    renaming Billing.jsx's `getBilledToDate`. Pure refactor.

===============================================================================
CLOSED THIS SESSION
===============================================================================

  - ERD Loop #26 (schedule-command-workflow-landing-page) closed at 16:51.
    Success 10/10. Elapsed 1h 3m vs 1hr predicted. Fear didn't happen.
    Verification artifact: commit 7bd708b on main.

===============================================================================
VERIFICATION
===============================================================================

What was verified:
  - **Plan audit pass.** Audit terminal returned 2 Med + 4 Low findings.
    All 3 actionable resolutions ((b) for MED-1, (b) for MED-2, lock-at-"—"
    for OPEN-1/LOW-2) applied as plan amendments D8/D9/D10 BEFORE commit.
  - **Build local smoke** (per build terminal report): all 10 tiles render
    in correct sections, counts populate, each tile click lands on
    correct route/tab, Production Complete tab renders Complete-status
    jobs, Budget tile lands on stub view, Daily Logs tile routes to
    existing /daily view.
  - **Fast-forward merge to main**: clean (no conflicts, no rebase needed).

What was NOT verified:
  - **Vercel preview URL on feat branch.** Build prompt called for preview
    re-smoke after push. Build terminal report did not explicitly confirm
    preview smoke vs local-only smoke. Preview was live; smoke status
    unclear.
  - **Production deploy on schedulecommand.com**. Auto-triggered by main
    push at ~16:50; deploy status not visually checked before session
    close. First action next session: visit https://schedulecommand.com/jobs
    and confirm the two-section landing renders.
  - **Cross-tenant isolation.** Landing page is read-only display of
    counts; no new RLS surface introduced.

===============================================================================
NOT TOUCHED THIS SESSION
===============================================================================

  - **JobDetail.jsx** — D7 decision: today's pattern is the management
    surface. No in-card actions added.
  - **Schedule.jsx, Billing.jsx, JobCardList.jsx** — out of scope. D9
    explicitly keeps the duplicate billing helpers in place; refactor
    is its own loop.
  - **DB migrations / RLS** — no DB changes this session. CLAUDE.md's
    RESUME ALERT (ledger reconciliation for jobs_material_status +
    job_wtcs) is STILL pending and applies on the NEXT `supabase db push`
    in this repo, regardless of this session's work.
  - **Edge functions** — none touched, none deployed.
  - **Sales-command / Field-command** — no cross-repo work this session.
  - **PR #8 (jobs IA refactor)** referenced in v11 — already merged to
    main as 2a286e9 sometime between v11 and now; not part of this session.

===============================================================================
NEXT SESSION POINTERS
===============================================================================

**First action:** open https://schedulecommand.com/jobs in a browser and
confirm Vercel finished deploying main. Expect to see two labeled sections
with 6 + 4 tiles. If anything's off, the rollback is `git revert 7bd708b`
on main; the build is one isolated commit.

Recommended follow-up sequencing (Chris's call which to pick first):

  1. **Class-name catch-up.** D1 keeps CSS class names (.jh-tile-scheduled,
     .jh-tile-active, .jh-tile-billing) referring to old labels even though
     tile text changed. Future-dev confusion risk. Small loop, no
     external surface.

  2. **Daily Logs tile count source.** Cheapest follow-up of the three
     stubs. Pick (a/b/c) above, write the query into JobsPicker (or
     load via Jobs.jsx if it needs a new fetch).

  3. **Billing helper consolidation.** Pure refactor. Extract helper,
     replace 3 sites. Smoke the existing Billing + Jobs flows after.

  4. **Real Budget view.** Requires Field Command DPR data flowing.
     Until then, the stub stands.

Safe operations next session:
  - Reading + grepping in sch-command.
  - Browser visits to schedulecommand.com.
  - Local `npm run dev` for any follow-up tile work.
  - Deleting the feat/jobs-landing-sections branch (origin + local) after
    prod confirms.

Unsafe operations — confirm before:
  - Any `supabase db push --linked` in sch-command. RESUME ALERT in
    CLAUDE.md is still load-bearing: run `supabase migration repair
    --status applied 20260512120000 20260512120100` first.
  - Class-name rename — verify no other component (CSS or JS) reads
    those class names before changing.
  - Touching JobDetail / Schedule / Billing without a fresh ERD loop +
    plan + audit.

===============================================================================
FILES TO PROBABLY KNOW ABOUT NEXT SESSION
===============================================================================

NEW this session:
  src/views/Budget.jsx
    ~10-LOC stub. Placeholder for real per-job margin dashboard. Wired
    to /budget route; only reachable via the Budget tile in JobsPicker.
    Replace when Field Command DPRs are flowing.
  docs/plans/jobs_landing_sections_redesign.md
    Durable plan doc — D1–D10 decisions, file-by-file changes per §4,
    implementation steps §5, audit history §9. Source of truth for what
    the build did and why.

MODIFIED this session:
  src/components/JobsPicker.jsx
    Two <section> restructure with .jh-picker-section-title headers.
    New tiles: Production Complete, Budget, Daily Logs. Label renames
    per §2. Inlined billing-percent formula for counts.readyToBill.
    Takes billingLog prop now.
  src/views/Jobs.jsx
    VALID_TABS adds 'complete'. New render block for Complete tab
    using JobCardList. Passes billingLog down to <JobsPicker>.
  src/App.jsx
    /budget route added.
  src/App.css
    .jh-picker-section margin + .jh-picker-section-title styles
    (Barlow Condensed, uppercase, letter-spacing).

UNCHANGED (and intentionally so per D9):
  src/views/Jobs.jsx getBilledTotal helper (line 53)
  src/components/JobCardList.jsx getBilledTotal helper (line 34)
  src/views/Billing.jsx getBilledToDate helper (line 53)

===============================================================================
GIT STATE ON CLOSE
===============================================================================

sch-command:
  Branch: main (== origin/main).
  Latest SHA: 7bd708b — Build: Jobs landing two-section redesign (§5 steps 3–7)
  Working tree: clean (handoff doc to be committed next).
  Open PRs: none.
  feat/jobs-landing-sections: still exists on origin; 0 commits ahead
    of main after FF merge. Safe to delete (local + remote) once prod
    smoke confirms.

erd-loop:
  Branch: main (== origin/main).
  Latest SHA: ea00f6b — Close loop #26 — schedule-command-workflow-landing-page

===============================================================================
END STATE
===============================================================================

Merged + deployed (Vercel auto-deploying schedulecommand.com from main
push). Local smoke passed; preview + prod smoke not yet hand-verified.
ERD Loop #26 closed at 16:51 with success 10/10 and fear-didn't-happen.
Ready for fresh session after a quick browser check at
https://schedulecommand.com/jobs.
