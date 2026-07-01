# Billing Redesign & Deposit — Phase 2 Build Order

**Status:** PLAN — Phase 0–1 SHIPPED (see Progress below); Phases 2–6 remain, order LOCKED
**Repo:** sch-command (cross-repo: `command-suite-db` for migrations, sales-command for deposit UI)
**Branch:** `main` (feat/billing-forecast merged + deleted)
**Date:** 2026-06-19 · **reconciled to shipped reality 2026-06-30 (Loop #38)**
**ERD:** authored Loop #36; reconciled Loop #38 (billing-worklist-refinement)
**Companion:** `billing_forecast_integration.md` (the forecast itself, already shipped). This doc orders the *remaining* billing backlog: BF-1…9 + ADJ-1…7.

Confidence tags: **[LOCKED]** confirmed in code · **[DERIVED]** inferred from code, not yet built · **[DESIGN-OPEN]** needs a call · **[BLOCKED]** needs external work · **[SHIPPED]** built + in prod, verified.

---

## Progress reconcile — what shipped since 6/19 (added Loop #38, 2026-06-30)

Loops #36–#37 built most of **Phase 0–1** after this doc was written, and did it with a **revised data model** the original prose didn't capture. Corrected here so Phases 2–6 build on reality.

**SHIPPED + smoke-verified (Chris confirmed sales-side end-to-end 2026-06-30):**
- **§1a schema** — deposit fields + `invoices.type` live. **Revised location: on `call_log`, NOT `proposals`** (the "one-field model", migrations `20260620120000_deposit_fields_and_invoice_type` + `20260621120000_deposit_one_field`, in **`command-suite-db`**). Columns: `call_log.deposit_required`, `call_log.deposit_amount`, `call_log.deposit_invoice_id`, `invoices.type ('regular'|'deposit'|'pay-app')`.
- **§1b** — Materials Deposit callout on `ProposalDetail.jsx:1140` (green-accented card).
- **§1c** — deposit invoice + "MATERIALS DEPOSIT INVOICE" badge (`invoicePdf.js:160`, `Invoices.jsx:834`, `PublicInvoicePage.jsx:177`) + "Mark as the job's deposit invoice" (`Invoices.jsx:2058`).
- **§1d** — Schedule surfaces it: Parked gate (`billingForecast.js:275`), deposit reads (`queries.js:84-86,116-118`), `deposit_invoice_id`-based derivation (`billingForecast.js:129-157`), indicators on `StageJobCard.jsx:283` + `BillingWorklist.jsx:77`.
- **Linkage — revised:** job → deposit invoice via explicit **`call_log.deposit_invoice_id`** pointer (Open decision #4 resolved), NOT by reading the invoice's `call_log_id` as the old §1d prose said.

**STILL OPEN after the reconcile:**
- **ADJ-4** — dead `terms_override` branch STILL present (`billingForecast.js:171`). One-liner, not yet done.
- **Open decision #2** — `jobs.status` → lifecycle-card mapping (BF-3). The one real design decision left; gates Phase 2.
- **ADJ-a** — `loadJobs()` unpaginated (`queries.js`) — was in no phase; slotted into Phase 6 below.
- **ADJ-b** — duplicate of ADJ-2 (billing load one-shot / no realtime); closed as dup below.
- **Phases 2–6** — BF-1/2/3/5/6/7/8/9 + ADJ-2/5/6/7 — untouched, ready to build once #2 is decided.

---

## Goal (from the loop's picture)

Manage margin better than any other software, because the data was structured right from the sale. A deposit on a job auto-surfaces for billing the moment the job is scheduled — three or four clicks to ship the invoice. Field-complete (later) kicks a job to the billing list with costs and over/under visible. Real-time visibility throughout. **Phase 2 = knock down the billing backlog in a durable order, starting with the deposit, so it's usable for the first paying customer ~7 days out.**

---

## Method note — this plan is code-grounded

Order and per-phase scope were verified by **reading the actual code on 2026-06-19**, not the backlog prose. Several prose claims were stale; corrections below. Build off this doc, not the raw backlog notes.

### Prose corrections (verified in code)

- **ADJ-3 is already done.** [LOCKED] `Jobs.jsx:14-20` (TAB_REDIRECTS) and `JobsPicker.jsx:72` (`goBilling`) already route to `/billing?tab=worklist`. → verify + close, no build.
- **The worklist is no longer a "3-column RTB pipeline."** [LOCKED] The forecast build already reshaped it into a status-grouped list under a Worklist/Forecast two-tab shell (`BillingWorklist.jsx:10-17`, `Billing.jsx:81-89`). BF-3 reshapes *this*, not a pipeline.
- **BF-8's gate is a contained change, not a spine rebuild.** [LOCKED] Population logic already lives in `billingForecast.js:268-293`; it just doesn't gate on schedule dates yet.
- **ADJ-4 redundancy is real.** [LOCKED] `expectedPayDate()` includes `terms_override` in the step-3 fallback COALESCE (`billingForecast.js:166-174`) — dead branch.
- **No deposit data exists anywhere.** [LOCKED] `proposals` and `invoices` schemas have no deposit field.
- **Retention is a directly reusable template; invoice "type" is currently implicit.** [LOCKED] Archive invoice = `invoice_lines` with null `proposal_wtc_id`; pay-app = lines with `billing_schedule_line_id`. No explicit type column today.

---

## §0 Reproduction — current state (pre-build, observed 2026-06-19)

This is a feature build, not a bug fix, so "reproduction" = the **observed pre-build state** the Phase-1 deposit work changes. Each item is third-party reproducible; values confirmed in code/migrations on 2026-06-19.

**Schema (sales-command, shared Supabase `pbgvgjjuhnpsumnowuym`):**
- `grep -rniE "deposit" supabase/migrations | grep -iE "proposal|invoice"` → **0 rows.** No `proposals.deposit_required` / `proposals.deposit_amount`; no `invoices` deposit field. A deposit cannot be flagged on a proposal today.
- `grep -rniE "add column.*type" supabase/migrations | grep -i invoice` → **0 rows.** No `invoices.type` column. Invoice "kind" is **implicit, enforced per-line in app code**: archive = `invoice_lines` with null `proposal_wtc_id`; pay-app = `billing_schedule_line_id` non-null (`20260416175646_billing_schedule_and_archive_links.sql:140-149`, "a line must reference exactly one of"). → A deposit line built by reusing the archive path (null `proposal_wtc_id`) is **byte-identical to an archive line** — nothing distinguishes a deposit invoice without an explicit marker.

**UI / behavior (observed):**
- Sales `ProposalDetail` summary (`ProposalDetail.jsx:1096-1246`) has **no deposit control** — no checkbox, no amount.
- Sales `NewInvoiceModal` (`Invoices.jsx:39-562`) has **no deposit-invoice path**; created invoices carry no "materials deposit" label on preview or PDF.
- Schedule billing worklist's "Deposit due" is an **unbacked guess** (no backing data anywhere — SCH_HANDOFF_v21); `buildBillingSurface()` (`billingForecast.js:268-293`) does **not** gate on schedule dates, so a job surfaces before it's scheduled.

**Net pre-build state:** a deposit cannot be (a) flagged on a proposal, (b) billed as a distinguishable/labeled invoice, or (c) truthfully surfaced by Schedule. Phase 1 builds exactly that chain; the POINT-AT (ERD Loop #36) is the proof: test job → scheduled → deposit on billing list → click-through → "materials deposit invoice" ships.

---

## Build order (durable: data model → spine → features → cleanup)

| Phase | What | Why here |
|---|---|---|
| **0** | ADJ-3 (verify+close), ADJ-4 (drop dead branch) | Trivial; clears confusion before building. |
| **1 — Deposit foundation + proof** | Sales deposit data + invoice + label; Schedule schedule-date gate | Durable source-of-truth data model AND it delivers the loop's POINT-AT. No throwaway. |
| **2 — Worklist reshape (spine)** | BF-3 **4-card billing-state picker** (Ready to Bill / Partially / Complete / **Pay Apps**) + `StageJobCard` rows + BF-8 done-pile scoping + BF-1 header + BF-2 filter + **forecast relocation** (own home card) | Biggest design item; see "Phase 2 card-mapping decision". Pay Apps card ships off existing data; its monthly due-date alert is a fast-follow (needs new `pay_app_billing_day` field). |
| **3 — Nav + polish** | BF-5 clickable rows→Sales, BF-6 card restyle + forecast rows | Overlays on the spine. |
| **4 — Past-due truth** | ADJ-6 `amount_paid/balance_due` → BF-7 AR aging bands | Aging is only honest once net exists. |
| **5 — Forward calendar** | BF-9 forward/back billing calendar | Builds on BF-2/BF-8. |
| **6 — Cutover cleanup** | ADJ-5, ADJ-2 realtime (= **ADJ-b**, dup), ADJ-7 retire `billing_log`, **ADJ-a** paginate `loadJobs()`, close ADJ-1 | Reversible, post-proof. |

The deposit (Phase 1) comes *before* the card redesign (Phase 2) because the code shows its durable foundation — deposit source-of-truth fields, `invoices.type`, and the schedule-date gate — doesn't depend on the redesign, and it delivers the proof. Spine-first and proof-first coincide.

---

## Phase 0 — corrections

- **ADJ-3** — confirm `/billing?tab=worklist` everywhere, close the item. [SHIPPED]
- **ADJ-4** — remove the dead `termsOverride ||` from step-3 of `expectedPayDate()` (`billingForecast.js:171`); keep it only as step 1 (line 168 already returns early when it's truthy, so the step-3 occurrence is unreachable). [DERIVED — STILL OPEN as of 2026-06-30; one-liner]

---

## Phase 1 — Deposit foundation + proof (the POINT-AT) — ✅ SHIPPED (Loops #36–#37, smoke-verified 2026-06-30)

> **RECONCILE NOTE (Loop #38):** This whole phase is built + in prod. Two things landed **differently** from the prose below, keep them straight for Phases 2–6:
> 1. **Deposit fields live on `call_log`, not `proposals`** (one-field model). Read `call_log.deposit_required / deposit_amount / deposit_invoice_id`.
> 2. **Migrations live in `command-suite-db`**, not sales-command (6/29 consolidation). The §1a "author from sales-command" instructions below are HISTORICAL — do not follow them for new migrations.
>
> The original §1a–§1d detail is kept below as the build record; treat it as [SHIPPED], superseded on the two points above.

Cross-repo. **Most of the build is sales-command.** Schedule just surfaces and links.

**Proof path:** test job → put on schedule (has dates) → deposit shows on billing list → click row → Sales proposal opens (new tab) → "create invoice" → invoice denotes **materials deposit** → flow works. *(Field-complete half is out of scope — Field Command work.)*

### 1a — Schema (sales-command owns `proposals` + `invoices`)
- `proposals.deposit_required boolean default false` [DERIVED]
- `proposals.deposit_amount numeric default 0` [DERIVED]
- `invoices.type text` column, check `'regular' | 'deposit' | 'pay-app'`, **NOT NULL**. [LOCKED 2026-06-19 — `type` column over boolean.]
- **Backfill rule [REVISED round-1, RATIFIED 2026-06-19] — mirror the existing per-invoice classifier, not a line-level shortcut.** The app already classifies an invoice by examining **all** its lines (`Invoices.jsx:1224`): `isArchiveInvoice = lines.length > 0 && lines.every(l => !l.proposal_wtc_id && !l.billing_schedule_line_id)`. The round-1 audit (5H) caught that the prior "null `proposal_wtc_id` = archive" *line-level* rule mislabels mixed/pay-app invoices on live data. Correct backfill: any invoice with **any** line carrying `billing_schedule_line_id` → `'pay-app'`; everything else → `'regular'`. No `'deposit'` exists in history (the new create path is the only writer of `'deposit'`).
- **Pinned DDL order, one transaction (`BEGIN/COMMIT`):**
  1. `ADD COLUMN type text DEFAULT 'regular'` (every existing row → `'regular'`; column non-null via default).
  2. `UPDATE invoices SET type='pay-app' WHERE type='regular' AND id IN (SELECT invoice_id FROM invoice_lines WHERE billing_schedule_line_id IS NOT NULL)` — idempotent (re-run skips already-classified pay-apps; never touches `'deposit'`).
  3. `ADD CONSTRAINT invoices_type_check CHECK (type IN ('regular','deposit','pay-app'))` — added **after** backfill so no existing row violates it.
  4. `ALTER COLUMN type SET NOT NULL` (default already guarantees it; explicit for the contract).
- **Post-backfill verify (run + record before declaring done):** `SELECT type, count(*) FROM invoices GROUP BY type;` and cross-check pay-app count against `SELECT count(DISTINCT invoice_id) FROM invoice_lines WHERE billing_schedule_line_id IS NOT NULL;` — the two pay-app numbers must match.
- **Authoring + deploy [CORRECTED]:** migration lives in **sales-command** (owns `proposals` + `invoices`). **Author and push from the sales-command repo via its `npm run db:push` path + `node scripts/check-migration-collision.mjs`** (and `scripts/check-migration-safety.sh`). Do **NOT** run from sch-command — `db push` is blocked here (cross-repo ledger; see CLAUDE.md). Timestamp must be collision-checked against the prod ledger first.
- **HOLD FOR ROUND-2:** this §1a (backfill only) goes back to T2 for a quick round-2 re-audit **before** it runs against prod — it mutates live invoice rows. §1c/§1d code can build and ride to T4; the §1a *execution* waits.

### 1b — Sales UI: deposit control on ProposalDetail summary
- Add **deposit checkbox + amount** to the `ProposalDetail` summary panel (`ProposalDetail.jsx:1096-1246`). Saves to `proposals`. [DERIVED]
- **Visibility is a hard requirement (Chris):** a distinct bordered callout card with the Command Green accent — not a faint inline checkbox, not tucked among the top menu buttons. When deposit is required, the amount reads boldly at a glance. Must not get lost in the muted linen UI. [LOCKED requirement]

### 1c — Sales invoice flow: create + label the deposit invoice
- In `NewInvoiceModal` (`Invoices.jsx:39-562`): when the selected proposal has `deposit_required` + `deposit_amount > 0`, offer "create deposit invoice." [DERIVED]
- Create it by **reusing the archive-invoice path** (`handleCreate`, `Invoices.jsx:213-300`): one `invoice_lines` row with null `proposal_wtc_id`, `amount = proposal.deposit_amount` shown as a **suggested, editable** figure (BF-4). [DERIVED]
- **`type` must be set explicitly in EVERY `handleCreate` branch [REVISED round-1].** The audit confirmed nothing in `handleCreate` writes `type` today — it is unbuilt, not "reused." Every create path must set it: deposit branch → `'deposit'`; pay-app branch → `'pay-app'`; archive/proposal branch → `'regular'`. A deposit line is byte-identical to an archive line, so the **only** thing distinguishing them is `type` — if the deposit branch forgets to set it, the deposit is indistinguishable from an archive invoice (DEFAULT `'regular'` would silently mislabel it). [LOCKED]
- **Deposit label = NEW badge, gated on `type==='deposit'` [REVISED round-1].** No "MATERIALS DEPOSIT INVOICE" badge exists today — it is new code, not an existing pattern to mirror. Add the badge to the preview (`Invoices.jsx:565-939`) **and** `invoicePdf.js`, each rendered only when `invoice.type==='deposit'`, near the invoice # / status. [LOCKED]
- **Deposit amount validation [REVISED round-1]:** reject `deposit_amount <= 0`; warn (not block) when `deposit_amount > proposal.total`. The figure is suggested-editable, so validate at create time.
- **Full-amount → Fully Billed decision [REVISED round-1]:** if an editable deposit equals the full authoritative total, the job is **Fully Billed**, not Partially. The worklist already resolves this via `billed >= authoritative` (`billingForecast.js:278`) — no special-casing needed in Schedule; just ensure the deposit invoice's `amount` flows into `billedTotal`. [DERIVED]
- Once sent, the deposit keeps its unique invoice ID; the job's worklist label follows from `billedTotal` (see §1d — driven by `billed`, not `type`). [DERIVED]

### 1d — Schedule: surface the deposit, gated on scheduled
- **Gate on raw `job.status !== 'Parked'` [REVISED round-1].** The original date-proxy gate (exclude jobs with no `scheduled_end`/`end_date`/`partial_bill_date`) is wrong: the audit showed it **defeats itself** — many scheduled jobs have null date fields, so a date proxy would hide jobs that ARE scheduled. The correct signal is the lifecycle status: a job leaves `'Parked'` the moment Schedule confirms it (the Send-to-Schedule → Confirm flow). Gate `buildBillingSurface()` (`billingForecast.js:247`) on the **raw** `job.status` string `!== 'Parked'` — NOT `getJobStatus()` (a derived/billing status, wrong axis), NOT a date proxy. [LOCKED]
- **Add the missing SELECT columns [REVISED round-1] — they are not loaded today:**
  - `INVOICE_SEL` (`queries.js:606`) must add `type` (currently absent — the worklist can't read it without this).
  - the proposals select (`queries.js:618`, currently `'id, call_log_id, status, total, is_archive_proposal'`) must add `deposit_required, deposit_amount`.
  - **Both depend on §1a's migration being live** (the columns don't exist until then) — so this part lands after §1a clears round-2 + prod.
- **DELETE the "reads `invoices.type='deposit'` to flip Partially Billed" claim [REVISED round-1].** It's false. The worklist label/status already flips off `billedTotal` — `billed < authoritative` → "Partially billed", `billed >= authoritative` → "Fully billed" (`billingForecast.js:278,348-351`). Schedule does **not** read `type` to drive status; the deposit invoice's `amount` flowing into `billedTotal` is what moves the job. `type` is read only for the *deposit label/UX*, not the status transition.
- Worklist shows the deposit as a **suggested amount** for non-Parked jobs with `deposit_required`. [DERIVED]
- Row click → Sales proposal in a new tab (this is BF-5, pulled forward minimally for the proof). [DERIVED]

### Phase 1 decisions / risks
- **`invoices.type` column vs one-off boolean** — [LOCKED 2026-06-19] `type` column: it unifies the currently-implicit archive/pay-app detection and makes future types easy. One-time backfill from line FKs.
- **How Schedule knows the job is "scheduled"** — [REVISED round-1] use the raw lifecycle status `job.status !== 'Parked'`, NOT the date fields (date proxy defeats itself — scheduled jobs often have null dates). See §1d. [LOCKED]
- **Deposit invoice ↔ job linkage** — invoice already carries `call_log_id` (`Invoices.jsx:256-257`). Confirm copy-vs-reference: Schedule **references** (reads), never copies. [DESIGN-OPEN]
- **Can Sales create a deposit invoice before the job is scheduled?** — [LOCKED 2026-06-19] **Gate only the Schedule worklist surfacing; Sales create-invoice stays independent.** Deposits get collected at signing (before scheduling), so Sales must be able to invoice anytime; Schedule's BF-8 date gate handles "don't surface/nag until scheduled." Avoids coupling Sales' invoice action to Schedule's scheduling state.

---

## Phase 2 card-mapping decision (Loop #38, 2026-06-30) — [LOCKED — Chris-ratified]

Resolves Open decision #2. The old shipped worklist (screenshot: NEEDS TRIAGE / INVOICE SENT / ALL READY BILLED, thin rows with inline buttons) gets **replaced**. Design settled through a walkthrough of the two live pickers (Jobs "Job Crew & Schedule Stages" + the current Billing Worklist).

### The model — two levels, each organized by the axis that fits it
- **Home screen** (the Jobs picker, "Job Crew & Schedule Stages") stays organized by **production stage** (STAGED/READY/ACTIVE/ON HOLD/…). Production is the parent *there*. This is the scheduling home; everything drives from it.
- **Billing is one card on the home screen** — rename the existing **"Ready to Bill" card → "Billing."** Clicking it opens →
- **The Billing screen**, organized by **billing state** (NOT production stage — billing wears billing clothes). A card-picker of **four cards** (mirrors the home-screen card-picker style):

| Card | Who's in it | Notes |
|---|---|---|
| **Ready to Bill** | regular-invoice jobs, `billed <= 0` | includes deposit-due (shows a `DEPOSIT` badge on the card) |
| **Partially Billed** | regular-invoice jobs, `0 < billed < authoritative` | |
| **Billed Complete** | regular-invoice jobs, `billed >= authoritative` | date-scoped done pile (BF-8) |
| **Pay Apps** | **all** `requires_pay_app` jobs, regardless of billing state | own lane — different clock (monthly GC cutoffs); see below |

- Open any card → the **rich `StageJobCard`s**. Each card's **banner still shows production status** (ACTIVE/COMPLETE/ON HOLD/…) — so production is "tucked in" per-card, satisfying the original "production-parent, billing-tucked-in" instinct at the right altitude.
- **Keep the `TOTAL TO BILL` header** on top of the billing picker (sum across the cards) — the at-a-glance $ stays.

### The rich card (`StageJobCard` reuse) — billing rides in existing slots
| Card slot (exists) | Today | Billing version |
|---|---|---|
| Banner left (`sjc-banner-stage`) | production stage | **unchanged** — production context per-card |
| Banner right (`sjc-banner-prt`, "NO PRTS YET") | PRT status | **billing badge:** `DEPOSIT DUE` / `PARTIALLY BILLED` / `FULLY BILLED` / `NEEDS FINAL BILL` |
| Identity bubbles (`sjc-identity`: JOB/CUSTOMER/WORK TYPES) | job facts | keep JOB + CUSTOMER; swap WORK TYPES → **money bubble: `CONTRACT / BILLED / REMAINING`** |
| Tabs (PLANNING/MANAGEMENT/DETAILS) | job drill-in | add a **BILLING tab** = manual controls (Hold / N/B / terms / notes) + billing history, moved **off the row** |

### The Pay Apps card (4th card) — Chris's at-a-glance monthly lane [LOCKED intent; one new data dep]
- **Filter:** `_requires_pay_app` (already read on the Schedule side, `queries.js:665,687`) — **buildable today.** Pay-app jobs are pulled **out** of the 3 general cards into this lane (exclusive, no double-count) because pay-app billing is a different animal (SOV / G702-G703, GC-specific format, monthly cycle — see [[project_pay_app_only_customers]], [[project_requires_pay_app_flag]]).
- **At-a-glance goals (Chris):** (1) which pay-app jobs are *ready to bill*, (2) a **monthly due-date warning** — "these jobs have a cutoff coming up, bill them by X."
- **⚠ NEW DATA DEPENDENCY:** there is **no monthly pay-app due-date / cutoff field anywhere today** (confirmed: only `requires_pay_app`, `billing_terms`, `terms_override` exist — none is a monthly billing-day). The due-date alert needs a **new per-customer field** (e.g. `customers.pay_app_billing_day` = day-of-month cutoff), on the sales/`command-suite-db` side, from which Schedule computes the next due date + urgency color (reuse BF-7's aging-band color treatment). **Split the build:** the Pay Apps *card* (filter + at-a-glance list) ships in Phase 2 off existing data; the *due-date urgency* is a fast-follow once the cutoff field lands.

### Ratified rules
1. **On Hold** jobs show **inside their billing card** (a held job still has a billing state), rendered **greyed**, not their own bucket.
2. **90-Day Forecast leaves the billing screen entirely.** Kill the `BILLING WORKLIST / 90-DAY FORECAST` two-tab shell. The forecast becomes **its own card in the home screen's "Job Management Stages" section**, opening to its own screen. Rationale: worklist = invoices *out* ("what do I bill"); forecast = cash *in* ("when does it land") — different questions, shouldn't share a screen (the BF-9 distinction).
3. **Money trio = `CONTRACT / BILLED / REMAINING`.**
4. **Manual controls move off the row into the card's BILLING tab** — the accepted trade: one extra tap to act, in exchange for the richer card + "simple screens beats one busy screen."
5. Entry point: home-screen **"Ready to Bill" card → renamed "Billing."**

### What this replaces / touches
- **Replaces** the current Billing Worklist body (NEEDS TRIAGE / INVOICE SENT / ALL READY BILLED sections + thin rows). Header + tab-shell change (forecast tab removed).
- **Reuses** `StageJobCard` (rows) + `JobsPicker` shell (the picker). Far less new code than a bespoke thin-row redesign.
- **Rewrites** BF-3 (categories now billing-state, 4 cards) and BF-6 (forecast-only restyle); adds two structural items: **forecast relocation** and the **Pay Apps card + cutoff field**.

---

## Phase 2 — Worklist reshape (the spine)

- **BF-3** — **[SPEC LOCKED → see "Phase 2 card-mapping decision" above.]** Billing screen = a 4-card picker by **billing state**: **Ready to Bill / Partially Billed / Billed Complete / Pay Apps** (+ optional All). Reuse `JobsPicker.jsx:77-244` for the picker shell and `StageJobCard` for the cards inside (banner = production, banner-right = billing badge, money bubble `CONTRACT/BILLED/REMAINING`, manual controls → BILLING tab). Entry = home-screen "Ready to Bill" card renamed "Billing". [DERIVED]
- **BF-8** — finish the action-pile vs done-pile section split (gate shipped in Phase 1). Action pile = all still-owed, NOT date-scoped. Done pile = Partially/Fully Billed, scoped to the active window by invoice `sent_at`. [DERIVED]
- **BF-1** — header + Back button (→ `/jobs` JobsPicker). Currently no header (`Billing.jsx:81-89`). [DERIVED]
- **BF-2** — time-period filter in the header (day/week/month/quarter/year + custom), mirroring `Jobs.jsx:129-133`. The header date IS the active window and scopes the done pile. [DERIVED]
- **Pay Apps card (new, Loop #38)** — 4th picker card; filter `_requires_pay_app` (`queries.js:665,687`, already read). Pulls pay-app jobs out of the 3 general cards (exclusive). Ships off existing data. **Monthly due-date alert = fast-follow** pending a new `customers.pay_app_billing_day` (day-of-month cutoff) field in `command-suite-db`; then compute next-due + urgency color (reuse BF-7 aging bands). [DERIVED + one new field]

---

## Phase 3 — Nav + visual polish

- **BF-5** — worklist row click → `salescommand.app/calllog/<call_log_id>` in a new tab (every row carries `call_log_id`). [DERIVED]
- **BF-6** — **worklist rows are handled by the Phase 2 `StageJobCard` reuse** (see "Phase 2 card-mapping decision"). BF-6 here reduces to the **forecast** restyle — which now lives on its **own screen** (relocated out of the billing tabs, see decision rule #2): card/bubble restyle of the per-week drill-down (a plain table today) + clickable forecast rows → Sales job (new tab, like BF-5). Design ref: Sales Command Proposals + Invoices lists. [DERIVED]
- **Forecast relocation (new, Loop #38)** — move the 90-Day Forecast off the billing screen into its own **"Job Management Stages" card** on the home screen; remove the `BILLING WORKLIST / 90-DAY FORECAST` two-tab shell. [DERIVED]

---

## Phase 4 — Past-due truth

- **ADJ-6** — add `invoices.amount_paid` / `balance_due` (today `paid_at` is binary), subtract in the past-due bucket. Matters for **partial PAYMENT** of non-GC invoices (partial *billing* is already tracked). [DERIVED]
- **BF-7** — Past Due: AR aging bands (1–30 yellow / 31–60 orange / 61–90 red / 90+ dark red) w/ $ subtotals, "X days overdue", oldest-first. "Current" stays on the upcoming side. Reword the gross-of-partials caveat to plain English about partial *payment*. [DERIVED]

---

## Phase 5 — Forward calendar

- **BF-9** — step the header window forward/back to see upcoming billing actions. Predict from `jobs.scheduled_end`/`end_date` + `jobs.partial_bill_date`. **Distinct from Forecast:** Forecast = cash IN; this = invoices OUT. Only dated jobs get placed on a future week. [DERIVED]

---

## Phase 6 — Cutover cleanup (post-proof)

- **ADJ-5** — label JobDetail billing history as legacy (`JobDetail.jsx:76`) or repoint at the invoice source. [DERIVED]
- **ADJ-2** — add a Supabase realtime subscription on `invoices` (or a refresh affordance); load is one-shot today (`Billing.jsx:41-49`). [DERIVED]
- **ADJ-7** — retire the remaining read-only `billing_log` reader once the new surface is proven. [DERIVED]
- **ADJ-a** — paginate `loadJobs()` (`queries.js`) with `.range()` per CLAUDE.md's 1000-row cap; `buildBillingSurface()` iterates this set so it silently drops billing rows past 1000 jobs. Low (HDSP nowhere near 1000). [DERIVED — added Loop #38; previously unmapped]
- **ADJ-b** — **CLOSED as duplicate of ADJ-2** (both are "billing load is one-shot, no realtime subscription on `invoices`"). Tracked as ADJ-2 only.
- **ADJ-1** — close out; retention confirmed forecast-safe, only a stale legacy `retainage_amount` on invoice 10024 remains (data-quality note, nothing in scope reads it). [LOCKED]

---

## Cross-app data contract additions

Per `command_suite_shared_data_contract.md`, every cross-app field needs source-of-truth, canonical location, copy-vs-ref, sync pipe.

| Field | Source of truth (writer) | Canonical location | Copy vs ref | Sync pipe |
|---|---|---|---|---|
| `proposals.deposit_required` / `deposit_amount` | Sales Command (proposal) | `proposals` table | Schedule **references** (reads) | PostgREST (both web apps) |
| `invoices.type` | Sales Command (invoice creation) | `invoices` table | Schedule references | PostgREST |

---

## Open decisions (carry into build)

1. ~~`invoices.type` column vs boolean~~ — **[SHIPPED] `type` column** (`'regular' | 'deposit' | 'pay-app'`), backfilled. Live in `command-suite-db` migration `20260620120000`.
2. ~~`jobs.status` → billing lifecycle card mapping (Phase 2, BF-3)~~ — **[RESOLVED Loop #38, 2026-06-30]**. Billing screen = 4-card picker by **billing state** (Ready to Bill / Partially Billed / Billed Complete / Pay Apps), rich `StageJobCard`s inside (production shown per-card via banner), forecast relocated to its own home-screen card. Full spec in **"Phase 2 card-mapping decision (Loop #38)"** below.
3. ~~Gate Sales-side deposit-invoice creation, or only Schedule's surfacing~~ — **[SHIPPED] gate only Schedule's worklist surfacing** (`billingForecast.js:275`, raw `job.status !== 'Parked'`); Sales create-invoice independent.
4. ~~Deposit invoice → job linkage~~ — **[SHIPPED/RESOLVED] explicit `call_log.deposit_invoice_id` pointer** set via "Mark as the job's deposit invoice" (`Invoices.jsx:2058`); Schedule reads it, never writes. Not the old "read the invoice's `call_log_id`" model.

Only **#2 remains open**, and it gates Phase 2 (not Phase 1, which is shipped).

## Scope guard

**OUT of scope this phase:** Field Command "Job Complete" auto-trigger that kicks a finished job onto the billing list. That's Field Command work; the lifecycle "Production Complete" category builds off the existing `Complete` status for now.

---

## Audit manifest

_Round 1 generated by `/auditcriteria` 2026-06-19 (Phase-1 deposit foundation). **Refreshed to Round 2 on 2026-06-30 (Loop #38)** — Phase 1 shipped; this round audits the reconcile + the Phase-2 redesign. Consumed by `/runaudit`._

> **Round-1 manifest is superseded/archived.** Its findings were applied as the `[REVISED round-1]` tags in §1a–§1d, and Phase 1 then shipped (Loops #36–#37). Do NOT re-audit Phase 1's build mechanics; audit whether this plan now tells the TRUTH about that shipped code, plus the new Phase-2 design.

### Bottom line (plain English)
Two things to check, not the deposit build (that shipped). **First:** does this plan honestly describe what's actually live? — it makes a lot of "[SHIPPED]/verified" claims, and the biggest risk is a **dual source of truth** (deposit fields claimed on `call_log`, but migration 20260620 may have also put them on `proposals`). **Second:** is the new Phase-2 design — a billing-state 4-card picker + a Pay Apps lane + moving the forecast off the billing screen — free of holes (buckets that double-count, pay-app jobs landing in two cards, dead forecast routes)? Plus one honesty check: is the "we need a new `pay_app_billing_day` field" claim actually true. Three reviewers, one each.

### Round
- Current round: 2 (reconciled plan + Phase-2 redesign)
- Plan revision under audit: `feat/billing-worklist-refinement` HEAD (Loop #38 commits: reconcile + Phase-2 revision + backlog/SJC)
- Findings trend: n/a for this scope — first pass on the Loop #38 layer

### Prior rounds
Round 1 (2026-06-19) audited Phase-1 deposit foundation — **applied + shipped**, now out of scope. The companion `billing_forecast_integration.md` went through its own rounds 1–3 (shipped). This round is the FIRST look at (a) the reconcile's truth-claims and (b) the Phase-2 billing-state redesign.

**Briefing for agents:** attack the **Loop #38 layer only** — (1) truth of the `[SHIPPED]` claims vs live code/schema, (2) the Phase-2 card-mapping decision's design soundness, (3) the new-data-dependency + scope-honesty claims. Do NOT re-find Phase-1 build issues (shipped) or re-derive the §0 baseline.

### Deployment context
- **Live tenants**: 1 — HDSP only (multi-tenant onboarding blocked). Cross-tenant findings cap at **Med**.
- **Prod / staging / dev**: the deposit foundation is **live in prod**; the Phase-2 redesign is **unbuilt** (plan only). Migrations live in `command-suite-db`.
- **Blocking feature flags**: `customers.requires_pay_app` routes pay-app vs regular invoicing AND now drives the new Pay Apps card — a mis-filter there is load-bearing.
- **Concurrency profile**: solo / ≤5 (office staff: Joe, John, Denise). Multi-user race findings cap at **Low**.

### Time budget + finding cap
- **Time budget**: **60 min** — plan-refinement audit, no clock lock on the loop.
- **Finding cap**: **6** findings (`max(3, ceil(60/10))`). Surface top-6 most consequential; remainder → "Quarantined (not actionable this loop)."

### Surface
- Total lines: ~340 (grew from reconcile + Phase-2 decision + refreshed manifest).
- [SHIPPED] claims to verify: Phase 0–1 (ADJ-3, §1a schema on `call_log`, `invoices.type`, §1d gate/derivation, deposit UI).
- [LOCKED] Phase-2 decisions: the billing-state 4-card model + Pay Apps + forecast relocation (Chris-ratified, unbuilt).
- [OPEN] items: ADJ-4 (one-liner), `pay_app_billing_day` new field (fast-follow), SJC-1/2 (deferred to Field).

### Layers touched (this round's audit surface)
- Plan truth vs live code: `billingForecast.js`, `queries.js`, `StageJobCard.jsx` (sch); `ProposalDetail.jsx`, `Invoices.jsx`, `invoicePdf.js` (sales).
- Schema reality: `command-suite-db` migrations `20260620120000`, `20260621120000` (deposit fields + `invoices.type`); `customer_pay_app_templates` / `billing_schedule*` (for the due-date claim).
- Design model (unbuilt): the Phase-2 billing-state buckets, Pay Apps exclusivity, forecast route relocation.

### New mechanisms introduced (by this plan revision — the round-2 targets)
- **Design:** billing-state card-picker (Ready to Bill / Partially / Complete / Pay Apps); production shown per-card via `StageJobCard` banner; forecast relocated to a home-screen "Job Management Stages" card (two-tab shell removed).
- **Proposed new field:** `customers.pay_app_billing_day` (day-of-month cutoff) — powers the Pay Apps due-date alert (fast-follow, NOT yet built).

### Cross-system reach
- **command-suite-db** — owns the shipped deposit migrations; verify the exact table(s) the deposit columns landed on.
- **sales-command** — deposit UI + `invoices.type` writer; the proposed `pay_app_billing_day` would live on `customers` here.
- **sch-command** — reads deposit fields + `requires_pay_app`; hosts the Phase-2 billing screen redesign.

### Irreversibility
- Low for this round — the Phase-2 redesign is unbuilt (a wrong design decision is reversible on paper). The one durable risk already in prod is the deposit data model; if it's a **dual source of truth** (`proposals` AND `call_log`), that's live drift worth catching now.

### Known weak points
- **Dual source of truth (highest):** plan says deposit fields live on `call_log` (one-field). Migration 20260620 also added `deposit_required/deposit_amount` — confirm it did NOT leave a second copy on `proposals`. Two writers = silent drift.
- **`invoices.type` integrity:** CHECK + backfill applied cleanly? Any NULL/misclassified rows in prod?
- **Bucket derivation holes:** do Ready-to-Bill / Partially / Complete map 1:1 onto the shipped `historyLabel` logic (`billingForecast.js:~355`)? Any job in zero or two buckets?
- **Pay Apps exclusivity:** a job that is BOTH deposit-required AND `requires_pay_app` — which card? Is the filter unambiguous at the data layer?
- **Forecast relocation dead links:** removing the `BILLING WORKLIST / 90-DAY FORECAST` tabs — what routes/tiles point at `?tab=forecast` today (note ADJ-3 standardized `?tab=worklist`)?
- **ADJ-4 still-open claim:** confirm the dead `termsOverride ||` is genuinely present at `billingForecast.js:171`.

### Open questions
- Does `customer_pay_app_templates` (or any billing_schedule table) already encode a monthly due cadence — which would make the "new `pay_app_billing_day` field" claim wrong?
- Is the Phase-2-vs-fast-follow split honest, or is the Pay Apps due-date urgency quietly pulled into Phase 2?

### Suggested attack angles (3 total)
1. **Truth of the `[SHIPPED]` claims (cross-repo schema + code).** Required reading: `command-suite-db` migrations `20260620120000` + `20260621120000`; `billingForecast.js` (Parked gate, deposit derivation, `historyLabel`, `expectedPayDate:171`); `queries.js:657-698`. Pressure: **dual source of truth** (`proposals` vs `call_log` deposit fields), `invoices.type` backfill integrity, §1d wired-not-stubbed, ADJ-3 truly done, ADJ-4 truly open.
2. **Phase-2 design soundness (billing-state picker).** Required reading: the "Phase 2 card-mapping decision" section; `billingForecast.js` status derivation; `queries.js` (`_requires_pay_app`, `_deposit` reads); current `Billing.jsx`/`BillingWorklist.jsx` routing. Pressure: bucket coverage (zero/two-bucket jobs), Pay Apps exclusivity vs deposit-required overlap, On Hold "greyed inside its card" data availability, forecast-relocation dead routes, `StageJobCard` reuse feasibility (inherits SJC-1 "day X of Y" quirk).
3. **New-data-dependency + scope honesty.** Required reading: `customer_pay_app_templates` + `billing_schedule*` schema; `customers` columns; the plan's Phase-2-vs-fast-follow split. Pressure: does a due-cadence field already exist (claim-falsification), and is any fast-follow work (due-date urgency alert) smuggled into the Phase-2 "ships today" scope.

### Suggested agent count: 3

Rationale: the audit surface is three clean, non-overlapping concerns — is-the-plan-true (code/schema), is-the-design-sound (Phase-2 model), is-the-data-story-honest (new field). 1 tenant / ≤5 users caps cross-tenant/race severity, so no dedicated RLS agent is warranted. Bump to 4 only to split the cross-repo schema-truth check from the sch-command code-truth check if the dual-source-of-truth risk looks live.
