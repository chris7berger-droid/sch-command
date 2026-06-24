# SCH_HANDOFF_v23 — Deposit indicator + billing-redesign "solid half" SHIPPED to prod

**Repo:** sch-command · **Branch shipped to:** `main` @ `ae2b171` (live on prod)
**Date:** 2026-06-23
**Production:** https://www.schedulecommand.com (apex `schedulecommand.com` does NOT resolve — use `www`)
**ERD:** Loop #36 (deposit flow) — deposit is now live; see §Next.

---

## 1. Session summary

Started as a "small" Cycle-2 add — the Schedule-side **deposit indicator** — and uncovered that it was sitting on top of a large, **parked** billing redesign on `feat/billing-forecast` (built 6/17–6/19, never merged). Chris had believed that redesign was already in prod; it wasn't. We did two things, both now **live in production**:

1. **Deposit indicator** (the original ask) — a read-only DEPOSIT tile on the Schedule job card.
2. **The billing redesign's "solid half"** — the two-tab Billing screen (**Worklist + 90-Day Forecast**), reconciled with the deposit indicator and shipped.

The redesign's **other half** (worklist *reorganization*: lifecycle cards, filters, AR aging, nav/polish) remains a deliberate, parked refinement — see §Next.

---

## 2. Changes shipped (live on prod, `main` @ `ae2b171`)

**Deposit indicator (read-only — Schedule mirrors sale-side state, no billing math, no writes):**
- `src/lib/queries.js` — `deposit_required`/`deposit_amount`/`deposit_invoice_id` added to `CALL_LOG_SELECT` + `normalizeJob`; `depositState()` derivation; `attachDepositState()` best-effort enrich in `loadJobs` (one scoped, active-filtered `invoices` read; never blocks the job list on error).
- `src/components/StageJobCard.jsx` — informational **DEPOSIT** tile in the management panel (`Due` / `Sent Nd, due M/D` / `Paid`); hidden when `job._deposit` is null. `fmtMD()` helper added.
- **No DB change** — the `call_log` deposit columns were already live on prod (sales-command Cycle 1, migration `20260621120000`, see sales-command `SC_Handoff_v148`).

**Billing redesign — solid half** (the forecast + worklist, from the parked branch):
- `src/lib/billingForecast.js` (engine), `src/components/BillingForecast.jsx`, `src/components/BillingWorklist.jsx`, `src/lib/weeks.js`.
- `src/views/Billing.jsx` — two-tab shell (`?tab=worklist|forecast`).
- Data layer in `queries.js`: `loadInvoicesForForecast`, `loadBillingWorklist`, `loadBillingSurfaceData`, `setBillingWorklistFlag`, `BILLING_WORKLIST_FIELDS`.
- `supabase/migrations/20260618120000_billing_worklist_create.sql` — **already applied to prod on 6/18** (the file is the record only; do NOT re-run).
- Card/nav rewires: `JobsPicker.jsx` (Ready-to-Bill / Production-Complete tiles), `Jobs.jsx`, `JobCardList.jsx`.

**Reconciliation:** the deposit tile was folded into the *redesigned* card via a `main`→branch merge, verified line-by-line (diff vs the pure redesign showed only `+fmtMD` and `+the deposit tile`, zero deletions).

---

## 3. Key decisions

- **Deposit is sale-side; Schedule only reads.** All deposit *actions* (flag job, bill it, mark the invoice) live in sales-command. The Schedule indicator mirrors `deposit_required` + the linked invoice's `sent_at`/`due_date`/`paid_at`. An earlier attempt to "fix" the `billingForecast` deposit arm was **reverted** — that's billing-side logic, out of scope.
- **Shipped the solid half now**, parked the worklist reorganization for its own proper build. The forecast was already validated on live data ($750,931 tie-out) and passed buildvsplan; the reorganization is genuinely unbuilt and has an open design question.
- **Migration was already applied** (6/18) — corrected an earlier in-session mis-statement that it wasn't. The `(NOT yet applied)` commit message was stale.
- **Deposit-trigger label** ("Deposit due" on any sold-but-unbilled job) left as the old guess — **deferred to refinement** (Chris's call).

---

## 4. Verification

- **Build:** clean (`npm run build`, 97 modules).
- **Smoke (Chris, on `feat/billing-ship` preview):** two-tab screen opens; Worklist renders real data (`$109,988` to bill, Needs-Triage/Invoice-Sent/All-Ready-Billed groups, manual controls); 90-Day Forecast numbers sane (~$750K). Deposit tile confirmed rendering in the management section earlier in the session.
- **Production deploy confirmed live (hard proof):** a fresh local build of `main` produces `assets/index-Dzgc0B3P.js` — the **exact content hash** `www.schedulecommand.com` is serving. Live bundle contains the redesign strings ("Billing Worklist", "90-Day Forecast", "Needs Triage", "deposit trigger").
- **Not tested:** the manual-flag write round-trip (Hold/N-B/Terms → `billing_worklist`). Chris skipped it — those controls are being reworked in refinement. The table is independently verified live (buildvsplan, 6/18); worst case is a "couldn't save" toast on temporary buttons.

---

## 5. Branch hygiene

- **Deleted (merged):** `feat/deposit-indicator`, `feat/billing-ship`, `feat/sow-vertical`.
- **Remaining:** `main`; `feat/billing-forecast` (the parked redesign — but see §6, it is now **superseded by main**).

---

## 6. Not touched / parked (the refinement — "the other half")

The worklist **reorganization** is unbuilt and parked. Full plan: `docs/plans/billing_redesign_buildorder.md` (now on `main`), Phases 2–6:
- **BF-3** — lifecycle card-picker (the "heart"); has an **OPEN design decision**: `jobs.status` → lifecycle-bucket mapping.
- **BF-1/BF-2** — header + back button; time-period filters.
- **BF-7 + ADJ-6** — Past-Due AR aging bands; needs new `invoices.amount_paid`/`balance_due` columns (sales-command) for honest partial-*payment* math.
- **BF-5/BF-6** — clickable rows → Sales job; card/bubble restyle.
- **BF-9** — forward billing calendar.
- **Phase 6** — cleanup (ADJ-5, ADJ-2 realtime, ADJ-7 retire read-only `billing_log`), ADJ-4 trivial dead-branch.
- **Deposit-trigger label fix** — make "Deposit due" key off real `deposit_required`, not the sold+unbilled guess.
- **Hold/N-B/Terms rework** — manual controls move into a drill-in (BF-3).

---

## 7. Next session pointers

- **Resume the refinement from a FRESH branch off `main`**, NOT `feat/billing-forecast`. `main` now has strictly more (redesign + deposit + the merge); `feat/billing-forecast` is behind and lacks the deposit tile — continuing on it would re-create the divergence. The plan docs + handoffs are on `main`. `feat/billing-forecast` can be deleted whenever you're comfortable.
- **First refinement item:** BF-3 lifecycle card-picker — settle the `jobs.status` → lifecycle mapping design question with Chris before building.
- **ERD Loop #36** ("closes when the deposit flow is live"): the deposit indicator is live on prod. Consider `/erd-close` for #36; the worklist reorganization is its own future loop, not #36.

---

## 8. Files to know

- `src/lib/queries.js` — job + billing data layer (deposit derivation + billing loaders).
- `src/lib/billingForecast.js` — forecast/worklist engine (pure, I/O-free).
- `src/views/Billing.jsx`, `src/components/BillingWorklist.jsx`, `src/components/BillingForecast.jsx` — the two-tab screen.
- `src/components/StageJobCard.jsx` — job card incl. the DEPOSIT tile.
- `docs/plans/billing_redesign_buildorder.md` — the refinement plan (Phases 0–6).
- `docs/BACKLOG.md` — BF-1…9 + ADJ-1…7.

---

## 9. Git state

- `main` @ `ae2b171` — clean, pushed, **live on prod** (verified by content-hash).
- `feat/billing-forecast` @ `544322a` — parked, behind main, superseded (see §7).
- 0 uncommitted, 0 unpushed.
