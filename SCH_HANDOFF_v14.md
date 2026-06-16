# SCH_HANDOFF_v14 — PLANNING terminal · SOW Vertical + Schedule-side remediation

**Date:** 2026-06-16 · **Branch:** `feat/sow-vertical` · **Terminal:** planning (one of several this loop — build terminal writes its own for build/smoke/merge detail).

## What this terminal owned
Design → `/auditcriteria` (sizing the audits) → folding audit findings back into the plan docs. This terminal did **not** build, run `/buildvsplan`, smoke, or merge.

## Artifacts produced (all on this branch)
- `docs/plans/sow_vertical.md` — the SOW vertical (Sales + Schedule + Field). Converged build-ready (3 rounds).
- `docs/plans/sow_vertical_schedule_remediation.md` — Schedule-side rebuild on the current card design, after the original smoke failed on a design-baseline mismatch. Converged build-ready (3 rounds).
- `docs/plans/build2_costs_overages_change_orders.md` — seed for Build 2 (cost visibility + overage stamp + change-order workflow), with the open pricing-plumbing decision (#1 carry-forward vs #2 shared service).
- `docs/AUDIT_LOG.md` — all 6 audit rounds (3 vertical, 3 remediation) with severity + pattern.

## Load-bearing locked decisions
- **Vertical:** frozen-at-sale (proposal immutable downstream); scope vs calendar = two owners (Sales / Schedule); Field read = day-centric, work-types collapsed, no notes; model (a) = one `jobs` row per proposal; overage → Build 2.
- **Remediation:** `staged_ready_card_design.md` is the design authority (no JobDetail Planning tabs); SOW editing = per-WTC `FieldSowBuilder` in the `StageJobCard` in-card modal writing `job_wtcs`; DaysModal = read-only overview, day rows **deep-link** into the SOW modal (Option 3); readiness = JS-authoritative, **no trigger**, handler clears `ready_confirmed_at` on SOW-empty + "moved back to Staged" toast (Option 1); one shared WTC-aware SOW predicate (`hasFieldSow`, JS + SQL `job_base_checklist_passes`) with the `jsonb_typeof='array'` crash guard (round-3 H1).

## Process lesson banked
Three clean spec-vs-code audit rounds + buildvsplan PASSED a plan built on a retired design — the smoke caught it, not the gates. Fix: planning now requires a surface/entry-point inventory + a current-design-doc check; buildvsplan gains an entry-point-coverage dimension (remediation §8). (Saved to memory `feedback_design_baseline_check`.)

## Deferred / open gates (NOT closed by this loop)
- **Field F1–F3** — deferred to Field launch (backlog D1).
- **Overage / costs / change orders** — Build 2 (seed above); pricing-plumbing decision still open.
- **Two-tenant PowerSync sync test** — hard gate before onboarding customer #2 (the [DISPUTED] RLS premise).
- **Field manager (Jonah)** confirms `crew_count` MAX-vs-SUM + per-task work-type tag during build/smoke.
- **Backlog:** L3 (`job_changes.job_id` constraint vs live schema), L4 (`job_wtcs` realtime channel in `Jobs.jsx`).

## Status at handoff
Planning complete; both plans build-ready. Build + smoke reported green (build terminal's handoff covers build/smoke/merge). **Not yet merged to main.** The ERD loop opened for this work is still open — closes at this loop's built + smoke-verified outcome.
