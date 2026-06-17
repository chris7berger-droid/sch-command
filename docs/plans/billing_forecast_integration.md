# Billing Triage + 90-Day Cash-Flow Forecast — Integration Plan

**Repo:** sch-command (Schedule Command) · **Branch:** `feat/billing-forecast`
**Status:** DESIGN/PLANNING only. No code yet. Card + technical decisions **RATIFIED by Chris 2026-06-17** (§5 cards, §8 items 2–8) — moved to [LOCKED]. Remaining open items: completion signal (§3.3), portal nuance (§3.1), Hold–Sales role-gating (§9-queue).
**Author:** planning agent · **Date:** 2026-06-17

Goal: rebuild Chris's proven Excel billing tool natively in Schedule Command's billing surface —
(1) a **weekly billing triage worklist** that self-populates from completed scheduled work, with
auto-derived statuses; (2) a **90-day cash-flow forecast** driven off real invoice sent-dates +
payment terms; and (3) reconcile the three "All Jobs" money cards (Ready to Bill, Budget,
Production Complete) against this new surface.

Confidence tags on every section: **[LOCKED]** verified in code/schema · **[DERIVED]** inferred
from evidence · **[DESIGN-OPEN]** needs Chris's product decision · **[BLOCKED]** info not found.

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

| # | Excel status | Source | Rule |
|---|---|---|---|
| 1 | **Paid** | AUTO | An invoice for this call_log has `status='Paid'` (or `paid_at NOT NULL`), `voided_at IS NULL`, `deleted_at IS NULL`. Removes row from active worklist; drops from forecast. **[LOCKED]** |
| 2 | **✅ Invoice Sent to QB** | AUTO | Invoice exists with `qb_invoice_id NOT NULL` (posted to QB) — and, per Chris's note, also submitted through the customer's portal. `qb_invoice_id` is the DB-knowable half. Portal-submission is NOT in the DB → see §3.1. **[LOCKED for QB half / DESIGN-OPEN for portal half]** |
| 3 | **✅ Invoice Sent** | AUTO | Invoice exists with `sent_at NOT NULL` (or `status IN ('Sent','Waiting for Payment','Past Due')`), not yet QB-posted/paid. **[LOCKED]** |
| 4 | **All Ready Billed** | AUTO | Invoice(s) exist covering this job's scheduled value with no remaining billable balance, sent in a **prior** week (sent_at before current worklist week). "No action this week." **[DERIVED — needs a 'fully billed' definition, see §3.2]** |
| 5 | **❌ Hold – Sales** | MANUAL | Operational flag set by sales: do not invoice. Stored in `billing_worklist` (`hold_sales` + `hold_reason`) — **storage LOCKED (§6.1)**. **[DESIGN-OPEN — who can set it; role-gated? = queue item 9]** |
| 6 | **Nothing to bill** | MANUAL | Operational flag: no billable work this week. Stored in `billing_worklist.nothing_to_bill` — **storage LOCKED (§6.1)**. |

Plus the implicit Excel "no status yet" = **Needs Triage** (work done, no invoice, no manual flag) —
the actionable rows. **[DERIVED]**

### 3.1 The "submitted to portal" gap [BLOCKED → DESIGN-OPEN]
The DB knows `qb_invoice_id` (QB posting) but has **no field for "submitted through the customer's
payment portal."** Options: (a) treat QB-posted as the canonical "Sent to QB" and drop the portal
nuance; (b) add a manual `portal_submitted_at` to `billing_worklist`. Chris decides — most likely (a).

### 3.2 "Fully billed" definition [LOCKED — Chris-ratified 2026-06-17]
For statuses 3/4 we need "is this job's billable value exhausted?" **Authoritative total (locked):**
- **`billing_schedule.contract_sum` (SOV) where a billing schedule exists for the job's proposal**,
  **else the proposal `total`.**
- Schedule's `jobs.amount` string is the **legacy placeholder and must NEVER be authoritative** —
  it is for display only.
- For SOV/pay-app jobs, "fully billed" can also be confirmed via `billing_schedule` fully drawn
  (all lines 100%), which is consistent with the `contract_sum` basis above.

Rule: `fully_billed = Σ(non-void, non-deleted invoice.amount for call_log) ≥ authoritative_total`,
where `authoritative_total = billing_schedule.contract_sum ?? proposals.total`.

The legacy `billing_log` percent model is **retired** in favor of invoice-dollar reconciliation
(kept read-only, never written; see §5.1/§7).

### 3.3 Worklist population query (self-populating) [DERIVED]
"Jobs that had work and may need billing this week" =
```
jobs (status='Complete' OR scheduled_end within/near week OR partial_bill_date this week)
  LEFT JOIN canonical invoices on call_log_id
  - exclude no_bill='Yes'
  - exclude rows already 'Paid' / 'All Ready Billed'
  - surface rows with NO sent invoice as "Needs Triage"
```
This replaces the manual "copy schedule in" step. Production-complete + WTC-complete signals
(`job_wtcs`, `daily_production_reports` approved) refine "had work." **Exact completion signal is
[DESIGN-OPEN]** — Chris ran it off "end date this week"; we can keep that or upgrade to DPR-approved.

---

## 4. The 90-day cash-flow forecast [DERIVED, sources LOCKED]

### 4.1 Source query
Read canonical invoices, one row per non-void/non-deleted invoice that has been sent but not paid:
```
SELECT i.id, i.call_log_id, i.amount, i.retention_amount, i.sent_at, i.due_date, i.status,
       cl.display_job_number, cl.customer_id, c.billing_terms
FROM invoices i
JOIN call_log cl ON cl.id = i.call_log_id
LEFT JOIN customers c ON c.id = cl.customer_id
WHERE i.voided_at IS NULL
  AND i.deleted_at IS NULL
  AND i.paid_at IS NULL
  AND i.sent_at IS NOT NULL
```

### 4.2 Expected pay date [LOCKED — Chris-ratified 2026-06-17]
Resolution order (first non-null wins):
1. **`billing_worklist.terms_override`** (per-invoice/job override, 15/30/45/60/75/90) applied to
   `i.sent_at` when set. Real GCs vary terms by job, so this override **is in scope** — see §6.1.
2. `i.due_date` (already required at creation, so usually present). **[LOCKED present]**
3. Fallback: `i.sent_at + (customers.billing_terms || tenant_config.default_billing_terms || 30) days`.

Decision (locked): payment terms **default from `customers.billing_terms`** (which already lives in
the DB — Schedule stores no terms column at the customer level), **but the per-invoice override IS
supported** and persists to `billing_worklist.terms_override` (§6.1) — NOT on the Sales-owned invoice.
When `terms_override` is set, expected pay date = `sent_at + terms_override days`, taking precedence
over both `due_date` and the customer default.

### 4.3 Weekly buckets [DERIVED]
Bin expected-pay-dates into Monday-anchored weekly buckets spanning **today → today+90d**. Per bucket:
total expected inflow ($) + invoice count. Mirrors Excel's "Total to Bill This Week" but on the
*inflow* side. Reuse existing `getMonday`/`fmtWk` helpers already in `Billing.jsx`.

### 4.4 Per-week drill-down [DERIVED]
"Select Week" → list invoices expected to pay that week (job #, customer, amount, sent date, terms,
expected date). This is the collections-call worklist. Direct port of the Excel forecast drill-down.

### 4.5 Retention + pay apps fold-in [LOCKED — Chris-ratified 2026-06-17]
- **Retention default is 5% (customizable per job)**, stored as `billing_schedule.retainage_pct`
  (default 5) and per-invoice as `invoices.retention_pct` / `retention_amount`. Forecast math uses
  the actual `retention_amount` on each invoice, not a hardcoded rate.
- **Retention (locked: forecast is NET of retention).** Each invoice's expected-inflow contribution =
  `amount − retention_amount` — only collectable-now dollars. Retention withheld is **excluded** from
  the expected-inflow forecast and shown as its **own separate bucket/line** ("held retention /
  future release").
- A **retention release** invoice (`retention_release_of NOT NULL`) is its own invoice row with its
  own `sent_at`/`due_date`, so the released retention **appears as future inflow when released** —
  flowing through the normal §4.1 invoice path at that time. (No double counting: it was excluded
  while held, counted once when its release invoice is sent.)
- **Pay apps:** fold in through the invoice each pay app generates (§2.5). The pay-app invoice is
  already net of its `retainage_withheld`, so it lands in the forecast as collectable-now dollars
  consistent with the rule above. No separate path.

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

### 5.3 Budget → **INFUSE** [LOCKED]
- Budget is a pure placeholder (renders `—`, stub view). It is a different question from billing:
  *margin/cost* (revenue − cost), not *cash timing*. The new tool's revenue + invoiced-to-date data
  **infuses the revenue/billed side** of Budget, but Budget's cost side still needs Field Command DPR
  actuals (labor/materials) that this tool does not provide.
- **Locked:** **infuse** the revenue/billed side **now** from real invoices (real contract value +
  billed + expected inflow). **Margin (revenue − cost) stays gated on Field DPR cost data — out of
  scope for this pass.** "This tool replaces Budget" is explicitly rejected; they overlap on revenue,
  not on cost.

> **Chris ratification table** — RATIFIED 2026-06-17:
>
> | # | Card | Decision | Rationale (short) | Chris's take |
> |---|---|---|---|---|
> | 1 | Ready to Bill | **Replace** | Worklist subsumes it; keep tile→opens worklist, retire old percent view | ✅ Accept |
> | 2 | Production Complete | **Synchronize** | Keep stage card ("is work done"), rewire money footer to worklist needs-triage count | ✅ Accept |
> | 3 | Budget | **Infuse** | Feed revenue side now from real invoices; margin/cost stays DPR-gated, out of scope this pass | ✅ Accept |

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
- `set_updated_at()` BEFORE UPDATE trigger (confirm the function exists in this DB — it's used by
  sales-command tables; verify before relying on it, else port it).
- Wrap in `BEGIN/COMMIT`, `IF NOT EXISTS` guards, 14-digit timestamp.

> NOTE [LOCKED]: the RLS+tenant_id "4 standard policies, tenant_id default+FK" pattern in
> MEMORY/project_rls_pattern.md is the **sales-command** pattern (those tables own `tenant_id`).
> sch-command's `jobs`-child tables use the **call_log-chain** pattern instead. Use the chain pattern
> here.

### 6.4 Writes go through the data layer [LOCKED]
All `billing_worklist` writes route through a new `queries.js` helper (e.g.
`setBillingWorklistFlag(jobId, field, value, changedBy)`) that audit-logs to `job_changes`, matching
`updateJobField`. No raw `supabase.from('billing_worklist').update()` in views (repo convention).

### 6.5 Migration deploy path [LOCKED]
`supabase db push` does NOT work from sch-command (shared ledger, ~60 sibling migrations). Per
sch-command CLAUDE.md: write the file → `node scripts/check-migration-collision.mjs` (clear timestamp)
→ paste SQL into Supabase dashboard SQL editor → `supabase migration repair --status applied <ts>`.
Coordinate timestamp with sales-command's open ledger (CLAUDE.md RESUME ALERT items 1–2).

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
│     ├─ READ invoices (sent, unpaid, non-void) JOIN customers.billing_terms
│     ├─ expected pay date = due_date ?? sent_at + terms
│     ├─ weekly buckets (today→+90d): Σ expected inflow + count
│     ├─ net-of-retention; retention releases appear as their own future invoices
│     └─ Select-Week drill-down → collections call list
└── Data layer: queries.js gains loadInvoicesForForecast(), loadBillingWorklist(),
      setBillingWorklistFlag() (audit-logged). NO invoice writes — read-only on Sales tables.

Cards (JobsPicker):
  Ready to Bill   → REPLACE  (tile routes to Tab A; retire billing_log percent view)
  Production Comp. → SYNC    (keep stage card; footer reads worklist "needs triage")
  Budget          → INFUSE   (revenue from this tool; cost/margin stays DPR-gated)
```

Legacy handling [LOCKED — Chris-ratified 2026-06-17]: stop writing to the percent-based `billing_log`
model, retire the current `Billing.jsx` 3-column view + `JobCardList`'s "Add to Bill List" percent
input behind the new worklist. **`billing_log` is kept READ-ONLY (no new writes); the table is NOT
deleted.** Retire it fully only after the new surface is proven (reversible decision). `jobs.amount`
remains display-only and is **never** authoritative (§3.2).

---

## 8. Decision queue — RATIFICATION STATUS (updated 2026-06-17)

**RESOLVED / LOCKED (Chris-ratified 2026-06-17):**

1. ✅ **Cards (§5):** **Replace** Ready-to-Bill (tile→opens worklist, retire old percent view) ·
   **Synchronize** Production-Complete (keep stage card, rewire footer to worklist needs-triage count) ·
   **Infuse** Budget (revenue from real invoices now; margin/cost DPR-gated, out of scope this pass).
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

## 9. Things to verify before build (cheap pre-build checks) [BLOCKED until run]

- Confirm `set_updated_at()` (or equivalent) trigger function exists in the shared DB for sch-command's
  schema; if not, port it in the migration.
- Confirm whether ANY non-void live invoices have NULL `due_date` (drives whether the §4.2 fallback is
  load-bearing). Quick `SELECT count(*) ... WHERE due_date IS NULL AND voided_at IS NULL`.
- Confirm `customers.billing_terms` is populated for active customers (else forecast leans on the 30-day
  default).
- Confirm anon/authenticated RLS on `invoices`/`customers` lets a Schedule (authenticated, same-tenant)
  user SELECT — Schedule reads them directly. (sales-command policies are `tenant_id = get_user_tenant_id()`
  for authenticated, which should pass.)
```

Confidence legend repeated for durability: [LOCKED] verified · [DERIVED] inferred · [DESIGN-OPEN]
Chris decides · [BLOCKED] not found / needs a query.
