# SCH Handoff v29 — DMS-1 Phase 3 build (IN PROGRESS, safe pause)

**Date:** 2026-07-30
**Repo / branch:** `sch-command` @ `feat/dms1-phase3` (also touches `sales-command` + `command-suite-db`)
**Plan:** `docs/plans/daily_material_schedule_phase3_build.md` (converged; corrected in-flight — see below)
**State:** Build-only. **NOTHING pushed, deployed, or merged.** Working trees clean.

## Where we are — Steps 0–2 + §2 done, Step 3 mid-flight

| Step | State |
|---|---|
| Premise check | ✅ Both verified live: `job_material_lines` EMPTY; `materials` NOT in `supabase_realtime` (board-freeze pre-existing). |
| Step 0 (Sales size/unit) | ✅ Committed on **`sales-command` branch `feat/dms1-phase3-task-size-unit`** (`b74963c`). Build passes. |
| Step 1 (Schedule pass-through) | ✅ `ff13067`. |
| Step 2 (read-only SOW tab) | ✅ `cd22681` (extracted `FieldSowView`). |
| §2 rollup helper | ✅ `859175d` — `src/lib/sowMaterials.js` + `sowMaterials.verify.mjs` (**BUILD-VERIFY 26/26**, proves no 3× overcount). |
| **Step 3 (Logistics + repoint)** | 🚧 **WIP 1/3 done** (`eee7cad`, data layer). **NEXT UP.** |
| §4 migration | ⬜ Not started (task #8). |
| Steps 4–8 | ⬜ Not started. Step 4 + Step 8 are **[DESIGN-OPEN] — must ask Chris** (R5 attach point, R7 finalize scope). |

## Commits on `sch-command/feat/dms1-phase3` this session (5 ahead of origin, unpushed)
`ff13067` Step 1 · `cd22681` Step 2 · `859175d` §2 · `4872dbb` ratifications · `eee7cad` Step 3 WIP 1/3
(+ earlier `e8f9cfa` premise/plan §0/§1 correction)

## Two ratifications made mid-build (both folded into plan + code)
1. **Writer column-ownership split** (§1): writer SETs `name/kit_size/coverage/supplier/qty_needed/coverage_status/coverage_reason` (name is NOT NULL). Warehouse-owned untouched: `qty_ordered/status/arrival_date/notes/qty_received/received_*`.
2. **Grain = one row per REAL logical need** (REG-4): the plan's "3 days = 3 rows" rested on a false premise (`wtc_material_id` collides across days on the proposal path). Ratified one-row-per-need; rollup groups on `(normalized task.description, catalog_id ?? product)`.

## DESIGN/SCOPE decision made: DMS-5 (deferred, Chris-approved with 2 conditions — BOTH met)
The "ready to schedule" gate has a **server-side DB layer** (`job_base_checklist_passes` + 3 `materials_recheck_*` triggers) still reading the dead `materials` table. **Deferred to Phase 5** (non-additive; Phase 5 drops `materials`). Verified SAFE: nothing trusts stored `ready_confirmed_at` without a live recompute (all 3 repos + all DB views/policies/cols checked). Filed as **BACKLOG DMS-5 (T2, Phase-5 blocker)**. Also filed DMS-4 (dead `assignments-changes` channel).

## Step 3 — what's DONE vs NEXT
**Done (WIP 1/3, `eee7cad`, data layer in `queries.js`):**
- `baseChecklistPasses` repointed to fail-closed §5 semantics.
- `syncJobMaterialLines()` (writer/seeder), `loadJobMaterialLines()` (reader), `updateJobMaterialLineField()` (warehouse edit) — all audit-logged, column-ownership-safe.

**NEXT (WIP 2/3 + 3/3) — the readers/UI, none wired yet:**
1. **Repoint every `materials`-table reader** (re-grep confirmed list — none may be missed):
   - `Jobs.jsx:181` `loadAllRows('materials','id, job_id, status')` → `job_material_lines` (**keeps matsByJobId shape** so `isReady`/cards work); **AND channel `Jobs.jsx:251` `materials-changes`** → `job_material_lines` channel.
   - `JobDetail.jsx:78` reader → `loadJobMaterialLines`; build the **Logistics** materials section (Material·Kit·Needed·Ordered[editable]·Status[4 words]·Flag[green/red/amber←coverage_status, tooltip=coverage_reason]·Arrival·Notes) via `updateJobMaterialLineField`. Reuse `STATUS_OPTIONS`/`statusColor` from `MaterialsModal.jsx`.
   - `MaterialsModal.jsx:26,42` + `Materials.jsx:127/193/213/227` + `exports.js:113` → repoint (state disposition, don't delete).
   - Call `syncJobMaterialLines` after SOW save (`CardSowModal` `saveWtc`/`saveLegacy`) + lazily on Logistics-tab open (seed).
2. **Rename tab label** Materials→Logistics (`JobDetail.jsx` PLANNING_TABS — SOW tab already added).
3. Re-grep `\.from\(['"]materials['"]\)|loadAllRows\(['"]materials['"]|channel\(['"]materials` to confirm zero misses.

## Then (after Step 3)
- **§4 migration in `command-suite-db`** (task #8): additive cols (`status` CHECK 4 words / `arrival_date` / `notes` / `coverage_reason`) + `job_assets` table (verbatim RLS chain from `job_material_lines.sql:103-168` + cross-tenant `asset_id` trigger) + realtime publication add for `job_material_lines`. **Rehearse first** (`cd ~/command-suite-db && ./scripts/rehearse.sh <migration>`).
- Steps 5, 6, 7 (buildable). Steps 4 + 8 → **ASK Chris first** (DESIGN-OPEN).

## Locked deploy order (when we get there — NOT NOW)
Sales (Step 0) → prod first → command-suite-db migration (rehearsed) → Schedule. No same-deploy. Gate after build: buildvsplan (T4) → code-review (T5) → security-review (T6).

## To resume
`cd ~/sch-command && git checkout feat/dms1-phase3` — read this file + the plan. Data layer is in `queries.js`; wire the readers/UI next (Step 3 WIP 2/3). Run `node src/lib/sowMaterials.verify.mjs` to re-confirm the rollup. sales-command Step 0 lives on its own branch there.
