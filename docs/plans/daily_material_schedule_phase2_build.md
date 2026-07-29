# DMS-1 Phase 2 — Build Spec (implementation-ready)

**Round-1 audit folded (2026-07-28).** All 8 spine findings (A1/A2, C1, C2/C3, D1, D2, E1) are
integrated below; §4B shortage view was cut to its own loop (this spec is Phase 2 only, so unaffected).
Steps 4 & 5 cleared — round-1 angle-3 found no restructure/gate blocker. Sibling to the audited plan
(`daily_material_schedule_buildorder.md`); does not modify it. **Pending round-2 re-audit** (light).

**Loop:** ERD #44 (`dms1-phase2-sales-sow`) · branch `feat/dms1-phase2-plan`
**Scope:** Phase 2 only — Sales SOW authoring (`sales-command`) + Schedule save protection (`sch-command`).
**Parent:** `daily_material_schedule_buildorder.md` §2. Decisions: `daily_material_schedule.md` §1/§2/§4.
**Build terminal (T3) executes this. Plan terminal (T1) does not ship code.**

---

## Ordered build steps

Ordering is load-bearing: **Step 1 (Schedule save-protection) lands first or same-deploy** as the
Sales-side field additions — else the §0.2b strip window applies to the new fields too (Phase-0 §5).

### Step 1 — Schedule save-protection passthrough `[LOCKED · audit-independent · do first]`
**Repo:** `sch-command` · **File:** `src/components/FieldSowBuilder.jsx` (`handleSave`, `:154-183`)

Today `handleSave` rebuilds each day from a fixed whitelist (`:158-181`) = `{id, day_label, date,
crew_count, hours_planned, tasks, materials}` — dropping `mobilization_seq`, `sq_ft`, `linear_ft`
(and it would drop `scope_notes`/`task_ref` too). Fix = **passthrough, not whitelist**:

- Spread the existing day object, then normalize only the fields that need coercion:
  ```
  const clean = days.map(d => ({
    ...d,                                   // preserve mobilization_seq, sq_ft, linear_ft, scope_notes, future keys
    date: d.date || null,
    crew_count: parseFloat(d.crew_count) || 0,
    hours_planned: parseFloat(d.hours_planned) || 0,
    tasks: (d.tasks || []).map(t => ({ ...t, pct_complete: parseFloat(t.pct_complete) || 0 })),
    materials: (d.materials || []).map(m => ({
      ...m,                                 // preserve task_ref + any new spec keys
      qty_planned: parseFloat(m.qty_planned) || 0,
      // specs stay TEXT — do NOT parseFloat mils/mix_time/cure_time (see Step 2 coercion rule)
    })),
  }))
  ```
- **[A2] Spread alone is not enough — seed the new keys at every constructor.** A spread only keeps
  keys the object already has. Add `task_ref`, `catalog_id`, `specs_stamped_at` (blank/null defaults)
  in ALL sch material constructors: `addMaterialToDay` / `addCatalogMaterialToDay` /
  `addCustomMaterialToDay` (`FieldSowBuilder.jsx:79-113`). (Sales `addMaterial :738` handled in Step 2.)
- **[C3] Text-coercion — render, save AND keystroke.** Stop `parseFloat`-ing `mils`, `mix_time`,
  `cure_time`:
  (1) **[R1, round-2 regression] the sch RENDER inputs** — `FieldSowBuilder.jsx` `specInput` calls
  for `mils` (`:435`) and `mix_time` (`:448`) pass `'number'` as the 4th arg → drop it so they render
  as text (shared helper at `:366`; two-call-site edit). This is the sch twin of the sales `specInput`
  fix in Step 2 [C2/C3] — the last unnamed site of the round-1 propagation pattern. Without it a
  Schedule user physically cannot type "20-25 mils" (the browser rejects it).
  (2) on save (above); (3) at keystroke — `updateMaterialField` `numericKeys` (`:124`) must drop the
  spec keys; and (4) the day-level `updateDayField` inline coercion (`:59`) keeps its text-passthrough
  for `day_label`/`date` (day fields, not spec fields). Only true numerics (`crew_count`,
  `hours_planned`, `qty_planned`, `pct_complete`) get `parseFloat`.
- **Acceptance:** edit a mob-carrying SOW in Schedule, save, reload → `mobilization_seq`, `sq_ft`,
  `linear_ft` survive (erased today); a text spec like "20-25 mils" survives a keystroke edit (coerces
  to `20` today). This is the §0.2b live-bug fix.

### Step 2 — Two-hop spec stamp + text spec inputs `[LOCKED core; C1/C2/C3 folded]`
**Repo:** `sales-command` · **File:** `src/pages/WTCCalculator.jsx`

- **[C1] One canonical spec-key set, stamp ALL fields — not just coverage.** Define once:
  `{mils, coverage_rate, mix_time, mix_speed, cure_time, unit}`. Today `mils`/`mix_time`/etc are
  hardcoded `0`/`""` — same gap coverage has; stamp all of them.
  - **Hop 1 — `addFromDB` (`:485`):** currently keeps `id: Date.now()`, `from_catalog: true`,
    `coverage_rate: m.coverage`, and **no `catalog_id`**. Add `catalog_id: m.id` + copy EVERY spec
    column from the catalog row + stamp `specs_stamped_at` at pick time. **`catalog_id` +
    `specs_stamped_at` are NET-NEW keys, not a "fix" of existing ones** (Phase-0 §4.2 [B1]).
  - **Hop 2 — SOW day-material picker (`:735-741`) + sales `addMaterial :738`:** fix the broken read —
    stamp reads `m.coverage` but Tab-3 lines carry `coverage_rate`; change to `coverage_rate`. Carry
    `specs_stamped_at` (do NOT re-stamp `now()`); seed `task_ref`/`catalog_id` here too.
- **[C2/C3] Text inputs — BOTH editors.** (1) Tab-3 `isText` coercion list (`:480`) add
  `mils, mix_time, mix_speed, cure_time, unit`. (2) **`FieldSowMaterialPicker.specInput` (`:752-790`)
  — the editor whose values reach the crew ticket** — `mils` (`:790`)/`mix_time` (`:803`) are
  `type="number"` there too; make text. Miss either and "20-25 mils" still corrupts to `20`.
- **Acceptance:** pick a catalog material with specs → the SOW entry shows the real coverage rate AND
  mils/mix specs (all blank today), text specs survive editing in the day picker, Tab-3 line carries
  `catalog_id` + `specs_stamped_at`.

### Step 3 — Scope Notes per day `[LOCKED · jsonb-additive]`
**Repo:** `sales-command` · `WTCCalculator.jsx` SowTab day card + `field_sow` day shape.

- Add `scope_notes: ''` to the `addDay` day shape (`:879`) and to `DAY_COERCE` (`:887`, passthrough).
- Add a full-width textarea in the day card (below the header row, above/beside Tasks) — matches the
  crew-ticket "SCOPE NOTES" callout. Design tokens per `sales-command` style rules (linen, no white).
- **Acceptance:** type scope notes on a day, save, reload → persists in `field_sow`.

### Step 4 — Material → Task tag (`task_ref`) `[CLEARED — round-1 angle-3 found no restructure]`
**Repo:** `sales-command` · `WTCCalculator.jsx` day-material entry.

- Add `task_ref` to each material (stores the day-task `id` it belongs to; blank allowed — Phase-0 §2).
  Seed it at the constructors named in Step 1 [A2] / Step 2.
- UI: a small "Task N" picker on the material row → renders as a chip.
- **Round-1 result:** angle-3 did NOT find that the per-material task picker forces a day-card
  restructure — D1 (lighter graft) holds. Build as above.

### Step 5 — Amber confirm chip + tri-state Send gate `[CLEARED — build to tri-state]`
**Repo:** `sales-command` · `WTCCalculator.jsx` material entry + Send path.

- Tri-state per Phase-0 §2: `specs_confirmed` = confirmed / unconfirmed / absent (grandfathered
  legacy lines with no `catalog_id` → absent, never forced to confirm).
- **[D1] Init rule:** set `specs_confirmed = false` only when the source has ≥1 non-empty spec;
  blank-spec rows stay absent (no forced confirm ritual).
- Amber chip on unconfirmed specs (use a **named design token**, not hardcoded hex — backlog);
  Send gate blocks on unconfirmed. Read the **tri-state**, never a JS-truthy check (else "absent"
  false-blocks — same rule the Phase-4 print gate must follow).
- **Round-1 result:** angle-3 confirmed the tri-state approach; no false-block/false-pass blocker.

### Step 6 — Catalog spec entry + fork-on-edit + Settings second editor `[LOCKED core]`
**Repo:** `sales-command` · `WTCCalculator.jsx` MaterialsTab catalog editor (`:431-467`) + `Settings.jsx:240-265`.

- **[D2] Both edits land in BOTH editors (duplicated code) — `WTCCalculator.jsx:459-471` AND
  `Settings.jsx:257-275`.** Preferred: extract a shared `saveCatalogRow(...)` both call. Otherwise
  build each as a separate line item — do not fix one and forget the other.
- Add spec columns to both catalog editors (Phase-0 §4.1 — the `Settings.jsx` one was previously unnamed).
- Fork-on-spec-edit: editing specs/price on a NULL-tenant default forks to a tenant row (Phase-0
  §4.1 [C1]); the existing `(name, kit_size)` tenant-wins dedupe shadows the default. Use the same
  case-insensitive `lower()` predicate the shipped index uses (build-amendment A1) —
  `WTCCalculator.jsx:443` keys `lower(name)|lower(kit_size)`; mirror it.
- **[D1] INSERT-stamp contract — write it verbatim in the build.** Migration `20260714120000`'s
  trigger stamps `specs_updated_at` on UPDATE only, **NOT on INSERT** (build-amendment A2). So every
  fork/insert path sets `specs_updated_at` **by hand**: typed specs → `now()`; price-only fork →
  **copy the source row's value** (never `now()` on inherited data). And the confirm-gate init rule:
  set `specs_confirmed = false` only when the source row has ≥1 non-empty spec — blank-spec rows stay
  absent (no forced confirm ritual, Phase-0 §2).
- **Fix the silent no-op:** the catalog edit currently only catches errors (`:452-467`); RLS filters
  a system-row update to 0 rows with no error → surface "0 rows updated" as an error. **Adjacent:**
  also catch the unique-index violation (`23505`) with a friendly "already in your catalog" message.

### Step 7 — Revision badge read on the proposal screen `[LOCKED]`
**Repo:** `sales-command` · `src/components/ProposalDetail.jsx`

- **[E1] Read from `job_wtcs`, NOT a `proposals` column.** `sow_revision_count` lives on `job_wtcs`
  (Phase-1 trigger), and a job can have multiple WTCs. Extend ProposalDetail's load with a **`job_wtcs`
  join by `call_log_id` + `MAX(sow_revision_count)` aggregate** (extend-canonical, not a new loader —
  Phase-0 §4.3). Show "SOW updated in Schedule — this version is historical" when the max `> 0`.
- The Phase-1 trigger already stamps the count; this is read-only display.

---

## Deploy / verification

- **Deploy order:** Step 1 (Schedule) first or same-deploy as Steps 2–6 (Sales). Preview-deploy each
  repo's branch; verify on preview before merge (never localhost-only for shared surface).
- **No migration expected** — Steps 3/4 are jsonb-additive; Phase-1 columns already shipped. If one
  surfaces, it goes through `command-suite-db` only, rehearsed before push.
- **PowerSync:** jsonb additions (`scope_notes`, `task_ref`) ride the synced `field_sow` text column —
  no `field-command/schema.js` change, no Field release needed.
- **Phase-2 done when:** a proposal authored in Sales carries clean text specs + scope notes + task
  tags through Send → Schedule can edit the SOW without stripping any field (Step 1) → the data is in
  `job_wtcs[].field_sow` ready for the Phase-3 builder and Phase-4 ticket.

---

## Round-1 audit resolution (folded)
- **Step 4 (task_ref):** CLEARED — angle-3 found no restructure; lighter graft (D1) holds.
- **Step 5 (Send gate):** CLEARED — tri-state confirmed; init rule [D1] + read-tri-state-not-truthy folded.
- **Step 1:** [A1] handleSave passthrough + [A2] seed keys at every constructor + [C3] keystroke coercer.
- **Step 2:** [C1] stamp all spec fields (not just coverage) + [C2/C3] text in BOTH editors.
- **Step 6:** [D2] both catalog editors + [D1] INSERT-stamp contract + unique-violation catch.
- **Step 7:** [E1] badge from `job_wtcs` MAX join, not a `proposals` column.
- **§4B shortage view:** deferred to its own loop (not in this Phase 2 spec).
- **Next:** round-2 re-audit (light — scope-cut + text tightening, no new mechanism).
