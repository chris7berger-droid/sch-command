# DMS-1 Phase 3 — Build Spec (Schedule SOW builder + Logistics)

**Loop:** ERD #44 (`dms1-phase2-sales-sow`, stays open until the ticket prints) · branch `feat/dms1-phase3`
**Scope:** Phase 3 — the Schedule-side read of the SOW + the warehouse's Logistics workspace + one small
Sales-side reach-back (task size/unit). Spans `sch-command` (bulk) + `sales-command` (one slice) +
`command-suite-db` (one additive migration).
**Parent spine:** `daily_material_schedule.md` §3/§4/§5 (Phase 3 = §5 row 3: *RETROFIT, not greenfield*).
**Prior:** Phase 1 (DB columns) + Phase 2 (Sales authoring + Schedule save-protection) — both LIVE 2026-07-28.
**Terminal roles:** Plan terminal (T1) authored + revised this; it does NOT ship code. Build terminal (T3)
executes. Audit terminal (T2) runs `/runaudit`.

> **Revision pass 1 (round-1 audit response, 2026-07-30).** Pattern: `shared-carrier-blindspot`. The
> round-1 fixes collapse the plan: the warehouse tracking table, the coverage flag, and the Settings
> asset lists **already exist live** (plan0 foundation, 2026-07-08). This spec now REUSES them instead of
> building twins. See §1.

---

## §0 Baseline — observed current state (read-verified 2026-07-30, code grep + Read; not run-verified)

**Type:** feature (adds new Schedule-side surface; no pre-existing defect). Evidence from `sch-command`
HEAD `04b93e2`, `sales-command` main, and `command-suite-db` live migrations.

- **Schedule SOW builder — `sch-command/src/components/FieldSowBuilder.jsx`:** `newTask()` (`:22`) =
  `{id, description, pct_complete}` — **no `size`/`unit`**. Materials carry `wtc_material_id` (minted in
  every constructor: `safeId` `:88`, `cat_${uid()}` `:126`, custom `:143`), `catalog_id`, `task_ref`,
  `specs_confirmed` (seeded false via `hasAnySpec` `:102/:135`). `updateMaterialField` (`:159`,
  `numericKeys=['qty_planned']`), `specInput` (`:400`), spec inputs `:469-492`. `handleSave` (`:193`) =
  passthrough spread (Phase-2). **No `SPEC_KEYS` constant, no lock branch today.**
- **Canonical SOW write path — `CardSowModal.jsx`** → `updateJobWtcFieldSow` (`queries.js:598`,
  audit-logged). `FieldSowModal.jsx` = read/print. `loadMaterialsCatalog` (`queries.js:43-46`) selects
  numeric `coverage` + `unit` from `materials_catalog`.
- **Legacy `materials` table** is read by the modal AND by other consumers (see Step 3 reader list). Its
  status vocabulary (`MaterialsModal.jsx:4`) = **Not Ordered / Ordered / In Stock / Delayed**.
- **CANONICAL tracking table ALREADY LIVE — `job_material_lines`** (migration `20260708120200`, live
  2026-07-08). Columns: `job_id` (FK), `material_key` (= the material's `wtc_material_id`), `qty_needed`
  (size ÷ coverage, aggregated across WTCs/days), `qty_ordered`, `coverage_status` (CHECK `OK/VERIFY/SHORT`,
  NULL = not-yet-computed). UNIQUE `(job_id, material_key)`, upsert `ON CONFLICT (job_id, material_key)`.
  **It carries no `status`/`arrival_date`/`notes`** (the four-word screen status lives only on the legacy
  `materials` table today). Migration header (`:5-6,26`, fixed by `20260714120300`) documents: `material_key`
  is the **per-WTC line id**, NOT a product id — so the same product across two WTCs does NOT auto-merge.
- **Settings asset lists ALREADY LIVE** (migration `20260708120000_material_flow_settings_tables`):
  `tenant_vehicles` (`identifier`), `tenant_power` (`spec`), `tenant_equipment`, `tenant_consumables` —
  all tenant-scoped, indexed, RLS'd, updated_at + forbid-hard-delete triggers.
- **Job home — `JobDetail.jsx`:** `PLANNING_TABS` (`:135`) = `[Materials]`; `MANAGEMENT_TABS` (`:139`) =
  `[Overview, Production, Daily Log, Billing, History]`. Overview: Vehicle/Equipment/Power as free-text
  writing single columns `jobs.vehicle/equipment/power_source`. **No SOW tab.**
- **NOT yet built:** task `size`/`unit`; a Needed COMPUTATION (the `qty_needed` column exists but nothing
  writes it); per-JOB asset assignment (which trucks on THIS job + available flag — the `tenant_*` LISTS
  exist, the job↔asset link does not); `status`/`arrival_date`/`notes` on `job_material_lines`.
- **Deployment reality:** `sch-command` prod live but **no office users yet — Chris-only testing**; old
  Apps Script parallel. `sales-command` live prod (HDSP daily). 1 tenant.

**Absence assertions verified by grep:** no task size/unit (both repos), no SOW tab, no writer to
`qty_needed`, no `jobs.*asset*`/`vehicle_ids` migration. Read-verified, not run-verified — §5 smoke is the
run-verification gate.

---

## Design floor — ideation decisions this spec implements (all Chris-ratified 2026-07-30)

Banked in ERD LOG.md Loop #44 NOTES. Restated as the design floor:

1. **One SOW, four ownership STAGES** (Sales → Scheduling → Logistics → Field) — one live `field_sow`,
   not four records; no unique identifier. `[LOCKED]`
2. **Sales authors the first draft of everything** (scope, specs, materials, *proposed* dates/crew/mob);
   each downstream stage FINALIZES its slice. `[LOCKED]`
3. **Two Schedule roles, structurally distinct:** Crew Allocator (time/labor) vs Warehouse Manager
   (materials/logistics). Unified READ, scoped EDIT. `[LOCKED]`
4. **Logistics = trucks + equipment + power + materials.** Keep the screen's four material status words
   (**Not Ordered / Ordered / In Stock / Delayed**) — do NOT adopt the ordering enum. `[LOCKED · ratified 2026-07-30]`
5. **No inventory counting.** Phase 2 laid the piping; Phase 3 computes/displays, does not count stock. `[LOCKED]`
6. **The Materials modal stays its own job area, but becomes a WINDOW onto canonical data** — no drifting copy. `[LOCKED]`
7. **Needed vs Ordered:** read-only Needed beside editable Ordered; the gap is the signal. `[LOCKED]`
8. **Three-state flag:** green ✓ covered / red ⚠ SHORT / amber ? CAN'T-TELL (missing size/coverage —
   never a dash). Backed by the live `coverage_status` column (OK/VERIFY/SHORT + NULL). `[LOCKED]`
9. **Needed math follows the daily task breakout:** each task gets **size + unit (SQFT/LF)** beside its
   `pct_complete`; **Needed = task size ÷ material coverage**. Confirmed vs Chris's original Excel. `[LOCKED]`
10. **Confirm/lock (simplifies DMS-2):** Sales-confirmed specs LOCK; adding more of a confirmed material
    inherits; a NEW/SWAPPED material is unconfirmed and must be confirmed in Schedule before it can print;
    warehouse override of a locked spec requires a typed reason (logged, re-confirmed, shown downstream). `[LOCKED]`
11. **Job-home layout** (preserve `JobDetail` tabs): NEW read-only **SOW** tab; RENAME **Materials →
    Logistics**; Overview stays the scheduler's room. `[LOCKED]`

---

## §1 Data home — REUSE the live `job_material_lines` (R1 resolved: not A, not A′, REUSE)

`[LOCKED · round-1 resolution]` The round-1 audit prescribed a new `job_material_tracking` table (A′);
my draft proposed a jsonb map on `job_wtcs` (A). **Both were twins of a table that already exists live.**

- **Warehouse tracking lives in `job_material_lines`** (live since 2026-07-08), keyed by
  **`(job_id, material_key)` where `material_key = wtc_material_id`.** This satisfies the audit's own item 3
  (key on `wtc_material_id`) and its shared-carrier finding (a proper table, NOT jsonb inside the synced
  `field_sow`). **`mat_uid` is DELETED** — `wtc_material_id` is the existing key.
- **Grain: per-job.** One row per `(job_id, material_key)` (the table's UNIQUE index). `material_key` is a
  per-WTC line id (not a product) — so a product used in two WTCs yields two rows; the modal groups for
  display but the storage grain stays per-line-per-job. `[LOCKED — respects the live schema, §2 handles the grouping]`
- **Column reuse:** `qty_needed` (Needed), `qty_ordered` (Ordered), `coverage_status` (flag OK/VERIFY/SHORT).
- **Additive columns to add** (the only tracking schema change — §4): `status text` (the four screen words,
  CHECK `Not Ordered/Ordered/In Stock/Delayed`), `arrival_date date`, `notes text`. These are the modal
  fields `job_material_lines` lacks. Additive; distinct from the live `material_status` ordering enum.
- **PowerSync:** verify `job_material_lines` is not on the crew's REQUIRED read/sync path (MIG-4 notes the
  single un-filtered bucket). If it syncs, that is unused warehouse rows on the phone, not a correctness
  break — but confirm nothing in Field READS it. Do not add it to `field-command/schema.js`. `[verify in build]`

---

## §2 The Needed rollup → writes `job_material_lines.qty_needed` + `coverage_status`

`[DERIVED]` Pulled forward from §5 Phase 4 (the modal needs it now; Phase-4 print reuses it). New pure
helper `rollupSowMaterials(fieldSow, catalogById)` in new `src/lib/sowMaterials.js` (no I/O), plus an
**audit-logged** writer that upserts `job_material_lines` `ON CONFLICT (job_id, material_key)`.

**Needed math (numeric, catalog-sourced — audit item 2):**
- Per material, resolve **coverage + unit from the catalog by `catalog_id`** (`materials_catalog.coverage`,
  `.unit` — numeric, `queries.js:46`), NOT by parsing the free-text `coverage_rate` on the SOW line.
- `qty_needed = task.size ÷ catalog.coverage`, aggregated across every day/WTC the material's tagged to
  (`ON CONFLICT` sums per `(job_id, material_key)`). Unit (SQFT/LF) on the task must match `catalog.unit`.
- **NO round-up** (audit item 2 — "drop or numerically define"): store the raw quotient in `qty_needed`;
  display may round for readability but the stored value is exact. Round-up mechanism struck.
- **`coverage_status` derivation:** `qty_ordered ≥ qty_needed` → `OK` (green); `< qty_needed` → `SHORT`
  (red); **cannot compute → `VERIFY`/NULL** (amber ? CAN'T-TELL).
- **CAN'T-TELL reason enum (named — audit item 2):** `NO_TASK_TAG` (blank `task_ref`), `NO_TASK_SIZE`
  (task `size` null), `NO_COVERAGE` (catalog coverage null), `UNIT_MISMATCH` (task unit ≠ catalog unit),
  `NO_CATALOG` (custom material, no `catalog_id`). The flag names the reason; a wrong number never shows.
- **Cross-WTC:** the job's modal rolls up across all WTCs' `field_sow`; storage stays per
  `(job_id, material_key)` per the live grain. `[verify multi-WTC job in smoke]`

---

## §3 Ordered build steps

Sequencing: **Sales (Step 0) deploys to prod FIRST, then Schedule** — Schedule's Needed can't compute
until tasks carry a size (audit item 6; no "same-deploy").

### Step 0 — Sales: size + unit per task `[LOCKED intent · DERIVED UI]`
**Repo:** `sales-command` · `src/pages/WTCCalculator.jsx` (`newTask` `:944`, task row `:1183-1198`).
- `newTask()` gains `size: null, unit: 'SQFT'`. **Old tasks seed `size: null`, NOT `0`** (audit item 6) —
  so un-authored tasks fire CAN'T-TELL (`NO_TASK_SIZE`), never a false "0 needed".
- **Task coercion is a keyed map, not blanket `parseFloat`** (audit item 6): `{ size: v => v===''? null :
  (parseFloat(v)||null), unit: v => v }` — `unit` passes through as text; other task keys unchanged.
- UI: size number + SQFT/LF toggle (restrict the existing `UNITS` to SQFT/LF for tasks) beside `pct_complete`.
- jsonb-additive, no migration; rides `field_sow`.
- **Acceptance:** author `5100 LF` + `10%/day`, Send → task carries `size`+`unit`; old task reads `size:null`.

### Step 1 — Schedule: pass through + display task size/unit `[LOCKED]`
**Repo:** `sch-command` · `FieldSowBuilder.jsx` (`newTask` `:22`, task render `:293-339`).
- Mirror `newTask` = `{...,size:null,unit:'SQFT'}`; keyed coercion (`size`→num-or-null, `unit`→text).
- Read-only in Schedule (Sales authors; scheduler finalizes dates/crew, not task sizes — §Step 8). `[DERIVED]`
- **Acceptance:** a Phase-0 SOW shows each task's size+unit in Schedule; save/reload preserves.

### Step 2 — Schedule: SOW read-only tab `[LOCKED]`
**Repo:** `sch-command` · `JobDetail.jsx` (`PLANNING_TABS` `:135`).
- Add `{key:'sow',label:'SOW'}`. Render read-only: per-day scope notes, tasks (desc+size/unit+%), materials
  with specs as TEXT (non-empty checks, no `" min"` suffix — spine §4.2 A2 rule). Reuse `FieldSowModal.jsx`.
- **Acceptance:** SOW tab shows what Sales authored; no editable fields; text specs visible.

### Step 3 — Schedule: rename Materials → Logistics + repoint ALL `materials`-table readers `[LOCKED]`
**Repo:** `sch-command` · `JobDetail.jsx`, `MaterialsModal.jsx`, `Materials.jsx`, `queries.js`, new `sowMaterials.js`.
- Rename tab label `Materials → Logistics`; keep/redirect `/materials` route (audit for stale `key` refs).
- **Materials section** = `job_material_lines` (Needed/Ordered/`coverage_status`) joined to the SOW rollup
  (§2) for display; columns: Material · Kit · **Needed** (read-only `qty_needed`) · **Ordered** (editable
  `qty_ordered`) · Status (four words, new `status` col) · **Flag** (green/red/amber ← `coverage_status`) ·
  Arrival · Notes. Reuse `STATUS_OPTIONS`/`statusColor` verbatim.
- **Enumerate + repoint EVERY `materials`-table reader** (audit item 5 — miss one and the job-promotion
  gate reads a dead table and auto-promotes). Known readers to repoint at `job_material_lines`:
  - `queries.js:73-84` — `baseChecklistPasses`/`isReady` (`materialsDecided` gate) **← highest risk**
  - `views/Jobs.jsx` — `loadAllRows('materials',…)` → `matsByJobId` feeding `isReady`
  - `views/Materials.jsx:127/193/213/227` — the `/materials` view reads + writes `materials`
  - `lib/exports.js:113` — `from('materials')` export
  - `components/StageJobCard.jsx` — MTRL signal (verify lines; audit cited `:122/229`)
  - **Build MUST re-grep** `\.from\(['"]materials['"]\)|loadAllRows\(['"]materials['"]` across `src/` and
    repoint each hit; enumerate the full list in the revision, no silent cap.
- **All writes audit-logged** (audit item 5): route through a new `queries.js` writer with `job_changes`
  logging — do NOT copy the raw `.update()` from `MaterialsModal.jsx:40-49`.
- **Acceptance:** correct Needed per material; a short material red; missing-coverage amber with reason;
  status/arrival/notes persist to `job_material_lines`; **the promotion gate reads `job_material_lines`,
  not the dead `materials` table**; every write hits `job_changes`.

### Step 4 — Schedule: warehouse add-material `[LOCKED core · DESIGN-OPEN attach point]`
**Repo:** `sch-command` · catalog picker path + the §2 writer.
- Warehouse adds via the existing catalog picker; the add writes to `field_sow` (so Needed computes) +
  upserts its `job_material_lines` row. New/swapped → `specs_confirmed=false` (§7).
- **DESIGN-OPEN (R5):** which day/task a warehouse-add attaches to (frequent path). Proposal: attach to a
  chosen day/task, defaulting to a "warehouse additions" bucket day. Settle with Chris or at build.
- **Acceptance:** warehouse add appears with Needed (or CAN'T-TELL), editable Ordered/status, persisted.

### Step 5 — Schedule: assign trucks/equipment/power to a job `[LOCKED intent · new job↔asset home]`
**Repo:** `sch-command` + `command-suite-db` (migration).
- Vehicle/Equipment/Power become **pick-many** from the live `tenant_vehicles`/`tenant_equipment`/
  `tenant_power` lists, each pick marked **Available / Unavailable (per-job)**.
- **The per-JOB assignment has no home today** (the LISTS exist; the job↔asset link does not). Add it as a
  small additive structure — proposal: a `job_assets` table `(job_id, asset_type, asset_id, available bool)`
  in `command-suite-db` (§4). Keep old `jobs.vehicle/equipment/power_source` text readable during
  transition; don't strip. `[DERIVED — confirm table vs jsonb]`
- **Acceptance:** pick two trucks + one generator from Settings, mark one Unavailable; per-job persist; shows in Logistics.

### Step 6 — Schedule: Settings UI over the EXISTING asset lists `[LOCKED — no new tables]`
**Repo:** `sch-command` (new Settings view) — **tables already exist** (`tenant_*`, live, RLS'd; audit item 7 confirmed).
- Build a minimal per-tenant list editor UI over `tenant_vehicles`/`tenant_equipment`/`tenant_power`
  (add/edit/soft-delete; the forbid-hard-delete trigger already guards). No schema work here.
- **Acceptance:** customer adds "F-350 + trailer" to the Vehicle list → it appears in the Step-5 picker.

### Step 7 — Schedule: confirm/lock + override escape hatch `[LOCKED · locate in code]`
**Repo:** `sch-command` · `FieldSowBuilder.jsx` / `CardSowModal.jsx`.
- **Define `SPEC_KEYS`** in `FieldSowBuilder.jsx` = `{mils, coverage_rate, mix_time, mix_speed, cure_time,
  unit}` (there is none today — audit item 4).
- **Lock, located in code (audit item 4):** (1) `specInput` (`:400`) gains an **`isLocked` branch** —
  when `m.specs_confirmed === true`, render specs read-only; (2) `updateMaterialField` (`:159`) **rejects**
  writes to any `SPEC_KEYS` key on a locked material (no-op + guard); (3) the reset-downgrade (DMS-2) —
  editing a `SPEC_KEYS` value on an UNconfirmed material downgrades `specs_confirmed` true→false (mirrors
  Sales `WTCCalculator.updateField`). Confirmed specs are locked, not reset.
- **Print gate predicate, defined NOW (audit item 4):** a material **cannot print** iff
  `specs_confirmed !== true && hasAnySpec(m)`. Phase 3 sets/holds `specs_confirmed` correctly and ships this
  predicate as the contract; **Phase 4 enforces the actual block at print** (no printer in Phase 3). The
  Phase-3 acceptance is therefore flag-state + predicate correctness, not a live print block.
- **Override escape hatch:** editing a LOCKED spec requires a typed reason (non-skippable) → write new value,
  log `{by,at,old,new,reason}` (jsonb `spec_overrides[]` on the material), re-confirm as warehouse-confirmed,
  surface "coverage changed by warehouse: <reason>" on the SOW tab + Phase-4 ticket.
- **Acceptance:** a Sales-confirmed spec is read-only + `updateMaterialField` rejects its edit; editing an
  unconfirmed spec downgrades the flag; overriding a locked spec forces a reason and logs it; the
  print-gate predicate returns true (cannot print) for `unconfirmed + hasAnySpec`.

### Step 8 — Schedule: crew-allocator "finalize" of Sales' proposal `[DESIGN-OPEN — likely labels only]`
**Repo:** `sch-command` · Overview + existing Schedule board.
- Sales proposes dates/crew/mob; scheduler FINALIZES. Today's board already sets dates/crew → likely a
  "proposed vs finalized" label/badge, not new mechanism. `[DESIGN-OPEN — verify current board first (R7).]`
- **Acceptance:** scheduler sees proposed values, can finalize/adjust; ownership visible.

---

## §4 Data-model summary

- **jsonb-additive, NO migration:** task `size`/`unit`; `spec_overrides[]`; confirm stamps.
- **REQUIRED additive migration — `command-suite-db` ONLY, `npm run db:push` + rehearsal** (audit item 7 —
  NOT "no migration"):
  1. `ALTER job_material_lines ADD status text` (CHECK the four words) `+ arrival_date date + notes text`.
  2. `job_assets (job_id, asset_type, asset_id, available bool)` — the per-job asset assignment home (§Step 5).
  - Both additive, no data rewrite; rehearse from a prod-shaped throwaway before push (standing rule); one
    migration, ledger-aligned.
- **Reused live, NO schema work:** `job_material_lines` (`qty_needed`/`qty_ordered`/`coverage_status`),
  `tenant_vehicles`/`tenant_equipment`/`tenant_power`.
- **PowerSync:** task size/unit + overrides ride `field_sow` (crew-visible, correct). `job_material_lines`
  + `job_assets` are web-only — confirm not on the Field required read path; no `schema.js` change.
- **Legacy `materials` table:** Phase 3 STOPS reading it (all readers repointed, §Step 3); Phase 5 drops it.

---

## §5 Deploy / verification / sequencing

- **Order:** Sales (Step 0) → prod first. Then the `command-suite-db` migration (§4). Then Schedule. No same-deploy.
- **Preview-deploy each repo's branch; verify on preview** (never localhost-only for shared surface).
- **Smoke (shared DB):** author a 6618-style SOW with per-task sizes → SOW tab shows it → Logistics shows
  Needed-vs-Ordered with correct flags (incl. a deliberate SHORT + a CAN'T-TELL with named reason) →
  warehouse add + confirm + one locked-spec override-with-reason → **promote the job and confirm the gate
  reads `job_material_lines`** → reload survives. Include a **multi-WTC job** (rollup grain).
- **Gate through terminals:** buildvsplan (T4) → code-review (T5) → security-review (T6) before merge.
- **Phase 3 done when:** the warehouse opens any job, sees honest Needed-vs-Ordered per material, tracks
  status + trucks/equipment, the confirm/lock holds, and the promotion gate reads canonical data — leaving
  `field_sow` + `job_material_lines` ready for Phase 4 to PRINT.

---

## §6 Ratification items (Chris — before build)

| # | Item | Resolution | Tag |
|---|------|-----------|-----|
| R1 | Warehouse tracking data-home | **REUSE `job_material_lines`** (live) — not A/A′. Ratified 2026-07-30 | LOCKED |
| R1b | Material status words | Keep the screen's four (add as `status` col) — ratified 2026-07-30 | LOCKED |
| R2 | Pull `rollupSowMaterials()` into Phase 3 | Yes — writes the live `qty_needed` | DERIVED |
| R3 | Round-up on Needed | **Struck** — store exact quotient | LOCKED |
| R4 | Task size read-only in Schedule | Yes (Sales authors) | DERIVED |
| R5 | Where a warehouse-add attaches (day/task) | needs a beat / build call | DESIGN-OPEN |
| R7 | Step 8 finalize — new mechanism or labels? | verify current board first | DESIGN-OPEN |
| R8 | `job_assets` per-job home: table vs jsonb | table proposed | DERIVED |

---

## Audit manifest

_Generated by `/auditcriteria` (round 1), restamped after revision pass 1 (2026-07-30). Consumed by `/runaudit`._

### Bottom line (plain English)
The big round-1 fix already happened: we found the warehouse tracking table, the covered/short flag, and
the truck/equipment lists **already exist** — so this revision reuses them instead of building duplicates,
and the plan got smaller. Round 2 is a lighter check on three things: that we're reading/writing that
existing table correctly (especially the tricky "same material in two work-types" case), that we repointed
**every** old reader so the job-promotion gate can't read a dead table, and that the one small database
change is done safely.

### Round
- Plan type: feature
- Current round: 2
- Plan revision under audit: revision pass 1 (sha stamped at this commit)
- Findings trend: round 1 (5H/2M + 4 adjacent) → round 2 (?) — expect DOWN (reuse dissolved the twin-table findings)

### Prior rounds
- Round 1: `f23de81` · 5H/2M + 4 adjacent · pattern: `shared-carrier-blindspot`

**Briefing for agents**: do NOT re-find round-1 issues (twin-table home, mat_uid, coverage parse, reader
repoint, deploy order — all addressed in revision pass 1). Attack ONLY the reuse as written. Cite
`file:line` / `migration:line` you read this round.

### Deployment context
- **Live tenants**: 1 — HDSP only.
- **Prod / staging / dev**: `sch-command` live but no office users yet (Chris-only testing); `sales-command`
  live prod; `command-suite-db` migration hits the shared prod DB (rehearse first).
- **Blocking feature flags**: none.
- **Concurrency profile**: solo. Multi-user race findings cap at Low; cross-tenant cap at Med while `live_tenants == 1`.

### Time budget + finding cap
- **Time budget**: ~150 min (Chris-confirmed).
- **Finding cap**: 15 findings.

### Surface
- Total lines: ~ (regenerated) · Sections: 10 (h2)
- [LOCKED]: majority (reuse resolved most forks) · [DESIGN-OPEN]: 2 (R5, R7/Step 8) · [DERIVED]: ~5
- Plan shrank vs round 1 (twin table + jsonb map + mat_uid + new Settings tables all removed).

### Layers touched
- UI / components (SOW tab; Materials→Logistics; Settings list editor; Overview asset pickers)
- Data layer (new `sowMaterials.js` rollup; new audit-logged `job_material_lines` writer; repoint all `materials` readers)
- State model (task size/unit; `job_material_lines` +status/+arrival/+notes; `job_assets`; `spec_overrides[]`)
- Migrations / schema (ONE additive command-suite-db migration: `job_material_lines` cols + `job_assets`)
- Cross-repo (sales-command Step 0; command-suite-db migration)
- Real-time / sync (confirm `job_material_lines`/`job_assets` not on Field required path)
- Audit logging (all Logistics writes → `job_changes`)

### New mechanisms introduced
- Helper: `rollupSowMaterials()` (Needed math + named CAN'T-TELL reason enum) in `src/lib/sowMaterials.js`
- Audit-logged writer for `job_material_lines` (upsert ON CONFLICT)
- Additive cols: `job_material_lines.status/arrival_date/notes`; new `job_assets` table
- Lock mechanism: `SPEC_KEYS` + `specInput` isLocked branch + `updateMaterialField` reject + reset-downgrade + print-gate predicate
- Task size/unit (Sales)
- **Reused, NOT new:** `job_material_lines`, `tenant_*` asset tables, `coverage_status`, `qty_needed/qty_ordered`

### Cross-system reach
- `sales-command` Step 0 (deploys prod FIRST)
- `command-suite-db` (the one additive migration; shared ledger; rehearse)
- `field-command`/PowerSync (confirm web-only tables don't reach the crew's required read)

### Irreversibility
- Additive migration only (new cols + new table); no destructive/backfill; reversible.
- `materials` table read-repointed (code, reversible); table NOT dropped in Phase 3.

### Known weak points
- **`material_key` semantics (§1/§2):** it's a per-WTC LINE id, not a product — a product in two WTCs yields
  two rows. Does the modal's grouping + the `qty_needed` aggregation handle that without double-count or
  merge-that-doesn't-happen? Prime target.
- **Reader-repoint completeness (§Step 3):** the `isReady`/`baseChecklistPasses` promotion gate
  (`queries.js:73-84`) MUST read `job_material_lines`; any missed `materials` reader silently breaks a gate.
- **Coverage source (§2):** catalog numeric `coverage`/`unit` vs the SOW line's text `coverage_rate` — is
  the catalog value always present for stamped materials, or does CAN'T-TELL (`NO_COVERAGE`) fire correctly?
- **Migration safety (§4):** additive to a LIVE table on the shared prod DB — rehearsal + ledger alignment;
  the `status` CHECK must not reject existing rows (there may be 0 today — verify).
- **Print-gate predicate is defined but enforced in Phase 4** — confirm no Phase-3 acceptance over-claims a live block.

### Open questions
- Count: 2 [DESIGN-OPEN] (R5 warehouse-add attach point; R7/Step 8 finalize scope).
- Highest-pressure: R5 (frequent path, under-specified).

### Suggested attack angles (3 total)
1. **Reuse correctness of `job_material_lines`** — covers Data layer + State model. Reading:
   `migration 20260708120200`, `§1`, `§2`, `queries.js:43-46`, `FieldSowBuilder.jsx` constructors. Pressure:
   `material_key` per-WTC-line semantics, cross-WTC aggregation, coverage source, `coverage_status`/reason mapping.
2. **Reader-repoint + promotion-gate + audit logging** — covers Data layer + Audit. Reading: `queries.js:73-84`,
   `Jobs.jsx`, `Materials.jsx`, `exports.js:113`, `StageJobCard.jsx`, `MaterialsModal.jsx`. Pressure: any
   missed `materials` reader; gate reading a dead table; raw un-logged writes.
3. **Migration + deploy order + lock coverage** — covers Migrations + Cross-repo + business logic. Reading:
   `§4`, `§5`, Step 0, Step 7, `command-suite-db` ledger/rehearsal conventions. Pressure: additive-safety on
   a live table, Sales-first deploy order, and whether the lock holds across every spec edit path.

### Suggested agent count: 3

Rationale: reuse collapsed the surface — cross-system + novel mechanisms dropped, so the round-2 verification
folds cleanly into 3 non-overlapping angles (reuse correctness / reader-repoint / migration+lock). Below 3
would blur the promotion-gate risk into the rollup angle; above 3 is over-staffing a shrinking plan.
