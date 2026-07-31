# DMS-1 Phase 3 — Build Spec (Schedule SOW builder + Logistics)

**Loop:** ERD #44 (`dms1-phase2-sales-sow`, stays open until the ticket prints) · branch `feat/dms1-phase3`
**Scope:** Phase 3 — the Schedule-side read of the SOW + the warehouse's Logistics workspace + one small
Sales-side reach-back (task size/unit). Spans `sch-command` (bulk) + `sales-command` (one slice).
**Parent spine:** `daily_material_schedule.md` §3/§4/§5 (Phase 3 = §5 row 3: *RETROFIT, not greenfield*).
**Prior:** Phase 1 (DB columns) + Phase 2 (Sales authoring + Schedule save-protection) — both LIVE 2026-07-28.
**Terminal roles:** Plan terminal (T1) authored this; it does NOT ship code. Build terminal (T3) executes.
Audit terminal (T2) runs `/runaudit` against the `## Audit manifest` below before any build.

> This spec is the front half of ERD #44's picture (the printed crew ticket). Phase 3 makes the SOW
> *visible and workable* on the Schedule side; Phase 4 prints it. Where Phase 3 pulls a piece forward
> from the §5 Phase-4 row (the material rollup), it says so.

---

## §0 Baseline — observed current state (read-verified 2026-07-30, code grep + Read; not run-verified)

**Type:** feature (adds new Schedule-side surface; no pre-existing defect). Evidence gathered by grep +
Read of `sch-command` HEAD `04b93e2` (main, post-Phase-2) and `sales-command` main.

- **Schedule SOW builder — `sch-command/src/components/FieldSowBuilder.jsx`:** `newTask()` (`:22`) =
  `{id, description, pct_complete}` — **no `size`, no `unit`**. Material constructors
  (`addMaterialToDay :85` / `addCatalogMaterialToDay :112` / `addCustomMaterialToDay :140`) already carry
  `catalog_id`, `task_ref`, and seed `specs_confirmed:false` via `hasAnySpec` (`:102/:135`). `handleSave`
  (`:193`) is a **passthrough spread** (Phase-2 fix) — preserves unknown keys.
- **Canonical SOW write path — `CardSowModal.jsx`** writes `job_wtcs` via `updateJobWtcFieldSow`
  (`queries.js:598`, audit-logged). `FieldSowModal.jsx` is a **read/print** surface only. `loadMaterialsCatalog`
  (`queries.js:43`) exists (the catalog picker).
- **Materials modal — `MaterialsModal.jsx`** reads the **legacy `materials` table**
  (`.from('materials').eq('job_id',…)`), columns `{job_id, ordinal, name, status, arrival_date, notes}`;
  displays `qty_ordered` (`:132`). `STATUS_OPTIONS` (`:4`) = `Not Ordered / Ordered / In Stock / Delayed`
  with `statusColor` (`:6-14`). `Materials.jsx` view (`/materials`) reads the same table (`:33`). **There is
  no Needed column and no link to `field_sow` today.**
- **Job home — `JobDetail.jsx`:** `PLANNING_TABS` (`:135`) = `[Materials]`; `MANAGEMENT_TABS` (`:139`) =
  `[Overview, Production, Daily Log, Billing, History]`. Overview renders **Vehicle / Equipment / Power as
  free-text inputs** (`:298-329`) writing single columns `jobs.vehicle / equipment / power_source`. Materials
  tab content at `:409`. **No SOW tab exists.**
- **No Settings page in `sch-command`** — grep of `src/views` + `src/components` for `setting`/`catalog`
  returns only `CardSowModal`/catalog refs; there is nowhere for a customer to build asset lists today.
- **Sales side — `sales-command/src/pages/WTCCalculator.jsx`:** `newTask()` (`:944`) = same
  `{id, description, pct_complete}` (no size/unit). Day shape (`addDay :948`) carries `sq_ft`/`linear_ft`
  at the **day** level. A `sub_areas` shape (`:934`) already pairs `size`+`unit`; `UNITS` (`:988`) =
  `SQFT/LF/EA/HR/TON/CY`. Materials carry `coverage_rate`, `qty`, `catalog_id`, specs (Phase-2, live).
- **"Needed" is computable but never computed today.** Piping (`catalog_id` + `coverage_rate` + day
  measurements) shipped in Phase 2; no code multiplies it into a required quantity anywhere.
- **Deployment reality:** `sch-command` prod = schedulecommand.com; **no office users yet — Chris-only
  testing** (spine §0.2b). Live tenant = HDSP (1). Old Google Apps Script stays live in parallel until parity.

**Absence assertions verified:** no task `size`/`unit` (grep `newTask` both repos), no SOW tab (grep
`PLANNING_TABS`), no Settings page (grep `views`/`components`), no Needed math (grep coverage×area). All
read-verified — **not** run-verified; the smoke in §5 is the run-verification gate.

---

## Design floor — ideation decisions this spec implements (all Chris-ratified 2026-07-30)

Banked in ERD LOG.md Loop #44 NOTES (2026-07-30). Restated here as the design floor:

1. **One SOW, four ownership STAGES** — Sales → Scheduling → Logistics → Field. NOT four records/IDs;
   one live `field_sow` moving through four stages of ownership. No unique identifier. `[LOCKED]`
2. **Sales authors the first draft of everything** (scope, specs, materials, *proposed* dates /
   crew / mobilization). Each downstream stage FINALIZES its slice. `[LOCKED]`
3. **Two Schedule roles, kept structurally distinct:** Crew Allocator (time/labor) vs Warehouse
   Manager (materials/fulfillment/logistics). One person in small shops; the structure must not
   conflate them. Unified READ, scoped EDIT. `[LOCKED]`
4. **Logistics = trucks + equipment + power + materials** (heaviest on materials). Reuse EXISTING
   material statuses (`Not Ordered / Ordered / In Stock / Delayed`) — do NOT expand. `[LOCKED]`
5. **No inventory-counting system.** Phase 2 laid the piping (each SOW material carries `catalog_id`
   + `coverage_rate`; days carry measurements) so quantities can be COMPUTED and later checked against
   a count — but Phase 3 does not build stock counting. `[LOCKED]`
6. **The Materials modal stays its own job-specific area, but becomes a WINDOW onto the SOW material
   list** — reads/writes the one SOW, no second drifting copy. `[LOCKED]`
7. **Needed vs Ordered.** Modal gets a read-only **Needed** column (computed) beside an editable
   **Ordered** column (today's manual qty). The gap is the signal. `[LOCKED]`
8. **Three-state readiness flag:** green ✓ covered (`Ordered ≥ Needed`); red ⚠ SHORT N (`Ordered <
   Needed`); amber ? CAN'T TELL when Needed can't compute (missing size/coverage). Never hide missing
   data as a dash — missing data is critical per job. `[LOCKED]`
9. **The Needed math follows the daily task breakout.** Each **task** gets a **size + unit (SQFT/LF)**,
   sitting beside the `pct_complete` it already has. **Needed = task size ÷ material coverage** (the
   task's unit tells the math which to use). This confirmed against Chris's original Excel (job
   6507WTC6), which broke size out per task with a SQFT/LF choice. `[LOCKED]`
10. **Confirm/lock logic (simplifies DMS-2):** Sales-confirmed specs LOCK for the job (untouched to
    the crew); adding MORE of a confirmed material inherits its spec; a BRAND-NEW or SWAPPED material
    comes in unconfirmed and must be confirmed in Schedule before it can print. Nothing unconfirmed
    ever leaves Sales (Send gate). Warehouse can override a locked spec only with a REQUIRED reason
    (logged who/when/old→new/why, re-confirmed as warehouse-confirmed, shown downstream). `[LOCKED]`
11. **Job-home layout** (preserve existing `JobDetail` tabs): NEW **SOW** read-only tab (JOB PLANNING);
    RENAME **Materials → Logistics** (materials + trucks/equipment/power); Overview stays the
    scheduler's room. `[LOCKED]`

---

## 1. The data-home question (the ONE architectural decision — ratify before build)

Everything downstream depends on this. `[DERIVED — needs Chris + audit ratification]`

**Problem.** Three kinds of number now live around a material, at different grains:
- **Needed** — computed from the SOW (task size ÷ coverage). Source of truth = `field_sow` (per-day
  tasks + materials). Job-level, derived, never stored.
- **Planned/bid qty** — what Sales estimated (`qty_planned` on the SOW material). Already in `field_sow`.
- **Warehouse tracking** — `Ordered` qty, `status`, `arrival_date`, `notes`. Job-level, warehouse-owned,
  **has nowhere to live on the SOW today** (it lives on the legacy `materials` table the modal reads).

**Two homes considered:**

- **(A) Tracking map in `job_wtcs` jsonb, keyed by material identity** *(recommended).* Add
  `material_tracking` (jsonb) on `job_wtcs`: `{ <matKey> → {ordered, status, arrival_date, notes} }`
  where `matKey` = `catalog_id` (or a stable synthetic id for custom/no-catalog materials). The modal
  = **rollup of `field_sow` day-materials by `matKey` (Needed summed)** LEFT-JOIN the tracking map.
  - *Pro:* one home (the SOW record); the legacy `materials` table can retire cleanly in Phase 5 as
    §5 already plans; no drifting copy of Needed; jsonb-additive, no migration.
  - *Con:* more build now (rollup + keyed map + custom-material key strategy); modal rewires off the
    `materials` table.
- **(B) Keep the `materials` table as the tracking layer**, pull Needed live from the SOW rollup.
  - *Pro:* reuses the existing modal/table/status code; less rewire.
  - *Con:* keeps the exact table Phase 5 wants to kill; two records per material (SOW + tracking row)
    to keep in step; a "bridge-then-fix" the standing discipline warns against.

**Recommendation: (A).** It matches decision #6 (one list, no drifting copy) and Chris's build-it-right
rule, and it makes Phase 5's retirement a deletion rather than a migration. **This is the #1 audit
target** — the alternative (B) is real and cheaper, so the audit should pressure whether (A)'s extra
build is justified vs deferring the table retirement.

**Custom / no-`catalog_id` materials** need a stable `matKey`. `[DESIGN-OPEN]` — proposal: mint a
`mat_uid` on every SOW material at add-time (all constructors already run through
`FieldSowBuilder.jsx:85-150`) and key tracking on `catalog_id ?? mat_uid`. Settle in build.

---

## 2. The Needed rollup (pulled forward from §5 Phase 4 — deliberate)

`[DERIVED]` The §5 mapping put `rollupSowMaterials()` (parked BF-12) in Phase 4. **Phase 3 needs it too**
(the modal's Needed column). Build it once here; Phase 4's print reuses it. Flagged as a deviation from
the §5 phase mapping so the audit sees it on purpose.

**`rollupSowMaterials(fieldSow)` contract:**
- Walk every day → every material. Group by `matKey` (§1).
- **Needed per material** = for the task the material is tagged to (`task_ref`): `task.size ÷
  material.coverage_rate`. If a material maps across multiple tasks, sum per task. `[LOCKED math]`
  - Unit check: `task.unit` (SQFT/LF) selects the measurement; coverage must be same-unit. Mismatch →
    CAN'T TELL, not a wrong number.
  - Round UP to whole `kit_size`/purchase units (you can't buy 4.3 pails). `[DERIVED — confirm rounding]`
- **Needed = null → the ? CAN'T TELL flag** when: `task_ref` blank, task has no `size`, task/material
  unit mismatch, or `coverage_rate` blank. Return the REASON so the flag can name it.
- Cross-WTC: the modal is per-JOB; a job may have multiple `job_wtcs`. Roll up across all WTCs'
  `field_sow`, keyed by `matKey`. `[DERIVED — verify multi-WTC job in smoke]`
- Pure function, no I/O — Phase 4 print + the modal both import it. Home: `src/lib/` (new
  `sowMaterials.js`) so it's not trapped in a component.

---

## 3. Ordered build steps

Sequencing is load-bearing: **the Sales-side task size/unit (Step 0) must ship first or same-deploy** —
Schedule's Needed can't compute until tasks carry a size (Phase-2 deploy-order lesson).

### Step 0 — Sales: size + unit per task `[LOCKED intent · DERIVED UI placement]`
**Repo:** `sales-command` · **File:** `src/pages/WTCCalculator.jsx` (`newTask` `:944`, task row `:1183-1198`,
`DAY_COERCE`/task coercion).
- `newTask()` gains `size: 0, unit: 'SQFT'`. (Today: `{id, description, pct_complete}`.)
- Task row UI: a size number input + a SQFT/LF (reuse the existing `UNITS` toggle, `:988` — but restrict
  task to SQFT/LF per decision #9) beside the existing `pct_complete` input.
- Passthrough on save (already spreads task objects; add the two keys to any explicit task coercion).
- **jsonb-additive, no migration.** Rides `field_sow` to Schedule + Field automatically.
- **Acceptance:** author a task with `5100 LF` + `10%/day`, Send → `field_sow` task carries `size`+`unit`.

### Step 1 — Schedule: pass through + display task size/unit `[LOCKED]`
**Repo:** `sch-command` · **File:** `src/components/FieldSowBuilder.jsx` (`newTask` `:22`, task render
`:293-339`, `handleSave` clean `:202-`).
- Mirror `newTask` = `{id, description, pct_complete, size, unit}`; seed defaults so old data reads clean.
- `handleSave` passthrough already spreads tasks (`...t`) — confirm `size`/`unit` survive (they will via
  spread); add to any explicit coercion (`size` → `parseFloat||0`; `unit` stays text).
- Display size/unit read-only or editable per the finalize decision (Step 8). Default: **read-only in
  Schedule** (Sales authors it; scheduler finalizes dates/crew, not task sizes). `[DERIVED]`
- **Acceptance:** a Phase-0-authored SOW opened in Schedule shows each task's size + unit; save/reload
  preserves them.

### Step 2 — Schedule: SOW read-only tab on JobDetail `[LOCKED]`
**Repo:** `sch-command` · **File:** `src/views/JobDetail.jsx` (`PLANNING_TABS` `:135`, tab content region).
- Add `{ key: 'sow', label: 'SOW' }` to `PLANNING_TABS` (JOB PLANNING group).
- Render a **read-only** view of the authored SOW: per-day scope notes, tasks (desc + size/unit + %),
  materials with specs (mils/coverage/mix/cure — TEXT, non-empty checks, no `" min"` suffix; A2 render
  rule from spine §4.2). Reuse `FieldSowModal.jsx` (already the read/print surface) if it fits.
- Nobody edits the SOW here — both roles read it. Edits happen in CardSowModal (existing) / Logistics.
- **Acceptance:** SOW tab shows exactly what Sales authored; no editable fields; text specs visible.

### Step 3 — Schedule: rename Materials → Logistics + Needed column + flag `[LOCKED]`
**Repo:** `sch-command` · **Files:** `src/views/JobDetail.jsx` (`PLANNING_TABS` `:135`, materials tab
`:409`), `src/components/MaterialsModal.jsx`, `src/views/Materials.jsx`, new `src/lib/sowMaterials.js`.
- Rename the tab label `Materials → Logistics` (keep the `key` or migrate it; audit for stale `key`
  refs). The Materials view/route (`/materials`) — rename label, keep route or add redirect. `[DERIVED]`
- **Materials section of Logistics** = `rollupSowMaterials()` (§2) joined to tracking (§1):
  - Columns: Material · Kit · **Needed** (read-only, computed) · **Ordered** (editable, today's `qty`) ·
    Status (existing dropdown) · **Flag** (3-state, §0.8) · Arrival · Notes.
  - Flag logic: `Ordered ≥ Needed` → green ✓; `Ordered < Needed` → red ⚠ `SHORT (Needed−Ordered) <unit>`;
    `Needed == null` → amber ? `CAN'T TELL — <reason>` (missing size / coverage / task tag / unit mismatch).
  - Reuse `STATUS_OPTIONS` + `statusColor` verbatim (`MaterialsModal.jsx:4-14`). Do NOT expand statuses.
- Data source shifts from the `materials` table to the SOW rollup + tracking map (§1A). This is the
  rewire the data-home decision gates.
- **Acceptance:** a job with authored task sizes shows correct Needed per material; a short material
  shows red with the gap; a material missing coverage shows amber with the reason; status/arrival/notes
  persist to the tracking home, not a stale table.

### Step 4 — Schedule: warehouse tracking home + add-material `[DERIVED — gated by §1]`
**Repo:** `sch-command` · **Files:** `src/lib/queries.js` (`updateJobWtcFieldSow` `:598` + a new tracking
writer), `MaterialsModal.jsx`.
- Implement the §1(A) tracking map (or (B) if ratified otherwise). Writer for `{ordered, status,
  arrival_date, notes}` keyed by `matKey`, audit-logged like `updateJobWtcFieldSow`.
- Warehouse **adds a material** in Logistics: reuse the existing catalog picker
  (`loadMaterialsCatalog`/`FieldSowBuilder.addCatalogMaterialToDay` path). An add here writes to the SOW
  (so Needed can compute) — decide which day/task it attaches to. `[DESIGN-OPEN]` — proposal: warehouse
  adds attach to a job-level "warehouse additions" bucket or a chosen day; needs a beat with Chris or a
  build-time call. Flag prominently; this is the frequent path (Chris: "they'll add more than you think").
- **Acceptance:** warehouse adds a material → appears in Logistics with Needed computed (or CAN'T TELL),
  editable Ordered/status, persisted to the tracking home.

### Step 5 — Schedule: trucks / equipment / power as picked lists `[LOCKED intent]`
**Repo:** `sch-command` · **Files:** `JobDetail.jsx` Overview veh/equip/power (`:298-329`) → move/echo into
Logistics; job-level storage.
- Each of Vehicle / Equipment / Power becomes a **pick-many** control sourced from Settings lists
  (Step 6), each pick marked **Available / Unavailable** (per-job).
- Storage: today `jobs.vehicle/equipment/power_source` are single free-text columns. Pick-many +
  availability needs a list shape → store as jsonb (e.g. `jobs.logistics_assets` or on `job_wtcs`):
  `[{list, item, available}]`. `[DERIVED — confirm column/home; possible additive migration in
  command-suite-db, rehearsed]`. Keep the old text columns readable during transition; don't strip.
- Available/Unavailable = per-job only (not global in-shop). `[LOCKED]`
- **Acceptance:** pick two trucks + one generator from Settings lists, mark one truck Unavailable;
  persists per-job; shows in Logistics.

### Step 6 — Schedule: Settings surface for the asset lists `[DESIGN-OPEN — new surface]`
**Repo:** `sch-command` — **no Settings page exists today** (verified). The customer needs to build the
Vehicle / Equipment / Power lists somewhere.
- Options: (a) a minimal new Settings view in sch-command; (b) fold into an existing config surface;
  (c) reuse a sales-command/Settings pattern. `[DESIGN-OPEN — needs a decision; smallest viable = a
  simple per-tenant list editor.]`
- Lists are per-tenant (customer-owned). Storage: a small `logistics_lists` table or tenant-config
  jsonb. `[DERIVED — settle with the data-home audit; additive, command-suite-db if a table.]`
- **Acceptance:** customer adds "F-350 + trailer" to the Vehicle list in Settings → it appears in the
  job-level Vehicle picker.

### Step 7 — Schedule: confirm/lock logic + override escape hatch `[LOCKED]`
**Repo:** `sch-command` · **Files:** `FieldSowBuilder.jsx` / `CardSowModal.jsx` material edit paths,
Logistics material rows.
- **Lock Sales-confirmed specs:** a material with `specs_confirmed === true` renders its specs
  read-only in Schedule. (This dissolves most of DMS-2 — confirmed specs aren't editable, so there's
  nothing to reset.)
- **New/swapped materials in Schedule** arrive `specs_confirmed = false` (constructors already do this
  via `hasAnySpec`, `FieldSowBuilder.jsx:102/135`). They wear the amber "confirm for this job" chip and
  **cannot print** (Phase-4 gate) until a warehouse confirm clears it.
- **Warehouse confirm** = one action on the material row clearing the flag → `specs_confirmed = true`,
  `specs_confirmed_by`/`_at` stamped (spine §3 ownership: Schedule confirms post-Send adds).
- **Override escape hatch:** editing a LOCKED spec requires a typed **reason** (non-skippable). On
  override: write the new value, log `{by, at, old, new, reason}` (jsonb-additive, e.g.
  `spec_overrides[]` on the material), re-confirm as warehouse-confirmed (still prints), and surface
  the reason downstream ("coverage changed by warehouse: <reason>") on the SOW tab + Phase-4 ticket.
- **DMS-2 (reset-on-edit), narrowed:** only unconfirmed / warehouse-added specs are editable, so
  reset-on-edit only applies there — Sales `WTCCalculator.updateField` already does true→false; mirror
  that downgrade for the (few) editable spec paths in Schedule. Confirmed specs are locked, not reset.
- **Acceptance:** a Sales-confirmed spec is read-only in Schedule; a warehouse-added material blocks the
  (Phase-4) print until confirmed; overriding a locked spec forces a reason and logs it; the reason
  shows on the SOW tab.

### Step 8 — Schedule: crew-allocator "finalize" of Sales' proposal `[DESIGN-OPEN — likely mostly exists]`
**Repo:** `sch-command` · Overview tab + existing Schedule board / `JobCrewScheduler`.
- Sales proposes dates / crew / mobilization; the scheduler FINALIZES (decision #2). Today's Schedule
  board already lets the scheduler set dates/crew — so this may be display-only work (show "proposed by
  Sales" vs "finalized") rather than new mechanism. `[DESIGN-OPEN — audit/verify current board covers
  it; if so, Step 8 shrinks to a label/badge.]`
- **Acceptance:** scheduler sees Sales' proposed dates/crew/mob and can finalize/adjust; ownership is
  visible (proposed vs finalized).

---

## 4. Data-model summary

- **jsonb-additive, NO migration (preferred):** task `size`/`unit`; material `mat_uid`; `material_tracking`
  map + `spec_overrides[]` (if kept on `job_wtcs`/`field_sow`); confirm stamps.
- **Possible additive migrations (command-suite-db ONLY, rehearsed before push):** `job_wtcs.material_tracking`
  as a real column if not folded into `field_sow`; `jobs.logistics_assets`; a `logistics_lists` table for
  Settings. Each is additive; none rewrites existing data. `[DERIVED — settle homes in §1/§5/§6, then a
  single command-suite-db migration if any survive as columns/tables.]`
- **PowerSync:** everything Field needs rides inside `field_sow` (jsonb) — no `field-command/schema.js`
  change. Tracking/lists that are web-only (warehouse Ordered/status, asset availability) must NOT be
  assumed to reach Field; confirm none of them are on the crew's required read path. `[verify in build]`
- **Legacy `materials` table:** Phase 3 stops reading it (§1A) but does not drop it — Phase 5 retires it.

---

## 5. Deploy / verification / sequencing

- **Order:** Step 0 (Sales task size/unit) ships first or same-deploy as the Schedule Needed math.
- **Preview-deploy each repo's branch; verify on preview** (never localhost-only for shared surface).
- **Smoke (shared DB):** author job 6618-style SOW with per-task sizes → open in Schedule → SOW tab
  shows it → Logistics shows Needed vs Ordered with correct flags (incl. a deliberate SHORT and a
  CAN'T TELL) → warehouse add + confirm + one locked-spec override-with-reason → reload survives.
- **Multi-WTC job** in smoke (rollup crosses WTCs).
- **Gate through terminals:** buildvsplan (T4) → code-review (T5) → security-review (T6) before merge.
- **Phase 3 done when:** the warehouse can open any job, see Needed-vs-Ordered per material with honest
  flags, track status + trucks/equipment, and the confirm/lock logic holds — leaving `field_sow`
  ready for Phase 4 to PRINT the ticket + Material Order Summary.

---

## 6. Ratification items (Chris — before build)

| # | Item | Recommendation | Tag |
|---|------|----------------|-----|
| R1 | Warehouse tracking data-home | (A) jsonb tracking map on `job_wtcs`, keyed by `matKey` | DERIVED |
| R2 | Pull `rollupSowMaterials()` forward into Phase 3 (vs Phase 4) | Yes — the modal needs it | DERIVED |
| R3 | Needed rounds UP to whole purchase units | Yes | DERIVED |
| R4 | Task size shown read-only in Schedule (Sales authors) | Yes | DERIVED |
| R5 | Where warehouse-added materials attach in the SOW (which day/task) | needs a beat / build call | DESIGN-OPEN |
| R6 | Settings surface for asset lists (new sch-command surface) | minimal per-tenant list editor | DESIGN-OPEN |
| R7 | Step 8 finalize — is new mechanism needed or just labels? | verify current board first | DESIGN-OPEN |

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-07-30. Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
This is a broad, foundation-touching plan — it decides where the warehouse's material tracking data
lives, adds a whole "needed vs ordered" math, and reaches back into the Sales screen. It's not risky in
the money sense, but it's easy to get the *data plumbing* wrong in a way that's hard to undo later. So
this deserves a real check (4 reviewers), each on a different risky corner: where the data lives, the
database changes, the confirm/lock rules, and whether any of it accidentally leaks to the field app.

### Round
- Plan type: feature
- Current round: 1
- Plan revision under audit: (uncommitted draft on `feat/dms1-phase3`; sha stamped at manifest commit)
- Findings trend: n/a — round 1

### Prior rounds
none — this is round 1

**Briefing for agents**: do NOT re-find issues from prior rounds (there are none). Attack the plan as
drafted. Cite `file:line` you read this round for any code/state assertion.

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant onboarding not in play.
- **Prod / staging / dev**: `sch-command` is live at schedulecommand.com but **no office users yet —
  Chris-only testing**; old Google Apps Script runs in parallel until parity. `sales-command` Step 0 is
  live prod (salescommand.app, HDSP daily).
- **Blocking feature flags**: none gating this surface.
- **Concurrency profile**: solo (Chris testing). Multi-user race findings cap at Low; cross-tenant cap at
  Med while `live_tenants == 1`. Theoretical blast radius against not-yet-live office-user concurrency is
  not High.

### Time budget + finding cap
- **Time budget**: ~150 min PROVISIONAL (no ERD per-phase lock exists; Chris to confirm — see note below).
- **Finding cap**: 15 findings (`max(3, ceil(150/10))`) — provisional, moves with the budget.

Synthesis MUST surface only the top-N most consequential findings; remainder → "Quarantined findings
(not actionable this loop)."

### Surface
- Total lines: 321
- Sections: 9 (h2)
- [LOCKED] decisions: 19
- [DESIGN-OPEN] items: 6
- [DERIVED] items: 10 (uncertainty surfaces — attack alongside DESIGN-OPEN)
- Plan-to-code ratio: n/a — plan has no §7 code estimate yet (est. code is large & multi-file; ratio not a
  scope-creep concern here).

### Layers touched
- UI / components (JobDetail tabs: new SOW tab + Materials→Logistics rename; MaterialsModal rewire; new Settings surface)
- Data layer (queries.js: new tracking writer; new `sowMaterials.js` rollup; modal repointed off `materials` table)
- State model (task `size`/`unit`; `material_tracking` map; `spec_overrides[]`; `mat_uid`; `logistics_assets`; confirm stamps)
- Migrations / schema (possible additive columns/tables in command-suite-db — homes still open)
- Cross-repo (sales-command Step 0 authoring; command-suite-db migrations)
- Real-time / sync (PowerSync — `field_sow` jsonb rides to Field; warehouse-only fields must NOT)
- Audit logging (existing `updateJobWtcFieldSow` audit + a new tracking writer that must log too)

### New mechanisms introduced
- New helper fn: `rollupSowMaterials(fieldSow)` in new `src/lib/sowMaterials.js` (Needed math + CAN'T-TELL reasons + cross-WTC rollup)
- New jsonb state: `job_wtcs.material_tracking` map (keyed by `matKey`), `spec_overrides[]`, per-material `mat_uid`
- New job-level state: `jobs.logistics_assets` (pick-many trucks/equipment/power + availability) — replaces 3 free-text columns
- Possible new table: `logistics_lists` (per-tenant Settings asset lists)
- New UI: SOW read-only tab; Logistics tab; warehouse confirm + override-with-required-reason flow
- New fields (Sales): task `size` + `unit`

### Cross-system reach
- `sales-command` — Step 0 (task size/unit) must ship first or same-deploy; sequencing dependency
- `command-suite-db` — any surviving column/table homes go here (rehearsed before push), shared ledger
- `field-command` / PowerSync — `field_sow` jsonb syncs to crew; warehouse tracking + asset availability
  must not sit on the Field required-read path or bloat the synced text column
- `updateJobWtcFieldSow` audit-logged write path (bypass/consistency with the new tracking writer)

### Irreversibility
- Migrations (if any survive as columns/tables): additive only, no destructive/backfill — reversible.
- The modal repointing off the `materials` table is a code behavior change (reversible); the `materials`
  table itself is NOT dropped in Phase 3 (Phase 5).
- No public API / external contract changes.

### Known weak points
- **§1 data-home is the load-bearing bet.** If (A) jsonb tracking map is chosen but the `matKey` strategy
  is wrong (custom/no-`catalog_id` materials, renamed catalog rows, same material on multiple days/WTCs),
  Ordered/status silently attach to the wrong material — a data-integrity bug that's invisible until the
  wrong number prints. Prime target.
- **Cross-WTC rollup (§2)** — the modal is per-job, `field_sow` is per-WTC; a job with multiple WTCs could
  double-count or drop materials in the rollup.
- **Needed math trust (§2/§0.9)** — task unit (SQFT/LF) vs coverage unit mismatch, blank task_ref, rounding
  up to purchase units. A wrong-but-plausible Needed is worse than CAN'T TELL.
- **Confirm/lock across ALL edit paths (§7)** — the lock must hold in CardSowModal AND FieldSowBuilder AND
  the Logistics rows; miss one and a "locked" Sales spec is still editable, or DMS-2 reset is skipped.
- **PowerSync leakage (§4)** — warehouse-only jsonb riding `field_sow` to the crew, or a required Field
  field accidentally moved to a web-only home.
- **Two new surfaces with open homes (Settings lists R6, warehouse-add attach point R5)** — under-specified;
  agents should pressure whether they're buildable as written or need a decision first.
- **Modal rewire without breaking existing readers** — `Materials.jsx` view + any card MTRL signal read the
  `materials` table today; repointing must not orphan them.

### Open questions
- Count: 6 [DESIGN-OPEN] + the 7-row §6 ratification table (R1–R7).
- Highest-pressure: R1 (data-home A vs B — everything hangs on it), R5 (where warehouse-added materials
  attach in the SOW), R6 (new Settings surface home).

### Suggested attack angles (4 total)
1. **Data-home + rollup correctness** — covers Data layer + State model. Required reading: `§1`, `§2`, `§0.9`,
   `MaterialsModal.jsx`, `FieldSowBuilder.jsx:85-150`, `queries.js:43,598`. Pressure: the `matKey` strategy
   under custom/renamed/multi-day/multi-WTC materials; rollup double-count/drop; Needed unit-mismatch &
   rounding; does (A) actually beat (B) enough to justify the rewire, or should the table retirement defer?
2. **Schema / migration / cross-repo** — covers Migrations + Cross-repo. Required reading: `§4`, `§5`, Step 0,
   `command-suite-db` migration/ledger conventions, `sch-command` CLAUDE.md (repo is unlinked, no local
   migrations). Pressure: which homes truly need a column/table vs jsonb; command-suite-db authoring +
   rehearsal + ledger; Step-0 Sales sequencing correctness; additive-only guarantee.
3. **Confirm/lock + write-path coverage** — covers business logic + Audit logging. Required reading: `§7`,
   `FieldSowBuilder.jsx` (constructors/`updateMaterialField`), `CardSowModal.jsx`, spine `§2`/`§3`. Pressure:
   does the lock hold across every edit path; does unconfirmed truly block the (Phase-4) print; escape-hatch
   log integrity + reason-required enforcement; DMS-2 reset narrowing actually complete.
4. **Field/PowerSync leakage + framework fit** — covers Sync + UI/framework. Required reading: `§4`,
   `field-command/src/lib/schema.js` (client column list), `queries.js` conventions, `JobDetail.jsx` tabs.
   Pressure: warehouse-only fields leaking to crew or bloating synced `field_sow`; a required Field field
   moved web-only; modal rewire orphaning `Materials.jsx`/MTRL-signal readers; tab-`key` rename fallout.

### Suggested agent count: 4

Rationale: the layer/mechanism/cross-system/open-question formula scores well above 5, but the risk clusters
collapse cleanly into 4 non-overlapping angles; a 5th (pure UX) would overlap angle 1/4, and round-1 economy
favors 4 over the cap. Drop to 3 by merging angle 4's framework-fit into angle 1 if Chris wants a lighter pass.
