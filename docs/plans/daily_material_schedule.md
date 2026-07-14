# Daily Material Schedule (DMS-1) — Phase-0 Plan + Ownership Matrix

**Status:** Phase-0 plan — decisions ratified, migrations NOT yet authored, no code ships from this doc.
**Loop:** ERD #42 (`mf-phase-d-phase0`) · locked 2026-07-14 11:28 · Fable terminal (T1 plan)
**Branch:** `sch-command feat/dms1-phase0-plan`
**Parents:** `command-suite-db/docs/MASTER_SCHEDULE.md` §4B step 2 · `sch-command/docs/BACKLOG.md` DMS-1 · `docs/plans/command_suite_shared_data_contract.md`
**Target:** the crew/warehouse "DAILY MATERIAL SCHEDULE" job ticket (built in Claude Web; crew loves it), reached by fixing the data spine first.

Everything below Tier 0 in the wall chart (`command-suite-db/docs/assets/wall_chart.html`) inherits this document.

---

## §0 Baseline — observed current state (verified 2026-07-14)

All **read-verified** (code/schema read on freshly-pulled main across 4 repos) except where marked. No run-verification was needed — this plan changes decisions and schema, not behavior; nothing below is assumed.

1. **`field_sow` exists in three places** (the premise of decision #1):
   - `proposal_wtc.field_sow` — authored in `sales-command/src/pages/WTCCalculator.jsx:876` (day shape: `{id, day_label, date, mobilization_id, sq_ft, linear_ft, tasks[], crew_count, hours_planned, materials[]}`)
   - `job_wtcs[].field_sow` — per-WTC stamp at Send, `sales-command/src/components/ProposalDetail.jsx:720-724`
   - `jobs.field_sow` — flat merged mirror at Send, `ProposalDetail.jsx:649-678`; code comment self-describes it as "legacy mirror"
2. **Field Command reads `job_wtcs`, not `jobs.field_sow`:** PowerSync schema syncs the `job_wtcs` table (`field-command/src/lib/schema.js:174-180`, comment: "canonical, replaces the [flat read]"); run-verified historically by smoke #10159 (MASTER_SCHEDULE §3 ledger).
3. **The SOW material entry already carries spec fields** (the premise of decision #2): `WTCCalculator.jsx:736-739` stamps `{wtc_material_id, name, kit_size, qty_planned, mils, coverage_rate, mix_time, mix_speed, cure_time}` at pick time — `coverage_rate` auto-fills from catalog `coverage`; the rest stamp empty/0 and are hand-typed per job.
4. **`materials_catalog` has NO spec columns beyond `coverage`:** live schema = `id, tenant_id, name, kit_size, price, coverage, supplier, active, created_at, updated_at` (`command-suite-db/supabase/migrations/20260416200000_materials_catalog.sql:7-19`). Absence of `mils`/`mix_time`/`mix_speed`/`cure_time`/`unit` verified by reading the full migration — no later ALTER exists (grepped `command-suite-db/supabase/migrations/` for `materials_catalog`; single hit).
5. **No revision stamp exists on `job_wtcs`** — no `sow_revised_*` anywhere (grep, all repos), and no Schedule write path to `field_sow` exists yet (`FieldSowModal.jsx` is the viewer/editor shell; canonical-home ambiguity is exactly what blocked it — contract doc line 93).
6. **Mobilizations contract row registered 2026-07-13** (Phase B done) — `docs/plans/command_suite_shared_data_contract.md` "Contracted entities"; the copy-at-Send pattern this plan extends.
7. **Reference PDF absent on this machine** — `find` across Desktop + all 4 repos: no `6618 - Lakes Crossing - Material Schedule.pdf` (open item #1).

---

## 0. Why this exists (plain English)

Two questions have been blocking the pipeline:

1. **Where does the field SOW live?** It exists in three places today and nobody ever picked the truth — so the Schedule SOW builder can't be built (it wouldn't know which copy to read or write).
2. **Where do material specs live?** Coverage rates, kit sizes, mix/cure data are typed by hand per job. A stale coverage rate riding silently into a job is a floor-failure risk.

Both are resolved below. Ratified by Chris 2026-07-14 (ERD loop #42 ideate pass).

---

## 1. Decision #1 — canonical `field_sow` home `[LOCKED 2026-07-14]`

### The three locations today (verified in code, 2026-07-14)

| Location | Written by | Read by | Verdict |
|---|---|---|---|
| `proposal_wtc.field_sow` | Sales authoring (`WTCCalculator.jsx`) | Sales only | **Keep — the authoring desk** |
| `job_wtcs[].field_sow` | Send-to-Schedule per-WTC stamp (`ProposalDetail.jsx:720-724`) | Schedule cards + Field (PowerSync `job_wtcs` table, `field-command/src/lib/schema.js:174-180`) | **CANONICAL** |
| `jobs.field_sow` | Send-to-Schedule flat merged mirror (`ProposalDetail.jsx:649-678`, self-described "legacy mirror") | none found (Field moved to `job_wtcs`, smoke #10159) | **Retire (Tier 4)** |

### The ratified rule

> **Author in the proposal. Send snapshots it. After Send, `job_wtcs[].field_sow` is the one living truth: Schedule edits it, Field reads it, the proposal is frozen forever.**

- **Sales authors** `proposal_wtc.field_sow` inside the WTC. It is a draft until Send.
- **Send** copies it per-WTC onto `job_wtcs[].field_sow` (copy-at-Send — same contract shape as mobilizations, registered 2026-07-13).
- **Schedule owns post-Send edits.** Real-world adjustments that don't justify a new proposal (room sequence, equipment/power/truck changes) are edited **in Schedule only**, directly on `job_wtcs[].field_sow`.
- **Field is read-only. Always.** No SOW write path from field-command, ever.
- **The proposal is frozen at Send** and never back-filled. Honesty is handled by a **derived badge**, not data backflow: every Schedule edit stamps `sow_revised_at` / `sow_revised_by` on the `job_wtcs` row; the Sales proposal screen checks `sow_revised_at > sent_at` and shows **"SOW updated in Schedule — this version is historical."** The badge is computed from the truth at render time, so it can never lie or go stale.
- **Record-keeping (right-sized at 1 tenant):** who + when + a revision counter on the job copy. No full field-level edit history now; the revision stamp is the hook if we ever want it, no re-architecture needed.
- **`jobs.field_sow` (flat legacy mirror): retire.** Stop writing at Send once verified reader-free (Tier 4, step 9 — plan-only there, with the legacy `materials` table).

### Multi-work-type jobs (the contract doc's test case)

Per-WTC canonical passes it by construction: each WTC carries its own `field_sow`, so a job with 3 work types has 3 independent SOWs — no flat-merge ambiguity. This is exactly what the flat `jobs.field_sow` mirror gets wrong.

---

## 2. Decision #2 — material specs: catalog master, stamped into the SOW `[LOCKED 2026-07-14]`

### The ratified rule

> **One SOW material format everywhere, self-contained, all the data. Specs are entered once on `materials_catalog` (Material Memory) and auto-STAMP (copy) into the SOW material entry at pick time. Stamped specs arrive UNCONFIRMED and must be human-confirmed before Send.**

Chris: *"Anywhere there's an SOW with material, there should only be one format, and it has all the data: coverage rate, kit sizes."*

- **Catalog = the master pad.** Specs (kit size, mils, coverage rate, mix time/speed, cure time, unit) live once per product on `materials_catalog`. Nobody re-types coverage rates job after job.
- **Stamp, not lookup.** Picking a material copies its specs into the SOW entry right then. The SOW document is self-contained forever — a printed ticket from March always matches what was sent in March. Catalog corrections apply to *future* SOWs only; existing SOWs keep what they were stamped with. (Lookup was considered and rejected: a catalog edit would silently rewrite historical SOWs.)
- **Per-job/day override is free:** editing the stamped copy on that day deviates without polluting the catalog default.
- **Stamped ≠ confirmed — the amber gate.** Stamped specs land marked unconfirmed with an amber chip: *"Specs pulled from Material Memory — confirm for this job's conditions."* A human confirms (or edits, then confirms) per material — the moment they check field conditions and manufacturer changes. **Send is gated on it** (joins the existing mobilization pre-send validation). Schedule adding a new material post-Send hits the same confirm gate.
- **Staleness visible:** each spec shows "last updated <date>" from the catalog so an old spec looks old at a glance.

**Failure mode this kills:** manufacturer updates a product, old coverage rate carries silently into an SOW, nobody re-checks, material doesn't go down at the proper rate, job is damaged.

### Why this is completing an existing pattern, not inventing one (verified in code)

The SOW day-material entry **already** carries the spec fields — `WTCCalculator.jsx:736-739`:

```js
{ wtc_material_id, name, kit_size, qty_planned,
  mils: 0, coverage_rate: m.coverage || "", mix_time: 0, mix_speed: "", cure_time: "" }
```

`coverage_rate` already stamps from the catalog's `coverage` column at pick time. The other specs stamp **empty** because the catalog has no columns for them (`materials_catalog` = name, kit_size, price, coverage, supplier only) — so users hand-type mils/mix/cure per job today. Decision #2 = give the catalog the missing columns so the existing stamp auto-fills, then add the confirm gate.

---

## 3. Ownership matrix (bid vs field)

The per-entity contract. **Pipe** names how it physically moves: PostgREST (Sales/Schedule/AR web) vs PowerSync (Field mobile, offline-first).

| Entity | Authored by (writer) | Canonical home | Copy vs reference | Post-Send editor | Readers | Pipe to Field |
|---|---|---|---|---|---|---|
| **SOW days** (`field_sow` array: day_label, date, tasks, crew_count, hours_planned) | Sales, in the proposal WTC | `job_wtcs[].field_sow` after Send | Copy-at-Send | **Schedule only** | Schedule, Field (RO) | PowerSync `job_wtcs` |
| **SOW day measurements** (`sq_ft`, `linear_ft`) | Sales (shipped Screen-1·A) | same | Copy-at-Send | Schedule only | Schedule, Field (RO) | PowerSync `job_wtcs` |
| **Scope notes** (`scope_notes`, NEW per day) | Sales | same | Copy-at-Send | Schedule only | Schedule, Field (RO) | PowerSync `job_wtcs` |
| **Mobilizations** (`mobilization_seq`) | Sales (`proposals.mobilizations`) | `mobilization_seq` on `field_sow` days + `job_mobilizations` | Copy-at-Send | — (contracted 2026-07-13, Phase B) | Schedule, Field (RO) | PowerSync `job_wtcs` |
| **Material allocations** (which material, `qty_planned`, which day, `task_ref` NEW) | Sales in step 3 of the WTC; Schedule may add post-Send | `materials[]` inside the `field_sow` day | Copy-at-Send | Schedule only | Schedule, Field (RO) | PowerSync `job_wtcs` |
| **Material specs** (kit_size, mils, coverage_rate, mix_time, mix_speed, cure_time, unit) | Whoever maintains Material Memory (Sales-side; Admin/Manager per role rules) | `materials_catalog` (master) → **stamped** into each SOW material entry | **Stamp at pick** (self-contained thereafter) | Per-day stamped copy: Schedule. Catalog: Sales-side only (Schedule reads catalog RO — BF-11 scope decision stands) | All apps | Stamped inside `field_sow` via PowerSync `job_wtcs` |
| **Spec confirmation** (`specs_confirmed`, by/at — NEW) | Human confirmer in Sales pre-Send; Schedule for post-Send additions | On the SOW material entry | n/a (lives with the stamp) | Schedule | Send gate, Schedule, Field (RO) | PowerSync `job_wtcs` |
| **SOW revision stamp** (`sow_revised_at/by/count` — NEW) | Schedule, automatically on any post-Send SOW edit | `job_wtcs` row | n/a (derived badge in Sales) | Schedule (automatic) | Sales (badge), audit | n/a (web only) |
| **Task % progress** | Field crew (Phase E — future) | TBD in Phase E plan; likely PRT-adjacent, NOT a `field_sow` write | — | — | Schedule, Field | — (Field writes stay in Field-owned tables; SOW read-only rule holds) |

**Legacy, scheduled to die (Tier 4, step 9):**

| Legacy | Why | Retirement gate |
|---|---|---|
| `jobs.field_sow` (flat merged mirror) | Superseded by per-WTC canonical; breaks multi-WTC jobs | Verify zero readers (Field confirmed on `job_wtcs`, smoke #10159), then stop writing at Send, then drop |
| `materials` table | Schedule's MTRL modal reads it; no specs, no kit_size; superseded by catalog + stamped SOW materials | Every reader moved to the catalog/SOW path (Phase 4 rebuilds MTRL from `field_sow` rollup — folds parked BF-12 `rollupSowMaterials()`) |

---

## 4. Data changes to author (Phase 1 — `command-suite-db` ONLY, per standing rule)

**Not authored yet. This section is the spec for the migration work in wall-chart step 3.**

### 4.1 `materials_catalog` — add spec columns (SQL migration)

```
mils            text        -- application thickness spec
mix_time        text        -- e.g. "3 min"
mix_speed       text        -- e.g. "slow / 300rpm"
cure_time       text        -- e.g. "12hr recoat / 24hr foot traffic"
unit            text        -- application unit if != kit implication
specs_updated_at timestamptz -- stamped when any spec column changes
```

- `kit_size` and `coverage` (rate) already exist — extend the canonical table, don't twin it.
- Spec fields stay **text** — they're human instructions for a printed ticket, matching existing `coverage`/`kit_size` (already text) and the shipped SOW-entry fields; only `qty_planned` does math today. Structured/numeric parsing is a later, additive migration if something ever needs to compute on them.
- `specs_updated_at` is separate from `updated_at` (which fires on price edits) — it drives the "spec last updated <date>" staleness display. Set via trigger on the spec columns.
- RLS unchanged: existing tenant policies stand; write-side role gating follows the standing money-table pattern (`is_admin_or_manager()`), consistent with [[feedback_role_gating]].

### 4.2 `field_sow` day/material jsonb — additive, NO migration

Per suite convention (additive jsonb, Plan 0):

- Day gains: `scope_notes` (text).
- Material entry gains: `task_ref` (link material → its TASK N; blank allowed — UI decision (c), Option A), `unit`, `specs_confirmed` (bool), `specs_confirmed_by`, `specs_confirmed_at`.
- Already present, no change: `sq_ft`, `linear_ft` (shipped Screen-1·A), `mils`, `coverage_rate`, `mix_time`, `mix_speed`, `cure_time` (shipped shape, currently hand-typed).

### 4.3 `job_wtcs` — revision stamp (SQL migration)

```
sow_revised_at    timestamptz
sow_revised_by    uuid
sow_revision_count integer NOT NULL DEFAULT 0
```

Written by Schedule's SOW editor on every post-Send `field_sow` change. Sales badge = `sow_revised_at > sent_at` (derived; zero backflow).

### 4.4 PowerSync note

`job_wtcs` already syncs whole-row to Field (`schema.js:174-180`) — new columns ride along; jsonb additions are invisible to sync. Verify sync-rule column selection during Phase 1 (rule says `SELECT * FROM job_wtcs`; confirm live).

---

## 5. Phase plan (mapped to wall chart §4B)

| DMS-1 phase | Wall-chart step | Repo | What |
|---|---|---|---|
| **0 — this doc** | 2 | sch-command (doc) + contract amendment | Ownership matrix + decisions #1/#2 ratified. **DONE when audited.** |
| **1 — migrations** | 3 | command-suite-db | §4.1 + §4.3 SQL; §4.2 is code-side jsonb. Run `check-migration-safety` + ledger-alignment checks per standing rules. |
| **2 — Sales SOW** | 4–5 (A2) | sales-command | Specs auto-fill from catalog into existing stamp; amber confirm chip + Send gate; scope_notes + task_ref entry; catalog spec-entry UI; **GATE at step 4: decision #3 reskin scope (a)/(b) — design session first, not build-first (ERD #41 lesson)** |
| **3 — Schedule SOW builder** | 7 | sch-command | Reads/edits canonical `job_wtcs[].field_sow`; revision stamping; confirm gate on post-Send material adds; inherits stamped specs |
| **4 — output** | 7 | sch-command | MTRL = Material Order Summary (page 1, per-material totals across days) + per-day ticket cards + print/sign frame; folds parked BF-12 `rollupSowMaterials()` (branch `feat/mtrl-sow-rollup` — fold, then delete) |
| **5 — backfill + retire** | 9 | command-suite-db | Retire `materials` table + `jobs.field_sow` mirror; verify vs job 6618 |

UI decisions already LOCKED in the DMS-1 backlog entry (2026-07-08) carry forward unchanged: (a) day-card header = day_label + TASK count, no "DAY X OF 7" badge; (b) Work-to-Complete = one row per task, "TASK N" + colored % badge (100 green / partial amber), split-day capable; (c) materials tagged with TASK N chip, blank allowed.

---

## 6. Open items

| # | Item | Status |
|---|---|---|
| 1 | **Reference PDF missing on this machine** — `6618 - Lakes Crossing - Material Schedule.pdf` is not on this Desktop (likely the laptop's). Copy into `docs/plans/assets/` before Phase 4 output work. Not needed for Phases 0–3. | OPEN — grab from laptop |
| 2 | Decision #3 — reskin scope (a)/(b) | OPEN — gate at wall-chart step 4, design session |
| 3 | MF4 send-once / re-send | DEFERRED (1 tenant) |
| 4 | Task % progress writer/home | Decide in Phase E plan (Field read-only rule constrains it out of `field_sow`) |

---

*Companion amendment: `docs/plans/command_suite_shared_data_contract.md` — SOW row resolved + specs row registered, same session.*
