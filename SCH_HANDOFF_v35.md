# SCH_HANDOFF_v35 — Phase F: Post-Send Mobilization Editing SHIPPED (3 repos, live)

**Repo:** sch-command (owner) · **Branch:** `main` · **Date:** 2026-08-25
**Production:** https://schedulecommand.com + https://salescommand.app — both merged + Vercel deploys **green**.
**Cross-repo:** YES — `command-suite-db` (F0 migration + backfill) + `sales-command` (F1 seed) + `sch-command` (F1b/F2/F3). **DB migration pushed to shared prod + one-time backfill run.**
Spine: `command-suite-db/docs/MASTER_SCHEDULE.md` Row **F** (marked SHIPPED). Plan: `docs/plans/post_send_mobilizations.md` (D1–D8 ratified, 2 audit rounds folded).

> **Numbering note:** this is **v35**, not v34 — `SCH_HANDOFF_v34.md` is claimed by the parallel unmerged branch `feat/daily-view-rebuild`. Skipped v34 to avoid a filename collision when that branch merges.

> **Why this was more work than a "one field" feature (Chris flagged it):** the *code* was clean and passed all three gates on the first pass. The extra time was entirely in the **deploy step hitting pre-existing shared-DB infra debt** — the rehearsal harness's expected-counts had lagged 4 already-applied migrations, and a `pg_dump` baseline refresh silently dropped a hand-maintained security REVOKE. Both were caught by the rehearsal (working as designed) and fixed. See §4 + §5. This is debt that would have bitten *any* migration push, not Phase F specifically.

---

## 1. Session summary

Built and shipped **Phase F — post-send mobilization editing**: Schedule Command now owns a live job's trips-to-site after Send, so a **go-back** (a return trip — warranty / added work) can be added without pulling back or unlocking the (possibly invoiced) proposal. Spanned three repos: a one-field DB migration (`command-suite-db`), a seed-at-send (`sales-command`), and the read-repoint + write UI + cost rollup (`sch-command`).

Went build → **T4 buildvsplan (34/34 spec points)** → **T5 code-review (0 blockers, 2 low fixed)** → **T6 security-review (0 exploitable-today, 1 deferred)** — all green — then pushed F0 to the shared prod DB (after a mandatory rehearsal that surfaced + fixed two pre-existing infra issues), ran the one-time backfill (2 pre-existing live jobs), merged all three repos to main, and confirmed both Vercel prod deploys green. `MASTER_SCHEDULE.md` Row F marked shipped. **Full end-to-end smoke of the F2/F3 UI in the live app is NOT yet done** — Chris was mid-smoke when this build started and will resume it (see §7).

## 2. Changes shipped

**command-suite-db (main):**
- `5d0face` **Phase F F0 + F1-backfill** — additive migration `20260825140000_job_mobilizations_is_go_back` (`is_go_back boolean NOT NULL DEFAULT false`, back-fills existing rows, inherits table RLS/grants) + matching rollback + one-time backfill SQL in `scripts/one-offs/`.
- `3e294e1` **Fix F1-backfill** — `jobs.deleted` is TEXT (`'No'/'Yes'`), not boolean; the WHERE clause was doing a boolean compare that would abort the whole INSERT (0 rows, not 2). Now matches `loadJobs`' own live filter `(deleted IS NULL OR deleted = 'No')`. *(caught by T4)*
- `888f512` **Recalibrate rehearse harness** — see §4/§5. Bumped stale EXPECT_* counts to current prod + restored the hand-added invoices REVOKE that the baseline refresh dropped.
- `0d0ec21` **MASTER_SCHEDULE** — Row F marked shipped + diagram/ledger/open-items updated.

**sales-command (main):**
- `638b9f6` **Phase F F1: seed job_mobilizations at Send** — in `commitSendToSchedule`, after the `job_wtcs` upsert, insert one `job_mobilizations` row per proposal mobilization (label/dates from `review.mobilizations`, not the id→seq `mobById`; `seq>0`; `is_go_back:false`; guarded on `p.call_log_id`). **NON-FATAL** — a seed failure warns and lets the job stand; does NOT mirror the `job_wtcs` job-killing rollback.

**sch-command (main):**
- `a9b74ef` **Phase F F1b/F2/F3** — the bulk of the feature:
  - **F1b:** new `loadMobilizationsByJobId` (keyed by `job_id`, not `call_log_id`, so archive+live call_logs don't cross) with a **permanent** `proposals.mobilizations` fallback for 0-row jobs. Rewired all 5 read sites; prop renamed `mobsByCallLog`→`mobsByJobId`.
  - **F2a:** `MobsModal` turned editable — reads `job_mobilizations` rows directly (dayless go-backs visible), **+ Add Go Back** / **+ Add trip**, `seq = max+1` over rows AND day seqs, delete = **hard block on pull_tickets** / warn+confirm on field_sow tags. New audit-logged writers `addJobMobilization`/`updateJobMobilization`/`deleteJobMobilization`. MOBS scorecard now always opens the editor + shows a go-back count badge.
  - **F2b:** per-day mobilization picker in `FieldSowBuilder` (sourced from a fresh load in `CardSowModal`); D6 Hours/Qty/Mobilization clarifiers.
  - **F3:** `computeMobCosts` — material $ via `catalog_id` join (name/kit fallback + unpriced flag); labor $ = hours × stamped `bid_breakdown.burden_rate` (PW-unstamped → "needs rate", non-PW → tenant `default_burden_rate`; `crew_count` NOT a multiplier). Added `default_burden_rate` to the job read select. Cost shown per go-back; count only mobs with ≥1 tagged day.
- `ef83132` **Address T5 #1 + #3** — pull-ticket hard block now checked (via new `countPullTicketsForMob`) *before* the field_sow confirm; `saveDraft` validates `end_date >= start_date`.
- `5e4d95b` **Plan backlog note** — recorded T6 #6 (server-side delete-block trigger) as deferred.

## 3. Gate record (all green — the "snapshots from the review terminals")

- **T4 buildvsplan:** **34/34** spec points built-to-spec. Found 1 real bug (the backfill `jobs.deleted` type error, fixed `3e294e1`) + flagged F0-not-yet-in-prod as an expected sequencing gate. Verdict: app code needs no changes.
- **T5 code-review:** **0 ship-blockers.** Verified computeMobCosts branches, the two-part delete scan + caller honoring the hard block, seq=max+1, the 6-site read-repoint, archive+live fallback, orphaned-seq select round-trip. 4 low findings filed → **#1 (confirm-before-block ordering) and #3 (end≥start) fixed**; #2 (memoization) and #4 (stamped-price preference) accepted as inert/trivial.
- **T6 security-review:** **0 exploitable-today** (scored against prod: 1 tenant, ≤5 authenticated office users). Verified RLS tenant-scoping on all new writers/reads, F0 grant inheritance, F1 seed RLS-gated, backfill's owner-conn bypass writes only tenant-correct job_ids, `tenant_config` embed column-restricted, `restrictive_combos` invariant held. 1 hardening item deferred (§5).

## 4. Deployed (shared prod DB + Vercel)

- **F0 migration → shared prod** (`pbgvgjjuhnpsumnowuym`): `20260825140000_job_mobilizations_is_go_back` applied via `npm run db:push` (full gate: migration-safety → collision → **invoice-lock assert** → powersync-from-scratch rehearsal → push). **Verified live:** `job_mobilizations.is_go_back` = boolean, NOT NULL, default false.
- **F1-backfill → run once** against prod (`supabase db query --linked -f`). **Verified: exactly 2 rows** — job 95 (Mob 1 "CHIPS", Jul 28–29) + job 96 (Mob 1, blank label/dates from its source proposal). Both `is_go_back=false`.
- **Vercel prod deploys — both green:** sales-command `dpl_9pRHZhpStUwpFJ4ipu54NL7kTzT3` (READY, commit `638b9f6`); sch-command `dpl_8bggy9Cwe6TSR8x4EyipsT9Ga5yG` (READY, commit `5e4d95b`).

## 5. Decisions / choices made (the non-obvious ones)

- **Seed at send is NON-FATAL** — a mob-seed failure warns and leaves the job sent (mobs are backfillable). Deliberately does NOT reuse the `job_wtcs` rollback, which deletes a valid job+bid; `job_wtcs` is unrecoverable, mobs are not.
- **Reads keyed by `job_id`, not `call_log_id`** — a call_log can carry archive + live jobs, so a call_log-keyed read returns the wrong job's mobs. This is why `loadMobilizationsByCallLog` is kept only as the internal fallback.
- **Proposal fallback is PERMANENT, not gate-removable** — because the seed is non-fatal, a live job can legitimately have 0 `job_mobilizations` rows with tagged days, so a row-count removal gate can never reliably latch.
- **Delete scan split by reversibility** — `pull_tickets` (ON DELETE CASCADE, irreversible) = hard block, no override; `field_sow` day-tags (re-taggable) = warn+confirm. Never collapsed into one confirm→proceed (that would allow click-through pull-ticket loss).
- **PW labor rate never silently defaulted** — a prevailing-wage job with no stamped `bid_breakdown.burden_rate` surfaces "needs rate" rather than applying the standard ~$56.50 default (which would 2–3× undercost the go-back).
- **Rehearse-harness recalibration (the deploy detour):** the rehearsal refused because (a) its EXPECT_* counts lagged 4 already-applied migrations since Aug 10 (rate_cards, home_followup ×2, leads_intake) — bumped to current prod after confirming `restrictive_combos` held at 1 (no new anon-exposure lock); and (b) the `supabase db dump` baseline refresh **silently dropped the hand-added `REVOKE SELECT ON invoices FROM anon`** (pg_dump can't express an absence — the MIG-1 invisible-bug class). Re-applied the REVOKE block verbatim in its original position. Rehearsal then fully green. **This is why the push took real work — pre-existing infra debt, not Phase F.**
- **Handoff numbered v35** to dodge the `feat/daily-view-rebuild` branch's v34.

## 6. Backlog touched

- **NEW (deferred, documented in the plan's §6):** server-side `BEFORE DELETE` trigger on `job_mobilizations` mirroring the pull-ticket hard block (T6 #6, defense-in-depth). Same-tenant-authorized-user data-loss only, never cross-tenant. A new shared-DB migration — author as a follow-on if wanted. **Not built.**
- No existing backlog IDs closed (Phase F was net-new feature work).

## 7. State at close

- **All three repos on `main`, clean, synced with origin.** Tips: command-suite-db `0d0ec21`, sales-command `638b9f6`, sch-command `5e4d95b`.
- **Feature branches deleted** (local + remote) in all three: `feat/post-send-mobilizations` gone.
- **Live:** DB migration applied, backfill run, both apps deployed. "Make it live" is fully done.
- ⚠ **Parallel branch:** `feat/daily-view-rebuild` (sch-command) is open with v34 handoff + daily-view work — another session's stream, untouched here.

## 8. Next / open

- **RESUME THE SMOKE (Chris) — this is the one thing not done.** On the live app, exercise the F2/F3 UI end-to-end: open a live job in Schedule → MOBS card → **+ Add Go Back** → tag days via the per-day Mobilization picker → Save. Confirm: go-back appears badged (even dayless), cost rolls up (materials + labor), MOBS card shows the ↩ count, **proposal untouched / no pull-back even on an invoiced job**, delete-with-pull-ticket is hard-blocked.
- **Two domain confirms to eyeball during smoke:** Hours = total man-hours/day (not per-person); material Qty = priced units (kits), not gallons. Both have UI clarifiers now — verify they match how quantities are actually entered.
- **Pre-flight for the next shared-DB migration (anyone):** the rehearse-harness recalibration is done for now, but if more migrations land before the next push, its EXPECT_* counts will lag again — and a baseline refresh will always drop the invoices REVOKE (re-add it, or the rehearsal catches it). Budget for that.

## 9. Files to probably know about next session

- `sch-command/src/lib/queries.js` — `loadMobilizationsByJobId`, `loadJobMobilizationRows`, `addJobMobilization`/`updateJobMobilization`/`deleteJobMobilization`, `countPullTicketsForMob`, `computeMobCosts`; `CALL_LOG_SELECT` now embeds `tenant_config(default_burden_rate)`.
- `sch-command/src/components/MobsModal.jsx` — the editable modal (was read-only).
- `sch-command/src/components/FieldSowBuilder.jsx` + `CardSowModal.jsx` — per-day mobilization picker + fresh-load wiring.
- `sales-command/src/components/ProposalDetail.jsx` — `commitSendToSchedule` seed (search "F1 (Phase F)").
- `command-suite-db/scripts/rehearse.sh` + `supabase/baseline/prod_public_schema.sql` — recalibrated harness + restored REVOKE (read the REVOKE comment block before ever refreshing the baseline again).
- `sch-command/docs/plans/post_send_mobilizations.md` — the contract (D1–D8, deferred #6 in §6).

## END STATE
**Merged, deployed, and live across 3 repos; F2/F3 UI smoke deferred to Chris's resumed session. Ready for a fresh session.**
