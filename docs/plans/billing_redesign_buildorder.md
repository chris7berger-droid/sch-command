# Billing Redesign & Deposit — Phase 2 Build Order

**Status:** PLAN — order LOCKED, phase detail DERIVED from code reading
**Repo:** sch-command (cross-repo: sales-command for the deposit)
**Branch:** feat/billing-forecast
**Date:** 2026-06-19
**ERD:** Loop #36 (billing-back log items)
**Companion:** `billing_forecast_integration.md` (the forecast itself, already shipped). This doc orders the *remaining* billing backlog: BF-1…9 + ADJ-1…7.

Confidence tags: **[LOCKED]** confirmed in code · **[DERIVED]** inferred from code, not yet built · **[DESIGN-OPEN]** needs a call · **[BLOCKED]** needs external work.

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

## Build order (durable: data model → spine → features → cleanup)

| Phase | What | Why here |
|---|---|---|
| **0** | ADJ-3 (verify+close), ADJ-4 (drop dead branch) | Trivial; clears confusion before building. |
| **1 — Deposit foundation + proof** | Sales deposit data + invoice + label; Schedule schedule-date gate | Durable source-of-truth data model AND it delivers the loop's POINT-AT. No throwaway. |
| **2 — Worklist reshape (spine)** | BF-3 card-picker + BF-8 section split + BF-1 header + BF-2 filter | Biggest design item; deposit rows inherit the new style for free. |
| **3 — Nav + polish** | BF-5 clickable rows→Sales, BF-6 card restyle + forecast rows | Overlays on the spine. |
| **4 — Past-due truth** | ADJ-6 `amount_paid/balance_due` → BF-7 AR aging bands | Aging is only honest once net exists. |
| **5 — Forward calendar** | BF-9 forward/back billing calendar | Builds on BF-2/BF-8. |
| **6 — Cutover cleanup** | ADJ-5, ADJ-2 realtime, ADJ-7 retire `billing_log`, close ADJ-1 | Reversible, post-proof. |

The deposit (Phase 1) comes *before* the card redesign (Phase 2) because the code shows its durable foundation — deposit source-of-truth fields, `invoices.type`, and the schedule-date gate — doesn't depend on the redesign, and it delivers the proof. Spine-first and proof-first coincide.

---

## Phase 0 — corrections

- **ADJ-3** — confirm `/billing?tab=worklist` everywhere, close the item. [LOCKED done]
- **ADJ-4** — remove `terms_override` from the step-3 COALESCE in `expectedPayDate()` (`billingForecast.js:171`); keep it only as step 1. [DERIVED]

---

## Phase 1 — Deposit foundation + proof (the POINT-AT)

Cross-repo. **Most of the build is sales-command.** Schedule just surfaces and links.

**Proof path:** test job → put on schedule (has dates) → deposit shows on billing list → click row → Sales proposal opens (new tab) → "create invoice" → invoice denotes **materials deposit** → flow works. *(Field-complete half is out of scope — Field Command work.)*

### 1a — Schema (sales-command owns `proposals` + `invoices`)
- `proposals.deposit_required boolean default false` [DERIVED]
- `proposals.deposit_amount numeric default 0` [DERIVED]
- `invoices.type text default 'regular'` (check `'regular' | 'deposit' | 'pay-app'`) [DESIGN-OPEN → recommend type column]
- Migration lives in **sales-command** (it owns these tables); follow sales-command migration rules — run `scripts/check-migration-safety.sh` + collision check before push.

### 1b — Sales UI: deposit control on ProposalDetail summary
- Add **deposit checkbox + amount** to the `ProposalDetail` summary panel (`ProposalDetail.jsx:1096-1246`). Saves to `proposals`. [DERIVED]
- **Visibility is a hard requirement (Chris):** a distinct bordered callout card with the Command Green accent — not a faint inline checkbox, not tucked among the top menu buttons. When deposit is required, the amount reads boldly at a glance. Must not get lost in the muted linen UI. [LOCKED requirement]

### 1c — Sales invoice flow: create + label the deposit invoice
- In `NewInvoiceModal` (`Invoices.jsx:39-562`): when the selected proposal has `deposit_required` + `deposit_amount > 0`, offer "create deposit invoice." [DERIVED]
- Create it by **reusing the archive-invoice path** (`handleCreate`, `Invoices.jsx:213-300`): one `invoice_lines` row with null `proposal_wtc_id`, `type='deposit'`, `amount = proposal.deposit_amount` shown as a **suggested, editable** figure (BF-4). [DERIVED]
- **Label "MATERIALS DEPOSIT INVOICE"** on the preview (`Invoices.jsx:565-939`) and the PDF (`invoicePdf.js`) — badge near the invoice # / status, mirroring how PAID is shown. [DERIVED]
- Once sent, the job drops to **Partially Billed**; the deposit keeps its unique invoice ID. [DERIVED]

### 1d — Schedule: surface the deposit, gated on scheduled
- Add the **schedule-date population gate** (BF-8 core): exclude jobs with no `scheduled_end`/`end_date`/`partial_bill_date` in `buildBillingSurface()` (`billingForecast.js:268-293`). A deposit shows only once the job is scheduled. [DERIVED]
- Worklist shows the deposit as a **suggested amount** for scheduled jobs with `deposit_required`; reads `invoices.type='deposit'` to know it's been billed → Partially Billed. Data is already loaded (`loadBillingSurfaceData`, `queries.js:605-646`). [DERIVED]
- Row click → Sales proposal in a new tab (this is BF-5, pulled forward minimally for the proof). [DERIVED]

### Phase 1 decisions / risks
- **`invoices.type` column vs one-off boolean** — recommend the `type` column: it unifies the currently-implicit archive/pay-app detection and makes future types easy. [DESIGN-OPEN]
- **How Schedule knows the job is "scheduled"** — use the existing `scheduled_end`/`end_date`/`partial_bill_date` fields (all already loaded). [DERIVED]
- **Deposit invoice ↔ job linkage** — invoice already carries `call_log_id` (`Invoices.jsx:256-257`). Confirm copy-vs-reference: Schedule **references** (reads), never copies. [DESIGN-OPEN]
- **Can Sales create a deposit invoice before the job is scheduled?** The proof routes through Schedule (scheduled-first), but Sales create-invoice is independent. Decide whether to gate Sales-side or only gate the Schedule worklist surfacing. [DESIGN-OPEN]

---

## Phase 2 — Worklist reshape (the spine)

- **BF-3** — card-picker like `JobsPicker` (`JobsPicker.jsx:77-244` is the reference): one card per lifecycle category w/ count + an "All" card. Categories: **Not Started / In Production / Production Complete / Partially Billed / Fully Billed / All.** Add a manual "Job not started" flag (distinct from Hold). Clean read-only rows; move manual controls (Hold / nothing-to-bill / terms-override / notes) into a drill-in. [DERIVED]
  - **Mapping is the real design work** [DESIGN-OPEN]: current billing statuses are invoice-state-based (NEEDS_TRIAGE/SENT/…, `billingForecast.js:87-95`); the card categories are lifecycle-based (live in `jobs.status`: Scheduled/In Progress/Complete/…). Needs an explicit cross-map. "Production Complete" builds off the existing `Complete` status now; the Field Command auto-trigger is later.
- **BF-8** — finish the action-pile vs done-pile section split (gate shipped in Phase 1). Action pile = all still-owed, NOT date-scoped. Done pile = Partially/Fully Billed, scoped to the active window by invoice `sent_at`. [DERIVED]
- **BF-1** — header + Back button (→ `/jobs` JobsPicker). Currently no header (`Billing.jsx:81-89`). [DERIVED]
- **BF-2** — time-period filter in the header (day/week/month/quarter/year + custom), mirroring `Jobs.jsx:129-133`. The header date IS the active window and scopes the done pile. [DERIVED]

---

## Phase 3 — Nav + visual polish

- **BF-5** — worklist row click → `salescommand.app/calllog/<call_log_id>` in a new tab (every row carries `call_log_id`). [DERIVED]
- **BF-6** — card/bubble restyle + clickable forecast rows (design ref: Sales Command Proposals + Invoices lists). Forecast per-week drill-down is a plain table today. [DERIVED]

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

1. `invoices.type` column vs boolean — **recommend type column.**
2. `jobs.status` → billing lifecycle card mapping (Phase 2) — design when we reach it.
3. Whether to gate Sales-side deposit-invoice creation on the job being scheduled, or only gate the Schedule worklist surfacing.
4. Deposit invoice → job linkage confirm (copy-vs-reference; reads only).

## Scope guard

**OUT of scope this phase:** Field Command "Job Complete" auto-trigger that kicks a finished job onto the billing list. That's Field Command work; the lifecycle "Production Complete" category builds off the existing `Complete` status for now.
