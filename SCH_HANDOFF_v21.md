# SCH_HANDOFF_v21 — BUILD terminal · Billing Triage + 90-Day Cash-Flow Forecast

**Repo:** sch-command (cross-app: reads sales-command-owned `invoices`/`proposals`/`billing_schedule`/`customers`/`tenant_config`) · branch `feat/billing-forecast`
**Author:** Terminal #3 of 4 — build (T3)
**Date:** 2026-06-18
**Plan:** `docs/plans/billing_forecast_integration.md` (build-ready at lock, HEAD `664a2f3`) · **Built to:** `5141ed0`
**Pipeline:** #1 plan (v18) → #2 audit (v19) → **#3 build (this doc)** → #4 buildvsplan (v20)

This is the **builder's seat**. v18 has the framing, v19 the convergence, v20 the gate. Mine is the view you only get with your hands in the code: where the plan's words and the live database disagreed, what I verified before trusting, the calls I made turning prose into running software, and — the part that ended up mattering most — what a clickable screen surfaced that no plan could.

---

## 1. What this terminal was (and the posture that shaped it)

Implement the build-ready plan, make every step **reviewable for T4**, and live by the loop's own central lesson, inherited from the audit: **the plan's wording is a pointer, not gospel — verify against source** ([[feedback_revise_against_code_not_prose]]). I treated every load-bearing claim (a column, a function, a count, a retention convention) as a hypothesis to confirm against the live DB or live code before a line depended on it. That posture is the reason T4 found only 3 low bugs in ~1,200 lines.

---

## 2. The build-start corrections only the builder hit

These never appear in a plan because they only surface when you sit down to start:

- **Repo correction (the first landmine).** The kickoff said *"origin feat/billing-forecast is at 664a2f3"* with **no repo named**. The branch, plan, and ADJ-1..6 backlog do **not** exist in sales-command — where "billing/invoices/retention" instinctively points. They were in **sch-command**. I nearly set up in the wrong repo. Caught it by fetching + confirming the commit/branch/plan actually resolved. → reinforces [[feedback_handoff_name_repo]]: handoffs across sibling Command Suite repos must name the repo; branch+path aren't repo-unique.
- **ADJ-1 retention, live-verified (the one load-bearing premise).** The forecast nets on `retention_amount`; ADJ-1 warned a legacy `retainage_*` set coexists. Service-role count over 70 live invoices: 10 carry `retention_amount>0`, only 2 also carry legacy `retainage_amount>0` — and **both of those also have a populated, canonical-correct `retention_amount`** (10024: legacy 2154.53 is stale, retention 3211.25 = correct 5%×amount). **Zero invoices** would net gross. Premise confirmed safe before building Tab B. (Other premises checked same way: 7/70 invoices have NULL `due_date` → §4.2 fallback IS load-bearing; 0/2077 customers have NULL `billing_terms` → terms source is solid.)
- **The three §8 design-opens, resolved with Chris at build start (§8.1c).** T1 left these for `/erd-start`; I closed them in the build session: completion signal → **hybrid trigger** (deposit arm: sold + nothing billed; production arm: partial + production-this-week); portal nuance → **auto-derived from pay-app submission** (no new field); Hold–Sales → **role-gated** (Admin). Recorded as a plan amendment, not silently built.

---

## 3. The signature move: validate the math on LIVE data before any UI

The plan's "prize" is the forecast; the worklist is the bug-dense half. So before a single pixel, I built the logic as a **pure, I/O-free lib** (`src/lib/billingForecast.js`) and ran it against **real HDSP data** via a throwaway harness:
- 13 worklist rows (8 fully-billed, 1 sent, 4 needs-triage), forecast grand **$750,931** (past-due $370,273 + 90-day $380,658) — sane, tied-out numbers on real invoices.
- **This is where the build improved the plan.** Running it surfaced that §8.1c's deposit arm (`billed < authoritative`) mislabeled a *partial* draw (Tarn Way) as a "deposit." Tightened it to `billed <= 0` (true first-bill) — a correctness fix the plan's prose couldn't show but live data made obvious. Plan §8.1c amended with the sharpening.

The lesson under this: **logic verified against live data before UI hardens is cheap; the same bug found after the UI is built is expensive.** (Foreshadows §7 below — the part that *didn't* get this treatment.)

---

## 4. Build sequence + the calls that mattered (plan §7)

1. **`src/lib/weeks.js`** — lifted the canonical `getMonday`/`fmtWk` (verified the 3-way-identical exports.js/Schedule/Daily copy is canonical, Billing.jsx is a variant) so the new surface never imports from the doomed `Billing.jsx`. Off-surface copies left for a future sweep (out of v1).
2. **Migration `20260618120000_billing_worklist_create.sql`** — timestamp pinned collision-free at build start (`check-migration-collision.mjs` against the live ledger, per the shared-ledger reality). RLS via the `jobs→call_log.tenant_id` chain (job_wtcs pattern); `terms_override` CHECK; **references existing `tg_set_updated_at()` — no `CREATE OR REPLACE` of the sales-owned `set_updated_at()`** (the N4 clobber trap). **Applied live with Chris's go-ahead** via `supabase db query --linked --file` (db push is blocked by the shared ledger; db query bypasses it), verified all 9 columns + RLS + trigger + constraint on prod, then `migration repair --status applied`.
3. **Data layer (`queries.js`)** — `loadInvoicesForForecast` via the pinned `loadAllRows(table, select, {orderBy, filterFn})` (C3 pagination, embedded PostgREST joins verified to return correctly nested data on real rows); `loadBillingSurfaceData` (parallel paginated reads); `setBillingWorklistFlag` (upsert + `job_changes` audit, the D3 anti-pattern fix).
4. **Two-tab surface** — `Billing.jsx` rebuilt as a thin shell; `BillingWorklist.jsx` + `BillingForecast.jsx` components (repo convention: pages are shells, logic in lib/components). `loadIdRef` race guard on the flag-reload path.
5. **Card rewire + billing_log retirement** — see §5.

---

## 5. The landmine I'm handing forward: the billing_log census was understated

Plan §5.2a enumerated **9** `billing_log` sites. Reality: the placeholder percent model was woven through **far more** — `StageJobCard` (a banner "unbilled" warning + an interactive "BILLED %" management tile), `Jobs.jsx` `urgencyScore` (a sort nudge), and `Staged/OnHoldCardList` prop-forwarding — none in the 9-site list. Chris confirmed in the walkthrough that the **entire old billing model was unused placeholder, never structured properly**, which de-risked a full clean removal: stopped **all** writes, rewired the `/jobs` landing count to the cheap `billing_worklist` signal (D2, no invoice join on the landing), deep-linked tiles to `/billing?tab=worklist` (ADJ-3). **Deferred per §7** (billing_log kept READ-ONLY, reversible): only the JobDetail read-only history remains (ADJ-7). **Takeaway for future census work:** grep the prop-drill chain, not just direct `from('table')` call-sites — a value threaded through 5 components hides from a naive count.

T4 then caught **3 real Tier-2 misses** (all fixed at `5141ed0`): **N9 $0-net suppression** (a genuine [LOCKED] spec gap in my logic — fixed), the percent **Billing Report export** (retired — it printed frozen placeholder), and the **`billed_to_date` percent input** in Schedule (N10 — removed).

---

## 6. The part that ended up mattering most: the walkthrough holes were a different species

After T4's GO, Chris walked the live preview with me. It surfaced a **9-item refinement punch-list** (captured as tasks) + a lifecycle status-model design Delta. **The honest framing — and the build terminal's central lesson:** these were **not** code-vs-plan holes. They were **plan-vs-DESIRE** holes — card-picker layout, a real deposit feature (Sales checkbox + amount → deposit invoice), time-scoping the "done" sections to the week, AR aging on past-due, clickable rows → Sales Command. **None were in the plan**, so no amount of verifying-code-against-plan would have found them. Chris's own words: *"it can really only be realized for me and experienced if I see it visually."* The lever for this class isn't read-code-first (that catches *correctness* holes, which §3 + T4 largely did) — it's **a clickable thing in front of him sooner, mid-build, while the design is still wet.** (See loop #35 close: this is the full do-different arc; Chris's landing was "no getting stronger without the pain" — the walkthrough *was* the discovery, not a detour.)

Two real-data corrections also came out of the walkthrough and are recorded for whoever builds the punch-list: **deposits have no backing data** anywhere (confirmed zero deposit columns — current "Deposit due" is an unbacked guess; needs the Sales checkbox+amount feature, task #4); and **partial *payment*** of an invoice is a real gap for non-GC customers (Steve's Collision proves partial *billing* is tracked — $5,884 = 50% of $11,768 — but a customer paying part of a sent invoice isn't, ADJ-6). Don't conflate partial billing (tracked) with partial payment (not).

---

## 7. What I deliberately did NOT do

- **Did not run `/buildvsplan`** — that's T4's instrument, not the builder's ([[feedback_four_terminal_roles]]). I made the branch reviewable and handed off.
- **Did not fold the 9-item punch-list into v1** — it's a next-pass's worth of work (the #3 card-picker / #8 time-scoping are a real redesign). Kept v1 scoped to the point-at.
- **Did not delete `billing_log`** — kept READ-ONLY per §7 (reversible until the new surface is proven).
- **Did not touch prod beyond the additive `billing_worklist` table** (with Chris's explicit go), and **nothing merged to main**.

---

## 8. Honest boundary + state at close

**Boundary:** v1 **hit the point-at** — jobs self-populate with correct triggers/statuses on real Sold proposals, feeding a working cash forecast — but it is, in Chris's words, **"half the picture."** The other half is the punch-list + the Field Command "Job Complete" trigger that would automate the production-complete signal (cross-repo, not built). The forecast is real and load-bearing; the worklist is real but its *organization* (cards, lifecycle, time-scoping) is the next design pass.

**State:**
- Branch `feat/billing-forecast` @ `5141ed0` — **8 commits, +1,215/−928 across 19 files** + the migration. Not merged.
- `billing_worklist` table **live on prod** (additive, RLS, ledger-reconciled). No other prod changes.
- T4 buildvsplan: **SMOKE GO**, 0 blockers; its 3 Tier-2 findings fixed.
- Preview validated by Chris on the Vercel branch deploy.
- **9-item refinement punch-list filed durably in `docs/BACKLOG.md` as BF-1..9** (full specs in the Notes column): BF-1 header/back · BF-2 time-filters · BF-3 card-picker = lifecycle categories (absorbs the lifecycle Delta + "Job not started" flag + clean-rows/controls-in-drill-in + section renames) · BF-4 deposit feature (cross-repo) · BF-5 clickable→Sales · BF-6 bubble restyle + clickable forecast · BF-7 Past-Due AR aging + caveat reword · BF-8 per-section time-scoping + scheduled-only population · BF-9 forward billing-calendar.
- Backlog: ADJ-1 verified forecast-safe; ADJ-3/N9/N10 closed in-build; ADJ-6 re-scoped (partial *payment*, non-GC); ADJ-7 narrowed (only JobDetail history read deferred).
- **Loop #35 closed** (`~/erd-loop/LOG.md`): big build · came out drifted (happy) · weight lighter.

**Next terminal's first move:** this is a **design pass**, not a build — the punch-list is plan-vs-desire, and #3/#8 are the heart. Build requires a verified plan; there isn't one for the redesign yet.
