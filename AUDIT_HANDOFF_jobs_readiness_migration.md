# Audit handoff — pre-push review of jobs readiness migration

> Run `/audit` in the audit terminal, then work this mandate. Read-only, no push.
> (NOT `/runaudit` — that's plan-doc only. NOT `/buildvsplan` — that runs *after* the push.)

## Context

Staged/Ready cards are dead in prod because `jobs.ready_confirmed_at` / `hold_reason` / `updated_at` were never created (confirmed 2026-05-28 via read-only PostgREST probe — all returned `column does not exist`). The app writes/reads them, so Promote-to-Ready silently fails and the Ready tile never populates. This migration adds the columns + the §3.12 hybrid-readiness enforcement. It is committed but **NOT db-pushed**. Review before the irreversible push to shared prod.

## Artifact

- **Branch:** `feat/staged-ready-cards`
- **File:** `supabase/migrations/20260528120000_jobs_ready_confirmed_hold_reason_triggers.sql`
- **Commit:** `f8ddcaf`
- **Source of truth:** `docs/plans/staged_ready_card_design.md` §3.11 + §3.12 (LOCKED)

## Verify (read-only, no push)

1. **Transcription faithfulness** — SQL matches plan §3.11/§3.12 exactly: base-checklist fn, WHEN-gated BEFORE clear trigger, AFTER demote-audit trigger (source encoding), the 3+3 `FOR EACH STATEMENT` child triggers with correct transition tables (INSERT=new_rows, DELETE=old_rows, UPDATE=both), and the trigger fire-order note.

2. **Push procedure** — the ledger-repair precondition is real and correct: `supabase migration repair --status applied 20260512120000 20260512120100` must run **before** `npm run db:push`. Confirm timestamp `20260528120000` is collision-free and the branch is current vs `main`.

3. **Cross-repo trigger reach** — the SECURITY DEFINER recheck triggers fire on `job_crew` / `materials` writes from **Field Command via PowerSync** (plan §496) and any sales-command path. Confirm the tenant-scoping (`get_user_tenant_id()` → NULL = service-role escape hatch) will not (a) wrongly clear `ready_confirmed_at` on sibling-originated writes, or (b) error on PowerSync writes. Confirm `get_user_tenant_id()` + `call_log.tenant_id` exist live (used by `20260512120100_job_wtcs_create.sql`).

4. **Carve-out correct** — confirm `job_changes` RLS was rightly EXCLUDED from this push. SELECT-only RLS enable would default-deny the client-side audit inserts at `queries.js:176, 229, 407` and break all logging; per `CLAUDE_RLS.md` it needs the 10-step additive→drop gate separately. It must NOT be in this migration.

## Deliver

**GO / NO-GO on the push**, with any required SQL corrections.
- If GO: push is `migration repair …` → `npm run db:push`.
- Then build terminal runs `/buildvsplan` to confirm columns exist live + board works.
- Then Chris smoke tests.

## Scope note

This migration is columns + triggers only (no RLS policy change), so the single reviewed push is appropriate — the strict 10-step RLS gate applies only to the carved-out `job_changes` work, not here.
