# Billing Triage + 90-Day Cash-Flow Forecast — Integration Plan

**Repo:** sch-command (Schedule Command) · **Branch:** `feat/billing-forecast`
**Status:** DESIGN/PLANNING only. No code yet. Card + technical decisions **RATIFIED by Chris 2026-06-17** (§5 cards, §8 items 2–8) — moved to [LOCKED]. **Round-1 audit response applied 2026-06-17 (Option 1 — patch status-derivation in v1; see §8.1):** A1–A5/B1–B3 status-derivation arithmetic, C1–C7 forecast, D1–D5 card rewire, E1–E4 migration all [LOCKED — round-1 audit fix]; cross-tenant RLS read CONFIRMED SAFE (§9); Budget infuse DEFERRED to fast-follow. **Round-2 audit response applied 2026-06-17 (Option 1 continues; see §8.1a): REG-1/2/3 corrected 3 regressions where pass-1 asserted wrong code facts (pay-app GROSS amount, canonical `getMonday` copy, count-in-memo); N1–N10 added (discount in net formula, zero-invoice proposal selection, fully-billed-paid-this-week, `tg_set_updated_at` clobber-avoidance, `loadAllRows` signature, gross-of-partials past-due, + 4 cleanups) — all [LOCKED — round-2 audit fix], re-verified against live source.** Remaining open items: completion signal (§3.3), portal nuance (§3.1), Hold–Sales role-gating (§9-queue).
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

**N3 — close the fully-billed-AND-paid-in-CURRENT-week hole (round-2 audit fix).** The B3 ordering
split fully-billed coverage (row 1) from the prior-week recency clause (A5). That left a gap: a job
that is **fully covered by sent invoices AND those are all paid, but the most-recent send was in the
CURRENT week** fails row 1's `max(sent_at) < current week` clause, and then could be read as either
row 2 (Paid) or — if neither clause cleanly owns it — fall through to Needs-Triage. To close it,
**split the fully-billed terminal into two explicit, mutually-exclusive outcomes evaluated FIRST,
before per-invoice Paid/Sent**:
- **`fully_billed` is computed once** (coverage test, §3.2 — independent of send recency).
- If `fully_billed` is TRUE, the row resolves terminally to **All Ready Billed** regardless of which
  week the last send landed in (the A5 prior-week clause only governs the *cosmetic* "no action this
  week" label/sort, NOT whether the row is terminal). A fully-billed-and-paid-this-week job is **All
  Ready Billed**, not Paid, and never falls through to Needs-Triage.
- Only if `fully_billed` is FALSE do we evaluate rows 2–4 (Paid / Sent-to-QB / Sent) per-invoice.

So the resolution order is strictly: **`fully_billed`? → All Ready Billed (terminal). Else → Paid →
Sent-to-QB → Sent → manual flags → Needs-Triage.** No job is both classified twice nor dropped to
Needs-Triage while fully billed. **[LOCKED — round-2 audit fix]**

| # | Excel status | Source | Rule |
|---|---|---|---|
| 1 | **All Ready Billed** (fully billed) | AUTO | The job's authoritative value is fully covered by sent, non-void, non-deleted invoices (`fully_billed`, §3.2). **Terminal and evaluated FIRST** so it dominates a single-invoice Paid match (B3) AND a current-week paid send (N3). The A5 `max(sent_at) < current week` test is **cosmetic only** — it drives the "No action this week" label/sort, NOT whether the row is terminal; a fully-billed job whose last send was THIS week is still All Ready Billed, not Paid/Needs-Triage (N3). **[LOCKED — round-2 audit fix (A5/B3/N3)]** |
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

**N2 — ZERO-invoice multi-proposal rows (round-2 audit fix):** a job can have **no invoices yet but
multiple proposals** (e.g. archive + live, or multi-GC). With no invoices, the "match on
`proposal_id`" rule above has nothing to match — so the authoritative-total proposal selection must
**fall back to the live, non-archive proposal selection directly**: pick the proposal with
`is_archive_proposal = false` AND an active sold/signed `status` (`'Sold'`, or `'Signed'` once Multi-GC
ships). **Verified `is_archive_proposal` exists** (`~/sales-command/supabase/migrations/20260420140000_proposals_is_archive_proposal.sql`
— `boolean NOT NULL DEFAULT false`). If still ambiguous (multiple live non-archive proposals, no
invoices to disambiguate), the row is a Needs-Triage row with `authoritative_total` flagged unresolved
rather than silently summing against an archive total. Such a zero-invoice row can never be
"fully billed" (billed_total = 0), so it correctly surfaces as Needs-Triage. **[LOCKED — round-2 audit fix]**

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

### 3.4 Worklist cleanup rules (round-2 audit — Low) [LOCKED — round-2 audit fix]
Small correctness guards on what surfaces in the actionable worklist:
- **N7 — draft/un-sent invoices are never surfaced as billable/sent.** An invoice with `sent_at IS NULL`
  (status `New`/draft) is NOT "sent" and does NOT count toward billed coverage. This is already enforced
  by the A3 filter (`sent_at IS NOT NULL` in the billed-sum, §3.2) and the row-4 "Sent" rule, but make it
  explicit at the population/status layer: a job whose only invoices are drafts surfaces as
  **Needs-Triage** (work done, nothing actually sent), never as Sent/Sent-to-QB/All-Ready-Billed.
- **N8 — CO completion is picked up independently of the parent.** **Verified** a CO is its own
  `call_log` (`is_change_order = true`, own `co_number`, `parent_job_id`) with its own `jobs` row
  (sales-command schema). A CO can complete on a **different** schedule than its parent. The §3.3
  population query is keyed per-`call_log`/`jobs` row, so the **CO's own completion signal** (its
  `jobs.status='Complete'`/end-date-this-week/DPR) drives whether the CO row populates — the parent's
  completion state does NOT gate it. A completed CO with an un-completed parent still surfaces its own
  Needs-Triage row, and vice-versa. (Reinforces §3.0a B1's separate-row grain.)
- **N9 — suppress `$0-net` rows from the ACTIONABLE worklist.** A row whose entire net is withheld
  (fully-retention) or fully-discounted — i.e. `amount − COALESCE(discount,0) − COALESCE(retention_amount,0)
  = 0` — has nothing collectable to act on. Suppress such rows from the actionable Needs-Triage worklist
  (they carry no billable action this week). They remain visible in history/drill-down and the
  retention-held bucket (§4.5) when their release later produces a non-zero invoice; they are only hidden
  from the *actionable* list to avoid noise.

---

## 4. The 90-day cash-flow forecast [DERIVED, sources LOCKED]

### 4.1 Source query
Read canonical invoices, one row per non-void/non-deleted invoice that has been sent but not paid:
```
SELECT i.id, i.call_log_id, i.amount, i.discount, i.retention_amount, i.retention_release_of,
       i.sent_at, i.due_date, i.status,                 -- N1: discount selected for the net formula
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

**N5 — `loadAllRows` exact call signature pinned (round-2 audit fix). Verified against
`src/lib/queries.js:7–33`:** the signature is
`loadAllRows(tableName, selectStr, { orderBy, orderAsc = true, filterFn })`. Pin for
`loadInvoicesForForecast`:
- `tableName` = `'invoices'`.
- `selectStr` = the **embedded** PostgREST select string pulling the joins inline, e.g.
  `'id, call_log_id, amount, discount, retention_amount, retention_release_of, sent_at, due_date, status, tenant_id, call_log:call_log_id(display_job_number, customer_id, customers:customer_id(billing_terms)), tenant_config:tenant_id(default_billing_terms)'`
  (PostgREST embedded resources replace the SQL JOINs in §4.1; column names per §2/§4.1).
- `orderBy` = **REQUIRED** — `loadAllRows` throws `orderBy is required` if omitted
  (`queries.js:12`). Use a stable PK/`sent_at`, e.g. `orderBy: 'id'`.
- `filterFn` = a function `(chain) => chain.is('voided_at', null).is('deleted_at', null).is('paid_at', null).not('sent_at', 'is', null)`
  — it receives the query chain and returns it with the §4.1 WHERE filters applied
  (`queries.js:16` calls `filterFn(chain)` before `.order()`).
- Returns `{ data, error, partial }`; `partial: true` signals a truncated/error page — surface it as a
  "counts may be stale" warning like `Jobs.jsx` does.

Paging correctness is **verified at build** (the DEV chunk-repeat guard at `queries.js:23–26` warns if
`.range()` reuse breaks). **[LOCKED — round-2 audit fix]**

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

**N6 — partially-paid invoices in the past-due bucket (round-2 audit fix).** **Verified against the
invoices schema 2026-06-17:** `invoices` has **NO partial-payment / amount-paid / balance field** —
only `paid_at` (timestamptz, NULL until fully paid) and `amount` (the gross total). There is no
`amount_paid`/`balance_due` column (confirmed: sales-command CLAUDE.md invoices reference lists none;
no such ALTER in `~/sales-command/supabase/migrations/`). Therefore the DB cannot net out partial
payments — an invoice is binary (`paid_at` set ⇒ fully paid and dropped; `paid_at` NULL ⇒ counted at
its full net). So the past-due bucket's Σ is **explicitly GROSS-of-partial-payments**: it counts each
still-unpaid (`paid_at IS NULL`) overdue invoice at its full
`amount − COALESCE(discount,0) − COALESCE(retention_amount,0)` net, even if the GC has paid part of it
outside the system. **Label the past-due bucket "(gross of any partial payments — DB tracks no partial
amount)"** so the number is not mistaken for a precise collectable balance. If precise partial-payment
tracking is later needed, it requires a new `invoices` column (out of scope; note for backlog).
**[LOCKED — round-2 audit fix]**

**D5 (round-2 audit fix — REGRESSION corrected; round-1 prose was wrong about which copy is
canonical) — lift the CANONICAL `getMonday`/`fmtWk` into a shared lib, then reconcile the variants:**
**Verified by reading all 5 cited sites 2026-06-17:**
- **3-way IDENTICAL canonical form** lives in `src/lib/exports.js:3–21`, `src/views/Schedule.jsx:12–30`,
  `src/views/Daily.jsx:9–27`: `getMonday` = `const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
  dt.setDate(diff)`, and a matching `fmtWk(monday)` (Mon→+5 Sat range). This is the canonical form.
- `src/views/Billing.jsx:9–35` holds a **VARIANT** — `getMonday` = `const diff = (day === 0 ? -6 : 1)
  - day; dt.setDate(dt.getDate() + diff)` (functionally equivalent but a different expression), and a
  **richer `fmtWk`** that also accepts a string arg (`monday + 'T00:00:00'`). Do **NOT** lift Billing's
  variant.
- `src/components/JobsPicker.jsx:6` holds a **4th copy** — yet another `getMonday` variant
  (`dt.setDate(dt.getDate() - (day === 0 ? 6 : day - 1))`); JobsPicker has **no `fmtWk`**.

**Plan (corrected):** lift the **canonical exports.js form** of `getMonday`/`fmtWk` into a shared lib
(e.g. `src/lib/weeks.js`) **before** `Billing.jsx` is retired/rebuilt. Then **reconcile Billing.jsx's
variant to the canonical** (replace Billing's local copies with the shared import; preserve the
string-arg handling in the shared `fmtWk` so Billing's callers don't regress), and **account for the
4th copy at `JobsPicker.jsx:6`** (re-point it to the shared `getMonday`). The worklist + forecast
import from the shared lib, never from the doomed `Billing.jsx`. Sequencing is pinned in §7.
**[LOCKED — round-2 audit fix]**

### 4.4 Per-week drill-down [DERIVED]
"Select Week" → list invoices expected to pay that week (job #, customer, amount, sent date, terms,
expected date). This is the collections-call worklist. Direct port of the Excel forecast drill-down.

### 4.5 Retention + pay apps fold-in [LOCKED — Chris-ratified 2026-06-17; null-safety + prose patched round-1 audit]
- **Retention default is 5% (customizable per job)**, stored as `billing_schedule.retainage_pct`
  (default 5) and per-invoice as `invoices.retention_pct` / `retention_amount`. Forecast math uses
  the actual `retention_amount` on each invoice, not a hardcoded rate.
- **Uniform net formula (locked: forecast is NET of retention AND discount).** EVERY invoice's
  expected-inflow contribution uses the SAME formula — there is **no special pay-app path**:
  ```
  net = amount − COALESCE(discount, 0) − COALESCE(retention_amount, 0)
  ```
  Only collectable-now dollars. **C2 (round-1 audit fix):
  every place the forecast subtracts retention/discount uses `COALESCE(…, 0)`** so a NULL
  retention/discount column (regular non-retention invoices) nets to the full amount rather than
  producing `amount − NULL = NULL` and dropping the invoice from the inflow total. Retention withheld is
  **excluded** from the expected-inflow forecast and shown as its **own separate bucket/line** ("held
  retention / future release").
- **N1 — `discount` included (round-2 audit fix):** the net formula subtracts
  `COALESCE(invoices.discount, 0)` as well. **Verified against code:** `invoices.discount` exists
  (sales-command CLAUDE.md column reference: `invoices: id, job_id, …, amount, discount, sent_at, …`;
  and `NewPayAppModal.jsx:187` writes `discount: 0` on insert). A discounted invoice collects
  `amount − discount`, so the forecast inflow must net it out the same way it nets retention.
  **[LOCKED — round-2 audit fix]**
- A **retention release** invoice (`retention_release_of NOT NULL`) is its own invoice row with its
  own `sent_at`/`due_date`, so the released retention **appears as future inflow when released** —
  flowing through the normal §4.1 invoice path at that time.
- **C7 — counted-exactly-once invariant (round-1 audit fix):** retention is counted **exactly once**.
  Add this invariant as a code comment on the forecast math: *retention is EXCLUDED from inflow while
  held (netted out of its originating invoice via the `− COALESCE(retention_amount,0)` term), and
  COUNTED when its release invoice (`retention_release_of NOT NULL`) is sent and flows through §4.1.*
  This pairs with §3.2's A1 filter (release invoices excluded from billed-coverage) so the same dollars
  are never both held-out AND re-counted, nor dropped entirely.
- **Pay apps:** fold in through the invoice each pay app generates (§2.5) — via the **SAME uniform net
  formula above, with NO special-casing.** **C1 (round-2 audit fix — REGRESSION corrected; prior prose
  was inverted/self-contradictory):** **Verified against `~/sales-command/src/components/NewPayAppModal.jsx`
  lines 178–192:** when a pay app is submitted the SC invoice is inserted with
  `amount: grossThisBilling` (line 186 — the **GROSS** this-app amount, NOT net), `discount: 0`
  (line 187), and `retention_amount: retentionThisPeriod` (line 191 — the withheld retainage stored
  **separately** on the invoice). The pay-app invoice `amount` is therefore **GROSS, not net of
  retainage** — the round-1 prose claiming it "is already net of retainage" was **WRONG** and is
  removed. Because retention lives in `retention_amount`, the uniform formula
  `amount − COALESCE(discount,0) − COALESCE(retention_amount,0)` already nets it out correctly for
  pay-app invoices exactly as it does for regular invoices. **There is no separate pay-app forecast
  path and no special-case math** — the forecast arithmetic was already correct; only the rationale was
  inverted. **[LOCKED — round-2 audit fix]**

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
- **D2 (round-2 audit fix — corrected against code) — relocate the needs-triage count OUT of
  `JobsPicker`'s `counts` memo, WITHOUT adding an invoice join to the `/jobs` landing.**
  **Verified against `src/components/JobsPicker.jsx:23–62` and `src/views/Jobs.jsx:185–204`:** the
  `readyToBill` count (which feeds both the Ready-to-Bill tile and the Production-Complete
  "{readyToBill} ready to bill" footer) is computed **TODAY INSIDE `JobsPicker`'s `counts` memo**
  (`JobsPicker.jsx:44–49`): it reads the `billingLog` prop, sums `billing_log.percent` per `job_id`,
  and counts `Complete` jobs with `<100%`. The parent `Jobs.jsx:191` fetches `billing_log` via
  `supabase.from('billing_log').select('*')` in its `Promise.all` and passes it down as the `billingLog`
  prop. **(Round-1 prose wrongly claimed the count is "in the parent today" — it is in the memo.)**
  - **The rewire:** stop computing the count from the `billingLog` prop inside the memo. Compute the
    **needs-triage count from the worklist source (§3)** and pass it into `JobsPicker` as a finished
    prop (e.g. `needsTriageCount`), so the memo no longer reads `billing_log`.
  - **CRITICAL CONSTRAINT — keep the landing light (no invoice query on first paint):** the `/jobs`
    landing must NOT add an `invoices` join/query. A full needs-triage computation needs the invoice
    join (§3.3), which is heavy. So the count must reach the footer **without** that join on first
    paint. Options (pick at build, do NOT join invoices into `Jobs.jsx`'s landing `Promise.all`):
    (a) **derive the count lazily** — render the footer count from a lightweight already-loaded signal
    on first paint (e.g. count of `Complete` jobs with no `billing_worklist` resolution flag), and
    hydrate the exact invoice-reconciled number only when the worklist surface itself is opened; or
    (b) **a cheap server-side count** — a dedicated lightweight count read (not the full joined
    worklist payload) that returns just the integer, kept off the landing's critical render path.
    Either way the heavy `loadInvoicesForForecast`/worklist join stays on the worklist surface, NOT on
    the `/jobs` landing. **[LOCKED — round-2 audit fix]**

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
| 6 | `src/components/JobsPicker.jsx` | 24–62 (`counts` memo: 44–49) | READ-CONSUMER (`readyToBill` percent proxy + Production-Complete footer) — **count computed HERE in the memo today** (D2, verified) | Remove the `billing_log`-based count from the memo; pass needs-triage count in as a prop, computed off the worklist source without an invoice join on the landing (D2) |
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
> | 2 | Production Complete | **Synchronize** | Keep stage card ("is work done"), rewire money footer to worklist needs-triage count (count moved out of JobsPicker memo → prop; no invoice join on landing, D2 corrected round-2) | ✅ Accept |
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
  updated_at      timestamptz NOT NULL DEFAULT now()   -- public.tg_set_updated_at() trigger (sch-command-owned; NOT set_updated_at, §6.3/N4)
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
- BEFORE UPDATE `updated_at` touch trigger. **E1 (round-2 audit fix — REGRESSION corrected; round-1
  would have CLOBBERED a sales-owned function):** use sch-command's **own** trigger function
  `public.tg_set_updated_at()` — do **NOT** `CREATE OR REPLACE public.set_updated_at()`.
  **Verified against migrations 2026-06-17:**
  - sch-command's canonical updated_at function is `public.tg_set_updated_at()`, defined at
    `20260528120000_jobs_ready_confirmed_hold_reason_triggers.sql:37–40` and used by the `jobs` table's
    own `updated_at` trigger (line 45). Body: `BEGIN NEW.updated_at := now(); RETURN NEW; END;`.
  - The name `set_updated_at()` (no `tg_` prefix) is a **SALES-OWNED** function in the shared DB —
    referenced by `EXECUTE FUNCTION set_updated_at()` across `~/sales-command/supabase/migrations/`
    (`20260417140000_pay_apps.sql:57,195`, `20260416200000_materials_catalog.sql:30`,
    `20260416175646_billing_schedule_and_archive_links.sql:56,112`). A `CREATE OR REPLACE
    public.set_updated_at()` from sch-command would **replace a sibling-owned function body in the
    shared DB** — exactly the clobber risk. **Do not touch it.**
  - **Verified approach (no new function, no replace):** `tg_set_updated_at()` already exists in the
    shared DB (sch-command owns it), so the migration **references it directly** — no `CREATE`/`CREATE
    OR REPLACE` of any updated_at function is needed:
    ```sql
    CREATE TRIGGER billing_worklist_set_updated_at_trg
    BEFORE UPDATE ON public.billing_worklist
    FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
    ```
    (Guard with `DROP TRIGGER IF EXISTS billing_worklist_set_updated_at_trg ON public.billing_worklist;`
    first for re-runnability — matching the `jobs` trigger pattern at the same migration, lines 42–45.)
  **[LOCKED — round-2 audit fix]**
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
│     ├─ uniform net = amount − COALESCE(discount,0) − COALESCE(retention_amount,0) (C2/N1);
│     │    NO special pay-app path (pay-app amount is GROSS, C1); releases = own future invoices;
│     │    retention counted exactly once (C7)
│     └─ Select-Week drill-down → collections call list
└── Data layer: queries.js gains loadInvoicesForForecast() (via loadAllRows), loadBillingWorklist(),
      setBillingWorklistFlag(jobId, field, value, changedBy) (audit-logged). NO invoice writes —
      read-only on Sales tables.

Cards (JobsPicker):
  Ready to Bill   → REPLACE  (tile routes to Tab A; retire billing_log percent view)
  Production Comp. → SYNC    (keep stage card; move needs-triage count OUT of JobsPicker memo → prop,
                              NO invoice join on the /jobs landing, D2)
  Budget          → NO CHANGE in v1 (INFUSE DEFERRED to fast-follow, D4)
```

**§7 expected-pay-date one-liner reconciled to §4.2 (C4):** the prior one-liner
`expected pay date = due_date ?? sent_at + terms` contradicted §4.2's locked precedence (where
`terms_override` wins over `due_date`). It now reads, consistent with §4.2:
`terms_override applied to sent_at  ??  due_date  ??  sent_at + COALESCE(billing_terms, default_billing_terms, 30)`.

**Build sequencing [LOCKED — round-2 audit fix (D5, corrected)]:** lift the **CANONICAL**
`getMonday`/`fmtWk` (the 3-way-identical `exports.js`/`Schedule.jsx`/`Daily.jsx` form — verified, see
§4.3) into a shared lib (e.g. `src/lib/weeks.js`) **as the first build step, BEFORE retiring/rebuilding
`Billing.jsx`**, so the forecast (Tab B) and worklist (Tab A) import them from the shared lib rather
than from the view being torn down. **Correction to round-1 prose:** the helpers do NOT "currently live
in Billing.jsx" — Billing.jsx holds a *variant*, not the canonical. There are **4 copies** total
(`exports.js:3`, `Schedule.jsx:12`, `Daily.jsx:9` = identical canonical; `Billing.jsx:9` = variant;
`JobsPicker.jsx:6` = a separate 4th variant of `getMonday`). v1 lifts the canonical form, **reconciles
Billing.jsx's variant to it** (preserving Billing's string-arg `fmtWk` in the shared version), and
**re-points `JobsPicker.jsx:6`**. (Consolidating the remaining exports/Schedule/Daily copies onto the
shared import is a tidy-up that can ride along but is not load-bearing for the rebuild.)

Legacy handling [LOCKED — Chris-ratified 2026-06-17]: stop writing to the percent-based `billing_log`
model, retire the current `Billing.jsx` 3-column view + `JobCardList`'s "Add to Bill List" percent
input behind the new worklist. **The rewire must touch all 9 enumerated `billing_log` sites (§5.2a)** —
removing the 3 writers and rewiring/retiring the 6 readers — so no card or export drifts.
**`billing_log` is kept READ-ONLY (no new writes); the table is NOT deleted.** Retire it fully only
after the new surface is proven (reversible decision). `jobs.amount` remains display-only and is
**never** authoritative (§3.2). **Budget is left unchanged in v1 (infuse deferred, §5.3 / D4).**

**N10 — replace the `jobs.billed_to_date` side-effect with the invoice-derived figure (round-2 audit —
Low) [LOCKED — round-2 audit fix].** **Verified against code 2026-06-17:** `jobs.billed_to_date` is
written today as a **side-effect of the percent model** — `Billing.jsx:250` (`confirmBill` →
`{ billed_to_date: String(newBilled) }`) and `Billing.jsx:322–332` (`markInvoiced` recomputes from
`billing_log` percent and writes via `auditUpdateJobField(jobId,'billed_to_date',…)`); it is then
read/edited as a percent in `Schedule.jsx:763`. Since those `billing_log` writers are removed (§5.2a
#7/#8/#9), the `billed_to_date` side-effect goes away with them. **Replace** it: wherever a billed-to-date
figure is still shown, derive it from the **invoice-dollar source** — `billed_total` per §3.2
(`Σ sent, non-void, non-deleted, non-retention-release invoice.amount`) — not from the retired
`billing_log` percent. Do not leave a stale `jobs.billed_to_date` percent as a live source; if any view
still needs the value, it reads the invoice-derived number.

---

## 8. Decision queue — RATIFICATION STATUS (updated 2026-06-17)

**RESOLVED / LOCKED (Chris-ratified 2026-06-17):**

1. ✅ **Cards (§5):** **Replace** Ready-to-Bill (tile→opens worklist, retire old percent view) ·
   **Synchronize** Production-Complete (keep stage card, rewire footer to worklist needs-triage count;
   count moved OUT of JobsPicker's `counts` memo to a prop, NO invoice join on the `/jobs` landing —
   D2 corrected round-2) · **Budget: INFUSE DEFERRED to fast-follow (round-1 audit D4) — v1 leaves
   Budget as-is**; revenue-side infuse moves to the fast-follow with `weekly_billing_snapshot`.
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

### 8.1a Round-2 audit response (applied 2026-06-17) — pattern: prose-patch-regressions
Round-2 verification-pass (0C/4H/5M/4L). **Pass 1 regressed 3 fixes by asserting wrong code facts;**
this pass re-verified every claim against live source before patching. All new fixes are
**[LOCKED — round-2 audit fix]**.
- **REGRESSIONS corrected (re-verified against code):**
  - **REG-1 (§4.5/C1):** `NewPayAppModal.jsx:186` writes the pay-app invoice `amount` **GROSS**
    (`grossThisBilling`), with retention separate in `retention_amount` (line 191). The round-1 claim
    that pay-app amount "is already net of retainage" was inverted — removed. There is **no special
    pay-app path**; the uniform net formula handles it.
  - **REG-2 (§4.3/§7/D5):** canonical `getMonday`/`fmtWk` is the 3-way-identical
    `exports.js`/`Schedule.jsx`/`Daily.jsx` form; `Billing.jsx:9` is a VARIANT and `JobsPicker.jsx:6` is
    a 4th copy. Lift the canonical (exports.js), reconcile Billing's variant, re-point JobsPicker —
    round-1's "helpers live in Billing.jsx, only that copy matters" was wrong.
  - **REG-3 (§5.2/D2):** the needs-triage/`readyToBill` count is in `JobsPicker`'s `counts` memo TODAY
    (`JobsPicker.jsx:44–49`), not the parent. Relocate it to a prop fed from the worklist source WITHOUT
    adding an invoice join to the `/jobs` landing.
- **NEW (High/Med):** N1 `discount` in net formula (`invoices.discount` verified to exist) · N2
  zero-invoice multi-proposal authoritative_total via live non-archive selection · N3 fully-billed-AND-paid-
  this-week classified as All-Ready-Billed (no fall-through) · N4 use sch-command's own
  `tg_set_updated_at()` — do NOT `CREATE OR REPLACE` the sales-owned `set_updated_at()` (clobber risk) ·
  N5 `loadAllRows(tableName, selectStr, {orderBy, orderAsc, filterFn})` signature pinned · N6 past-due
  bucket labeled gross-of-partials (no partial-payment column on `invoices`).
- **CLEANUP (Low):** N7 drafts not surfaced as sent · N8 CO completion picked up independently · N9
  suppress `$0-net` rows from actionable worklist · N10 replace `billed_to_date` side-effect with
  invoice-derived figure.

### 8.2 Adjacent findings — to file
5 adjacent findings (3 from round 1 + 2 from round 2) pending backlog filing — text to come from the
audit synthesis. File as backlog rows once their text is supplied. (Do not invent their text.)

## 9. Things to verify before build (cheap pre-build checks)

- ~~Confirm `set_updated_at()` trigger function exists~~ — **RESOLVED by E1, corrected round-2 (N4):**
  the migration references sch-command's **own** `public.tg_set_updated_at()` (already exists, verified
  at `20260528120000_…:37`, used by the `jobs` table). No `CREATE OR REPLACE` of any updated_at
  function — avoids clobbering the sales-owned `set_updated_at()`. No longer a blocker.
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
- **5 adjacent findings still unfiled** (§8.2 — 3 round-1 + 2 round-2) — text pending from the audit synthesis; not yet in the plan or a backlog.
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
