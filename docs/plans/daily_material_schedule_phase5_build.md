# DMS-1 Phase 5 — Backfill + Retire (build plan)

**Branch:** `feat/dms1-phase5` (plan doc lives in sch-command; work spans 3 repos)
**Wall-chart step:** 9 (Tier 4 — retire legacy)
**Status:** PLAN — drafted 2026-08-03, post-ideate. Not yet audited.

---

## What this is (plain)

Cleanup. Nothing new is built. Two old stores were already replaced by newer ones
that are in real use; the old ones just sit there still getting copies written to them.
Phase 5 throws out the old ones so each thing lives in exactly one place.

**Two things retired:**
1. The legacy **`materials`** table (old per-job materials list). Replaced by `job_material_lines`.
2. The legacy **`jobs.field_sow`** flat copy of the SOW **for WTC-backed jobs**. Replaced by
   per-WTC `job_wtcs.field_sow`. **The column is NOT dropped** — it stays as the carrier for
   zero-WTC (archive) jobs.

### Key unblock (ratified in ideate, 2026-08-03)

**Field Command has no live users — it is still prototype/in-build, on nobody's phone.**
So the "don't break the crew report screen / need an app release first" precondition is **void**.
The ReportTab fix is a plain code change with no deploy-pipeline dependency. Both halves ship now,
as one job. (This reverses the master-plan assumption that 5 was gated on a field-command release.)

---

## §0 Baseline (observed current state — what this plan changes)

**Verification level: read-verified** (code + committed baseline schema + greps this session, 2026-08-03).
Not yet run-verified: job 6618's live row state and a live DB census of which jobs hold `materials`
rows — that is the smoke/verify step at build time (step 5), explicitly called out below.

**The two old stores exist and are still being written:**
- **`materials` table** — defined `command-suite-db/supabase/baseline/prod_public_schema.sql:3037`.
  Sole remaining **writer** = Sales `ProposalDetail.jsx:788` (insert at Send-to-Schedule, rows
  default `status='Not Ordered'`). **No app readers remain** — all moved to `job_material_lines`
  (sch `Materials.jsx`, `queries.js:85` `materialsDecided`). Sole remaining **reader** = the SQL
  `job_base_checklist_passes()` materials check. 3 recheck triggers + `materials_recheck_parents()`
  + 4 RLS policies attached.
- **`jobs.field_sow` column** — written by Sales `ProposalDetail.jsx:703` (flat mirror at Send) and
  by sch `CardSowModal.saveLegacy` (zero-WTC jobs). Read as a **primary** source in exactly one
  place: field `ReportTab.js:36`. Everywhere else it is **fallback-only** (gated on "no `job_wtcs`
  rows"): field `TasksTab.js:96`, sch `queries.js:69` (`hasFieldSow`), `FieldSowModal.jsx:179`,
  `CardSowModal.jsx:20`.

**The new stores are live and in real use:**
- **`job_material_lines`** — written/read by sch `queries.js:706`/`:692`; the app's live Ready gate
  `materialsDecided` (`queries.js:85`) already reads it, **fail-closed on empty**. Populated lazily
  (SOW-save / Logistics-tab open), NOT at Send.
- **`job_wtcs.field_sow`** — read as primary by field `TasksTab.js:88` and sch canonical paths;
  synced to device via `powersync-sync-rules.yaml` (`job_wtcs` in the bucket).

**The DB's duplicate Ready gate is real and enforced:** SQL `job_base_checklist_passes()`
(`prod_public_schema.sql:925`) still reads the OLD `materials` table and is enforced by a jobs
trigger (`:1032`) + ready-flag null-out queries (`:311/:324/:341/:1299/:1312/:1329`). The app's own
code flags it as Phase-5-owned (`queries.js:79`).

**Field Command has no live users** — prototype/in-build, on nobody's phone. No release pipeline:
no `eas.json`, no `expo-updates`; `package.json` scripts are `expo start`/`run:ios`/`run:android`
only. Confirmed 2026-08-03. This voids the master-plan assumption that Phase 5 was gated on a
field-command release.

---

## The whole job (6 steps)

| # | Repo | What | Deploy gate |
|---|---|---|---|
| 1 | field-command | Point the **report screen** at the new SOW store (`job_wtcs` primary, `jobs.field_sow` fallback for zero-WTC). Resolve the `daily_production_reports.wtc_id` write. | none (no live users) |
| 2 | sales-command | **Stop writing** both old stores at Send-to-Schedule: drop the `materials` insert (`ProposalDetail.jsx:788`) and the flat `field_sow` mirror write (`ProposalDetail.jsx:703`). Keep the `job_wtcs` write. | must deploy **before** step 4 (else the insert errors on a dropped table) |
| 3 | command-suite-db | **Rewrite the ready-gate** `job_base_checklist_passes()` so its materials check mirrors the live JS `materialsDecided` (read `job_material_lines`, fail-closed on empty). Mechanical mirror, not a behavior change — see below. | — |
| 4 | command-suite-db | **Drop** the `materials` table + its 3 recheck triggers + `materials_recheck_parents()` + 4 RLS policies. | after steps 2 & 3 |
| 5 | all | **Verify vs job 6618**, then a **zero-hit re-grep** for `from('materials')` / stale `jobs.field_sow` primary reads across all 4 repos. | — |
| 6 | command-suite-db | **Amend `MASTER_SCHEDULE.md` §4B step 9** wording to include the `jobs.field_sow` mirror (currently names only `materials`). | — |

Steps 3 + 4 are one migration file. Step 2 (Sales stop-writes) deploys first.

---

## The ready-gate — mirror update, NOT a decision (settled 2026-08-03)

Earlier draft framed this as an open choice. It isn't. The **live app** already decided it and
runs it today.

- **App (the real gate):** `materialsDecided()` / `baseChecklistPasses()` (`sch-command/queries.js:85-95`)
  already reads the **new** list (`job_material_lines`) and is **fail-closed**: a job with a scope
  but an **empty** new list is **NOT ready** until the list is built. Every live "ready" read
  recomputes this in JS — no consumer trusts a stored flag without recompute (verified 2026-07-30).
- **Database (a duplicate copy):** the SQL `job_base_checklist_passes()` keeps its own copy of the
  same check, but still reads the **old** `materials` table. The app's own code flags this:
  *"NOTE (DMS-5): the SQL mirror … still reads the OLD materials table … Phase-5 owned."* This SQL
  copy IS actively enforced (a jobs trigger at `prod_public_schema.sql:1032` + the ready-flag
  null-out queries at `:311/:324/:341/:1299/:1312/:1329`), so it can't just be deleted — dropping
  the old table without fixing it would break those.

**So the task is mechanical:** rewrite the SQL `job_base_checklist_passes()` so its materials check
**mirrors the JS `materialsDecided` verbatim** — read `job_material_lines`, fail-closed on empty,
block on `status` NULL / `'Not Ordered'` / `'Delayed'`. Same behavior the app already ships; the DB
just catches up. No behavior change, no choice to make.

The SOW-present half of the SQL function already matches the JS (`hasFieldSow`) and stays as-is.

---

## Step details

### Step 1 — field-command report screen (`src/screens/tabs/ReportTab.js`)

Today (`:36`, `:40`, `:45`): primary read is `SELECT field_sow FROM jobs`; fallback is an unjoined
`SELECT * FROM proposal_wtc ... LIMIT 10`. Wrong order and a sloppy fallback.

Fix — mirror the sibling `TasksTab.js:88-120`, which already does this correctly:
- **Primary:** `job_wtcs` for this job, ordered by `position`, merge each row's `field_sow`.
- **Fallback (zero-WTC/archive jobs only):** `SELECT field_sow FROM jobs WHERE call_log_id = ?`.
- **Delete** the `proposal_wtc` unjoined fallback.
- **`daily_production_reports.wtc_id` write (`:141`,`:169`):** currently sourced from the deleted
  `proposal_wtc` fallback. Decide which WTC id to stamp per report (track which WTC each task came
  from, or stamp per-report). No schema/sync-rule change — `job_wtcs` already syncs to the device
  (`powersync-sync-rules.yaml`), so this is app-code only.

### Step 2 — sales-command stop-writes (`src/components/ProposalDetail.jsx`, Send-to-Schedule)

- `:788` — remove the `materials` table insert (`matRows`). App readers already use `job_material_lines`.
- `:703` — remove the flat `field_sow: mergedSow` mirror write on the `jobs` insert. Keep the
  canonical `job_wtcs` write (`:744`). The column stays populated for zero-WTC jobs via
  `CardSowModal.saveLegacy` (`sch-command`), which is untouched.

### Steps 3+4 — command-suite-db migration (one file, + rollback pair)

1. Rewrite `job_base_checklist_passes()` materials check to mirror JS `materialsDecided` verbatim
   (read `job_material_lines`, fail-closed on empty). Confirm the `job_material_lines.status`
   values at build so the SQL keys off the same signal the JS does.
2. `DROP` trigger ×3 (`materials_recheck_ready_{insert,update,delete}_trg`), then
   `DROP FUNCTION materials_recheck_parents()`, then `DROP` the 4 `materials_*` RLS policies, then
   `DROP TABLE public.materials`.
3. Author + rollback pair per repo convention (`supabase/rollbacks/<ts>_revert_<name>.sql`).
4. **Rehearse before push** (standing rule): `./scripts/rehearse.sh <migration>` against a
   prod-shaped throwaway — seed job 6618 + a zero-WTC job + a WTC-backed job so the gate rewrite is
   exercised on real shapes (baseline is schema-only/empty tables). Then `npm run db:push` (runs
   safety + collision + anon-lock + from-scratch gates).

### Step 5 — verify + re-grep

- Job **6618**: still passes Ready via the new gate; report screen renders SOW; no `materials` rows needed.
- Zero-hit re-grep across all 4 repos: no `from('materials')`, no `jobs.field_sow` used as a
  **primary** read (fallback-only reads are expected and fine).

### Step 6 — amend `MASTER_SCHEDULE.md` §4B step 9

Current text names only the `materials` table. Add the `jobs.field_sow` mirror retirement
(WTC-backed jobs only; column stays for zero-WTC).

---

## Stays (do NOT touch)

- `jobs.field_sow` **column** — carrier for zero-WTC/archive jobs.
- `CardSowModal.saveLegacy` (sch-command) — only editor for zero-WTC field_sow.
- All **fallback** readers of `jobs.field_sow` in sch-command + field-command (they gate on
  "no `job_wtcs` rows").
- `job_material_lines`, `materials_catalog`, `job_wtcs` — the new/canonical stores.

## Out of scope

- Field Command release pipeline (EAS/OTA) — not needed; no live users.
- Any new SOW/materials features. This is retirement only.
- Dropping the `jobs.field_sow` column (it stays).

## Verify (before done)

- Sales Send-to-Schedule: creates `job_wtcs` rows; writes **no** `materials` rows and **no**
  `jobs.field_sow` on WTC-backed jobs; zero-WTC path unchanged.
- Migration rehearsed green; `npm run db:push` clean; rollback pair present.
- Ready-gate behaves per Decision D1 on job 6618 + a fresh un-opened job.
- ReportTab (dev build) renders SOW from `job_wtcs`; zero-WTC job still renders via fallback.
- Zero-hit re-grep passes.

## Deploy

- Order: **Sales stop-writes (step 2) → DB migration (steps 3+4)**. field-command (step 1) any time.
- Closes the SOW/Material-Flow master schedule Tier 4.

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-08-03. Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
This is a cleanup that throws out two old storage spots and ends with permanently deleting one
database table on the shared live database. Nothing new gets built, so it doesn't need a big review —
but a wrong move here is hard to undo. Three reviewers, aimed at the three danger spots: the database
delete + the "Ready" check rewrite, whether we truly found every place still writing the old stuff,
and the crew report screen.

### Round
- Plan type: feature (retirement/cleanup — no pre-existing defect)
- Current round: 1
- Plan revision under audit: uncommitted working tree (first commit is this manifest)
- Findings trend: n/a — round 1

### Prior rounds
none — this is round 1

**Briefing for agents**: attack the plan revision under audit. This is the first pass; no prior
findings to avoid.

### Deployment context
- **Live tenants**: 1 — HDSP only (Sales + Schedule Command in prod for one tenant)
- **Prod / staging / dev**: the `materials` ready-gate + Sales Send-to-Schedule are LIVE in prod for
  HDSP (salescommand.app / schedulecommand.com). The `jobs.field_sow` / ReportTab half has ZERO prod
  exposure — Field Command is prototype, on nobody's phone.
- **Blocking feature flags**: none
- **Concurrency profile**: ≤5 (small office: Joe, John, Denise)

Weight severity accordingly: cross-tenant findings cap at Med (1 tenant); multi-user race findings
cap at Low (≤5, effectively solo writes); any finding about Field Command runtime behavior caps at
Low (no live users). The one place full severity is warranted: the destructive migration against the
shared prod DB.

### Time budget + finding cap
- **Time budget**: 90 min
- **Finding cap**: 9 findings

Synthesis surfaces the top 9; remainder go to "Quarantined findings (not actionable this loop)."

### Surface
- Total lines: 189
- Sections: 11 (`##` headings)
- [LOCKED] decisions: 0 tagged (the ready-gate approach is settled in prose, not tag-marked)
- [DESIGN-OPEN] items: 0 tagged
- [OPEN] items: 2 (job_material_lines status values to confirm; ReportTab `wtc_id` write resolution)
- Plan-to-code ratio: ~189 : ~130 est ≈ 1.5:1 (not scope-crept)

### Layers touched
- Data layer (queries.js reads/writes; Sales Send-to-Schedule)
- State model / business logic (the "Ready" gate)
- Migrations / schema (destructive DROP + function rewrite)
- RLS / multi-tenancy (dropping 4 `materials` policies)
- Cross-repo (all 4 repos: sales-command, sch-command, field-command, command-suite-db)
- Real-time / sync (PowerSync — `job_wtcs` / `jobs.field_sow` reads on device; ReportTab)

### New mechanisms introduced
- New columns: none
- New tables: none
- New helpers/hooks: none (the SQL gate rewrite MIRRORS existing JS `materialsDecided` — not novel)
- New triggers / RLS: none (dropping 3 triggers + 4 policies)
- New routes / jobs / cron: none

**Net novelty: zero.** This is pure retirement — the audit's risk is in deletions + coordination,
not new surface.

### Cross-system reach
- All 4 repos read or wrote the retired stores
- PowerSync (Field device sync of SOW data)
- Service-role / bypass: SQL `job_base_checklist_passes()` is `SECURITY DEFINER`; migration runs as
  superuser on the shared prod DB

### Irreversibility
- **`DROP TABLE public.materials`** — destructive DDL on the shared prod DB. Rollback pair recreates
  an EMPTY table; any historical `materials` rows are gone. Ledger-coordinated (single shared ledger).
- `job_base_checklist_passes()` rewrite — reversible (function redefine), but enforced live.
- Code stop-writes — reversible.

### Known weak points
- **Destructive drop on the shared prod DB** — standing rehearse-before-push rule applies; rehearsal
  must be seeded with prod-shaped data (job 6618 + a zero-WTC job + a WTC-backed job) or it never
  exercises the rewritten gate (baseline is schema-only/empty).
- **Cross-repo deploy ordering** — Sales stop-insert (`ProposalDetail.jsx:788`) MUST deploy before
  the table drop, or the live insert errors against a dropped table. No mechanism enforces this order.
- **Invisible gate drift (MIG-1 class)** — the rewritten SQL gate must mirror JS `materialsDecided`
  EXACTLY, including fail-closed-on-empty and status handling; a subtle mismatch silently changes
  which jobs can go Ready.
- **Stop-writes completeness** — plan assumes `ProposalDetail.jsx:788/:703` are the ONLY remaining
  writers of `materials` / `jobs.field_sow` mirror. A missed writer (edge fn, cron, other repo) →
  orphaned rows or a post-drop error.
- **All call sites of the rewritten function** — `job_base_checklist_passes()` is called from a jobs
  trigger (`:1032`) + 6 null-out queries (`:311/:324/:341/:1299/:1312/:1329`); the rewrite must keep
  every caller correct.
- **`daily_production_reports.wtc_id` write in ReportTab** — currently sourced from the deleted
  `proposal_wtc` fallback; which WTC id to stamp is underspecified.
- **`job_material_lines.status` values** unconfirmed for the SQL rewrite (open item).

### Open questions
- Count: 2 (see step 1 `wtc_id`; the gate `status` values)
- Highest-pressure: does the rehearsal actually exercise the rewritten gate on a fresh un-opened job
  (the fail-closed-on-empty path), or does an empty throwaway mask it?

### Suggested attack angles (3 total)
1. **Destructive migration + Ready-gate mirror correctness** — covers Migrations/schema, State model,
   RLS. Required reading: `command-suite-db/.../prod_public_schema.sql` (`job_base_checklist_passes`
   `:925`, `materials_recheck_parents`, the trigger `:1032`, and all 6 call sites `:311/:324/:341/
   :1299/:1312/:1329`), `sch-command/src/lib/queries.js:60-104`, the phase-3 migration
   `20260731130000_...`. Pressure: does the rewritten SQL gate mirror JS `materialsDecided` verbatim
   (fail-closed on empty, status NULL/Not-Ordered/Delayed)? Is the DROP order safe (triggers →
   function deps → policies → table)? Does the rollback pair actually restore a working state? Does
   the rehearsal seed exercise the fresh-job path?
2. **Stop-writes completeness + cross-repo deploy ordering** — covers Data layer, Cross-repo.
   Required reading: full grep census of `from('materials')` / `field_sow` writes across all 4 repos,
   `sales-command/src/components/ProposalDetail.jsx` Send-to-Schedule flow. Pressure: are `:788`/`:703`
   truly the ONLY remaining writers? Any edge fn / cron / other-repo writer missed? Is the
   Sales-stop-before-drop ordering enforceable, and what breaks if it's violated? Is dropping
   historical `materials` rows for archive jobs acceptable (any reporting/QB dependency)?
3. **Field report screen + PowerSync fallback correctness** — covers Real-time/sync, UI. Required
   reading: `field-command/src/screens/tabs/ReportTab.js`, `TasksTab.js` (the working reference),
   `powersync-sync-rules.yaml`, `src/lib/schema.js`. Pressure: does the ReportTab rewrite match
   TasksTab's job_wtcs-primary + jobs.field_sow-fallback pattern? Is the zero-WTC fallback preserved
   offline? Is the `daily_production_reports.wtc_id` write resolved correctly? (Severity capped — no
   live users.)

### Suggested agent count: 3

Rationale: 6 layers touched would push the raw formula to 5, but net novelty is zero (pure
retirement) and risk is concentrated in three clean danger zones — a 4th/5th agent would re-plow the
same ground rather than open a new attack surface.
