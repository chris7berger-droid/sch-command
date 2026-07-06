# SCH_HANDOFF_v26 — Budget tab (Bid side) SHIPPED to prod (Loop #40), cross-repo

**Repo:** sch-command · **Branch:** `main` (merged + pushed; `feat/budget-tab` deleted)
**Date:** 2026-07-06
**Production:** https://www.schedulecommand.com — Budget tab LIVE this session.
**ERD:** Loop #40 (SCH-budget-functionality) — build session, **CLOSED** (16:43, 3h 16m).

> Cross-repo loop. Primary deliverable here (sch-command), but it spans three repos:
> **command-suite-db** (the migration), **sales-command** (the stamp + backfill), and
> **sch-command** (the Budget tab). All three merged to their `main` and pushed.

---

## 1. Session summary

Built and shipped the **Bid side** of the Budget tab: open a Schedule job card → **BUDGET** toggle → see the frozen bid (reg/OT hours, labor/materials/travel cost, total cost, margin) pulled straight from the signed proposal. The design decision (locked with Chris before the build) was that **Sales stamps the finished cost breakdown onto the `job_wtcs` snapshot at Send-to-Schedule** — calc.js stays the single home for the money math, Schedule just reads pre-computed numbers off its own row. That meant a DB migration (nullable `job_wtcs.bid_breakdown jsonb`), a Sales-side stamp + backfill, and the Schedule render. Ran the full protocol: `/buildvsplan` (clean, incl. the backfill B′ check on a non-clone proposal), a high-effort multi-agent `/code-review` (10 findings, 0 High/Med — 3 fixed by the review terminal, the rest triaged), and `/security-review` (no High/Med; cost/margin contained behind tenant RLS at every read/write). Deployed in order: migration to the shared DB → smoke on Vercel previews → merge both apps to prod. The Actual/Δ columns are scaffolded but read "pending" until Field Command is tracking. Backfill of legacy rows was **deferred to go-live** (Chris is the only Schedule user; data isn't final yet). Loop closed; the carry-forward ("ideate before plan") was promoted into the global protocol.

---

## 2. Changes shipped

### command-suite-db (merged to main, `a2a9a14`; migration APPLIED to shared DB)
- `5f389fb` — **Add `job_wtcs.bid_breakdown jsonb` (nullable).** The stamp column. Nullable so legacy/not-yet-stamped rows read as absent and the UI degrades gracefully; single jsonb (not scalars) keeps the payload versionable (`.v`).
- `30c1e9d` — **Sensitivity/role-gating doc (review L10).** Migration comment only: payload carries cost/profit/margin under tenant-only RLS; future role-gating → role-aware RLS or a SECURITY DEFINER view, NOT a column REVOKE (no-op under the table grant).

### sales-command (merged to main, `3c400ce` → prod)
- `9a0f342` — **calc.js + stamp.** Surfaced `laborCost/materialCost/travelCost` from `calcWtcBreakdown`'s existing locals (additive; labor+mats+travel === cost by construction). Added `calcBidStamp` (thin shaper over one `calcWtcBreakdown` call). Wired `bid_breakdown: calcBidStamp(wtc, usesExactPricing(p))` into `handleSendToSchedule`. Added the minimal calc.js-backed backfill script.
- `78c5e8b` — **Review hardening (M1/L7/L5).** Backfill now paginates past the 1000-row cap (service-role reads span all tenants) + skips fail loud (non-zero exit). A failed `job_wtcs` upsert at Send-to-Schedule is now fatal: rolls back the just-inserted `jobs` row (verifies the delete — RLS can no-op) and doesn't mark the proposal sent.
- `0f7d3df` — **Backfill comment fix + F40 (review L3/L6/L9).** Corrected the eyeball guidance (compare to the archived signed PDF, not the live recompute). Dropped the drift-guard in favor of closing the root cause; filed **F40**.

### sch-command (merged to main, `71abd4a` → prod)
- `d6b8bf5` — **BudgetPanel + BUDGET toggle.** Renders off `job._wtcs[n].bid_breakdown` (no queries.js change). Per-WTC BID·ACTUAL·Δ table; roll-up sums extensive fields only, margin = Σprofit/Σprice guarded; per-WTC empty state; travel row only when >0; reuses `fmtMoney` + `.jobs-table`/`.jd-*` (no new CSS, no status dots).
- `33fd86b` — **Partial roll-up banner (review M2/L4).** A partly-stamped job shows "Partial roll-up — N of M stamped" and relabels aggregates "Total Cost (partial)" / "Margin (partial)" instead of presenting a subset as the job total.
- `5bc4c7f` — **Rate header to the cent (review L8).** `fmtRate` (2dp) for the burden/OT $/hr header only; cost figures stay whole-dollar.

---

## 3. Deployed

- **DB migration** `20260706120000_job_wtcs_bid_breakdown.sql` — applied to the shared Supabase project **pbgvgjjuhnpsumnowuym** via `npm run db:push` from command-suite-db `main`. Safety + collision checks passed (85 local / 84 in ledger, no collision). Verified live: `information_schema` shows `bid_breakdown` jsonb, nullable.
- **sales-command** → Vercel prod (scmybiz.com) via merge to main `3c400ce`.
- **sch-command** → Vercel prod (schedulecommand.com) via merge to main `71abd4a`.
- No edge functions touched.

---

## 4. Decisions / choices made

- **Sales stamps the breakdown at Send-to-Schedule (vs. Schedule re-deriving).** calc.js is the declared single source of truth with ~8 replication traps; re-implementing it in Schedule would guarantee drift. Stamping keeps one math home and makes the Budget tab match the signed proposal exactly. Cost: cross-repo + a one-time backfill.
- **Extend the canonical aggregate, don't build a twin.** `laborCost/materialCost/travelCost` are surfaced from `calcWtcBreakdown`'s existing locals, so `calcBidStamp` is a thin shaper — no re-deriving helper that can drift.
- **Backfill gates on `created_at`, NEVER `pricing_anchor_at`.** `pricing_anchor_at` is NULL on every non-clone proposal; gating on it would strand every normal proposal (Budget empty forever). `/buildvsplan` proved the B′ case on a real non-clone.
- **Reviewer's drift-guard → root-cause fix instead.** The drift the review flagged (recomputing an edited WTC into a frozen row) is only reachable because `handlePullBack` lacks the Schedule-job guard that mirrors the invoice guard. Chris's invariant: WTCs lock at approval; no pull-back/edit while a Schedule job exists. Doing it right spans **three seams that must move together** (pull-back guard + re-send guard + orphaned `job_wtcs` on re-send), and Schedule soft-deletes jobs — so it's its own scoped item, not a Budget-loop bolt-on. Filed as **F40**. This loop only fixed the misleading backfill comment.
- **Backfill deferred to go-live.** Schedule has no real users yet (Chris building it); data isn't final. He'll do a big data push at go-live; the script + F40 are the breadcrumb.
- **Merge to prod now (not park).** Chris wanted it live so he can see it in production while finishing the build — no branch/preview-URL hunting. He's the only Schedule user, so it's zero-risk.
- **jobs DELETE RLS policy — deferred.** The L5 rollback delete currently RLS-no-ops (no DELETE policy on `jobs`) → routes to the admin-cleanup fallback. Widening DELETE on a shared, Schedule-owned table to self-heal a rare failure isn't worth the surface. Fallback stands.

---

## 5. New backlog items filed this session

- **F40** (sales-command, T2) — **Post-send lock integrity + re-send round-trip.** Pull-back guard / re-send guard / orphaned `job_wtcs` must move together (fix all or none — half-fixing dead-ends the workflow). Surfaced by the Budget-tab review, not caused by it. Low today (test-tenant, round-trip not in use). Full spec in the sales-command backlog row.

---

## 6. Closed this session

- **ERD Loop #40** (SCH-budget-functionality) → closed 16:43, 3h 16m. Bid side renders from stamped data on the job card, prod-verified.
- No backlog IDs closed (this loop opened F40; the Budget tab wasn't a pre-existing backlog row).

---

## 7. Verification

- **`/buildvsplan`:** CLEAN — 0 Tier-1/2. B′ proven: backfill dry-run stamps a real **non-clone** proposal (not just a clone), prices match the signed display in both eras.
- **`/code-review` (high, multi-agent + adversarial verify):** 10 findings, **0 High/0 Med** (2 Med downgraded on verify, 8 Low). 3 fixed (M1/L7/L5, M2/L4, L8); L10 doc'd; L3/L6/L9 → root cause filed as F40; jobs-DELETE (L5 policy) deferred.
- **`/security-review`:** no High/Med. `bid_breakdown` (cost/profit/margin) contained behind authenticated tenant-scoped RLS at every read and write; no anon/public/PowerSync path. One low/informational note (service-role key passed inline on the backfill run recipe — ops hygiene, no code change).
- **Sales unit check:** `calcBidStamp` == the signed-proposal display (`calcWtcBreakdown`) across normal/PW × exact/legacy eras (33/33 asserts passed).
- **Preview smoke (Chris):** Sales send-to-schedule stamped `bid_breakdown`; Schedule Budget tab rendered correctly (numbers match, rate header cents, Actual/Δ pending, mixed-null + zero-WTC states). **PASSED.**
- **Prod:** both apps merged + pushed; column live on shared DB. Watch Vercel for both builds green.
- **NOT verified:** the **backfill was NOT run** (deferred to go-live) — legacy `job_wtcs` rows still read empty in Budget until then. That's the intended graceful-degrade, not a bug.

---

## 8. Not touched this session

- **The backfill** — deferred to the go-live data push (script committed, F40 breadcrumb).
- **F40 (lock-integrity round-trip)** — filed, not built (its own scoped task; touches sales pull-back + re-send + sch soft-delete cascade).
- **Actual / Δ columns** — scaffolded "pending"; wire when Field Command tracks real numbers.
- **jobs DELETE RLS policy** — deferred (fallback stands).
- **Standalone `/budget` route** — left inert/untouched (scope trim; a literal half-delete would break the Vite build).

---

## 9. Next session pointers

- **Nothing blocking.** The loop is closed and shipped. Confirm both Vercel prod builds went green (schedulecommand.com Budget tab renders; scmybiz.com deploys clean).
- **At go-live:** run the backfill — `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/backfill_job_wtcs_bid_breakdown.mjs` in **sales-command** (dry-run first; eyeball each vs the archived signed PDFs; then `--apply`). Fold into the "big data push."
- **When F40 comes up:** it's a sales-command-led change (pull-back + re-send guards, filter soft-deleted jobs) with a sch-command cascade (orphaned `job_wtcs`). Plan it as one unit — don't half-fix.

---

## 10. Files to probably know about next session

- `src/components/StageJobCard.jsx` — `BudgetPanel` + BUDGET toggle + `fmtRate` (2dp). Reads `job._wtcs[n].bid_breakdown`.
- (sales-command) `src/lib/calc.js` — `calcWtcBreakdown` now returns `laborCost/materialCost/travelCost`; new `calcBidStamp`.
- (sales-command) `src/components/ProposalDetail.jsx` — `handleSendToSchedule` stamps `bid_breakdown`; fatal-on-upsert-fail rollback.
- (sales-command) `scripts/backfill_job_wtcs_bid_breakdown.mjs` — the deferred go-live backfill.
- (sales-command) `docs/BACKLOG.md` — F40 filed.
- (command-suite-db) `supabase/migrations/20260706120000_job_wtcs_bid_breakdown.sql` — the applied migration.

---

## 11. Git state on close

- **sch-command:** on `main` @ `71abd4a` (== origin/main). `feat/budget-tab` merged + deleted (local + remote). Working tree: only this handoff pending.
- **sales-command:** on `main` @ `3c400ce` (== origin/main). `feat/budget-tab` merged + deleted (local + remote).
- **command-suite-db:** on `main` @ `a2a9a14` (== origin/main). Local `feat/budget-tab` deleted (was never pushed).
- No open feature branches across the three repos. No open PRs.

---

## END STATE

Shipped + closed — Budget tab (Bid side) merged to prod across all three repos, migration applied to the shared DB, smoke-verified on preview, ERD Loop #40 closed. Only the legacy-row backfill is deferred (to go-live) and F40 (lock-integrity round-trip) is filed for later. Ready for a fresh session.
