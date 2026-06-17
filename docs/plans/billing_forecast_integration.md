# Billing Triage + 90-Day Cash-Flow Forecast — Integration Plan

**Repo:** sch-command (Schedule Command) · **Branch:** `feat/billing-forecast`
**Status:** DESIGN/PLANNING only. No code yet. Card + technical decisions **RATIFIED by Chris 2026-06-17** (§5 cards, §8 items 2–8) — moved to [LOCKED]. **Round-1 audit response applied 2026-06-17 (Option 1 — patch status-derivation in v1; see §8.1):** A1–A5/B1–B3 status-derivation arithmetic, C1–C7 forecast, D1–D5 card rewire, E1–E4 migration all [LOCKED — round-1 audit fix]; cross-tenant RLS read CONFIRMED SAFE (§9); Budget infuse DEFERRED to fast-follow. Remaining open items: completion signal (§3.3), portal nuance (§3.1), Hold–Sales role-gating (§9-queue).
**Author:** planning agent · **Date:** 2026-06-17

Goal: rebuild Chris's proven Excel billing tool natively in Schedule Command's billing surface —
(1) a **weekly billing triage worklist** that self-populates from completed scheduled work, with
auto-derived statuses; (2) a **90-day cash-flow forecast** driven off real invoice sent-dates +
payment terms; and (3) reconcile the three "All Jobs" money cards (Ready to Bill, Budget,
Production Complete) against this new surface.

Confidence tags on every section: **[LOCKED]** verified in code/schema · **[DERIVED]** inferred
from evidence · **[DESIGN-OPEN]** needs Chris's product decision · **[BLOCKED]** info not found.

---

## §0 Reproduction — Current-State Baseline (observed) [LOCKED]

This is a **greenfield feature plan, not a bug fix**, so there is no failing behavior to reproduce.
The equivalent grounding is the **observed current state** of the surface this plan replaces/rewires —
verified in code and schema, not asserted. Concrete observed values below; full detail in §1–§2.

**Click-path to observe:** Schedule Command → `/jobs` → landing `JobsPicker` → "Job Management Stages"
section → the three money tiles.

**Observed card state (verified `src/components/JobsPicker.jsx:24–62, 184–218`):**
- **Budget tile** renders a hardcoded em-dash `—` (no computed value), footer "Coming soon"; `/budget`
  is a 10-line stub (`src/views/Budget.jsx`). → placeholder, zero data.
- **Ready to Bill tile** count = jobs where `getJobStatus(j)==='Complete'` **AND** Σ`billing_log.percent`
  for that `job_id` `< 100` — a percent-of-job proxy. Routes to `/billing`.
- **Production Complete tile** count = jobs with status `Complete`; footer "{readyToBill} ready to bill"
  reads that **same** `billing_log` percent proxy.

**Observed billing engine state (verified `src/views/Billing.jsx`, 738 lines):** `/billing` is a 3-column
Pending/Confirmed/Invoiced pipeline keyed off **percent of `jobs.amount`** (a string like `"$45,000"`),
writing `billing_log` rows. It holds **no reference to canonical `invoices`** — no `from('invoices')` in
the Schedule billing path. So today the suite has: no real invoice dollars on this surface, no sent/paid
dates, no retention, no payment terms, and **no cash forecast anywhere**.

**Observed canonical reality (verified `~/sales-command/supabase/migrations/`):** `invoices.call_log_id`
(int, NOT NULL, FK) is the clean job→invoice join key; `customers.billing_terms` (int, default 30) is the
existing terms store; `billing_schedule.contract_sum` / `retainage_pct` (default 5) exist. **The data the
new surface needs is already in the shared DB, one join away** — this is a wiring/reconciliation gap, not
a missing-data gap.

**Baseline conclusion:** the three cards and `/billing` are placeholders built on a pre-invoice percent
model; the canonical invoice/terms/retention data they should reflect already exists. This plan rewires
them to it. Cross-tenant RLS read access is **CONFIRMED SAFE** (round-1 audit, §9); remaining live-DB
confirmations (null `due_date`s, `billing_terms` population) are cheap informational checks in §9.

---

## 0. Constraints (carried in from Chris, do not relitigate) [LOCKED]

1. **Single source of truth.** Do NOT rebuild invoices in Schedule. The worklist READS canonical
   invoice/job data; Schedule WRITES BACK only operational state. Invoice creation stays in the
   Sales Command engine.
2. **Self-populating worklist** from completed scheduled work — no manual copy-paste.
3. **Auto-derive statuses** the DB already knows (invoice exists? sent to QB? paid?). Only
   judgment statuses stay manual (Hold–Sales, Nothing to bill, partial).
4. **The forecast is the prize** — nothing in the suite forecasts cash today.
5. One shared Supabase DB (`pbgvgjjuhnpsumnowuym`); Schedule reads canonical tables directly, no sync layer.

---

## 1. Current state — Schedule Command billing surface [LOCKED]

### 1.1 The "All Jobs" screen and where the three cards live

- **`src/views/Jobs.jsx`** — the `/jobs` shell. Landing renders `JobsPicker`; `?tab=all` renders
  `JobCardList`. Tabs: `staged | scheduled | active | on-hold | complete | all` (`VALID_TABS`,
  line 11). Legacy slugs redirect via `TAB_REDIRECTS` (line 14): `ready-to-bill → /billing`,
  `billing → /billing`.
- **`src/components/JobsPicker.jsx`** — the landing "What do you want to look at?" picker. The
  three money cards are tiles here under the **"Job Management Stages"** section, NOT on a job's
  detail row:
  - **Production Complete** (lines 184–194): count = `counts.complete` (jobs with
    `getJobStatus(j) === 'Complete'`). Footer "{readyToBill} ready to bill". Routes to
    `goTab('complete')` → `/jobs?tab=complete`.
  - **Ready to Bill** (lines 196–206): count = `counts.readyToBill`. Routes to `goBilling()` → `/billing`.
  - **Budget** (lines 208–218): count = `—` (hardcoded em-dash, placeholder). Footer "Coming soon".
    Routes to `goBudget()` → `/budget`.
- The card data is computed in `JobsPicker`'s `counts` memo (lines 24–62):
  - `readyToBill` (lines 44–49) = jobs where `getJobStatus(j) === 'Complete'` **AND** summed
    `billing_log.percent` for that `job_id` `< 100`. **[LOCKED]**
  - `complete` = bucket count of status `Complete`.
  - Budget has **no** computed value — literally renders `&mdash;`.

### 1.2 The existing Billing view (`/billing`)

- **`src/views/Billing.jsx`** (738 lines) — a 3-column **Pending / Confirmed / Invoiced** weekly
  pipeline keyed off a **percent-of-job-amount** model, NOT off canonical invoices. **[LOCKED]**
  - Reads `loadJobs()` + `supabase.from('billing_log').select('*')`.
  - "Pending" derives from `jobs` operational fields: `scheduled_end`/`end_date` within week &
    `billed < 100` (Complete), or `partial_billing='Yes'` + `partial_bill_date` (Partial), plus a
    paused branch (`billing_paused='Yes'`).
  - Writes rows into **`billing_log`** (`{job_id, date, percent, cumulative_percent, type, notes,
    invoiced, invoiced_date}`) via `confirmBill()`, `markInvoiced()`, etc.
  - `job.amount` is a **string** (e.g. `"$45,000"`); billing is tracked as **percent** of it, not
    as dollars tied to a real invoice. There is no link to canonical `invoices` rows anywhere here.
- **Conclusion [DERIVED]:** the current `/billing` view and `billing_log` are a *percent-progress
  tracker that predates the shared invoice engine*. It is the placeholder Chris described. It does
  not know about `invoices`, `sent_at`, `paid_at`, retention, pay apps, or payment terms.

### 1.3 The Budget view (`/budget`)

- **`src/views/Budget.jsx`** — a 10-line stub: "Budget — coming soon. Will surface real-time
  per-job margin once Field Command DPRs are flowing." No data. **[LOCKED]**

### 1.4 Data layer + routing [LOCKED]

- **`src/lib/queries.js`** is the data layer (per repo convention). Key exports: `loadJobs({withWTCs})`,
  `loadJob`, `updateJobField/updateJobFields` (audit-logged to `job_changes`), `updateJobStatus`
  (stage-sync chokepoint), `loadAllRows` (pagination), PRT readers. **There is no invoice reader
  here yet** — it would be the natural home for `loadInvoicesForForecast()` etc.
- **`loadJobs()`** normalizes a `jobs ⟕ call_log` join (`normalizeJob`, lines 89–117). It exposes
  `j.call_log_id`, `j.customer_id` (from call_log), `j.job_num`, `j.amount` (jobs col, string).
- Routing: `src/App.jsx` `<Routes>` (lines 306–318). `/billing → Billing`, `/budget → Budget`.
  Nav (`NAV_ITEMS`, line 24) shows "Billing" but not "Budget" (Budget reachable only via the picker tile).

---

## 2. Canonical schema the worklist + forecast will READ [LOCKED unless noted]

Verified against `~/sales-command/CLAUDE.md` (canonical column reference) and
`~/sales-command/supabase/migrations/`. All tables are in the shared DB.

### 2.1 `public.invoices` (Sales-owned — the money source of truth)

Columns relevant here (text PK):
- `id` (text), `proposal_id` (text FK proposals), **`call_log_id` (integer, NOT NULL, FK call_log)**
  — added `20260514130000`; this is the clean join key from an invoice to a job. **[LOCKED]**
- `job_id` (text) — denormalized *display label*, NOT a FK. Do not join on it.
- `status` (text) — lifecycle: **`New → Sent → Waiting for Payment → Past Due → Paid`**
  (verified in `Invoices.jsx` `statusActions`, lines 1193–1200). **[LOCKED]**
- `amount` (numeric) — invoice dollar total.
- `sent_at` (timestamptz) — set when status moves to `Sent`, or on Approve→QB (lines 1115–1116). **[LOCKED]**
- `due_date` (date) — **required at invoice creation** (`Invoices.jsx` line 214 errors if blank),
  entered manually, NOT auto-computed from terms today. **[LOCKED]**
- `paid_at` (timestamptz) — set when status → `Paid`, including via Stripe/QB webhook poll
  (lines 1002–1011, 1119). **[LOCKED]**
- `qb_invoice_id` (text), `qb_payment_id` (text) — present ⇒ synced/paid in QuickBooks. **[LOCKED]**
- `stripe_payment_id`, `stripe_payment_link_id`, `stripe_checkout_id/url` — Stripe linkage. **[LOCKED]**
- `voided_at` (timestamptz) + `void_reason` — `20260522130000`. **Aggregators MUST filter
  `voided_at IS NULL`** (per migration comment). **[LOCKED]**
- `deleted_at` (timestamptz, NULL = active) — soft delete; filter `deleted_at IS NULL`. **[LOCKED]**
- Retention: `retention_pct`, `retention_amount` (`20260420170000`); `retention_release_of` (text
  FK invoices — non-null ⇒ this row IS a retention-release invoice), `retention_released` (bool on
  the source invoice) (`20260601120000`). Also a legacy parallel set `retainage_pct/amount/released`
  (`20260416175646`) — **two conventions coexist**; the active one is `retention_*`. **[LOCKED]**
- `tenant_id` (uuid FK tenant_config). **[LOCKED]**

### 2.2 `public.call_log` (Sales-owned master record) [LOCKED]

`id (int PK)`, `display_job_number`, `customer_name`, `customer_id` (uuid FK customers), `stage`,
`job_name`, `sales_name`, `is_change_order`, `co_number`, `tenant_id`. Schedule's `jobs.call_log_id`
FKs to this. Invoices also carry `call_log_id`, so **`jobs ⟷ call_log ⟷ invoices` joins cleanly on
`call_log.id`.**

### 2.3 `public.customers` — payment terms live HERE [LOCKED]

`id`, `name`, `billing_terms` (**integer, default 30**) — the per-customer net terms (days).
`tenant_config.default_billing_terms` (int, default 30) is the tenant fallback.
**This is the canonical "Payment Terms" store for the forecast.** No new terms column needed at the
customer level.

### 2.4 `public.proposals` [LOCKED]

`id (text)`, `status` ('Sold' is the invoiceable state; a `'Signed'` status is being added by
sales-command's Multi-GC work — see RESUME ALERT item 3 in CLAUDE.md), `total`, `call_log_id`,
`proposal_number`, `historical_billed_amount`, `is_archive_proposal`. An invoice's `proposal_id`
ties it back to its proposal.

### 2.5 Billing schedule / pay apps (SOV / G702-G703) [LOCKED]

- `billing_schedule` (1:1 per proposal): `contract_sum`, `retainage_pct` (default 5), `status`.
- `billing_schedule_lines`: SOV line items.
- `billing_schedule_pay_apps`: `app_number`, `period_from/to`, `this_app_amount`,
  `retainage_withheld`, `current_payment_due`, **`invoice_id` (FK invoices)**, `status`
  ('draft'|'submitted'|'paid'), `submitted_at`. Each submitted pay app **produces an SC invoice**
  for (this-app − retainage). So **pay-app cash folds into the forecast through the invoice it
  generates** — no separate forecast path needed. **[LOCKED]**
- `customers.requires_pay_app` (bool) routes a customer to the pay-app flow vs. a regular invoice.

### 2.6 Schedule-owned tables (already here) [LOCKED]

`jobs` (`job_id`, `call_log_id`, `amount` string, `status`, `no_bill`, `no_bill_reason`,
`partial_billing`, `partial_bill_date`, `partial_percent`, `billing_paused`, `billing_notes`,
`billed_to_date`, `scheduled_end`/`end_date`, `ready_confirmed_at`), `billing_log`, `job_wtcs`,
`job_changes`, `assignments`, `materials`, `daily_production_reports` (Field, FK call_log.id).

---

## 3. Worklist status derivation — the 6 statuses [DERIVED, rules LOCKED to schema]

Each worklist row = one job (or job+WTC) that had billable work. Status is computed as a **derived
state** layered with **manual operational overrides**. Resolution order (first match wins):

**Resolution order is RE-ORDERED per round-1 audit (B3): fully-billed must dominate Paid.** A
job whose entire authoritative value is invoiced and where those invoices are all paid must resolve
to the terminal "fully billed / All Ready Billed" state, not flicker to "Paid" on a single paid
invoice while billable balance remains. So evaluate **fully-billed coverage FIRST**, then per-invoice
Paid/Sent states for the remaining (not-yet-fully-billed) jobs. **[LOCKED — round-1 audit fix (B3)]**

| # | Excel status | Source | Rule |
|---|---|---|---|
| 1 | **All Ready Billed** (fully billed) | AUTO | The job's authoritative value is fully covered by sent, non-void, non-deleted invoices (`fully_billed`, §3.2) AND the most-recent send was in a **prior** week (`max(sent_at)` across the job's invoices < current worklist week — A5). "No action this week." Evaluated FIRST so it dominates a single-invoice Paid match (B3). **[LOCKED — round-1 audit fix (A5/B3)]** |
| 2 | **Paid** | AUTO | An invoice for this call_log has `status='Paid'` (or `paid_at NOT NULL`), `voided_at IS NULL`, `deleted_at IS NULL`, and the job is NOT already resolved as fully-billed above. Removes row from active worklist; drops from forecast. **[LOCKED]** |
| 3 | **✅ Invoice Sent to QB** | AUTO | Invoice exists with `qb_invoice_id NOT NULL` (posted to QB) — and, per Chris's note, also submitted through the customer's portal. `qb_invoice_id` is the DB-knowable half. Portal-submission is NOT in the DB → see §3.1. **[LOCKED for QB half / DESIGN-OPEN for portal half]** |
| 4 | **✅ Invoice Sent** | AUTO | Invoice exists with `sent_at NOT NULL` (or `status IN ('Sent','Waiting for Payment','Past Due')`), not yet QB-posted/paid. Drafts/New invoices (`sent_at IS NULL`) do NOT count toward "Sent" or billed coverage (A3). **[LOCKED — round-1 audit fix (A3)]** |
| 5 | **❌ Hold – Sales** | MANUAL | Operational flag set by sales: do not invoice. Stored in `billing_worklist` (`hold_sales` + `hold_reason`) — **storage LOCKED (§6.1)**. **[DESIGN-OPEN — who can set it; role-gated? = queue item 9]** |
| 6 | **Nothing to bill** | MANUAL | Operational flag: no billable work this week. Stored in `billing_worklist.nothing_to_bill` — **storage LOCKED (§6.1)**. |

Plus the implicit Excel "no status yet" = **Needs Triage** (work done, no **sent** invoice, no manual
flag) — the actionable rows. **[DERIVED]**

### 3.0a Worklist grain — one row per call_log; COs are their own rows [LOCKED — round-1 audit fix (B1/B2)]
- **B2 — aggregate grain:** the worklist shows **ONE ROW PER JOB (per `call_log`)**. A single call_log
  can have N canonical invoices (progress draws, retention-release, pay-app invoices). Those N invoices
  are **aggregated into that single row**: the row's billed total = `Σ(invoice.amount)` over the job's
  qualifying invoices (filters per A1/A3 below), and the row's status is the single resolved value from
  the table above computed over that invoice set. The UI never shows one row per invoice on the worklist
  (per-invoice detail lives in the forecast drill-down §4.4, not the triage worklist).
- **B1 — Change Orders are SEPARATE call_log children:** a CO is its own `call_log` row
  (`is_change_order = true`, `co_number` set), with its own `jobs` row and its own invoices. Therefore
  **each CO is its own worklist row** — a CO is NOT folded into the parent job's row. The parent job's
  fully-billed math is computed against the parent call_log's invoices and authoritative total ONLY;
  the CO's math is computed against the CO call_log's own invoices and its own authoritative total.
  This keeps the per-call_log grain clean and avoids cross-counting CO dollars into the base contract.

### 3.1 The "submitted to portal" gap [BLOCKED → DESIGN-OPEN]
The DB knows `qb_invoice_id` (QB posting) but has **no field for "submitted through the customer's
payment portal."** Options: (a) treat QB-posted as the canonical "Sent to QB" and drop the portal
nuance; (b) add a manual `portal_submitted_at` to `billing_worklist`. Chris decides — most likely (a).

### 3.2 "Fully billed" definition [LOCKED — Chris-ratified 2026-06-17; arithmetic patched round-1 audit]
For statuses 1/3/4 we need "is this job's billable value exhausted?" **Authoritative total (locked):**

**A2 — authoritative_total gating (locked, round-1 audit fix):**
- Use **`billing_schedule.contract_sum` ONLY when a real SOV sum exists** — i.e.
  `billing_schedule.contract_sum > 0` (a present-but-zero `contract_sum` is treated as "no SOV", not
  as a $0 contract). **Otherwise fall back to the proposal `total`.**
- `authoritative_total = (billing_schedule.contract_sum WHEN contract_sum > 0) ?? proposals.total`.

**A4 — which proposal (locked, round-1 audit fix):** a single `call_log` can carry **multiple
proposals** (archive + live, multi-GC). When selecting the proposal for `authoritative_total`, choose
the **LIVE, non-archive proposal** — `is_archive_proposal = false` and the `status` reflecting the
active sold/signed proposal (`'Sold'`, or `'Signed'` once Multi-GC ships, §2.4). Never sum invoices
against an archive proposal's total. If multiple live proposals exist on one call_log (multi-GC), the
authoritative total is the live proposal that the job's invoices belong to (match on `proposal_id`).

- Schedule's `jobs.amount` string is the **legacy placeholder and must NEVER be authoritative** —
  it is for display only.
- For SOV/pay-app jobs, "fully billed" can also be confirmed via `billing_schedule` fully drawn
  (all lines 100%), which is consistent with the `contract_sum` basis above.

**A1 + A3 — billed-sum filters (locked, round-1 audit fix):**
`fully_billed = billed_total ≥ authoritative_total`, where
```
billed_total = Σ invoice.amount  over the call_log's invoices WHERE
                 voided_at IS NULL
                 AND deleted_at IS NULL
                 AND sent_at IS NOT NULL            -- A3: only actually-sent invoices count (no drafts/New)
                 AND retention_release_of IS NULL   -- A1: exclude retention-RELEASE invoices so the
                                                    --     released-retention dollars don't double-inflate
                                                    --     the contract's billed coverage
```
- **A1 rationale:** a retention-release invoice re-bills dollars already counted inside the original
  progress invoices' gross. Summing it into `billed_total` would push a job past `authoritative_total`
  and false-flag "fully billed." Releases are tracked on the forecast side (§4.5), not in coverage math.
- **A3 rationale:** a draft/`New` invoice (`sent_at IS NULL`) is not yet billed; counting it would
  mark a job "fully billed" before anything was actually sent.

The legacy `billing_log` percent model is **retired** in favor of invoice-dollar reconciliation
(kept read-only, never written; see §5.1/§7).

### 3.3 Worklist population query (self-populating) [DERIVED; deleted-filter LOCKED round-1 audit]
"Jobs that had work and may need billing this week" =
```
jobs (status='Complete' OR scheduled_end within/near week OR partial_bill_date this week)
  LEFT JOIN canonical invoices on call_log_id
  - exclude jobs.deleted = true       -- E3 (round-1 audit fix): never surface soft-deleted jobs
  - exclude no_bill='Yes'
  - exclude rows already 'Paid' / 'All Ready Billed' (resolved per the §3 order)
  - aggregate the call_log's invoices into ONE row (§3.0a B2); count only sent invoices (A3)
  - surface rows with NO sent invoice as "Needs Triage"
```
This replaces the manual "copy schedule in" step. Production-complete + WTC-complete signals
(`job_wtcs`, `daily_production_reports` approved) refine "had work." **Exact completion signal is
[DESIGN-OPEN]** — Chris ran it off "end date this week"; we can keep that or upgrade to DPR-approved.
**Each CO call_log surfaces as its own row (§3.0a B1).**

---

## 4. The 90-day cash-flow forecast [DERIVED, sources LOCKED]

### 4.1 Source query
Read canonical invoices, one row per non-void/non-deleted invoice that has been sent but not paid:
```
SELECT i.id, i.call_log_id, i.amount, i.retention_amount, i.retention_release_of,
       i.sent_at, i.due_date, i.status,
       cl.display_job_number, cl.customer_id,
       c.billing_terms,
       tc.default_billing_terms                 -- C6: source for the §4.2 tenant fallback
FROM invoices i
JOIN call_log cl ON cl.id = i.call_log_id
LEFT JOIN customers c ON c.id = cl.customer_id
LEFT JOIN tenant_config tc ON tc.id = i.tenant_id   -- C6: tenant_config.default_billing_terms fallback
WHERE i.voided_at IS NULL
  AND i.deleted_at IS NULL
  AND i.paid_at IS NULL
  AND i.sent_at IS NOT NULL
```
**C3 — pagination (LOCKED, round-1 audit fix):** `loadInvoicesForForecast` MUST route through
`loadAllRows` (queries.js) so the read pages past PostgREST's 1000-row cap. A naive single `.select()`
silently truncates at 1000 invoices and undercounts the forecast — never fetch this set unpaginated.

**C6 — terms source (LOCKED, round-1 audit fix):** the query JOINs `tenant_config` so the §4.2 fallback
chain `customers.billing_terms → tenant_config.default_billing_terms → 30` actually has a source row for
the tenant default; previously the tenant default was referenced in §4.2 but never selected.

### 4.2 Expected pay date [LOCKED — Chris-ratified 2026-06-17]
Resolution order (first non-null wins) — this is the canonical precedence; **§7's one-liner is
reconciled to match it (C4)**:
1. **`billing_worklist.terms_override`** (per-invoice/job override, 15/30/45/60/75/90) applied to
   `i.sent_at` when set. Real GCs vary terms by job, so this override **is in scope** — see §6.1.
   **terms_override WINS over `due_date`** (round-1 audit C4).
2. `i.due_date` (already required at creation, so usually present). **[LOCKED present]**
3. Fallback: `i.sent_at + COALESCE(billing_worklist.terms_override, customers.billing_terms,
   tenant_config.default_billing_terms, 30) days`. **C6 (round-1 audit fix):** the terms fallback is a
   null-safe `COALESCE` chain, and `tenant_config.default_billing_terms` is now actually selected in
   the §4.1 query so this fallback resolves.

Decision (locked): payment terms **default from `customers.billing_terms`** (which already lives in
the DB — Schedule stores no terms column at the customer level), **but the per-invoice override IS
supported** and persists to `billing_worklist.terms_override` (§6.1) — NOT on the Sales-owned invoice.
When `terms_override` is set, expected pay date = `sent_at + terms_override days`, taking precedence
over both `due_date` and the customer default.

### 4.3 Weekly buckets [DERIVED; past-due bucket LOCKED round-1 audit]
Bin expected-pay-dates into Monday-anchored weekly buckets spanning **today → today+90d**. Per bucket:
total expected inflow ($) + invoice count. Mirrors Excel's "Total to Bill This Week" but on the
*inflow* side.

**C5 — Past-due bucket (LOCKED, round-1 audit fix):** invoices whose **expected pay date is already in
the past but the invoice is still unpaid** (`paid_at IS NULL`, expected pay date < today) do NOT
silently fall out of the forecast. Surface them in a dedicated **"Past Due"** bucket shown ahead of the
first forward week, with its own Σ inflow + count. These are the most-collectable, highest-priority
dollars — Excel surfaced them as overdue; the native forecast must not drop them by bucketing only
today→+90d forward.

**D5 (round-1 audit fix) — `getMonday`/`fmtWk` are LIFTED to a shared lib first:** these helpers
currently live in `Billing.jsx`. They are extracted into a shared lib (e.g. `src/lib/weeks.js`)
**before** `Billing.jsx` is retired/rebuilt, so both the worklist and the forecast import them rather
than depending on the doomed view. Sequencing is pinned in §7.

### 4.4 Per-week drill-down [DERIVED]
"Select Week" → list invoices expected to pay that week (job #, customer, amount, sent date, terms,
expected date). This is the collections-call worklist. Direct port of the Excel forecast drill-down.

### 4.5 Retention + pay apps fold-in [LOCKED — Chris-ratified 2026-06-17; null-safety + prose patched round-1 audit]
- **Retention default is 5% (customizable per job)**, stored as `billing_schedule.retainage_pct`
  (default 5) and per-invoice as `invoices.retention_pct` / `retention_amount`. Forecast math uses
  the actual `retention_amount` on each invoice, not a hardcoded rate.
- **Retention (locked: forecast is NET of retention).** Each invoice's expected-inflow contribution =
  `amount − COALESCE(retention_amount, 0)` — only collectable-now dollars. **C2 (round-1 audit fix):
  every place the forecast subtracts retention uses `COALESCE(retention_amount, 0)`** so a NULL
  retention column (regular non-retention invoices) nets to the full amount rather than producing
  `amount − NULL = NULL` and dropping the invoice from the inflow total. Retention withheld is
  **excluded** from the expected-inflow forecast and shown as its **own separate bucket/line** ("held
  retention / future release").
- A **retention release** invoice (`retention_release_of NOT NULL`) is its own invoice row with its
  own `sent_at`/`due_date`, so the released retention **appears as future inflow when released** —
  flowing through the normal §4.1 invoice path at that time.
- **C7 — counted-exactly-once invariant (round-1 audit fix):** retention is counted **exactly once**.
  Add this invariant as a code comment on the forecast math: *retention is EXCLUDED from inflow while
  held (netted out of its originating invoice via the `− COALESCE(retention_amount,0)` term), and
  COUNTED when its release invoice (`retention_release_of NOT NULL`) is sent and flows through §4.1.*
  This pairs with §3.2's A1 filter (release invoices excluded from billed-coverage) so the same dollars
  are never both held-out AND re-counted, nor dropped entirely.
- **Pay apps:** fold in through the invoice each pay app generates (§2.5). **C1 (round-1 audit fix —
  prose corrected):** the pay-app invoice amount **is already net of retainage** — when a pay app is
  submitted it produces an SC invoice for `current_payment_due` (this-app amount **minus**
  `retainage_withheld`), so the invoice `amount` is the collectable-now (net) figure, NOT the gross
  this-app amount. It therefore lands in the forecast as collectable-now dollars directly, with no
  additional retention subtraction needed beyond the null-safe `COALESCE` above. No separate path.

### 4.6 "Paid removes the row" [LOCKED]
`paid_at NOT NULL` (set by status change or Stripe/QB webhook) auto-excludes the invoice from the
forecast — exactly Excel's "change status to Paid removes the row," but now automatic.

---

## 5. The three money cards — reconciliation [LOCKED — Chris-ratified 2026-06-17]

All three decisions accepted as recommended. Locked outcomes below.

### 5.1 Ready to Bill → **REPLACE** [LOCKED]
- The new triage worklist *is* "ready to bill," done properly: it self-populates from completed work
  and reconciles against real invoices, whereas the current card counts Complete-jobs-with-`billing_log`
  `<100%` — a percent proxy with no invoice link. The card's job is fully subsumed.
- **Locked:** keep the **tile** on the All Jobs screen as the entry point that **opens the worklist**;
  **retire the old percent view behind it** (the percent-based `/billing` 3-column view and the
  `billing_log` write path). Replace the destination, preserve the navigation affordance. `billing_log`
  itself stays read-only (not deleted) — see §7 / §8 item 2.

### 5.2 Production Complete → **SYNCHRONIZE** [LOCKED]
- This card is a legitimate **lifecycle/stage** signal — it answers "**is the work done**," a different
  question than "is it billed" — and is upstream of billing, so it is **kept**, not retired. But its
  "{readyToBill} ready to bill" footer currently reads the stale `billing_log` proxy.
- **Locked:** keep the card; **rewire** its "ready to bill" footer to the new worklist's **needs-triage
  count** so the two surfaces agree on one source. Card stays a stage filter (`?tab=complete`); only its
  money sub-stat changes source.
- **D2 (round-1 audit fix) — derive the footer count in the PARENT, not in `JobsPicker`'s `counts` memo:**
  the Production-Complete "{n} ready to bill" footer must be computed in the **parent component** that
  owns the worklist/needs-triage data and passed down as a prop — NOT inside `JobsPicker`'s `counts`
  memo (which today reads `billing_log`). Computing it in the memo would re-introduce a `billing_log`
  read on the very card we're trying to wean off the percent proxy. The parent reads the worklist
  needs-triage source (§3) and hands `JobsPicker` the finished number.

### 5.2a `billing_log` reader/writer census — all 9 sites the Replace/Sync rewire must touch [LOCKED — round-1 audit fix (D1)]
The round-1 audit found the rewire census understated at 2 sites; there are **9 enumerated
reader/writer sites** that touch `billing_log`. The Replace/Sync rewire (and the "stop writing
`billing_log`" decision, §7/§8 item 2) must address **every** one or the card numbers and the legacy
view will drift. Verified by grep over `src/` 2026-06-17:

| # | Site | Line(s) | Kind | Disposition in rewire |
|---|------|---------|------|-----------------------|
| 1 | `src/components/JobCardList.jsx` | 126 | **WRITE** (insert — "Add to Bill List" percent input) | Remove write; route the affordance to the new worklist (anti-pattern, §5.1/§7) |
| 2 | `src/components/JobCardList.jsx` | 136 | READ (select) | Retire with the percent input it feeds |
| 3 | `src/lib/exports.js` | 110 | READ (select — Billing Report export) | Re-point to worklist/invoice source, or retire the percent export |
| 4 | `src/views/JobDetail.jsx` | 76 | READ (select — per-job billing history) | Keep READ-ONLY (history view); no new writes — `billing_log` stays read-only |
| 5 | `src/views/Jobs.jsx` | 191 | READ (select — feeds JobsPicker counts) | This is the read that powers the percent proxy; rewire to worklist needs-triage (D2) |
| 6 | `src/components/JobsPicker.jsx` | 24–62 (`counts` memo: 44–49) | READ-CONSUMER (`readyToBill` percent proxy + Production-Complete footer) | Replace percent proxy; footer count derived in PARENT (D2), not in this memo |
| 7 | `src/views/Billing.jsx` | 94 | READ (select — 3-column pipeline) | Retired with the percent view (§5.1) |
| 8 | `src/views/Billing.jsx` | 239 | **WRITE** (insert — `confirmBill`) | Remove write (stop writing `billing_log`, §8 item 2) |
| 9 | `src/views/Billing.jsx` | 290 / 303 / 314 / 324 | **WRITE/READ** (`markInvoiced` + status updates) | Remove writes; retired with the percent view |

**Disposition summary:** writers (#1, #8, #9) are removed — no new `billing_log` writes anywhere
(§D3 anti-pattern). Pipeline readers (#2, #6, #7) are retired/rewired to the worklist + invoice
sources. #4 (JobDetail history) and the table itself stay **READ-ONLY, not deleted** (§7/§8 item 2).
#3 (export) and #5 (Jobs→JobsPicker feed) re-point to the worklist source. Nothing is left pointing at
the old percent model as a live source.

### 5.3 Budget → **INFUSE (DEFERRED to fast-follow)** [LOCKED — round-1 audit fix (D4)]
- Budget is a pure placeholder (renders `—`, stub view). It is a different question from billing:
  *margin/cost* (revenue − cost), not *cash timing*. The new tool's revenue + invoiced-to-date data
  *could* infuse the revenue/billed side of Budget, but Budget's cost side still needs Field Command DPR
  actuals (labor/materials) that this tool does not provide.
- **D4 (round-1 audit fix) — Budget infuse is DEFERRED out of v1.** v1 **leaves Budget as-is** (the
  `—` placeholder / stub view, untouched). The revenue-side infuse moves to the **fast-follow**
  alongside `weekly_billing_snapshot` (§6.2). Rationale: v1's load-bearing surfaces are the triage
  worklist + forecast + the Ready-to-Bill/Production-Complete rewire; the Budget infuse is independent
  of those, touches a different view, and adds scope without unblocking the prize. Design intent (when
  built): infuse revenue/billed side from real invoices; margin (revenue − cost) stays DPR-gated.
  "This tool replaces Budget" remains explicitly rejected.

> **Chris ratification table** — RATIFIED 2026-06-17 (Budget row amended by round-1 audit, D4):
>
> | # | Card | Decision | Rationale (short) | Chris's take |
> |---|---|---|---|---|
> | 1 | Ready to Bill | **Replace** | Worklist subsumes it; keep tile→opens worklist, retire old percent view | ✅ Accept |
> | 2 | Production Complete | **Synchronize** | Keep stage card ("is work done"), rewire money footer to worklist needs-triage count (count derived in PARENT, D2) | ✅ Accept |
> | 3 | Budget | **Infuse — DEFERRED to fast-follow (D4)** | v1 leaves Budget as-is; revenue-side infuse moves to fast-follow with `weekly_billing_snapshot`; margin/cost stays DPR-gated | ✅ Accept (v1 = no Budget change) |

---

## 6. Minimal new persistence Schedule must own [shape LOCKED 2026-06-17, pattern LOCKED]

Everything auto-derivable (Sent / Sent-to-QB / Paid / amounts / expected dates) is **read-only from
canonical tables — store nothing**. Schedule writes back ONLY operational judgment + the per-invoice
terms override. **v1 ships ONE new table (`billing_worklist`)**; `weekly_billing_snapshot` is designed
below but **deferred to a fast-follow** (§6.2).

### 6.1 `billing_worklist` — per-job operational state (the manual overrides) [LOCKED, v1]
One row per job that needs a manual flag (sparse; absence = "no override").
```
billing_worklist:
  id              uuid PK default gen_random_uuid()
  job_id          int8 NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE
  hold_sales      boolean NOT NULL DEFAULT false
  hold_reason     text
  nothing_to_bill boolean NOT NULL DEFAULT false
  terms_override  int                       -- LOCKED: per-invoice/job terms override (15/30/45/60/75/90);
                                            --   null = use customers.billing_terms default (§4.2)
  chris_notes     text                      -- the Excel "Chris Notes" column
  created_at      timestamptz NOT NULL DEFAULT now()
  updated_at      timestamptz NOT NULL DEFAULT now()   -- set_updated_at() trigger
```
**Key (locked): `job_id`** — matches every other Schedule child table (`billing_log`, `materials`)
and the existing audit chain. **`terms_override` is locked IN** (real GCs vary terms by job, §4.2);
it is the persistence home for the per-invoice override and takes precedence over the customer default.
Constrain to the allowed set (15/30/45/60/75/90) via a CHECK, or NULL.

### 6.2 `weekly_billing_snapshot` — the Monday-tab ritual [DESIGN LOCKED, DEFERRED to fast-follow]
**Decision (locked): v1 ships a LIVE derived worklist (always current) — this table is NOT built in
v1.** It is designed here so the fast-follow has a ready spec, but the live view + `job_changes` audit
is sufficient for v1. Build it only when Chris wants frozen per-Monday history.
```
weekly_billing_snapshot:   -- DEFERRED (fast-follow, not v1)
  id            uuid PK default gen_random_uuid()
  week_start    date NOT NULL              -- Monday
  job_id        int8 REFERENCES jobs(job_id) ON DELETE CASCADE
  status_label  text                       -- the resolved status at snapshot time
  amount        numeric                    -- amount triaged that week
  notes         text
  created_at    timestamptz NOT NULL DEFAULT now()
  UNIQUE (week_start, job_id)
```

### 6.3 RLS pattern (LOCKED — copy from `20260512120100_job_wtcs_create.sql`)
`jobs` has **no `tenant_id` column**; sch-command child tables scope tenant via the
`jobs → call_log.tenant_id` chain, NOT a local `tenant_id` default+FK. Follow `job_wtcs` exactly:
- `ENABLE ROW LEVEL SECURITY`.
- 4 policies (select/insert/update/delete) each `EXISTS (SELECT 1 FROM jobs j JOIN call_log cl ON
  cl.id = j.call_log_id WHERE j.job_id = <tbl>.job_id AND cl.tenant_id = public.get_user_tenant_id())`.
- `set_updated_at()` BEFORE UPDATE trigger. **E1 (round-1 audit fix) — inline the function in the
  migration:** rather than gating the build on verifying `set_updated_at()` already exists in this
  schema, the migration **inlines `CREATE OR REPLACE FUNCTION public.set_updated_at()`** (idempotent —
  `CREATE OR REPLACE` is safe whether or not it already exists) before creating the trigger. This
  removes the unverified-existence dependency entirely:
  ```sql
  CREATE OR REPLACE FUNCTION public.set_updated_at()
  RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
  ```
  Then `CREATE TRIGGER ... BEFORE UPDATE ON billing_worklist ... EXECUTE FUNCTION public.set_updated_at();`
- Wrap in `BEGIN/COMMIT`, `IF NOT EXISTS` guards, 14-digit timestamp.

> NOTE [LOCKED]: the RLS+tenant_id "4 standard policies, tenant_id default+FK" pattern in
> MEMORY/project_rls_pattern.md is the **sales-command** pattern (those tables own `tenant_id`).
> sch-command's `jobs`-child tables use the **call_log-chain** pattern instead. Use the chain pattern
> here.

### 6.4 Writes go through the data layer [LOCKED; signature pinned + anti-pattern round-1 audit (D3)]
All `billing_worklist` writes route through a new `queries.js` helper that audit-logs to `job_changes`,
matching `updateJobField`. **D3 (round-1 audit fix):**
- **Pinned signature (LOCKED):** `setBillingWorklistFlag(jobId, field, value, changedBy)` — `field` ∈
  {`hold_sales`, `hold_reason`, `nothing_to_bill`, `terms_override`, `chris_notes`}; upserts the sparse
  `billing_worklist` row keyed on `job_id` and writes a `job_changes` audit row (old→new) for the field.
- **Anti-pattern to REMOVE:** raw `supabase.from('billing_log').insert(...)` and any raw
  `supabase.from('billing_worklist').update()/insert()` **in views** is explicitly called out as an
  anti-pattern (the legacy `JobCardList.jsx:126` and `Billing.jsx:239` `billing_log` inserts are
  exactly this — see §5.2a #1/#8). No raw cross-table writes in views; everything goes through the
  audit-logged queries.js helper (repo convention).

### 6.5 Migration deploy path [LOCKED]
`supabase db push` does NOT work from sch-command (shared ledger, ~60 sibling migrations). Per
sch-command CLAUDE.md: write the file → `node scripts/check-migration-collision.mjs` (clear timestamp)
→ paste SQL into Supabase dashboard SQL editor → `supabase migration repair --status applied <ts>`.
Coordinate timestamp with sales-command's open ledger (CLAUDE.md RESUME ALERT items 1–2).

**E2 (round-1 audit fix) — pin the timestamp AT BUILD START as a build-time step:** the migration's
14-digit timestamp is NOT chosen now (planning) — it is pinned **at the start of the build session** by
running `node scripts/check-migration-collision.mjs` against the live prod ledger, because
sales-command is actively pushing Multi-GC migrations to the shared ledger (RESUME ALERT item 2) and a
timestamp clear today can collide by build time (this repeats the 2026-05-12 collision if skipped). Add
this to the build's first steps: run the collision check, take the cleared value, then write the file.

---

## 7. Proposed architecture (summary) [DERIVED]

```
NEW Billing surface in Schedule Command (/billing, rebuilt)
├── Tab A: Weekly Triage Worklist
│     ├─ self-populates from jobs(completed/partial-this-week) LEFT JOIN canonical invoices
│     ├─ auto status: Paid / Sent-to-QB / Sent / All-Ready-Billed   ← READ invoices
│     ├─ manual status: Hold-Sales / Nothing-to-bill / notes        ← WRITE billing_worklist
│     └─ bottom line: "Total to Bill This Week"
├── Tab B: 90-Day Cash-Flow Forecast  ★ the prize
│     ├─ READ invoices (sent, unpaid, non-void) JOIN customers.billing_terms JOIN tenant_config (C6)
│     │    via loadAllRows pagination (C3)
│     ├─ expected pay date = terms_override(sent_at) ?? due_date ?? sent_at + COALESCE(terms…)  (per §4.2, C4)
│     ├─ buckets: PAST-DUE (overdue unpaid, C5) + weekly (today→+90d): Σ expected inflow + count
│     ├─ net-of-retention via − COALESCE(retention_amount,0) (C2); releases = own future invoices;
│     │    retention counted exactly once (C7)
│     └─ Select-Week drill-down → collections call list
└── Data layer: queries.js gains loadInvoicesForForecast() (via loadAllRows), loadBillingWorklist(),
      setBillingWorklistFlag(jobId, field, value, changedBy) (audit-logged). NO invoice writes —
      read-only on Sales tables.

Cards (JobsPicker):
  Ready to Bill   → REPLACE  (tile routes to Tab A; retire billing_log percent view)
  Production Comp. → SYNC    (keep stage card; footer "needs triage" count derived in PARENT, D2)
  Budget          → NO CHANGE in v1 (INFUSE DEFERRED to fast-follow, D4)
```

**§7 expected-pay-date one-liner reconciled to §4.2 (C4):** the prior one-liner
`expected pay date = due_date ?? sent_at + terms` contradicted §4.2's locked precedence (where
`terms_override` wins over `due_date`). It now reads, consistent with §4.2:
`terms_override applied to sent_at  ??  due_date  ??  sent_at + COALESCE(billing_terms, default_billing_terms, 30)`.

**Build sequencing [LOCKED — round-1 audit fix (D5)]:** lift `getMonday`/`fmtWk` out of `Billing.jsx`
into a shared lib (e.g. `src/lib/weeks.js`) **as the first build step, BEFORE retiring/rebuilding
`Billing.jsx`**, so the forecast (Tab B) and worklist (Tab A) import them from the shared lib rather
than from the view being torn down. (Note: copies of these helpers also exist in several other views —
exports.js, Schedule.jsx, Daily.jsx, etc. — but only the `Billing.jsx` copy is load-bearing for this
rebuild; consolidating the rest is out of scope for v1.)

Legacy handling [LOCKED — Chris-ratified 2026-06-17]: stop writing to the percent-based `billing_log`
model, retire the current `Billing.jsx` 3-column view + `JobCardList`'s "Add to Bill List" percent
input behind the new worklist. **The rewire must touch all 9 enumerated `billing_log` sites (§5.2a)** —
removing the 3 writers and rewiring/retiring the 6 readers — so no card or export drifts.
**`billing_log` is kept READ-ONLY (no new writes); the table is NOT deleted.** Retire it fully only
after the new surface is proven (reversible decision). `jobs.amount` remains display-only and is
**never** authoritative (§3.2). **Budget is left unchanged in v1 (infuse deferred, §5.3 / D4).**

---

## 8. Decision queue — RATIFICATION STATUS (updated 2026-06-17)

**RESOLVED / LOCKED (Chris-ratified 2026-06-17):**

1. ✅ **Cards (§5):** **Replace** Ready-to-Bill (tile→opens worklist, retire old percent view) ·
   **Synchronize** Production-Complete (keep stage card, rewire footer to worklist needs-triage count,
   footer count derived in PARENT per D2) · **Budget: INFUSE DEFERRED to fast-follow (round-1 audit D4)
   — v1 leaves Budget as-is**; revenue-side infuse moves to the fast-follow with `weekly_billing_snapshot`.
2. ✅ **Legacy billing_log (§1.2, §3.2, §7):** keep **READ-ONLY, stop writing to it; do NOT delete**
   the table. Retire fully after the new surface is proven (reversible).
3. ✅ **"Fully billed" authority (§3.2):** **`billing_schedule.contract_sum` (SOV) where it exists,
   else proposal `total`.** `jobs.amount` is the legacy placeholder and is **never** authoritative.
6. ✅ **Forecast retention (§4.5):** **NET of retention** — expected-inflow counts only collectable-now
   dollars; retention is a separate bucket/line, appearing as inflow when released.
7. ✅ **Per-invoice terms override (§4.2/§6.1):** default from `customers.billing_terms` **plus** a
   per-invoice override (15/30/45/60/75/90), persisted to `billing_worklist.terms_override`.
8. ✅ **Weekly snapshot (§6.2):** v1 ships the **LIVE derived worklist** (always current);
   `weekly_billing_snapshot` is designed but **deferred to a fast-follow**, not built in v1.

**STILL OPEN (not ratified this pass):**

4. **Completion signal (§3.3):** keep Excel's "end date this week" trigger, or upgrade to
   DPR-approved / WTC-complete?
5. **Portal-submitted nuance (§3.1):** fold "submitted to customer portal" into "Sent to QB" (no new
   field), or track it separately?
9. **Who sets Hold–Sales (§3, role-gating):** role-gated (sales only) per the role-gating memory, or
   open to all Schedule users?

### 8.1 Round-1 audit response (applied 2026-06-17)
Chris RATIFIED **Option 1** — patch the fully-billed / status-derivation logic in v1 (NOT deferred).
Applied this pass (all newly-decided fixes are [LOCKED — round-1 audit fix]):
- **A1–A5, B1–B3** (§3/§3.0a/§3.2/§3.3): retention-release excluded from billed sum; authoritative_total
  gated on `contract_sum > 0` else proposal `total`; sent-only coverage; live non-archive proposal
  selection; `max(sent_at)` for prior-week; CO = own call_log/own row; one-row-per-call_log grain;
  fully-billed dominates Paid in resolution order.
- **C1–C7** (§4): pay-app net prose corrected; `COALESCE(retention_amount,0)`; `loadAllRows` pagination;
  §7↔§4.2 precedence reconciled; past-due bucket; `COALESCE` terms chain + `tenant_config` join;
  retention-counted-once invariant.
- **D1–D5** (§5/§7): 9-site `billing_log` census (§5.2a); Production-Complete footer derived in parent;
  raw-insert anti-pattern + pinned `setBillingWorklistFlag` signature; **Budget infuse DEFERRED**;
  `getMonday`/`fmtWk` lifted to shared lib before Billing.jsx rebuild.
- **E1–E4** (§6/§9): inline `CREATE OR REPLACE set_updated_at()`; collision check at build start;
  `jobs.deleted` filter on population; `customers.billing_terms`-populated verify retained.
- **RLS:** §9 cross-tenant read marked **RESOLVED / CONFIRMED SAFE**.

### 8.2 Adjacent findings — to file (round-1 audit)
3 adjacent (NOT caused-by) findings from the round-1 audit are pending backlog filing — **text to come
from the audit terminal** (not yet provided here; do not invent). File as 3 backlog rows once their
text is supplied.

## 9. Things to verify before build (cheap pre-build checks)

- ~~Confirm `set_updated_at()` trigger function exists~~ — **RESOLVED by E1 (round-1 audit):** the
  migration **inlines `CREATE OR REPLACE FUNCTION public.set_updated_at()`** (§6.3), so existence no
  longer needs verifying — no longer a blocker.
- **E2 (build-start step, not a pre-check):** run `node scripts/check-migration-collision.mjs` AT BUILD
  START to pin a collision-free 14-digit timestamp against the live ledger (§6.5).
- Confirm whether ANY non-void live invoices have NULL `due_date` (drives whether the §4.2 fallback is
  load-bearing). Quick `SELECT count(*) ... WHERE due_date IS NULL AND voided_at IS NULL`. [still a
  cheap check — informational, not blocking]
- **E4 (retained):** Confirm `customers.billing_terms` is populated for active customers (else forecast
  leans on the 30-day default).
- **Cross-tenant RLS read — RESOLVED / CONFIRMED SAFE [round-1 audit, verified from policy SQL].**
  A Schedule **authenticated, same-tenant** user CAN SELECT Sales-owned `invoices` and `customers`:
  those tables' RLS authenticated SELECT policies are `tenant_id = public.get_user_tenant_id()`, which a
  same-tenant Schedule session satisfies (single shared tenant per the deployment context, HDSP). This
  is **no longer an open blocker** — the worklist + forecast WILL render against canonical Sales data.
- **E3 (population filter, locked in §3.3):** the worklist population query filters `jobs.deleted` so
  soft-deleted jobs never surface.
```

Confidence legend repeated for durability: [LOCKED] verified · [DERIVED] inferred · [DESIGN-OPEN]
Chris decides · [BLOCKED] not found / needs a query.

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-06-17 (round 2). Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
Round 1 found 24 issues and they're all addressed — but fixing them grew the plan by two-thirds. This
round is a tighter, verification-focused check: 3 reviewers confirm the fixes actually landed and that the
new logic added to fix them didn't introduce fresh bugs. If this round comes back as big as the last, that's
a signal we've over-built and should cut scope, not keep patching.

### Round
- Current round: 2
- Plan revision under audit: `3e07e89` (Plan revision pass 1) + this manifest commit
- Findings trend: round 1 (24: 2C/7H/11M/4L) → round 2 (?). **Plan grew 492 → 819 lines (+66%) in the round-1 response** — leading edge of scope creep; watch the round-2 count.

### Prior rounds
- Round 1: `3e07e89` · 2C/7H/11M/4L (24 caused-by + 3 adjacent) · pattern: `status-derivation-arithmetic`

**Briefing for agents**: do NOT re-find round-1 issues — `3e07e89`'s message + §8.1 are the canonical record of what was addressed (A1–A5, B1–B3, C1–C7, D1–D5, E1–E4; RLS confirmed safe; Budget infuse deferred). Attack ONLY material NEW to revision pass 1: the §3.0a grain/CO-row model, the reworked §3.2 predicate, the §4 forecast delta (past-due bucket, tenant_config join, COALESCE chains), the §5.2a 9-site census, and the inline `set_updated_at`. Verify the fixes are correct; find bugs the fixes introduced.

**Plateau signal**: ACTIVE WATCH. The round-1 response answered findings by ADDING mechanism (+66% plan growth) — the classic scope-creep pattern. Plateau forms if round 2 returns a count at or above round 1's 24. **If round 2 plateaus, `/runaudit` MUST present scope-cut as the ONLY build-prompt option** — specifically, falling back to the deferred-fully-billed path (the original Option 2: ship Needs-billing/Sent/Paid + forecast, defer All-Ready-Billed/fully-billed to a focused fast-follow). Do NOT hedge with "do the cut OR patch 13 more items."

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant onboarding blocked (F7).
- **Prod / staging / dev**: Schedule Command is in prod, but this billing surface is the placeholder — real billing is done off the Excel tool + QuickBooks today; not yet load-bearing.
- **Blocking feature flags**: `customers.requires_pay_app` routes pay-app vs. regular invoice.
- **Concurrency profile**: ≤5 (office staff); billing is effectively solo (Chris).

Cross-tenant findings cap at Med while `live_tenants == 1` (and the RLS read is now CONFIRMED SAFE — do not re-raise it). Multi-user race findings cap at Low while billing is solo. Theoretical attacks on a not-yet-live surface are not High.

### Time budget + finding cap
- **Time budget**: 240 min (unchanged; ERD lock set by Chris at `/erd-start`)
- **Finding cap**: 24 findings — but round 2 attacks only the delta, so expect well under that. A round-2 count near 24 IS the plateau signal above.

### Surface
- Total lines: 819 (was 492 at round 1)
- Sections: 12
- [LOCKED] decisions: 53 (was 45)
- [DESIGN-OPEN] items: 5
- [OPEN] items: 3 (§8 still-open: completion signal, portal nuance, Hold–Sales role-gating — unchanged through round 1)
- Plan-to-code ratio: ~819 plan : ~700–900 est code ≈ 1:1 — not scope-crept by the 50:1 rule, but the plan is now as large as the code it specifies (mild over-spec smell; see weak points).

### Layers touched (round-2 ATTACK surface — narrowed)
- State model / business logic (the NEW §3.0a grain + CO-row model; reworked §3.2 predicate)
- Data layer (forecast §4 delta: past-due bucket, tenant_config join, COALESCE, loadAllRows pagination)
- UI / components (§5.2a 9-site census; parent-derived Production-Complete footer)
- Migrations / schema (inline `CREATE OR REPLACE set_updated_at`; `jobs.deleted` filter)
- (RLS / multi-tenancy — RESOLVED round 1, OUT of scope; do not re-attack)

### New mechanisms introduced (by revision pass 1 — the round-2 targets)
- Grain model: §3.0a one-row-per-`call_log` aggregate + CO-as-separate-call_log-child = own worklist row
- Reworked predicate: `authoritative_total` gated on `contract_sum > 0 ?? proposals.total`, live non-archive proposal selection, `max(sent_at)` prior-week test
- Forecast: past-due bucket; `tenant_config` join for default-terms fallback; `COALESCE(retention_amount,0)`
- Migration: inline `CREATE OR REPLACE FUNCTION set_updated_at()`
- Census: §5.2a enumeration of 9 `billing_log` reader/writer sites
- Footer: Production-Complete count derived in parent component

### Cross-system reach
- Reads 6 Sales-owned tables: `invoices`, `customers`, `call_log`, `proposals`, `billing_schedule`, `billing_schedule_pay_apps` (now incl. `tenant_config` for the terms fallback)
- Migration on the shared ledger while sales-command is mid-sprint on Multi-GC (collision risk; RESUME ALERT)
- No service-role bypass; authenticated same-tenant RLS read CONFIRMED SAFE (round 1)

### Irreversibility
- New migration — additive (new table + inline function); reversible
- `billing_log` retirement — kept READ-ONLY, NOT deleted; reversible
- Shared-ledger timestamp must be collision-free (pinned at build start, §6.5/E2)
- No destructive backfill

### Known weak points
- **Scope creep — plan grew +66% in one revision** (§8.1) — round-1 fixes added mechanism (§3.0a, §5.2a, past-due bucket). This is the leading edge of plateau; if round 2 is large, cut to the Option-2 defer rather than patch further.
- **§3.0a grain/CO-row model is NEW and unverified** — CO-as-separate-row + one-row-per-call_log aggregate is freshly introduced; attack it for its own aggregation/double-count bugs (e.g., a job with 2 COs now yields 3 worklist rows — is fully-billed computed per-row correctly?).
- **Past-due bucket vs counted-once invariant** (C5 + C7) — does adding a past-due bucket preserve "retention counted exactly once"? Could an overdue retention-held invoice land in two buckets?
- **9-site census completeness** (§5.2a) — claims exactly 9 `billing_log` reader/writer sites; a missed 10th site = silent drift. Grep-verify exhaustiveness.
- **3 adjacent findings still unfiled** (§8.2 stub) — text pending from the audit terminal; not yet in the plan or a backlog.
- **set_updated_at inline idempotency** (E1) — `CREATE OR REPLACE` in a shared DB: confirm it doesn't clobber a differing sibling-owned definition.

### Open questions
- Count: 3 (see §8 STILL OPEN — unchanged through round 1)
- Highest-pressure: (a) **completion signal** (§3.3 — drives the entire worklist population); (b) whether the §3.0a CO-row grain interacts correctly with the completion signal (a CO completing independently of its parent).

### Suggested attack angles (3 total)
1. **Status-derivation & grain verification** — covers state model + business logic. Required reading: §3, §3.0a, §3.2, §3.3, §8.1. Specific pressure: confirm A1–A5/B1–B3 actually resolve as written; attack the NEW §3.0a grain — CO-as-separate-row correctness, multiple-invoices-into-one-row aggregation, fully-billed-dominates-Paid ordering edge cases, archive-vs-live proposal selection when a call_log has several.
2. **Forecast delta correctness & scale** — covers data layer + perf. Required reading: §4.1–4.6, §7. Specific pressure: past-due bucket logic + its interaction with the counted-once invariant (C5×C7), `tenant_config` join actually resolves the default-terms fallback (C6), `COALESCE` chains null-safe, `loadAllRows` pagination wired (C3), §7-vs-§4.2 precedence reconciliation holds (C4).
3. **Card-rewire census & migration delta** — covers UI + migrations + audit logging. Required reading: §5, §5.2a, §6, §7. Specific pressure: is the §5.2a 9-site `billing_log` census actually exhaustive (hunt for a 10th reader); parent-derived footer reads the worklist source not the memo (D2); inline `set_updated_at` idempotency/no-clobber (E1); `jobs.deleted` filter on population (E3); confirm no raw `billing_log` inserts survive (D3).

### Suggested agent count: 3

Rationale: round 2 attacks only the bounded delta from revision pass 1, and RLS resolving drops an angle vs round 1's 4; three angles (status/grain, forecast, card+migration) cover the entire changed surface without overlap. A 4th would have to re-attack resolved RLS or split the forecast/card work artificially.
