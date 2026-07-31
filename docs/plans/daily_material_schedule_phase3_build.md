# DMS-1 Phase 3 — Build Spec (Schedule SOW builder + Logistics)

**Loop:** ERD #44 (`dms1-phase2-sales-sow`, stays open until the ticket prints) · branch `feat/dms1-phase3`
**Scope:** Phase 3 — the Schedule-side read of the SOW + the warehouse's Logistics workspace + one small
Sales-side reach-back (task size/unit). Spans `sch-command` (bulk) + `sales-command` (one slice) +
`command-suite-db` (one additive migration).
**Parent spine:** `daily_material_schedule.md` §3/§4/§5 (Phase 3 = §5 row 3: *RETROFIT, not greenfield*).
**Prior:** Phase 1 (DB columns) + Phase 2 (Sales authoring + Schedule save-protection) — both LIVE 2026-07-28.
**Terminal roles:** Plan terminal (T1) authored + revised this; it does NOT ship code. Build terminal (T3)
executes. Audit terminal (T2) runs `/runaudit`.

> **Revision pass 2 (round-2 audit response, 2026-07-30).** Pattern: `reuse-rests-on-false-premise`. Round 2
> caught two false premises the round-1 reuse pivot introduced: catalog coverage/unit are **TEXT and mostly
> blank** (not numeric), and `job_material_lines` is **empty/unwritten** (not a populated table to "reuse").
> Both corrected here. **Coverage source ratified (2026-07-30): the SOW line's own `coverage_rate`** (the WTC
> Materials "Coverage Rate" field, estimator-entered per job) — parse the number+area-unit from that text;
> the catalog-coverage join is DELETED. Pass 2 corrects premises + tightens; it adds no new surface.
>
> **Revision pass 3 (round-3 response — CONVERGED, 2026-07-30).** Round 3 = 0 regressions, 0 High, 4 Med + 2
> Low (`converged-parse-hardening`); plateau broken. Pass 3 folds the 6 refinements: denominator-required
> coverage parse + comma-strip (§2); `{SQFT,LF}` normalize + `UNIT_UNSUPPORTED` (§2); stable logical-task
> grouping + build-verify for the 3× overcount (§2, item 6); realtime publication for `job_material_lines`
> (§4); cross-tenant `asset_id` trigger (§4); bespoke writer logs to `job_changes` with a line-identifying
> field (Step 3); task coercion keeps a `parseFloat` fallthrough for `pct_complete` (Step 0). **BUILD-READY —
> no round 4 for architecture.**

---

## §0 Baseline — observed current state (read-verified 2026-07-30, code grep + Read; not run-verified)

**Type:** feature. Evidence from `sch-command` HEAD `04b93e2`, `sales-command` main, `command-suite-db` migrations.

- **Schedule SOW builder — `FieldSowBuilder.jsx`:** `newTask()` (`:22`) = `{id, description, pct_complete}`
  — no `size`/`unit`. Materials carry `wtc_material_id` (constructors `:88/:126/:143`), `catalog_id`,
  `task_ref`, `coverage_rate` (TEXT, stamped from the WTC line), `specs_confirmed` (`hasAnySpec` `:102/:135`).
  `updateMaterialField` (`:159`, `numericKeys=['qty_planned']`), `specInput` (`:400`), spec inputs `:469-492`.
  `handleSave` (`:193`) passthrough spread. No `SPEC_KEYS`, no lock branch today.
- **Coverage is TEXT and usually blank (REG-1 corrected).** `materials_catalog.coverage`/`unit` are TEXT
  (migration `20260714120000:11-14`: *"coverage... already text"*); ~161 seed rows store `coverage = ''`.
  **The populated, per-job coverage is the WTC Materials line's `coverage_rate`** (auto-filled from the
  price list, estimator-editable — screenshot 2026-07-30), stamped onto each SOW material. §2 sources from
  there, not the catalog.
- **Canonical SOW write path — `CardSowModal.jsx`** → `updateJobWtcFieldSow` (`queries.js:598`, audit-logged).
  `FieldSowModal.jsx` = read/print.
- **`job_material_lines` is LIVE BUT EMPTY (REG-2 corrected; live shape re-verified 2026-07-30 build).**
  Migration `20260708120200` created it. **Actual live columns (`information_schema` 2026-07-30 — §0 prior
  draft under-described this; corrected here):** `id uuid pk`, `job_id int8 NOT NULL` (FK `jobs(job_id) ON
  DELETE CASCADE`), `material_key text NOT NULL` (= `wtc_material_id`), **`name text NOT NULL`**, `kit_size
  text`, `coverage text`, `supplier text`, `qty_needed numeric`, `qty_ordered numeric`, `qty_received
  numeric`, `coverage_status text` (CHECK `NULL OR OK/VERIFY/SHORT`), `received_at timestamptz`, `received_by
  uuid`, `created_at`, `updated_at`. UNIQUE `(job_id, material_key)` present as index
  `idx_job_material_lines_job_id_material_key_uniq` → upsert `ON CONFLICT (job_id, material_key)` works.
  Additional CHECK `qty_* >= 0`. RLS 4-policy jobs→call_log.tenant_id chain (`job_material_lines.sql:103-168`),
  forbid-hard-delete trigger. **`name` is NOT NULL → the writer MUST populate it (and `kit_size/coverage/
  supplier` as SOW-derived display) on insert** (see §1 writer-set list). The 4 migration cols
  (`status/arrival_date/notes/coverage_reason`) genuinely do not exist yet → additive-safe. Note `coverage`
  (existing display text) is DISTINCT from the new `coverage_reason` (CAN'T-TELL enum). **Nothing writes it**
  (grep both apps = 0). So Phase 3 is a **fresh write path onto an empty table**, not a reuse of populated data.
- **REALTIME (verified 2026-07-30 build): `supabase_realtime` publishes ONLY `jobs`.** `materials` is NOT
  published — so the `channel('materials-changes')` (`Jobs.jsx:251`, `postgres_changes` on `public.materials`)
  **has never fired**; the board has never live-refreshed on material changes. **Board-freeze is pre-existing,
  NOT caused by Phase 3.** The §4 migration adds `job_material_lines` to the publication, so repointing the
  channel (Step 3) is a net improvement over today's dead channel — zero regression. (Aside: `assignments` is
  also unpublished → `assignments-changes` also dead; filed as BACKLOG DMS-4, out of Phase-3 scope.)
- **Legacy `materials` table** — read by MANY consumers (Step 3 list) INCLUDING a realtime channel
  (`Jobs.jsx:251` `channel('materials-changes')`) and the job-promotion gate (`queries.js:73-84`). Status
  words (`MaterialsModal.jsx:4`) = Not Ordered / Ordered / In Stock / Delayed.
- **Settings asset lists LIVE** (`20260708120000_material_flow_settings_tables`): `tenant_vehicles`,
  `tenant_power`, `tenant_equipment`, `tenant_consumables` — tenant-scoped, RLS'd, indexed.
- **Job home — `JobDetail.jsx`:** `PLANNING_TABS` (`:135`)=[Materials]; MANAGEMENT=[Overview…]. Overview
  Vehicle/Equipment/Power = free-text → `jobs.vehicle/equipment/power_source`. No SOW tab.
- **Deployment reality:** `sch-command` live, no office users yet (Chris-only); `sales-command` live prod; 1 tenant.

---

## Design floor — ideation decisions (all Chris-ratified 2026-07-30)

1. One SOW, four ownership STAGES (Sales→Scheduling→Logistics→Field); no unique id. `[LOCKED]`
2. Sales authors first draft of everything (incl. proposed dates/crew/mob); downstream FINALIZES its slice. `[LOCKED]`
3. Two Schedule roles distinct: Crew Allocator (time/labor) vs Warehouse (materials/logistics). Unified READ, scoped EDIT. `[LOCKED]`
4. Logistics = trucks+equipment+power+materials. Keep the four material status words. `[LOCKED]`
5. No inventory counting. `[LOCKED]`
6. Materials modal = a WINDOW onto canonical data, no drifting copy. `[LOCKED]`
7. Needed vs Ordered; the gap is the signal. `[LOCKED]`
8. Three-state flag green ✓ / red ⚠ SHORT / amber ? CAN'T-TELL, backed by `coverage_status`. `[LOCKED]`
9. **Needed = task size ÷ material coverage** (per task). `[LOCKED]`
10. Confirm/lock: Sales-confirmed specs lock; new/swapped confirm in Schedule; override needs a typed reason. `[LOCKED]`
11. Job-home layout: new read-only SOW tab; rename Materials→Logistics; Overview stays scheduler's. `[LOCKED]`

---

## §1 Data home — `job_material_lines`, a FRESH write path onto an empty table (REG-2 corrected)

`[LOCKED · round-2 reframe]` `job_material_lines` exists live but is **empty**. Phase 3 is the code that
first WRITES it. Not "reuse populated data" — a new write path onto the canonical (already-migrated) home.

- **Grain: one row per REAL logical material need** `[REG-4 corrected · Chris-ratified 2026-07-30]`, keyed
  `(job_id, material_key = wtc_material_id)` (the table's UNIQUE index). **The prior "3 days = 3 rows" rested
  on a false premise** — build found `wtc_material_id` is NOT unique per day-line: proposal-sourced materials
  reuse `String(source.id)` every day, so the UNIQUE index collapses N days to ONE row (3 rows is physically
  impossible on the dominant path); only catalog/custom adds mint a fresh id per day. So the writer keys on
  the **stable logical need** (`rollupSowMaterials` groups by normalized task.description + catalog_id ??
  product) and upserts **one row per need**, using the group's representative `wtc_material_id` as the key.
  This matches the proposal path exactly (already one row) and gives the warehouse one Ordered box per
  material. `mat_uid` deleted. BUILD-VERIFY (`sowMaterials.verify.mjs`, 26/26) proves no N× overcount.
- **Additive columns (§4):** `status text` (four words, CHECK), `arrival_date date`, `notes text`,
  `coverage_reason text` (§2's CAN'T-TELL reason, persisted with the row).
- **Two ownership classes of column on the row — the writer must respect the split (Chris-ratified
  2026-07-30, corrected for the live `NOT NULL` shape):**
  - SOW-DERIVED (writer SETs/replaces — on insert AND every upsert): `job_id`, `material_key`, **`name`**
    (product name — NOT NULL, required on insert), **`kit_size`**, **`coverage`** (text display = the SOW
    `coverage_rate`), **`supplier`**, `qty_needed`, `coverage_status`, `coverage_reason`.
  - WAREHOUSE-OWNED (writer NEVER touches): `qty_ordered`, `status`, `arrival_date`, `notes`, and the
    receiving fields `qty_received`, `received_at`, `received_by` (plan-0 receiving workflow — leave alone).
  - `ON CONFLICT (job_id, material_key) DO UPDATE SET` must list **only the SOW-derived columns**, so a
    re-run never clobbers warehouse-owned values. `coverage` (text) and `coverage_reason` (enum) stay separate.
- **When rows are created / the seeder (REG-2):** the rollup writer (§2) runs on **(a)** every SOW save
  (`CardSowModal`/`FieldSowBuilder` `handleSave`), and **(b)** lazily on Logistics-tab open (seeds jobs
  sent before this feature). Each run upserts one row per current SOW line, SETting only the SOW-derived
  columns. **Orphan cleanup:** a material removed from the SOW → delete its `job_material_lines` row (or the
  gate/print would count a phantom). `[DERIVED — confirm delete-vs-tombstone in build]`
- **PowerSync:** `job_material_lines` is web-only warehouse data — do NOT add to `field-command/schema.js`;
  confirm nothing in Field READS it. `[verify in build]`

---

## §2 The Needed rollup → writes `job_material_lines` (SET, per line, no summing)

`[LOCKED math · round-2 corrected]` New pure helper `rollupSowMaterials(fieldSow)` in `src/lib/sowMaterials.js`
(no I/O) + an **audit-logged** writer (`queries.js`) that upserts per line.

**Coverage source + parse spec (ratified option i, from the SOW line — audit item 0):**
- Coverage = the SOW material's own **`coverage_rate` TEXT** (estimator-entered per job). **No catalog join.**
- **Parse (round-3 hardened, item 1):** strip commas first, then `parseFloat` the leading numeric token =
  the coverage number. **A rate REQUIRES a denominator token** — `per` or a dispense unit
  (`gal|kit|unit|pail|can|box`); e.g. `"200 sqft/gal"` → 200, area-unit SQFT, per gal. A **range**
  (`"130 to 154"`) or a **missing denominator** → `coverage_reason = NO_COVERAGE` (don't treat a bare
  number or a range as a rate).
- **Unit check (round-3 hardened, item 2):** normalize to exactly **{SQFT, LF}** (`sf`→SQFT, `ft`→LF); compare
  `task.unit` to the parsed **coverage numerator area-unit** (NOT `catalog.unit`, a free-text spec field).
  - area-unit ≠ task.unit → `UNIT_MISMATCH`; **task.unit ∉ {SQFT, LF} → `UNIT_UNSUPPORTED`** (distinct reason).

**Needed (audit item 2 — per line, SET, never additive):**
- `qty_needed` for a line = `task.size ÷ parsed_coverage_number` (task the line is tagged to). Writer **SETs
  (replaces)** `qty_needed`; **drop "ON CONFLICT sums across WTCs/days"** — one row = one line = its own quotient.
- **No round-up** (struck round 1): store the exact quotient; display may round.
- **Display grouping must NOT sum quotients — and `task_ref` is NOT a safe grouping key (round-3 item 6).**
  `task_ref` is a **fresh uid minted per day** (`newTask()` runs per day), so the "same" logical task on 3
  days has 3 different `task_ref`s — grouping on `(task_ref, product)` would NOT dedupe and the 3× overcount
  survives. **Group on a STABLE logical-task identity** = `(normalized task.description, catalog_id ??
  product)`, read the task's total size once, show a task's material need ONCE. **BUILD-VERIFY (item 6):**
  test the same-material-across-3-days case and confirm no 3×; if `task.description` proves unreliable as
  identity, escalate before shipping — do not silently ship the per-day key.

**`coverage_status` + CAN'T-TELL reason (audit item 7 — persisted home):**
- `qty_ordered ≥ qty_needed` → `OK` (green); `< qty_needed` → `SHORT` (red); cannot compute → `VERIFY`
  (amber ? CAN'T-TELL) with `coverage_reason` ∈ **{NO_TASK_TAG, NO_TASK_SIZE, NO_COVERAGE, UNIT_MISMATCH,
  UNIT_UNSUPPORTED}**.
- `coverage_status` + `coverage_reason` are **stored columns** (persisted with the row), re-SET every writer
  run — so the gate/print read a durable verdict without recomputing. (Chosen over recompute-live so the
  promotion gate and Phase-4 print have a stable read.)

---

## §3 Ordered build steps

Sequencing: **Sales (Step 0) → prod FIRST, then the migration, then Schedule** (audit item 6; no same-deploy).

### Step 0 — Sales: size + unit per task `[LOCKED intent]`
**Repo:** `sales-command` · `WTCCalculator.jsx` (`newTask :944`, task row `:1183-1198`).
- `newTask()` gains `size: null, unit: 'SQFT'`. Old tasks seed `size: null` (NOT 0 → CAN'T-TELL, not false-0).
- **Keyed task coercion (round-3 item 7):** `{ size: v => v===''?null:(parseFloat(v)||null), unit: v => v,
  description: v => v }` with a **`parseFloat` fallthrough for all OTHER keys** — so `pct_complete` (and any
  future numeric task key) stays coerced. Only `size`/`unit`/`description` opt out of `parseFloat`.
- UI: size number + SQFT/LF toggle beside `pct_complete`. jsonb-additive, no migration.
- **Acceptance:** author 5100 LF + 10%/day, Send → task carries size+unit; old task reads size:null.

### Step 1 — Schedule: pass through + display task size/unit `[LOCKED]`
`FieldSowBuilder.jsx` `newTask :22` mirrors `{…,size:null,unit:'SQFT'}`; keyed coercion; read-only display.
- **Acceptance:** SOW shows each task's size+unit in Schedule; save/reload preserves.

### Step 2 — Schedule: SOW read-only tab `[LOCKED]`
`JobDetail.jsx` `PLANNING_TABS :135` += `{key:'sow',label:'SOW'}`. Read-only: scope notes, tasks
(desc+size/unit+%), material specs as TEXT (A2 rule). Reuse `FieldSowModal.jsx`.
- **Acceptance:** SOW tab shows what Sales authored; no editable fields.

### Step 3 — Schedule: rename Materials → Logistics + repoint EVERY `materials` reader/channel `[LOCKED · REG-3]`
`JobDetail.jsx`, `MaterialsModal.jsx`, `Materials.jsx`, `Jobs.jsx`, `queries.js`, `exports.js`, new `sowMaterials.js`.
- Rename tab label; keep/redirect `/materials` route (audit stale `key` refs).
- Logistics materials section = `job_material_lines` joined to the §2 rollup: Material · Kit · **Needed**
  (`qty_needed`, read-only) · **Ordered** (`qty_ordered`, editable) · Status (four words) · **Flag**
  (green/red/amber ← `coverage_status`, tooltip = `coverage_reason`) · Arrival · Notes. Reuse
  `STATUS_OPTIONS`/`statusColor` verbatim.
- **Repoint EVERY `materials`-table reader AND realtime channel** (REG-3 — audit found my list short):
  - `queries.js:73-84` — `baseChecklistPasses`/`isReady` promotion gate **(highest risk)**
  - `JobDetail.jsx:77` — `from('materials')` reader
  - `MaterialsModal.jsx:26,42` — the modal's own reads
  - `Materials.jsx:127/193/213/227` — `/materials` view reads+writes
  - `Jobs.jsx` — `loadAllRows('materials')` → `matsByJobId` **AND the realtime channel `Jobs.jsx:251`
    `channel('materials-changes')`** (repoint to a `job_material_lines` channel or it goes silent → the
    board stops refreshing on Logistics edits)
  - `exports.js:113` — `from('materials')` export
  - **Build MUST re-grep** `\.from\(['"]materials['"]\)|loadAllRows\(['"]materials['"]|channel\(['"]materials`
    across `src/` and repoint every hit — no silent cap. Enumerate the full list in the revision.
- **Modal disposition (REG-3):** `MaterialsModal.jsx` becomes the Logistics materials view (repointed to
  `job_material_lines`), NOT deleted; `Materials.jsx` `/materials` view likewise repointed. State both.
- **All writes audit-logged (round-3 item 5):** the new `job_material_lines` writer is **bespoke** (not
  `updateJobField`) — it must still log to `job_changes` with a **line-identifying field name**, e.g.
  `material_line[<wtc_material_id>].status` / `.qty_ordered`, so the audit trail names which line changed.
  Do NOT copy the raw un-logged `.update()` from `MaterialsModal.jsx:40-49`.
- **Acceptance:** correct Needed per material; short=red, missing=amber+reason; status/arrival/notes persist
  to `job_material_lines`; **promotion gate + realtime channel read `job_material_lines`, not the dead
  `materials` table**; every write hits `job_changes`.

### Step 4 — Schedule: warehouse add-material `[LOCKED core · DESIGN-OPEN attach point]`
Catalog picker → writes `field_sow` + upserts its `job_material_lines` row; new/swapped → `specs_confirmed=false`.
- **DESIGN-OPEN (R5):** which day/task a warehouse-add attaches to. Settle with Chris / at build.
- **Acceptance:** add appears with Needed (or CAN'T-TELL), editable Ordered/status, persisted.

### Step 5 — Schedule: assign trucks/equipment/power to a job `[LOCKED intent · new job↔asset home]`
Pick-many from live `tenant_vehicles/equipment/power`, each **Available/Unavailable (per-job)**. The per-JOB
link has no home → new `job_assets` table (§4). Keep old text columns readable; don't strip.
- **Acceptance:** pick 2 trucks + 1 generator, mark one Unavailable; per-job persist; shows in Logistics.

### Step 6 — Schedule: Settings UI over the EXISTING asset lists `[LOCKED — no new tables]`
New minimal per-tenant list editor over `tenant_*` (tables live, RLS'd; forbid-hard-delete guards soft-delete). No schema work.
- **Acceptance:** customer adds "F-350 + trailer" → appears in the Step-5 picker.

### Step 7 — Schedule: confirm/lock + override escape hatch `[LOCKED · located in code · round-2 corrected]`
`FieldSowBuilder.jsx` / `CardSowModal.jsx`.
- **`SPEC_KEYS = {mils, coverage_rate, mix_time, mix_speed, cure_time}`** (audit item 5 — `unit` EXCLUDED;
  reconcile the divergence: `unit` is a task-level SQFT/LF concept, not a locked material spec).
- **Lock (located in code, audit item 4):** (1) `specInput :400` gains `isLocked` branch → read-only when
  `specs_confirmed === true`; (2) `updateMaterialField :159` rejects writes to any `SPEC_KEYS` key on a
  locked material; (3) reset-downgrade — editing a `SPEC_KEYS` value on an UNconfirmed material downgrades
  true→false (mirrors Sales `updateField`).
- **Override = its own multi-field handler `overrideSpec()` (audit item 5)** — do NOT route through the
  single-key `updateMaterialField`. Editing a LOCKED spec requires a typed reason (non-skippable) → write
  value(s), log `{by,at,old,new,reason}` to `spec_overrides[]`, re-confirm as warehouse-confirmed, surface
  "coverage changed by warehouse: <reason>" downstream.
- **Print-gate predicate (defined now, enforced Phase 4):** cannot print iff `specs_confirmed !== true &&
  hasAnySpec(m)`. Phase-3 acceptance = flag-state + predicate correctness, not a live print block.
- **Acceptance:** confirmed spec read-only + `updateMaterialField` rejects its edit; editing an unconfirmed
  spec downgrades the flag; `overrideSpec` forces a reason, writes multi-field, logs it.

### Step 8 — Schedule: crew-allocator "finalize" `[DESIGN-OPEN — likely labels only]`
Sales proposes dates/crew/mob; scheduler finalizes (board likely already covers it → proposed-vs-finalized
label). `[DESIGN-OPEN — verify board first (R7).]`

---

## §4 Data-model summary

- **jsonb-additive, NO migration:** task `size`/`unit`; `spec_overrides[]`; confirm stamps.
- **REQUIRED additive migration — `command-suite-db` ONLY, `npm run db:push` + rehearsal** (one migration):
  1. `ALTER job_material_lines ADD status text` (CHECK the four words — must not reject the 0 existing rows)
     `+ arrival_date date + notes text + coverage_reason text`.
  2. `CREATE TABLE job_assets (id, job_id int8 NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
     asset_type text CHECK (asset_type in ('vehicle','equipment','power')), asset_id uuid NOT NULL,
     available boolean NOT NULL DEFAULT true, tenant_id …, created/updated_at)`.
     - **RLS (audit item 4): `ENABLE ROW LEVEL SECURITY` + the 4-policy `jobs.call_log_id → call_log.tenant_id`
       chain copied VERBATIM from `job_material_lines.sql:103-168`.** `job_id` FK `ON DELETE CASCADE`.
     - **Cross-tenant `asset_id` guard = a `BEFORE INSERT OR UPDATE` trigger (round-3 item 4):** branch on
       `asset_type` (`vehicle`→`tenant_vehicles` / `equipment`→`tenant_equipment` / `power`→`tenant_power`),
       look up the referenced row, and assert its `tenant_id` = the job's tenant (via the
       `jobs → call_log.tenant_id` join). Raise if mismatched — so a job can't point at another tenant's
       truck. (A trigger, not RLS prose — RLS can't enforce a conditional cross-table FK.)
  3. **Realtime (round-3 item 3):** `ALTER PUBLICATION supabase_realtime ADD TABLE public.job_material_lines`
     — **guarded**, mirroring the `jobs` block in `20260715120000`. Set `REPLICA IDENTITY FULL` on
     `job_material_lines` IF the repointed channel callback needs old-row data. **First verify whether
     `materials` is in `supabase_realtime` today** — if it is NOT, the board never live-refreshed on material
     changes and the "board freeze" risk is **pre-existing, not caused by this change** (adjust Step 3
     accordingly).
  - All additive; rehearse from a prod-shaped throwaway before push; ledger-aligned.
- **Reused live, NO schema work:** `job_material_lines` core cols; `tenant_vehicles/equipment/power`.
- **Legacy `materials` table:** Phase 3 STOPS reading it (all readers+channel repointed); Phase 5 drops it.

---

## §5 Deploy / verification / sequencing

- **Order:** Sales (Step 0) → prod first → `command-suite-db` migration (rehearsed) → Schedule.
- **Preview-deploy each branch; verify on preview.**
- **Promotion-gate ready-semantics (audit item 6 — define explicitly):** `isReady`/`baseChecklistPasses` on
  `job_material_lines`: a row's `status = NULL` counts as **undecided** (blocks ready, like Not Ordered).
  **Fail-closed:** a SOW-bearing job with **zero `job_material_lines` rows is NOT ready** (today's
  `materialRows.length===0 → materialsDecided=true` would auto-pass an unseeded job — must invert for
  SOW-bearing jobs). No-SOW jobs keep the empty-is-fine behavior.
- **Smoke (shared DB):** author a 6618-style SOW with per-task sizes + a `coverage_rate` per material → SOW
  tab shows it → Logistics shows Needed-vs-Ordered with correct flags (deliberate SHORT + a CAN'T-TELL naming
  its reason) → warehouse add + confirm + one `overrideSpec` with reason → **promote the job: gate reads
  `job_material_lines` and a zero-line SOW job is held** → board realtime refreshes on a Logistics edit →
  reload survives. Include a **multi-WTC job** and a **same-material-on-two-days** case (overcount check).
- **Gate through terminals:** buildvsplan (T4) → code-review (T5) → security-review (T6) before merge.

---

## §6 Ratification items (Chris)

| # | Item | Resolution | Tag |
|---|------|-----------|-----|
| R0 | Coverage source | **Parse the SOW line's `coverage_rate` text** (option i, from the line; no catalog join). Ratified 2026-07-30 | LOCKED |
| R1 | Tracking home | REUSE `job_material_lines` as a FRESH write path (empty table). Ratified | LOCKED |
| R1b | Status words | Keep the four (add `status` col). Ratified | LOCKED |
| R3 | Round-up | Struck — exact quotient | LOCKED |
| R9 | Multi-day-same-task overcount | display groups per `(task_ref,product)`, never sums quotients | DERIVED |
| R5 | Warehouse-add attach point | needs a beat / build call | DESIGN-OPEN |
| R7 | Step 8 finalize scope | verify board first | DESIGN-OPEN |
| R8 | `job_assets` table + cross-tenant `asset_id` check | table w/ verbatim RLS chain + tenant check | DERIVED |

---

## Audit manifest

_Restamped after revision pass 2 (round-2 response), 2026-07-30. Consumed by `/runaudit` for round 3._

### Bottom line (plain English)
Round 2 was right — it caught that my "reuse" leaned on two things that aren't true (there's no ready-made
number for coverage, and the table it reuses is empty). Both fixed: coverage now comes from the number the
estimator already types on the job, and the plan treats the table as something we fill fresh. Round 3 is a
short confirmation check on three spots: the coverage-parsing + the "same material on two days" counting
trap, that we repointed *every* old reader (there was a hidden live-refresh channel), and that the new
truck-assignment table is locked down the same way the others are.

### Round
- Plan type: feature
- Status: **CONVERGED at round 3** — 0 regressions, 0 High. Pass 3 (this commit) folds the 6 Med/Low
  refinements. **BUILD-READY; no round 4 for architecture.**
- Findings trend: round 1 (5H/2M) → round 2 (1C/4H/4M, plateau fired) → **round 3 (0C/0H/4M/2L, 0
  regressions — DOWN, plateau broken)**.

### Prior rounds
- Round 1: `f23de81` · 5H/2M + 4 adjacent · pattern: `shared-carrier-blindspot`
- Round 2: `9fddc00` · 1C/4H/4M + 3 adjacent · pattern: `reuse-rests-on-false-premise`
- Round 3: `329de17` · 0C/0H/4M/2L + 0 regressions · pattern: `converged-parse-hardening` → folded in pass 3

**Briefing for agents**: do NOT re-find round-1/2 issues (twin table, mat_uid, numeric-coverage premise,
empty-table premise, reader-repoint list, deploy order, coverage source — all addressed). Attack ONLY the
pass-2 corrections. Cite `file:line`/`migration:line` read this round. **Plateau is active** — if round-3
count is not clearly DOWN, the only build-prompt option is scope-cut (defer §2 auto-Needed to Phase 4, option
iii), not more mechanism.

### Deployment context
- Live tenants: 1 (HDSP). Affected `sch-command` live but no office users yet; migration hits shared prod (rehearse).
- Blocking flags: none. Concurrency: solo → race findings cap Low, cross-tenant cap Med.

### Time budget + finding cap
- Time budget: ~150 min. Finding cap: 15.

### Surface
- Sections: 10 (h2). [LOCKED] majority; [DESIGN-OPEN]: 2 (R5, R7); [DERIVED]: ~4.
- Pass 2 shrank/held the surface (removed the catalog-coverage join; no new mechanism beyond the required RLS + gate semantics).

### Layers touched
- UI/components (SOW tab; Materials→Logistics; Settings editor; Overview pickers)
- Data layer (`sowMaterials.js` rollup; audit-logged `job_material_lines` writer + seeder; repoint all `materials` readers + realtime channel)
- State model (task size/unit; `job_material_lines` +status/+arrival/+notes/+coverage_reason; `job_assets`; `spec_overrides[]`)
- Migrations/schema (ONE additive command-suite-db migration: cols + `job_assets` with RLS)
- Cross-repo (sales-command Step 0; command-suite-db migration)
- Real-time/sync (repoint `materials-changes` channel; confirm web-only tables off Field required path)
- Audit logging (all Logistics writes → `job_changes`); RLS/multi-tenancy (`job_assets` chain + cross-tenant asset_id)

### New mechanisms introduced
- Helper `rollupSowMaterials()` (text-coverage parse + named CAN'T-TELL enum) + audit-logged writer/seeder
- Additive cols `job_material_lines.status/arrival_date/notes/coverage_reason`; new `job_assets` table (RLS)
- Lock: `SPEC_KEYS` (5 keys) + `specInput` isLocked + `updateMaterialField` reject + reset-downgrade + `overrideSpec()` multi-field + print-gate predicate
- Task size/unit (Sales)
- Reused, NOT new: `job_material_lines` core, `tenant_*`, `coverage_status`, `qty_needed/qty_ordered`

### Cross-system reach
- `sales-command` Step 0 (deploys prod FIRST); `command-suite-db` (one additive migration, shared ledger, rehearse);
  `field-command`/PowerSync (confirm web-only tables off the crew's required read).

### Irreversibility
- Additive migration only (cols + new table); no destructive/backfill; reversible. `materials` read-repointed (code); dropped in Phase 5.

### Known weak points
- **Coverage-text parse (§2):** real-world `coverage_rate` strings ("130 to 154 LF per kit/5,100 total LF")
  — does the leading-number + area-unit parse extract the right number, and does blank→NO_COVERAGE fire cleanly?
- **Multi-day-same-task overcount (§2/R9):** the fix is "display groups per (task_ref,product), never sum
  quotients" — verify it actually prevents 3× on a material split across days; and that per-line storage +
  display-grouping stay consistent for the gate/print.
- **Writer column-ownership split (§1/§2):** the writer SETs qty_needed/coverage_status/coverage_reason but
  must NOT clobber qty_ordered/status/arrival/notes — verify the upsert is column-scoped, and orphan cleanup
  removes rows for deleted SOW materials.
- **Reader/channel repoint completeness (§Step 3):** the promotion gate AND the `materials-changes` realtime
  channel must move; any missed reader silently breaks a gate or freezes the board.
- **Gate fail-closed (§5):** inverting "zero rows = ready" for SOW-bearing jobs — verify it doesn't break
  legitimately no-material jobs.
- **`job_assets` cross-tenant `asset_id` (§4):** the FK is to a `tenant_*` row; the tenant match needs an
  explicit policy/trigger, not just the jobs→call_log chain.

### Open questions
- Count: 2 [DESIGN-OPEN] (R5 attach point; R7 finalize scope). Highest-pressure: R5.

### Suggested attack angles (3 total)
1. **Coverage parse + Needed correctness** — Data/State. Reading: `§2`, `FieldSowBuilder.jsx` coverage_rate
   stamp, sample `coverage_rate` strings. Pressure: text parse robustness, unit-numerator match, multi-day
   overcount, SET-not-additive, column-ownership split + orphan cleanup.
2. **Reader/channel repoint + gate semantics** — Data/Audit/Real-time. Reading: `queries.js:73-84`,
   `Jobs.jsx:77?/251`, `MaterialsModal.jsx:26/42`, `Materials.jsx`, `exports.js:113`, `§5` gate. Pressure:
   any missed `materials` reader or channel; fail-closed correctness; audit-logged writes.
3. **Migration + `job_assets` RLS + lock coverage** — Migrations/RLS/business logic. Reading: `§4`,
   `job_material_lines.sql:103-168`, Step 0, Step 7. Pressure: additive-safety on a live table (status CHECK
   vs existing rows), the verbatim RLS chain + cross-tenant `asset_id` check, Sales-first deploy, lock across
   every spec path + `overrideSpec` multi-field.

### Suggested agent count: 3

Rationale: same three non-overlapping risk clusters as round 2, now verifying pass-2's corrections; plateau
is active so this is a convergence check, not a re-expansion — 3 holds.
