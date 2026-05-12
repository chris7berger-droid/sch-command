# Jobs IA Refactor + Send-to-Schedule Wizard

Session: 2026-05-11. Cross-app: sch-command + sales-command.

## Why

Three problems surfaced today:

1. **Vocab mismatch** between picker tiles ("Parked", "Ready"), page headers ("INCOMING JOBS"), and DB status (`Parked`, `Scheduled`). Three names per stage.
2. **"Ready" tile** routes to the crew grid, not a job list. No list view exists for `Scheduled` jobs.
3. **Sales-side handoff is too permissive** — jobs can arrive in Schedule Command with no dates, no crew, no Field SOW, no materials. Sales just needs `status='Sold'`.

## Decisions

### Schedule Command — vocab + IA

- Rename pipeline stages so picker, headers, badges, and code all match:

| Old (mixed) | New (unified) |
|---|---|
| Ready / Scheduled | **Scheduled** |
| Active / In Progress | **Active** |
| Billing (picker label) → routes to /billing | **Billing** (tile only; no `/jobs` tab) |

- **Complete status stays as one status.** No new terminal/Invoiced status — `/billing` already handles sub-buckets (Pending Partial, Pending Complete, Paused, Confirmed, Invoiced, No Bill) internally.
- **No Complete tab in `/jobs`** (honors prior memory: Complete is search-only at the `/jobs` level). Picker's Billing tile is the entry point; everything Complete-status lives in `/billing`.

- **No more `Parked` / `Incoming` stage.** The wizard guarantees dates + Field SOW + material status at arrival, so jobs land directly in `Scheduled`.
- All `/jobs` tabs are **list views** (Scheduled, Active, On Hold, All Jobs).
- Crew grid stays at `/schedule` as **Live Schedule** (the only non-list view in the picker).
- Picker stays at **7 tiles** (same count, different mix): Scheduled → Active → On Hold → Billing · All Jobs · Live Schedule · Production Rate. (Current `JobsPicker.jsx` renders 7 buttons. The status-bucket count in code is 6 — `Parked`, `Scheduled`, `In Progress`, `Complete`, `On Hold`, `Ongoing` catch-all — buckets ≠ tiles.)
- **On Hold** keeps a tile so paused jobs stay visible (return-path requirement carried forward from prior IA session). Tile routes to `/jobs?tab=on-hold` list view.

**Explicit picker tile → route mapping:**

| Tile | Route | Surface |
|---|---|---|
| Scheduled | `/jobs?tab=scheduled` | New list view inside `/jobs` |
| Active | `/jobs?tab=active` | Existing tab |
| On Hold | `/jobs?tab=on-hold` | New list view inside `/jobs` |
| Billing | `/billing` | Existing top-level route (NOT a `/jobs` tab) |
| All Jobs | `/jobs?tab=all` | Existing tab |
| Live Schedule | `/schedule` | Existing crew grid |
| Production Rate | `/production-rate` | Existing list view |

`/jobs` has **4 tabs**: Scheduled, Active, On Hold, All. Billing/Live Schedule/Production Rate are top-level routes reached from the picker. Production Rate (`/production-rate`) is already a list view (PRT entries).

- **Multi-week alert** — when a job's date range spans more than one week AND any week it spans has zero crew assignments for **that specific job**, the alert fires:
  - Picker (count badge on Scheduled tile of jobs with at least one unassigned week beyond their start week)
  - Live Schedule (week navigation arrows pulse on weeks containing days for **this job** where this job has no crew assigned)
  - Criterion is **per-job per-week** — not "any unassigned day" (which would pulse every newly-arrived job for every week it spans).
- **JobDetail readiness checklist** is removed. Wizard pre-fills dates, Field SOW, and materials; only crew remains, and that's handled in Live Schedule.

### Sales Command — Send-to-Schedule Wizard

Replaces today's 1-click "Send to Schedule" button on ProposalDetail. Button now opens a 5-step wizard.

**Wizard runs once per WTC** (NEW-D resolution, option B). To send 3 WTCs from a proposal, sales clicks "Send to Schedule" three times — each run handles one WTC end-to-end. Sibling detection at Step 5 offers join with already-sent siblings on the same proposal (Q7 path).

| Step | Field | Notes |
|---|---|---|
| 1 | Select WTC | Pick **one** WTC from the proposal. WTCs already sent show as such with a "Sent" badge (not selectable for re-send). |
| 2 | Confirm Start Date | per-WTC (reads `proposal_wtc.start_date`; required to proceed) |
| 3 | Field SOW | If the WTC's `field_sow` is present, Step 3 shows a read-only summary ("5 days planned, 3-man crew") + an "Edit in WTC Editor →" link. If blank, Step 3 blocks and shows a guided message (see below) directing the user to the canonical WTC editor. **No SOW authoring happens inside the wizard.** All edits go through `src/pages/WTCCalculator.jsx` (NEW-E resolution, option B). |
| 4 | Material Status | new 5-state value — see below |
| 5 | Summary + sibling detection | Shows the WTC about to send. If any other WTC on this proposal was already sent to Schedule, prompts to join with an existing card. **If exactly 1 unjoined existing card:** "Join with existing card for proposal 10085?" Yes/No. **If multiple unjoined existing cards exist** (e.g. user picked "create new" on prior sends): the prompt must enumerate them so user can pick which card to join (or create new). The enumeration model is **Q6-dependent** — planning agent resolves once the multi-WTC join model is chosen. |

**Per-WTC sends.** Default = one job card per WTC. Joining only happens via the Step 5 sibling-detection prompt (this run) or later via the Schedule Command card-merge action.

**Step 3 — guided "no SOW yet" flow.** When `field_sow` is blank for the selected WTC, Step 3 must explicitly tell the user what's happening, what to do, and how to come back. Required UX:

1. **Message:** "Caulking doesn't have a Field SOW yet. You'll need to add one before this WTC can be scheduled."
2. **Numbered next steps (visible on screen):**
   - "1. Click **Open WTC Editor** below."
   - "2. Build your day-by-day plan in the Field SOW section."
   - "3. Save your changes."
   - "4. Click **Send to Schedule** again on this proposal to come back here."
3. **Primary button:** `Open WTC Editor →` — deep-links to `src/pages/WTCCalculator.jsx` on the WTC's Field SOW section. (Path note: sales-command keeps page-level routes in `src/pages/`, not `src/components/`.)
4. **Secondary note:** "Heads up: leaving the wizard ends this session. When you return, you'll re-pick Caulking from Step 1 — but Step 3 will pass since the SOW will be saved."

No silent state-saving across wizard sessions; the wording is honest about the round trip. After the user saves a SOW and re-enters the wizard, Step 3's gate auto-passes (`field_sow.length ≥ 1`).

**call_log.stage stays `Sold`.** The wizard does NOT update `call_log.stage`. Sales-side pipeline (Inquiry → Wants Bid → Has Bid → Sold → Lost) ends at "Sold" — once a proposal is sold, its sales-side lifecycle is complete. The "this got sent to Schedule" signal is the existence of `jobs` row(s) with `source_proposal_id = p.id`, which already drives the "✓ Sent to Schedule" badge on ProposalDetail. Remove the existing `call_log.stage = 'Parked'` write at `ProposalDetail.jsx:588`. Net effect: cleaner sales-side stage vocabulary, no cross-repo vocab tangle, no new stageColor mapping needed.

**Card label format:**
- **Single-WTC card:** Title = `10085 - Test - <work type name>` (e.g. `10085 - Test - Epoxy`). Chip below: `WTC 1`.
- **Joined card (2+ WTCs):** Title = `10085 - Test - N work types` (e.g. `10085 - Test - 5 work types`). Chip below: `WTC 1, WTC 2, WTC 3, WTC 4, WTC 5` (or natural CSS truncation if chip overflows). Individual work type names are visible on the card detail view, not the list-row title. (NEW-G resolution, option C — prioritizes clean visual rhythm over per-WTC name visibility at the list level.)

**Block conditions** (gate before "Send"):
- Each selected WTC must have `start_date` set
- Each selected WTC must have `field_sow.length ≥ 1` (at least one planned day)

**End date** is computed server-side as `start_date + (field_sow.length - 1) days`. Never user-input.

### Schema deltas

- New job-level field: `material_status` enum — replaces today's `materials_needed` boolean.
  - **Storage values (snake_case):** `ordered`, `partially_ordered`, `not_ordered`, `on_hand`, `local_store_pickup`
  - Display labels mapped in UI: "Ordered", "Partially Ordered", "Not Ordered", "On Hand", "Local Store Pick Up"
- `end_date` becomes derived: `start_date + (field_sow.length - 1) days`. Not user-set.
  - `field_sow` is an existing jsonb array on `proposal_wtc`; each element = one planned day. Day count = `field_sow.length`.
  - **Block condition (corrected):** each selected WTC must have `start_date` set AND `field_sow.length ≥ 1`. End date is computed at send time, never user-input.
- Multi-WTC job grouping — three candidates (Q6 deferred to planning agent):
  - **(a)** Row-per-WTC: each "Send" inserts a `jobs` row; joined cards share a new `card_group_id`.
  - **(b)** Row-per-card: one `jobs` row holds a WTC list as jsonb.
  - **(c)** Hybrid: `jobs` row = card; new `job_wtcs` join table holds per-WTC attributes (materials_status, field_sow). Joining = re-point rows.

## Open decisions (still TBD)

| # | Question | Why it matters |
|---|---|---|
| M5 | Migration ownership + sequencing for `material_status` enum | Deferred to planning agent — see "Migration ownership & sequencing" block below |

## Closed decisions

- **Q1 (Pipeline tab split)** — N/A. No Incoming stage exists.
- **Q3 (Schedule readiness gate)** — Closed. Option (b): jobs arrive directly as `Scheduled`; no readiness gate needed (wizard enforces upstream). Crew assignment is the only post-arrival step.
- **Q4 (Card label)** — Closed. Both: title + WTC chip below. Refined by NEW-G: single-WTC = work type name in title (`10085 - Test - Epoxy`); joined card = count in title (`10085 - Test - 5 work types`). Chip always shows WTC numbers.
- **Q5 (JobDetail Schedule tab)** — Closed. Option (c): remove embedded crew grid entirely. JobDetail = single job's facts; crew assignment happens on Live Schedule. Add a "Schedule this job" button that deep-links to the job's start week.
- **Q6 (Multi-WTC join model)** — Deferred to planning agent. Three candidates documented: row-per-WTC + group_id, row-per-card with WTC jsonb list, or hybrid (jobs + job_wtcs join table). Agent should pressure-test against existing call sites (queries.js, billing_log FKs, assignments).
- **Q7 (Partial-send re-join)** — Closed. Option (c): wizard summary step detects an existing card for this proposal and asks "Join or create new?" before send.
- **Q2 (Scheduled list view layout)** — Closed. Option (b): purpose-built card emphasizing crew/kickoff status, NOT the generic `JobCardList` layout. Surfaced fields: start date, days-until-kickoff, crew coverage ("3 of 5 days covered" or "no crew yet"), multi-week badge, Field SOW size (e.g. "5 days · 4-man crew"). Hidden vs Active/Billing card: billing progress bar, $ totals, OVERDUE/UNBILLED/READY-TO-INVOICE flags (none relevant pre-kickoff). New component (e.g. `ScheduledCardList.jsx`) — do not extend `JobCardList.jsx` with mode flags.

## Cross-repo work split

| Repo | Scope |
|---|---|
| sales-command | Send-to-Schedule Wizard (5 steps), block conditions, replace 1-click button |
| sch-command | IA rename (drop Parked; Scheduled / Active / On Hold / Billing); new Scheduled list view (purpose-built card) + new On Hold list view; picker tile updates (still 7, different mix); JobDetail readiness checklist removed; embedded crew grid removed (replaced by "Schedule this job" deep-link); optional card-merge action; multi-week per-job per-week alert in picker + Live Schedule |
| both | Schema migration for `material_status`, derived `end_date`, multi-WTC grouping |

## Next steps

1. ~~Close the 7 open decisions above (conversation).~~ Done. Q1 N/A; Q2/Q3/Q4/Q5/Q7 closed; Q6 (multi-WTC join model) + M5 (migration ownership/sequencing) deferred to planning agent.
2. Planning agent on **sales-command wizard** scope (clearer; ready first).
3. Planning agent on **sch-command IA refactor** scope.
4. Plan migration for schema deltas.

## Planning agent — sales-command context briefing

**Required reading before planning anything in sales-command** (sales-command has had heavy security/anti-fragility work through April–May 2026 — patterns are now strict):

| File | Why |
|---|---|
| `~/sales-command/CLAUDE.md` | Style rules, data integrity rules, verified Supabase column reference, page structure, session protocol |
| `~/sales-command/CLAUDE_RLS.md` | RLS anti-pattern from 2026-04-26 incident; correct token-gated and authenticated-access patterns; cross-repo policy impact |
| `~/sales-command/docs/BACKLOG.md` | Active security findings (H5, H11, B13, S2 — at T2). Any new "Send" flow must not regress these. |
| `~/sales-command/docs/handoffs/SC_Handoff_v111.txt` | Most recent session (planning closeout). Tonal context for current state. |

⚠ **Missing-runbook note:** `CLAUDE_RLS.md:65-66` references `docs/runbooks/rls-deploy-gates.md` for the 6-gate deploy pattern. **That file does not exist.** Canonical 6 gates extracted from `~/sales-command/docs/handoffs/SC_Handoff_v83.txt:64-89` (origin of the pattern) and inlined below. Follow-up cleanup task: convert the inlined version into a proper `~/sales-command/docs/runbooks/rls-deploy-gates.md` so the canonical reference isn't buried in a postmortem handoff.

**The 6-gate deploy pattern (RLS/auth changes):**

A. PR merged to main; Vercel auto-deploys frontend. Old DB policies still active. Frontend code may reference new behavior but DB doesn't enforce it yet.
B. Test production signing/auth flow end-to-end. Confirm no regression with new frontend + old policies.
C. Apply **additive** migration: new policies added alongside old. RLS combines with OR — no behavior change, safe overlap window.
D. Test production again with both policy sets active. Confirm overlap is non-breaking.
E. Apply **drop** migration: old policies removed. Only new (tighter) policies remain.
F. Test production a third time with strict enforcement only. Confirm new policies cover all paths.

Each migration paired with a rollback file in `supabase/rollbacks/` (or `sql/` for legacy) written **before** apply. Preview test on Vercel preview URL in incognito before merging.

**For non-RLS schema migrations** (e.g. the `material_status` column add this work needs): apply the same additive-mutate-cleanup principle adapted to schema:
1. Additive: add nullable column + backfill from existing data
2. Verify: read + write both shapes work in prod
3. Cleanup (optional): add NOT NULL constraint once 100% populated, drop legacy column

The 6-gate pattern is non-negotiable for RLS/auth changes. For pure schema changes (no policy impact), the lighter additive pattern above suffices. **Planning agent must call out which category any new migration falls into.**

**Hard constraints the wizard implementation must respect:**

1. **No body-trusted data on the server.** Any new edge function or server-side action must use `_shared/tenantAuth.ts` → `authenticateCaller`. Load proposal/WTC/customer/tenant data server-side from DB given an ID, not from request body. (Pattern established by C9 fix on `send-pay-app`, 2026-05-09.)
2. **Tenant-scope every read and every write.** `.eq("tenant_id", caller.tenantId)` on every query touching tenant-owned tables. (See completed C9 entry in BACKLOG.)
3. **Cross-repo grep before any RLS or schema change.** Tables listed at the bottom of `CLAUDE_RLS.md` are shared with sch-command. Migration touching `proposals`, `proposal_wtc`, `call_log`, `customers`, etc. → grep sch-command first. `jobs` is sch-command-owned and read/written by sales' `handleSendToSchedule`.
4. **No new policy in the `signing_token IS NOT NULL` anti-pattern shape.** All token-gated reads use the header-matched `request_signing_token()`/`request_viewing_token()` helpers.
5. **6-gate deploy** for any RLS/auth-touching migration. Skipping caused the 2026-04-26 incident.
6. **`fmt$` uses `maximumFractionDigits: 0`.** If the wizard renders money, no sub-cent decimals.
7. **No white backgrounds in-app.** Use `C.linen`, `C.linenCard`, `C.linenDeep`, `C.linenLight` from `src/lib/tokens.js`. (PDF/print is the only exception.)
8. **Active open T2 security findings are blockers for F7** (multi-tenant onboarding). The wizard work is independent of F7 but must not introduce new T2-class findings.

**Schema migration touch-points for this work:**

- `jobs` (sch-command-owned, written by sales `handleSendToSchedule`) — needs `material_status` enum column; derived `end_date`; multi-WTC join model (Q6 deferred).
- `proposal_wtc` (sales-owned) — already has `field_sow`, `start_date`, `end_date`, `materials`. Wizard reads these; no new columns expected.
- `proposals` (sales-owned) — no change expected (wizard summary may write a "sent to schedule" flag, TBD).

**Migration ownership & sequencing — DEFERRED to planning agent.** Constraints the agent must weigh:

- Shared Supabase project (`pbgvgjjuhnpsumnowuym`) across both repos.
- `supabase db pull` is broken; each repo holds its own `supabase/migrations/` history. Truth-of-state is whatever was last pushed via `db push --linked`. (Per memory `project_sales_command_migration_state.md`.)
- The owning table determines the natural home for the migration: `jobs` is sch-command-owned, so the `material_status` migration file most likely belongs in `~/sch-command/supabase/migrations/`. Planning agent must confirm.
- Deploy must be additive-then-mutate to avoid breakage:
  - Sales-command write path (`handleSendToSchedule` → new wizard) cannot reference the new column until it exists in prod.
  - Sch-command read path (jobs view, materials filter UI) cannot assume the new column is non-null until backfill completes.
- New `supabase/rollbacks/` directory convention (per memory) — rollback file paired with each forward migration.
- Cross-repo grep before pushing any migration that touches a shared table (CLAUDE_RLS.md rule).
- Planning agent must produce: (1) which repo owns the migration file, (2) the deploy sequence step-by-step, (3) rollback file content, (4) verification queries between steps.
- **Historical data shape mismatch.** Today's `handleSendToSchedule` (`ProposalDetail.jsx:507–535`) merges all proposal WTC `field_sow` arrays via `flatMap` into a **single** `jobs` row per proposal. The new wizard produces **per-WTC** rows (default) or joined cards (opt-in). The `material_status` backfill must handle both shapes:
  - **Legacy merged rows** (existing prod): backfill `material_status` from `materials_needed` boolean (true → `not_ordered` as default; false → `not_ordered` as well? or skip? planning agent decides). One row covers all WTCs of that proposal.
  - **New per-WTC rows** (post-deploy): `material_status` set per row by the wizard at send time. No backfill needed for these.
  - **Mixed-shape detection** during multi-WTC join model selection (Q6) — the chosen model must support both shapes without a destructive data migration. Avoid forced re-split of legacy merged rows unless explicitly part of the plan.

**Files almost certain to change in sales-command:**

- `src/components/ProposalDetail.jsx:488–596` — `handleSendToSchedule()` (current 1-click flow). Replace with wizard-launching button.
- New: `src/components/SendToScheduleWizard.jsx` — 5-step wizard component.
- New: an edge function for the actual server-side send (per constraint 1 — don't trust client-built insert payload).

**Test plan constraints (planning agent must produce a detailed smoke plan):**

- **No prod mutations.** Test surface touches both repos and the shared Supabase project (`pbgvgjjuhnpsumnowuym`). Smoke must use either (a) a Vercel preview branch with a TEST customer/proposal, or (b) a scratch Supabase project per the established pattern (see `~/sales-command/docs/handoffs/SC_Handoff_v102.txt` for S1 scratch-project precedent).
- Cover: per-WTC send (Step 5 "create new"); partial send + later second-WTC join via wizard summary detection (Q7 path); blocked-send when Field SOW missing; material_status enum write + readback on sch-command side.
- Cross-repo rollback rehearsed before prod migrate.

**Files almost certain to change in sch-command (downstream):**

- `src/components/JobsPicker.jsx` — drop "Parked" tile; rename "Ready" → "Scheduled" with new list-view route (`/jobs?tab=scheduled`); add "On Hold" tile → `/jobs?tab=on-hold`. Tile count stays at 7.
- `src/views/Jobs.jsx` — drop Pipeline tab + Parked-related logic; add Scheduled list-view tab; add On Hold list-view tab. Final tabs: Scheduled, Active, On Hold, All Jobs.
- `src/views/JobDetail.jsx` — drop readiness checklist (logic at lines 133–139; UI block lines 233–310, conditional wrapper at 234); drop embedded crew grid; add "Schedule this job" button deep-linking to `/schedule` on the job's start week.
- `src/components/JobCardList.jsx` — card label format: work-type-name title + WTC chip (Q4 closed).
- New component: `src/components/ScheduledCardList.jsx` (Q2 closed — purpose-built card, not generic JobCardList).
- `src/views/Schedule.jsx` — multi-week alert: per-job per-week pulse on weeks the job spans where this job has zero crew assignments (M6-tightened criterion; NOT "any unassigned day").
- `src/lib/queries.js` — handle new multi-WTC grouping (depends on Q6 outcome).
- Migration: `material_status` enum + backfill from `materials_needed`; multi-WTC grouping schema (depends on Q6).

---

## Appendix — Audit resolution log

_For traceability only. Not required reading for planning agents — skip to the briefing above._

Audit terminal pass produced 3 high, 6 medium, 5 low findings (rev 1) + 4 medium, 3 low (rev 2). Resolutions:

| ID | Finding | Resolution |
|---|---|---|
| NEW-A | Historical merged-row vs new per-WTC backfill mismatch | Added to "Migration ownership" block: explicit shapes (legacy merged vs new per-WTC) + non-destructive constraint for Q6 model choice. |
| NEW-B | `call_log.stage` value on send undefined | Closed. `call_log.stage` stays `Sold`. Wizard does NOT update it. Existing 'Parked' write at `ProposalDetail.jsx:588` removed. |
| NEW-C | 6-gate deploy info is vapor | Closed. 6 gates (A-F) extracted from `SC_Handoff_v83.txt:64-89` and inlined in the briefing. Schema-only migrations get a lighter additive-mutate-cleanup pattern. |
| NEW-D | Wizard multi-WTC flow ambiguity | Closed. Option (B): one WTC per wizard run; sibling detection at Step 5 (Q7 path) offers join with existing card. |
| NEW-E | Step 3 SOW authoring surface | Closed. Option (B) with guided copy: numbered next-steps, "Open WTC Editor →" deep link, honest "you'll re-pick the WTC when you return" note. |
| NEW-F | Audit log clutters agent-facing doc | Closed. Moved to this appendix at the bottom. |
| NEW-G | Joined-card label truncation rule | Closed. Option (C): joined cards (2+ WTCs) show count (`N work types`) instead of work type names. Single-WTC cards keep the name. Individual names visible on card detail. |
| NEW-H | `WTCCalculator.jsx` path not specified | Closed. Path is `src/pages/WTCCalculator.jsx` (page-level route, not a component). Added to Step 3 spec + guided "no SOW yet" flow. |
| NEW-I | Step 5 sibling-detection prompt assumes ≤1 existing card | Closed. Step 5 spec now distinguishes 1 unjoined card (simple Yes/No) vs N unjoined cards (enumeration). Enumeration model is Q6-dependent — planning agent finalizes. |
| NEW-J | 6-gate source is a postmortem, not a runbook | Acknowledged. Follow-up cleanup task added to missing-runbook note: convert inlined gates into `~/sales-command/docs/runbooks/rls-deploy-gates.md`. Not blocking. |
| NEW-K | Joined-card readability trade-off | No action. Trade-off explicitly accepted at Q4/NEW-G. Revisit only if joined cards become the common case. |
| H1 | `docs/runbooks/rls-deploy-gates.md` doesn't exist | Briefing row replaced with reference to `CLAUDE_RLS.md` + flagged the missing-runbook as a separate cleanup task. |
| H2 | On Hold missing from new IA | Added 7th picker tile "On Hold" → `/jobs?tab=on-hold` list view. Tab count: 4 (Scheduled, Active, On Hold, All). |
| H3 | Complete/Billing conflation | Kept single Complete status. No Complete tab in `/jobs`. Billing tile counts all Complete-status jobs and routes to `/billing` which handles sub-buckets (Pending Partial, Pending Complete, Paused, Confirmed, Invoiced, No Bill) internally. |
| M1 | Picker→route mapping undefined | Explicit table added. `/jobs` = 4 tabs. Billing, Live Schedule, Production Rate = top-level routes. |
| M2 | Wizard Step 1/2 ordering ambiguous | Reordered. Step 1 = Select WTC, Step 2 = Confirm Start Date (per-WTC). |
| M3 | Derived end_date vs block condition contradiction | Reworded: block on `start_date` + `field_sow.length ≥ 1`. End date computed server-side. `field_sow` is jsonb array — day count = `.length`. |
| M4 | Field SOW edit persistence | Option (a): writes persist back to `proposal_wtc.field_sow` immediately on Save & Continue. (Superseded by NEW-E: all SOW edits go through WTC editor, not the wizard.) |
| M5 | Migration ownership/sequencing undefined | Deferred to planning agent with constraint list (shared DB, broken `db pull`, rollback convention, cross-repo grep). |
| M6 | Multi-week pulse criterion = noise on arrival | Tightened: per-job per-week criterion — pulse only when this job has no crew assigned in a week it spans, not "any unassigned day." |
| L1 | Q6 option count mismatch (2 vs 3) | Schema deltas section updated to list all 3 candidates. |
| L2 | Enum casing convention | Snake_case storage values documented with display-label map. |
| L3 | Math typo `× → +` | Fixed: `end_date = start_date + (field_sow.length - 1) days`. |
| L4 | Line citations slightly off | Updated to verified ranges: `ProposalDetail.jsx:488-596`, `JobDetail.jsx` readiness logic 133-139, UI block 233-310, conditional wrapper line 234. |
| L5 | "7 tiles → 6" baseline | Clarified: tile count (7 buttons in `JobsPicker.jsx`) vs status-bucket count (6 in `buckets` object on line 34). After this refactor: tile count stays at 7 (different mix), bucket count drops as `Parked` is removed. |
| — | No smoke plan | Added "Test plan constraints" section requiring planning agent to produce a non-prod-mutating smoke plan. |
