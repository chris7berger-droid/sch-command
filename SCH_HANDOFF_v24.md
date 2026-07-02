# SCH_HANDOFF_v24 — Billing worklist refinement: plan reconciled + 3 audit rounds to GO (doc-only)

**Repo:** sch-command · **Branch:** `feat/billing-worklist-refinement` (pushed to origin, NOT merged to main)
**Date:** 2026-06-30
**Production:** https://www.schedulecommand.com (unchanged this session — no code shipped)
**ERD:** Loop #38 (billing-worklist-refinement) — **CLOSED** 2026-06-30, "came out like painted."

---

## 1. Session summary

A **planning-only** session — zero code, zero deploys. Picked up the parked billing-redesign refinement (v23 §6) and did two things: (1) **reconciled the plan doc to shipped reality** — Loops #36–#37 had already built most of Phase 0–1 with a *revised data model* the plan never captured — and (2) **locked the Phase 2 design** through a back-and-forth walkthrough with Chris, then ran it through **three adversarial audit rounds** (via a separate audit terminal) until it converged to GO. The headline design outcome: the billing worklist is reorganized by **billing state** (4-card picker: Ready to Bill / Partially Billed / Billed Complete / Pay Apps), rendered with a **purpose-built billing card** (not a StageJobCard fork), with the **90-Day Forecast relocated** off the billing screen to its own home card. Open design decision #2 (the `jobs.status`→bucket mapping that blocked Phase 2 in v23) is now resolved. The plan is GO for the Phase-2 build; no code was written — that's next session.

---

## 2. Changes shipped (7 commits on `feat/billing-worklist-refinement`, doc-only)

- `53d1c2c` — **Reconcile plan to shipped reality + lock Phase 2 card model.** Marked Phase 0–1 SHIPPED; corrected the data model to `call_log.deposit_*` + `deposit_invoice_id` pointer (not `proposals`); corrected deploy path to `command-suite-db`; dropped the dead `feat/billing-forecast` branch ref.
- `f979d9d` — **Sync backlog to the reconcile.** ADJ-3 → Done, ADJ-b → closed dup of ADJ-2, BF-4 → Done (deposit shipped), BF-3/BF-6 spec notes.
- `ab53266` — **Revise Phase 2 to billing-state card-picker + Pay Apps + forecast split-out.** The core design: 4 billing-state cards, Pay Apps as its own lane, forecast leaves the billing screen.
- `1eb47f7` — **Log SJC-1 / SJC-2.** The "day 129 of 5" banner quirk (display cap, deferred to Field Command) + stale-ACTIVE lifecycle gap.
- `632e053` — **Refresh audit manifest to Round 2** scope (truth-of-claims + Phase-2 design + data honesty).
- `a988ab6` — **Apply Round-2 audit findings (6: 3H/1MH/2M).** A1 contract table→`call_log`; B1 buckets keyed on derived fields + billed-but-unresolved home; C1 `requires_pay_app` sourced on the job row; D1 adopt Option B purpose-built card; E1 full state→card table; A2 `invoices.type` vestigial.
- `2f6d0ed` — **Apply Round-3 audit cleanup (6: 0H/5M/1L, converged).** Purged last StageJobCard-reuse refs; collapsed `invoices.type` to one apply-state; pinned the Pay Apps row field + flagged a name collision; rule #1 → `heldSales` + mapped `productionStage`; cards feed emitted `rows` not raw `jobs`.

---

## 3. Key decisions

- **Billing state is the parent on the billing screen, not production stage.** Chris's walkthrough surfaced that the shipped worklist grouped by billing state but badged by production events — the two axes fought. Resolution: home screen stays production-organized; the *Billing* screen (reached from the renamed "Billing" home card) organizes by **billing state**; production shows per-card via a banner. Both axes live, each at the right altitude.
- **Option B: purpose-built billing card, NOT a StageJobCard fork.** I'd pitched "reuse StageJobCard = far less code"; the Round-2 audit refuted it (StageJobCard drags crew/material/PRT/day-counter machinery + the SJC-1 bug). Chris ratified Option B — a billing-native card that *borrows the design language* without the coupling.
- **90-Day Forecast leaves the billing screen** → its own card in "Job Management Stages." Worklist = invoices *out*; forecast = cash *in* — different questions, shouldn't share a screen.
- **Pay Apps card is its own lane, sourced off the job row.** `requires_pay_app` jobs pull out of the 3 general cards (exclusive). Audit C1: the flag must come off `call_log→customers` (a `loadJobs` embed), NOT the invoice-derived local — else un-invoiced pay-app jobs miss the card.
- **`invoices.type` is vestigial.** The reconcile itself had carried it as canonical; the pointer model (`call_log.deposit_invoice_id`) superseded it. It's applied to prod but inert (no reader), backfill correctness unverified. Do not read it.
- **`pay_app_billing_day` is a real new dependency** (not yet built). The Pay Apps *card* ships off existing data; the *monthly due-date alert* is a fast-follow needing a new per-customer cutoff field.

---

## 4. Backlog changes this session

**Filed (new):**
- **SJC-1** (T3, deferred→Field) — ACTIVE banner "day X of Y" uncapped past end date; inherited by the billing card via BF-3 unless capped first.
- **SJC-2** (T3, deferred→Field) — jobs stuck in ACTIVE, status never advances to Complete; the root of the "129" number.

**Closed / changed:**
- **ADJ-3** → Done (tab param already routed).
- **ADJ-b** → Closed as duplicate of ADJ-2.
- **BF-4** → Done/shipped (deposit end-to-end, revised `call_log` model).
- **BF-3** → Open but **spec LOCKED** (billing-state picker); **BF-6** → narrowed to forecast-drill-down restyle only.

---

## 5. Verification

- **No code, no deploy, no smoke** — this was a planning session. Nothing to verify at runtime.
- **Plan verified three ways:** reconciled against live code/schema (deposit migrations in `command-suite-db`, `billingForecast.js`, `queries.js`), then **three adversarial audit rounds** in a separate audit terminal: R2 = 6 findings (3H/1MH/2M), R3 = 6 findings (0H/5M/1L). Severity collapsed 3H→0H — **converged to GO**.
- **Auditor's call:** GO for Phase-2 build, **no round-4** — verify at `/buildvsplan` against real code during the build.
- **Chris smoke-confirmed** (verbally, this session) that the shipped deposit indicator + sales-side deposit functions work end-to-end — that's what let Phase 0–1 be marked SHIPPED in the plan.

---

## 6. Not touched / parked

- **All of Phase 2–6 is unbuilt** — this session only refined the plan. BF-1/2/3/5/6/7/8/9 + ADJ-2/4/5/6/7/a remain open per the plan doc.
- **ADJ-4** (dead `termsOverride ||` at `billingForecast.js:171`) — confirmed still open; trivially the first commit of the Phase-2 build.
- **SJC-1 / SJC-2** — deferred to Field Command (the fix changes the elapsed math from `start_date` to first-clock-punch).
- **`pay_app_billing_day`** cutoff field — fast-follow, not built.

---

## 7. Next session pointers

- **Tomorrow = Phase-2 build.** Pull `feat/billing-worklist-refinement` (it's on origin), `/decide` → build mode with `docs/plans/billing_redesign_buildorder.md` as the verified plan.
- **First build steps, in order:** (1) ADJ-4 one-liner; (2) the `loadJobs` `call_log→customers(requires_pay_app)` embed (C1); (3) the purpose-built billing card + 4-card picker (BF-3, keyed on `fullyBilled`/`historyLabel`/`authoritativeResolved`); (4) SJC-1 banner cap before any billing card renders the ACTIVE stage.
- **Pre-flight:** re-read the "Phase 2 card-mapping decision" + the round-2/round-3 findings tables in the plan — they carry the exact field names + the `requiresPayApp` name-collision warning.
- **Run `/buildvsplan` after the build** (the auditor deferred round-4 to it) before merging to main.
- **ERD Loop #38 is already closed** — the point-at ("refined plan, ready to build") was met. The Phase-2 build is its own new loop.

---

## 8. Files to know

- `docs/plans/billing_redesign_buildorder.md` — **the plan** (reconciled + Phase-2 decision + round-2/3 audit tables + refreshed manifest). Start here next session.
- `docs/BACKLOG.md` — BF-*/ADJ-*/SJC-* (synced this session).
- `src/lib/billingForecast.js` — worklist/forecast engine; the derived fields (`fullyBilled:284`, `historyLabel:358`, the `requiresPayApp` local at `:287`) the cards key off.
- `src/lib/queries.js` — `loadJobs` (needs the `call_log→customers` embed, C1) + billing loaders.
- `src/components/StageJobCard.jsx` — the scheduling card the billing card *borrows from* but does NOT fork; `:137-139` is the SJC-1 day-X-of-Y quirk to cap.
- `~/command-suite-db/supabase/migrations/20260620120000_*`, `20260621120000_*` — the deposit migrations (pointer model canonical; `invoices.type` vestigial).

---

## 9. Git state

- **Current branch:** `feat/billing-worklist-refinement` — 7 commits (+ this handoff = 8), **pushed to origin**, NOT merged to main.
- `origin/main` @ `d7b45cf` — unchanged this session.
- Working tree: clean (0 uncommitted before this handoff commit).
- **Open branches:** this one. `feat/billing-forecast` was noted superseded in v23.

---

## END STATE

In progress — plan complete + audited to GO, branch `feat/billing-worklist-refinement` open and pushed, Phase-2 build is next session. No code shipped, nothing deployed, nothing to smoke.
