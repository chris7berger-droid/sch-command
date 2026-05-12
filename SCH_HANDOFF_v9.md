# SCH Handoff v9 — Jobs IA + Send-to-Schedule Wizard planning complete

**Session:** 2026-05-11 (continues on work desktop)
**Branch state:** `main` clean + pushed

## What happened this session

Cross-app planning session that produced TWO implementation plans:
- `docs/planning/JOBS_IA_REFACTOR.md` (this repo) — design contract, decisions, vocab unification
- `docs/plans/jobs_ia_refactor_implementation.md` (this repo) — file-by-file sch-command implementation plan
- `~/sales-command/docs/plans/send_to_schedule_wizard.md` (sales-command, PR #23) — companion wizard plan

## Locked design decisions

| # | Decision |
|---|---|
| Vocab | Drop `Parked`. Tile/tab labels: Scheduled, Active, On Hold, Billing. |
| Picker | 7 tiles — Scheduled, Active, On Hold, Billing, All Jobs, Live Schedule, Production Rate. |
| `/jobs` tabs | 4 — Scheduled, Active, On Hold, All. Billing/Live Schedule/Production Rate are top-level routes. |
| Send-to-Schedule | 5-step wizard, **one WTC per run**, sibling detection at Step 5. |
| Status value | Wizard writes `status = 'Scheduled'` (no Parked bridge). |
| Q6 (multi-WTC) | **Hybrid model.** `jobs.job_id` = card identity. New `job_wtcs` table holds per-WTC attributes (`field_sow`, `material_status`, `proposal_wtc_id`, `start_date`). |
| M5 (migration) | **sch-command owns** the migration files. 5-step pure-schema additive sequence. |
| call_log.stage | Wizard does NOT update it. Stays `Sold`. Existing `'Parked'` write at sales `ProposalDetail.jsx:588` to be removed. |
| Card label | Single-WTC = work type name; joined = "N work types". WTC chip always shown. |
| JobDetail | Drop readiness checklist + embedded crew grid. Add "Schedule this job" deep-link to `/schedule`. |
| Multi-week alert | Per-job per-week pulse on Live Schedule + count badge on Scheduled tile. Criterion: weeks the job spans where this job has no crew assigned. |
| Scheduled card | Purpose-built component `ScheduledCardList.jsx` (NOT a JobCardList mode). |

## Shipping order constraint

**The sch-command IA refactor ships FIRST or TOGETHER with the wizard. NEVER after.**

If wizard ships first, new `status = 'Scheduled'` jobs land under the stale "Ready" tile with no list view → broken UX during interim.

## Next-up step on work desktop

1. `git pull` both repos: `~/sch-command` and `~/sales-command`
2. Review sales-command PR #23 (https://github.com/chris7berger-droid/sales-command/pull/23) — merge or request changes
3. Begin sch-command implementation per `docs/plans/jobs_ia_refactor_implementation.md` §12 (Implementation order)
   - Recommended start: migration M1 (`jobs.material_status` column) → smoke verify → M2 (`job_wtcs` table + RLS) → smoke verify → UI work in order
4. Implementation lands on a feat branch, NOT main. Test on Vercel preview before merge.

## Risks already cleared (don't re-litigate)

- R4 + R14 (office staff training): closed — Joe/John/Denise still on legacy Apps Script. Chris is sole sch-command user today.
- R15 (field-command impact): closed — grep ran 2026-05-11, zero `Parked` or `jobs.status` filter references in field-command source.

## Risks still standing (mitigate during implementation)

- R1: Cross-repo shipping order (mitigate by sequencing — see §12)
- R2: `job_wtcs` RLS policy correctness (use established `EXISTS(jobs JOIN call_log WHERE tenant_id = ...)` pattern; NOT the `signing_token IS NOT NULL` anti-pattern)
- R3: Read-path perf with `job_wtcs` join (one PostgREST query, not N+1; add `.range()` if > 1000 rows)
- R5: Realtime subscription gap on `job_wtcs` (acceptable v1; add 2nd channel as follow-up)
- R6: `urgencyScore` sort change (Scheduled jobs no longer hard-pin to top; set `score = -2500` for soon-to-kickoff)
- R7: No `tenant_id` on `jobs` — RLS chains via `call_log.tenant_id` (flag for F7 follow-up)
- R9: `Schedule.jsx` (1092 lines) — keep new logic in ADDITIVE blocks only, no refactor in this PR
- R13: `material_status` UI edit surface missing v1 (acceptable; Materials view will add it later)

## Files to know

- `~/sch-command/docs/planning/JOBS_IA_REFACTOR.md` — source of truth design doc (4 revisions of audit)
- `~/sch-command/docs/plans/jobs_ia_refactor_implementation.md` — sch-command file-by-file plan (940 lines)
- `~/sales-command/docs/plans/send_to_schedule_wizard.md` — sales-command companion plan (756 lines, on PR #23)
- `~/sales-command/CLAUDE.md` + `CLAUDE_RLS.md` — non-negotiable rules for any sales-command edits
- `~/sch-command/CLAUDE.md` + `CLAUDE_RLS.md` — non-negotiable rules for this repo

## Git state at session end

- `main` @ `bef6114` (planning doc) — clean before this commit
- About to commit: `docs/plans/jobs_ia_refactor_implementation.md` + this handoff
- Sales-command: `feat/multi-gc-allocation` checked out locally, plan on `docs/send-to-schedule-wizard` branch (PR #23)
