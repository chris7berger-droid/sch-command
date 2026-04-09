# Handoff — Schedule Command

**Date:** 2026-04-09
**Last commit:** Sales Command → Schedule Command integration (Send to Schedule)

## What Was Done This Session (v4)

### 1. "Send to Schedule" Button — Sales Command
- Added button on ProposalDetail that appears when a proposal is Sold
- Gathers data from `call_log`, `proposal_wtc`, and `work_types`
- INSERTs a row into the shared `jobs` table with:
  - `job_num`, `job_name`, `amount` (numeric), `work_type`
  - `field_sow` (JSONB — day-by-day tasks, materials, crew, hours)
  - `sow` (sales_sow text), `start_date`, `end_date`, `prevailing_wage`
  - `size`, `size_unit` (from WTC)
  - `source_proposal_id`, `source_call_log_id` (dedup + linking)
- Duplicate-safe via unique index on `source_proposal_id`
- Button states: "Send to Schedule" → "Sending..." → "Sent to Schedule"
- On load, checks if already sent and shows correct state

### 2. Invoice Guard
- Blocks "Send to Schedule" if any invoice exists for the proposal
- Prevents scheduling work that's already been billed
- Go Backs (re-scheduling invoiced work) tagged for future session

### 3. QB Test Guard
- Any job with "test" in the name skips all QuickBooks API calls
- Covers: `qb-create-job` (ProposalDetail + PublicSigningPage),
  `qb-sync-invoice`, `qb-record-payment`, `qb-void-invoice` (Invoices)

### 4. Database Migrations (run in Supabase SQL Editor)
- `source_proposal_id` (text) + `source_call_log_id` (int8) on `jobs`
- Unique index on `source_proposal_id`
- `size` (numeric) + `size_unit` (varchar) on `jobs`

### 5. Field SOW Modal — Styled + Editable
- Added inline CSS so modal matches the print PDF layout
- Linen background (#c8bcaa) instead of white on day bodies
- Teal (#30cfac) on dark (#1c1814) pills for Expected Production %
- Added "Expected Production" column header for task percentages
- Added Size field to info bar (Work Type | Size | Lead | Start | End)
- Full material columns: Product, Kit Size, Qty, Mils, Mix Time, Mix Spd, Cure, Coverage
- Alternating row shading on materials for crew readability
- **Edit mode**: inline editing for all fields — tasks, materials, crew count, hours, day labels
- Add/remove tasks, materials, and entire days
- Save writes back to `jobs.field_sow` JSONB
- "Create Field SOW" button for jobs that don't have one yet

## Files Changed

### Sales Command (`sales-command`)
- `src/components/ProposalDetail.jsx` — Send to Schedule button, invoice guard, QB test guard
- `src/pages/Invoices.jsx` — QB test guard on sync, payment, edit, void
- `src/pages/PublicSigningPage.jsx` — QB test guard on customer signature

### Schedule Command (`sch-command`)
- `src/components/FieldSowModal.jsx` — full restyle + edit mode
- `src/views/Jobs.jsx` — pass `onUpdated` to FieldSowModal
- `add_source_columns.sql` — migration script (already run)

## Known Issues
- **SMTP password still empty** — forgot-password emails won't send
- **406 console error** — `.single()` → `.maybeSingle()` on team_members
- Test job (job_id 79) still in DB — delete when done testing
- Size field won't show on existing test job (sent before size columns added)

## What's Next
1. **Mobilizations** — replace direct crew-schedule entry with Jobs → Mobilization → Schedule flow
2. **Go Backs** — allow re-scheduling invoiced work with a Go Back flag
3. **Bug hunt** — go through all 7 views and fix issues
4. **Send Schedules** — crew card flipper for SMS/text
5. **SMTP API key** — paste Resend key into Supabase SMTP password

## Architecture Notes
- **Shared Supabase DB** — Sales Command writes to `jobs` table directly (same project)
- **No webhooks/edge functions needed** for the integration
- `source_proposal_id` links Schedule jobs back to Sales proposals
- `field_sow` is JSONB on `jobs` — editable in Schedule Command after initial send
- QB test guard is client-side only (job name contains "test") — quick/dirty, not permanent

## Session Prompt for Next Claude Code Session
Continue building Schedule Command. Read HANDOFF.md for context.
Key items: Mobilizations architecture (Jobs → Mobilization → Crew Schedule),
Go Backs for invoiced work, and bug hunt across all 7 views.
