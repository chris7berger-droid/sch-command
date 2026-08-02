# SCH_HANDOFF_v32 — DMS-1 Phase 4 SHIPPED (Crew Ticket print)

**Repo:** sch-command · **Branch:** `main` · **Date:** 2026-08-02
**Production:** https://schedulecommand.com — merged + deploying (Vercel auto-build on push to main).
**Cross-repo:** none this phase — sch-command only, NO DB changes (reads existing data).
Spine: `command-suite-db/docs/MASTER_SCHEDULE.md`. Plan: `docs/plans/daily_material_schedule_phase4_build.md` (RESET).

> **Loop:** closes inside open ERD Loop #44 (the printed ticket is the built outcome). "Prints live"
> confirmed by the prod smoke below → then Loop #44 is closeable and DMS-1 flips to "Phase 4 shipped."

---

## 1. Session summary

Built and shipped **DMS-1 Phase 4** — the printable **crew ticket** ("Daily Material Schedule" job
ticket), reachable from the Logistics tab's **Print Ticket** button. This is the last *feature* phase
of the big DMS build (only Phase 5, retiring the legacy `materials` table, remains).

The plan was a deliberate **RESET** (commit `b3b48e4`): rounds 1–3 had fallen into an accrete loop by
coupling the ticket to the live SOW print's shared `DayCard`. The reset severed that — Phase 4 is a
**self-contained component** (`CrewTicket.jsx`) that loads its OWN data and renders its OWN markup,
sharing nothing mutable with the live SOW print. That decision held up through every gate.

Went build → buildvsplan (T4) → live smoke → code-review (T5) → security-review (T6) — **all green,
0 ship-blockers** — then merged to main + deployed. No cross-repo work, no migration, no edge fn.
Feature branch deleted. Chris live-smoked page-1 qty against the DB/Sales on a real 2-WTC job.

## 2. Changes shipped

**sch-command (main, this session — 5 commits under the feature branch, merged as `cc96b1d`):**
- `f46c09e` **Phase 4 build** — NEW `src/components/CrewTicket.jsx` (`{ jobId, onClose }`; self-loads
  via `loadJobWithWTCs` + a direct `proposal_wtc.materials` read scoped to this job's scheduled WTCs;
  own markup — page-1 bid-material order summary with summed qty + checkboxes + Lead/Sales signatures,
  then per-day cards grouped by WTC with task tags + % badges, scope-notes callout, materials-as-text +
  unconfirmed tag, **no per-day qty**; null-guarded `window.open` print). `FieldSowModal.jsx` — added
  `export` to `PRINT_CSS` (one word, live SOW print untouched). `LogisticsMaterials.jsx` — Print Ticket
  button → `<CrewTicket jobId={job.job_id} />` (job_id, not call_log_id — the one audit fix).
- `28e2d78` page-1 summary groups by **name + kit_size** (buildvsplan watch-item 2 — two kit sizes of
  one product stay separate order lines).
- `c40080c` dedupe duplicate `.ct-mat-name` CSS (T5 nit #1); filed DMS-7.
- `3d44c1f` HTML-escape the print `<title>` job_num/job_name (T6 #2); filed SEC-6.

## 3. Gate record (all green)

- **buildvsplan (T4):** GO, 0 blockers. Verified wiring (job_id, scoped proposal_wtc read), decoupling
  (own DayCard, FieldSowModal diff = only `export`), no DB changes.
- **Live smoke:** job **92 / 10159 (ZZ TEST · SOW SMOKE)**, a real 2-WTC / 5-day job. Page-1 Total
  Needed matched the DB + Sales for all 4 materials; multi-WTC scoping clean (nothing leaked); day
  headers "Day N" (no "of N"); task tags with amber 50%/25% badges; SPECS UNCONFIRMED tag; blank
  sq_ft/linear_ft correctly omitted from the subline; no per-day qty. **Coverage-rate "gap" diagnosed
  as test-data blank** (empty on catalog + proposal + SOW for these test materials — the render prints
  coverage wherever it exists; the real-6618 reference PDF proves it), not a ticket bug.
- **code-review (T5):** 0 ship-blockers, 4 nits (1 fixed in-loop, 3 filed).
- **security-review (T6):** 0 exploitable-today. Tenant isolation confirmed (proposal_wtc / call_log /
  job_wtcs all `tenant_id = get_user_tenant_id()`); only unescaped concat was the print `<title>` —
  fixed in-loop. Surfaced one pre-existing cross-tenant item (SEC-6).

## 4. Backlog filed this session (none gate the ship)

- **DMS-7** (T4) — 2 remaining CrewTicket nits: `useMemo` the summary/sections/totalDays derivations;
  re-check `win.closed` before the 400ms `win.print()`. Cosmetic/defensive, off the ship path.
- **SEC-6** (T2, **multi-tenant onboarding blocker**) — **command-suite-db.** Legacy `jobs`
  "Authenticated users can do everything" ALL policy allows cross-tenant reads. NOT exploitable at 1
  tenant, pre-existing (not from Phase 4). Drop the over-broad policy before tenant #2 (same class as
  SEC-2). Rehearse before push.

## 5. Verify + next steps

- **PROD SMOKE (do to call it live / close Loop #44):** on schedulecommand.com, open job **10159
  (ZZ TEST · SOW SMOKE)** → Logistics → **Print Ticket** → page 1 shows 4 materials with correct Total
  Needed. Once confirmed, flip DMS-1 backlog status to "Phase 4 shipped."
- **DMS-1 remaining:** only **Phase 5** — backfill + retire the legacy `materials` table. Carries the
  named cross-boundary item **DMS-5** (server-side ready-gate + 3 triggers still read the dead
  `materials` table — Phase-5-owned, must not ride along unowned; rehearse before push, SECURITY DEFINER).
- Also open on the DMS line: **DMS-2** (Schedule-side spec confirm UI needs reset-on-edit — Phase-3
  carryover), **DMS-6** (warehouse-add price/note/job-costing — plan-mode, cross-repo).

## 6. State at handoff

- `main` @ `cc96b1d` (merge), clean working tree. `feat/dms1-phase4` deleted (local + origin).
- No DB migrations pending, repo unlinked from Supabase (author DB changes in command-suite-db).
- No open branches for this work.
