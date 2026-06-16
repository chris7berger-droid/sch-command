# SCH_HANDOFF_v16 — AUDIT terminal · SOW Vertical (+ Schedule Remediation)

**Repo:** sch-command · **Branch:** `feat/sow-vertical` · **Author:** Terminal #2 (audit) · **Date:** 2026-06-16
**Role in the 4-terminal process:** #1 plan · **#2 audit (this doc)** · #3 build · #4 buildvsplan
**Scope audited:** `docs/plans/sow_vertical.md` (parent, 3 rounds) + `docs/plans/sow_vertical_schedule_remediation.md` (3 rounds). 6 `/runaudit` passes total. All rows in `docs/AUDIT_LOG.md`.

---

## TL;DR (read this if nothing else)

Both plans were audited to **convergence and marked build-ready**. The build terminal (#3) has since implemented the remediation (commits `c523986`→`a24a1c1`, steps 0–5) plus two build-time fixes. **Audit is done; nothing is open for me.** What rides forward:

- **Terminal #4 (buildvsplan) must run an *entry-point-coverage* pass, not just spec-vs-code** — that distinction is the entire reason this build needed a remediation. See "The one lesson" below.
- **Three things deliberately ride past this build to later checkpoints** (not audit failures — parked by design): the DISPUTED PowerSync RLS premise (two-tenant test before customer #2), the MAX-vs-SUM crew math (Jonah confirm, Field launch), and ReportTab's stale read (Field launch). See "Open gates."

---

## The one lesson (the meta-insight of this whole build)

**The parent plan passed THREE audit rounds + buildvsplan and was build-ready — then the Sales→Schedule smoke FAILED.** Root cause: every gate was **spec-vs-code** (does the code match the plan?). None checked **design-baseline** — the plan placed the SOW editor on the `JobDetail → Planning` tab, a surface production had already retired in favor of `StageJobCard` in-card modals. The code matched the plan perfectly; the plan targeted a dead screen. Invisible to all four gates.

The remediation audit was explicitly re-tooled to be **design-baseline + entry-point-coverage aware**, and on round 1 immediately caught the recurrence vector: the **Staged→Ready readiness gate** was itself a SOW-*reading* surface (in **both** JS `baseChecklistPasses` and SQL `job_base_checklist_passes`) that the inventory had missed — the exact failure class that shipped.

**Durable takeaways (already folded into remediation §8 as an enforceable gate):**
1. A data-model change requires a **surface/entry-point inventory** — every screen reading/writing the touched field, with a *verified `file:line`* and a disposition (REWIRE/LEAVE/RETIRE/DELETE), built by **running grep, not from memory**, across **JS *and* SQL**.
2. A **design-baseline check** — name the current production design doc and confirm the touched surfaces are the ones users actually reach.
3. **buildvsplan gains an entry-point-coverage dimension** — re-run the inventory grep against the built diff; confirm no SOW-touching surface writes the non-canonical field outside the allowlist.
4. **Readiness/checklist predicates are SOW surfaces too.** A gate that reads `field_sow` to decide promotion is as load-bearing as the editor — and a JS predicate with a SQL mirror can silently drift.

> Worth promoting to a global audit-methodology memory: *spec-vs-code audits are blind to design-baseline drift; always inventory entry points by grep across JS+SQL and confirm the surface is the one users reach.*

---

## The convergence arc (6 rounds, 2 plans)

| Plan | Round | Findings | Pattern | Outcome |
|---|---|---|---|---|
| parent vertical | 1 | 6 (1H/5M) | writer-coverage | revised; **overage scope-cut to Build 2** |
| parent vertical | 2 | 13 (1H/8M/4L) | stage-map-completeness | revised (the stage-sync map regression) |
| parent vertical | 3 | 5 (0H/0M/5L) | converged | **build-ready** |
| remediation | 1 | 12 (5H/4M/3L) | entry-point-coverage-gap | revised (the design-baseline miss) |
| remediation | 2 | 14 (5H/5M/2L) | wiring-spec-gaps | revised; **coverage crux CONVERGED** |
| remediation | 3 | 4 (1H/3L) | defensive-sql-guard | **build-ready** |

**Reading the arc:** severity falls and the *class shifts each round* — inventory → wiring → verification. That shift (not just a count drop) is the real convergence signal; a flat count with a shifting class is healthy, not a plateau. Two scope-cut clauses fired on count-flatness (parent R2→nothing-cut, remediation R2) but both mechanisms were load-bearing (the editor rewire IS the remediation) — documented and kept, not cut.

---

## Per-plan summary

### Parent `sow_vertical.md` — built, mostly deferred
- **Sales S1–S4** (sales-command): smoke-verified, untouched by the remediation.
- **Schedule SCH1–SCH4**: this is what the remediation **rebuilt** — the original placement was the design-baseline miss.
- **Field F1–F3**: **deferred to backlog D1** (Field launch). Two parked items live here (see Open gates).
- **Overage / costs / change-orders**: **scope-cut to Build 2** (`docs/plans/build2_costs_overages_change_orders.md`) at parent R1. Do not audit it against this build.
- Two migrations applied to prod: `20260612120000` (job_wtcs dates nullable), `20260613120000` (proposal_wtc.dates_tbd).

### Remediation `sow_vertical_schedule_remediation.md` — built (steps 0–5)
Confirmed-broken path (smoke failed) → rebuilt on the `StageJobCard` card surface. Build commits `c523986` (step 0: WTC-aware `hasFieldSow` JS+SQL) → `f2b34f4` (step 1: per-WTC `FieldSowBuilder` in-card) → `20ae61f` (step 2: Dates TBD badge) → `61ab97c` (step 3: revert JobDetail planning + `mode=planning`) → `50356e0` (step 4: DaysModal canonical + click-to-edit, Option 3) → `a24a1c1` (step 5: FieldSowModal Print-only). Plus build-time finds `7589234` (FieldSowBuilder id-collision — same `Date.now()` class the parent vertical flagged as R5) and `9e5d43c` (Print per-WTC headers).
- **New migration** `20260616120000` — `job_base_checklist_passes` redefine (`CREATE OR REPLACE`, WTC-aware SOW test). **Verify it carries the round-3 H1 `jsonb_typeof(field_sow)='array'` guard** (see below).

---

## Open gates — ride past this build, NOT audit failures

1. **DISPUTED PowerSync RLS premise** (parent vertical). Rounds 1 and 2 reached **opposite conclusions** on whether PowerSync enforces the `jobs→call_log.tenant_id` chain for the `job_wtcs` bucket; it is **unsettleable from the repo** (depends on the PowerSync dashboard connector/sync-rule config). The plan WITHDREW the "service-level connection" assertion and gated it on a **mandatory two-tenant sync test before onboarding customer #2** (create a tenant-B `job_wtcs` row, confirm it does NOT sync to a tenant-A device; remedy = sync-rule tenant filter / per-tenant bucket param). **1 live tenant today → not urgent, must not be skipped.** My lean: round-1's "filtering is via sync rules, not Postgres RLS" is mechanically how PowerSync works, so treat the over-sync risk as real until the test proves otherwise.
2. **MAX-vs-SUM crew math** (parent F3, Field render — deferred to D1). Same-day work types: MAX (shared crew) is the working assumption; **Jonah must confirm** whether they're ever genuinely additive. The per-task work-type tag keeps both computable, so the rule can flip without re-architecting. Dormant until Field launch.
3. **ReportTab reads `jobs.field_sow` first** (parent O1). `§9` was narrowed to say only `TasksTab` is canonical-first (verified); ReportTab (PRT target %) still reads the merged parent. Informational; rides to Field launch.
4. **Backlog from over-cap/adjacent buckets** across rounds: Jobs.jsx realtime has no `job_wtcs` channel (stale cards until refresh, ≤5 concurrency); `job_changes.job_id` constraint unverified against live schema; parent vertical O1–O6/ADJ items. None block this build.

---

## What Terminal #4 (buildvsplan) should specifically verify

This is a confirmed-broken path; do NOT rely on spec-vs-code alone. Concretely:
- **Entry-point-coverage pass.** Re-run the inventory greps against the built diff: `grep -rn "field_sow" src/`, `grep -rn "update(.*field_sow" src/`, and the §7.1 two-gate writer allowlist. Confirm **no SOW surface writes `jobs.field_sow` as canonical** outside the documented legacy fallback (the `_wtcs.length===0` `updateJobField` branch). Confirm `FieldSowModal.jsx:92` raw write is **gone**.
- **JS↔SQL predicate parity.** Confirm the shipped `hasFieldSow(job)` helper and the `20260616120000` SQL `job_base_checklist_passes` encode identical WTC-OR-parent logic, **including the empty-array edge** (`[]` → both false) and the named parent/WTC asymmetry. **Verify the round-3 H1 guard landed**: SQL WTC branch must be `jsonb_typeof(w.field_sow)='array' AND jsonb_array_length(w.field_sow)>0` (without `jsonb_typeof`, a non-array row throws and cascades through the recheck triggers). The migration must be `CREATE OR REPLACE` based on the `…133000` body (assignments crew block intact, NOT `…120000` job_crew).
- **Per-tab `key={activeWtc.id}`** on the in-card `FieldSowBuilder` (else save-to-wrong-WTC; `FieldSowBuilder` has no value-resync effect — the key is load-bearing).
- **Zero-WTC legacy job** stays editable from the card (the `_wtcs.length===0` fallback builder), and the **Option-3 DAYS modal holds no write path** (only navigates to the SOW modal).
- **Re-smoke from the card flow** (remediation step 6) — author SOW on a staged card → confirm `job_wtcs` written (not `jobs.field_sow`) → confirm the readiness tile/gate flips for a WTC-only job with no parent `field_sow`.

---

## Audit-process notes (reusable, for the next dynamic build)

- **3 agents = sweet spot; drop to 2 on verification rounds; never pad.** Round counts here: 4/3/4 (parent) → 3/3/2 (remediation). The angle that earns its own agent every time on a data-model change: **entry-point coverage** (the crux), and **JS↔SQL parity** the moment a predicate has a SQL mirror.
- **Feed the agents the grep leads you already have.** Pre-grepping `field_sow`/`job_wtcs` surfaced `JobsPicker` + `jobCardLabel` as "not in §4" leads before launch — one was a real miss, one was clean. Cheaper than letting agents rediscover.
- **Inter-agent and inter-round disagreements are signal, not noise.** Two rounds flat-out contradicted each other on the PowerSync RLS mechanism. The honest move was to *report the conflict and gate it empirically*, not pick a winner — that became the two-tenant test. (See feedback: stop on ambiguous conflict, report.)
- **Deployment-context severity caps did real work** — 1 tenant capped cross-tenant findings to Med and kept the report focused on what's actually broken now, while still flagging the leak-at-tenant-#2.
- **The build will surface its own finds** (the id-collision `7589234` is the parent vertical's R5 day-ID risk landing for real during build). Expect buildvsplan to catch a few more — that's the system working.

---

## Cross-references
- `docs/AUDIT_LOG.md` — all 7 rows (this subject + the 2026-05-28 readiness-migration precursor).
- `docs/plans/sow_vertical.md` §11 + `…_schedule_remediation.md` §11 — the manifests each round consumed.
- `docs/plans/staged_ready_card_design.md` — the design authority the remediation re-baselined against (§3.5, §376).
- Planning-terminal handoff: commit `222b36b` ("Planning terminal handoff v14").
- Build-2 seed: `docs/plans/build2_costs_overages_change_orders.md` (overage/costs, scope-cut here).
