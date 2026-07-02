# SCH_HANDOFF_v25 — Phase-2 billing worklist redesign BUILT (Loop #39), iterated live on preview

**Repo:** sch-command · **Branch:** `feat/billing-worklist-refinement` (pushed to origin, NOT merged to main)
**Date:** 2026-07-02
**Production:** https://www.schedulecommand.com (unchanged this session — nothing merged/deployed to prod)
**ERD:** Loop #39 (Phase-2 billing worklist redesign) — build session, open (not yet closed).

---

## 1. Session summary

The **build** session for the Phase-2 billing redesign that v24 planned + audited to GO. Executed the four-step build order (ADJ-4, C1, SJC-1, BF-3), ran it through `/buildvsplan` (0/0, GO), `/code-review` (0 correctness bugs), and `/security-review` (no reportable findings; one RLS gap read + filed as SEC-1). Then pushed to a Vercel preview and iterated live against Chris's smoke feedback over ~8 more commits: fixed the identity-bubble truncation, made TOTAL TO BILL clickable, relocated the 90-Day Forecast to its own screen + home card (killing the two-tab shell), renamed the N/B control to **GB (Go Back)** as a visible + filterable marker, converted the forecast drill-ins to the full billing-card format with an invoice breakdown, fixed the GB toggle flicker (optimistic update), and finally repointed **both** billing/forecast card types to open the job in **Sales Command** (proposals + invoices live there), not Schedule's own job detail. 14 commits, all on the branch, nothing merged to main. The one thing explicitly left unsolved: the cross-app "radar" (Sales cold-boot) — established as a deployment-unification concern, not a card fix.

---

## 2. Changes shipped (14 commits on `feat/billing-worklist-refinement`)

- `e12b57e` — **Closes ADJ-4.** Dropped the dead `termsOverride ||` from `expectedPayDate` step-3 COALESCE (`billingForecast.js`); step 1 already returns when `termsOverride && sent`, so it was provably dead. Doc comment corrected.
- `f2e86eb` — **C1 (Touches BF-3).** `loadJobs` now embeds `customers:customer_id(requires_pay_app)` through `call_log`; row emits `requiresPayApp` off the job row (present even for un-invoiced pay-app jobs). Invoice-derived local renamed `requiresPayAppInvoice` (deriveStatus-only) to kill the B1 name collision.
- `7789ca0` — **SJC-1.** Capped the ACTIVE "day X of Y" banner at `totalDays` (`StageJobCard.jsx:139`) — display cap only; the real clock-punch fix stays deferred to Field Command.
- `183c956` — **BF-3 core.** `/billing` worklist → 4-card billing-state picker (`BillingPicker.jsx`) + purpose-built billing card (`BillingCard.jsx`, Option B, borrows sjc-* design, NOT a StageJobCard fork). `billingCardKey()`/`billingBadge()` in `billingForecast.js`; rows carry `productionStage` + `heldSales`. `BillingWorklist.jsx` removed.
- `64bbea3` — **BF-3 spec align.** Added the JOB identity bubble to the card (buildvsplan note 1).
- `38a772b` — **BF-3 cleanup + SEC-1.** `resolveStage()` warns in dev on unmapped `productionStage` (drift-proofing). Filed SEC-1 (billing_worklist role-gate gap).
- `5d28a3b` — Fixed identity-bubble truncation (two-row: JOB+CUSTOMER over the money trio) + made TOTAL TO BILL clickable → drill-in of still-owed jobs.
- `f2d4bc1` — **Forecast relocation (option A).** Killed the two-tab shell; `/billing` is worklist-only; new `/billing/forecast` route (`views/Forecast.jsx`) + home-screen "90-Day Forecast" card in JobsPicker.
- `f666907` — **BF-6/BF-7.** Forecast drill-ins → clickable cards; Held Retention stat made clickable → drills into jobs holding retention.
- `3e59eb6` — **Renamed N/B → GB (Go Back).** Visible purple GB chip on the card banner + a "Go Backs (N)" filter bar on the billing screen. Underlying flag stays `billing_worklist.nothing_to_bill` (UI relabel, no migration).
- `2a9af72` — Forecast drill-ins reuse the FULL billing card (looked up by call_log_id, deduped by job) with CONTRACT/BILLED/REMAINING; card header clicks to job detail; BILLING tab lists the invoice breakdown (#/amounts); "← All jobs" back button on the worklist.
- `4e47af3` — Fixed GB flicker (optimistic override patch, no full reload) + orphan forecast cards get a banner + resolve their job from the full jobs list.
- `2d3f13a` — Fixed forecast card stretch (`align-self: start`) so a short forecast card doesn't distort next to a tall full card in the grid row.
- `923a710` — **Both card types open the job in Sales** (`salescommand.app/calllog/<callLogId>`), keyed on the shared call_log; dropped the Schedule-job-detail routing. Proposals + invoices live in Sales.

---

## 3. Decisions / choices made

- **Forecast relocation = option A (own screen + home card), not a card-on-/billing.** Ratified by Chris. Worklist = money out, forecast = cash in — different questions, own screens (plan rule #2).
- **N/B → GB (Go Back).** Chris's workflow: "nothing to bill" cases are really go-backs (job comes up but was already built/billed). Relabeled to a meaningful, trackable marker; ties to the existing Go Backs re-scheduling need. Kept the DB column as `nothing_to_bill` (UI relabel only). Count = currently-flagged jobs, NOT lifetime history — a lifetime tally would need a go-backs log (noted, not built).
- **Forecast drill-ins reuse the full BillingCard, deduped by job.** Chris wanted the standardized format + job-level billing picture, not the plain per-invoice card. Trade-off logged: a job with 2 invoices in one bucket shows once; header reads "N jobs · N invoices."
- **GB toggle = optimistic update.** The flicker was a full `loadData()` with `loading=true` unmounting the picker. Now patches `surface.overrides` locally so `buildBillingSurface` re-derives in place; persists in background; reverts only on error.
- **Both billing/forecast cards open Sales, not Schedule's job detail.** Chris: from a billing card you're going to manage proposals/invoices, which live in Sales. Schedule's own JobDetail (the "SCHEDULE THIS JOB" screen) is the wrong destination here. Keyed on the shared `call_log_id`.
- **The cross-app "radar" is a deployment concern, not a card fix.** Schedule + Sales are separate deployments on separate domains, so opening Sales cold-boots it. The shared DB makes the data instant; it doesn't make the second app's boot instant. Real fix = the one-app / unified-deployment vision. NOT filed as a backlog item yet (Chris closed before deciding — see NEXT SESSION POINTERS).

---

## 4. New backlog items filed this session

- **SEC-1** (T2, repo `command-suite-db`) — `billing_worklist` writes are tenant-scoped but NOT role-gated; the Admin gate is client-only, so any same-tenant authenticated user can write billing overrides. Pre-existing (table created 2026-06-18). Fix = add `is_admin_or_manager()` to its INSERT/UPDATE/DELETE, matching `role_aware_money_rls`. Verified: cross-tenant isolation IS solid; `customers` embed (C1) adds no new exposure.

---

## 5. Closed this session

- **ADJ-4** → Closed (`e12b57e`) — dead `termsOverride` removed.
- **BF-3** → Core built (`183c956` + follow-ups), pending merge; backlog row updated to "Core built — pending /buildvsplan + smoke" then iterated further.
- **SJC-1** → Display cap shipped (`7789ca0`); real fix still deferred to Field Command.

---

## 6. Verification

- **Local checks:** `npm run build` passes; ESLint clean on every touched file across all 14 commits (the pre-existing `queries.js` unused-var 'today' + the App.jsx errors are NOT from this diff — verified on clean tree).
- **`/buildvsplan`:** 0 blockers / 0 bugs, GO (ran against the first 5 commits / original 4-step scope).
- **`/code-review`:** 0 correctness bugs; 3 minor cleanup notes (applied #2 drift-proofing, declined #1 money-util dedup + #3 uncontrolled notes input).
- **`/security-review`:** no reportable findings; XSS/injection clean; SEC-1 filed.
- **Live smoke (Chris, on preview):** iterated through the billing picker, GB, forecast relocation, forecast cards, and the card-click destination over several rounds. The billing screen + forecast render and function on the preview.
- **NOT verified:** the later commits (`f666907` onward — forecast cards, GB, optimistic toggle, Sales routing) have NOT been through a fresh `/buildvsplan` or `/code-review` — the diff grew materially past the audited 4-step scope. No production verification (nothing merged/deployed).

---

## 7. Not touched this session

- **SEC-1** — filed, not fixed (cross-repo, `command-suite-db`; deploy-gated).
- **The radar / one-app unification** — discussed, not filed, not built.
- **Remaining Phase-2/3 billing items** — BF-2 time filter, BF-8 done-pile scoping, "All" card, `pay_app_billing_day` due-date alert, the go-backs lifetime-history log. (BF-1 header/back partially done; BF-5 row→Sales effectively done via the card click; BF-6 forecast restyle done.)
- **Nothing merged to main; nothing deployed.**

---

## 8. Next session pointers

- **First action: re-audit the grown diff before merge.** The build grew well past the audited 4-step scope (forecast relocation, GB, forecast cards, optimistic toggle, Sales routing). Re-run `/buildvsplan` + `/code-review` against tip `923a710` (and `/security-review` — the card writes still touch `billing_worklist`) BEFORE merging to main.
- **Then decide the merge.** Branch is pushed, NOT merged. When ready: merge `feat/billing-worklist-refinement` → main.
- **Open question for Chris: file the one-app / no-radar unification.** He closed the session before deciding whether to file it as a backlog item. It's the real fix for "instant movement between drivers."
- **SEC-1 before prod.** Land the `billing_worklist` role-gate migration in `command-suite-db` before a paying customer's non-Admin staff use the billing screen.
- **Preview URL (stable branch alias — always latest):** `https://sch-command-git-feat-billin-ae0495-chris7berger-droids-projects.vercel.app` — NOT the per-commit `sch-command-<hash>-…` URLs (those are frozen to one build).

---

## 9. Files to probably know about next session

- `src/components/BillingPicker.jsx` (new) — 4-card billing-state picker + TOTAL TO BILL + Go Backs filter + drill-ins.
- `src/components/BillingCard.jsx` (new) — purpose-built billing card; header opens Sales; BILLING tab has GB/Hold/terms/notes + invoice breakdown.
- `src/components/ForecastCard.jsx` (new) — light fallback card for forecast invoices with no worklist row; opens Sales.
- `src/views/Forecast.jsx` (new) — standalone 90-Day Forecast screen (`/billing/forecast`).
- `src/views/Billing.jsx` — worklist-only now (two-tab shell removed); `onFlag` is optimistic.
- `src/components/BillingForecast.jsx` — forecast drill-ins reuse BillingCard (by call_log_id) + clickable Held Retention.
- `src/lib/billingForecast.js` — `billingCardKey`/`billingBadge`, row fields (`requiresPayApp`/`productionStage`/`heldSales`/`invoiceBreakdown`), retention invoices enriched with `_net`.
- `src/lib/queries.js` — `loadJobs` `call_log→customers(requires_pay_app)` embed (C1).
- `src/components/JobsPicker.jsx` — new "90-Day Forecast" home card; `goBilling` drops `?tab=worklist`.
- `docs/BACKLOG.md` — ADJ-4 closed, SJC-1 display-cap noted, BF-3 core-built, SEC-1 filed.

---

## 10. Git state on close

- **Current branch:** `feat/billing-worklist-refinement` — 14 session commits (+ this handoff = 15), **all pushed to origin**, NOT merged to main.
- `origin/main` @ `d7b45cf` — unchanged this session.
- Working tree: clean before this handoff commit.
- **Open branches:** this one. No other active local branches expected.

---

## END STATE

In progress — Phase-2 billing redesign fully BUILT + iterated on preview, branch `feat/billing-worklist-refinement` open and pushed (tip `923a710`), NOT merged. Re-audit the grown diff, then merge. Nothing deployed to prod; ERD Loop #39 stays open until merge + smoke.
