# Deposit Schedule Indicator — Cycle 2 (STARTER / pick-up here)

**Status:** NOT STARTED. This is a **fresh T1→T5 cycle** (plan → audit → build → buildvsplan → code-review). Do not build off this stub — it's a pointer for the next session.
**Repo:** sch-command. **Date filed:** 2026-06-22.

## Context
**Cycle 1 shipped** (2026-06-22): the deposit **tag** in sales-command — flag a job deposit-required, bill it with the existing flow, mark the invoice as the deposit. Merged to `main`, live on prod. See `~/sales-command/docs/plans/deposit_tag.md` (v2, one-field model).

Cycle 2 is the **Schedule side**: when a job shows up ready to schedule, show an **indicator** that the deposit invoice was **sent**, plus **how many days** have passed and the **due date** — because that drives when the job can start and when the company can pay for materials. **Informational, not a billing action.**

## Data contract (already live on the shared prod DB — ready to read)
sales-command added these to `call_log` (migration `20260621120000`, applied to prod):
- `call_log.deposit_required` (bool) — the flag
- `call_log.deposit_amount` (numeric) — the target figure
- `call_log.deposit_invoice_id` (text FK → invoices.id) — **the pointer to the deposit invoice**

State derives from the pointed invoice, **active-filtered**:
- **required** = `deposit_required` AND no active-sent deposit invoice
- **sent / due** = the deposit invoice has `sent_at` set, `voided_at IS NULL AND deleted_at IS NULL`, unpaid → show **days since `sent_at`** + `due_date`
- **paid** = the deposit invoice's `paid_at`

## Build notes for whoever picks this up
- `CALL_LOG_SELECT` (`src/lib/queries.js:67`) does **NOT** currently fetch the deposit columns — you must add them (and likely join/read the deposit invoice's `sent_at`/`due_date`/`paid_at`/`voided_at`/`deleted_at`).
- The existing `'deposit'` arm in `billingForecast.js` (`populationArm`) is the **old unbacked guess** ("Sold + nothing billed") — reconcile/replace it with the real pointer-based truth.
- Surface: the **scheduling-readiness** view (where a job appears to be scheduled), per Chris — not the billing worklist.

## Cross-refs
- Cycle 1 plan: `~/sales-command/docs/plans/deposit_tag.md` (v2).
- The original (superseded) billing-redesign framing: `billing_redesign_buildorder.md` §1 in this repo.
