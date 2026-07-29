# DMS-1 Phase 2 — Build Spec (implementation-ready)

**DRAFT — pre-audit.** Drafted while round-1 plan-audit runs in the T2 terminal. Folds round-1
findings when they land (see §"Audit-sensitive" tags below). Does not modify the audited plan
(`daily_material_schedule_buildorder.md`) — this is a sibling build spec.

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
- **Text-coercion rule:** stop `parseFloat`-ing `mils`, `mix_time`, `cure_time` on save (they become
  text in Step 2). Only numeric fields (`crew_count`, `hours_planned`, `qty_planned`, `pct_complete`)
  get `parseFloat`. Confirm the `updateDayField` inline coercion (`:59`) matches — it currently
  `parseFloat`s everything that isn't `day_label`/`date`; widen its text-passthrough list to include
  the spec keys.
- **Acceptance:** edit a mob-carrying SOW in Schedule, save, reload → `mobilization_seq`, `sq_ft`,
  `linear_ft` survive (they're erased today). This is the §0.2b live-bug fix.

### Step 2 — Two-hop spec stamp + text spec inputs `[LOCKED core; verify against audit angle-1]`
**Repo:** `sales-command` · **File:** `src/pages/WTCCalculator.jsx`

- **Hop 1 — `addFromDB` (`:485`):** currently keeps `id: Date.now()`, `from_catalog: true`,
  `coverage_rate: m.coverage`, and **no `catalog_id`**. Add `catalog_id: m.id` + copy all spec
  columns (`mils, mix_time, mix_speed, cure_time, unit`) from the catalog row + stamp
  `specs_stamped_at` at pick time (Phase-0 §4.2 [B1] — stamp when values leave the catalog).
- **Hop 2 — SOW day-material picker (`:735-741`):** fix the broken read — stamp reads `m.coverage`
  but Tab-3 lines carry `coverage_rate`; change to `coverage_rate`. Carry `specs_stamped_at` along
  (do NOT re-stamp `now()`).
- **Text inputs:** the spec `specInput`s for `mils` (`:790`) and `mix_time` (`:803`) are
  `type="number"` → make text. Add `mils, mix_time, mix_speed, cure_time, unit` to the Tab-3
  `isText` coercion list (`:480`) so "20-25 mils" stops coercing to `20`.
- **Acceptance:** pick a catalog material with specs → the SOW entry shows the real coverage rate
  (blank today), text specs survive editing, and the Tab-3 line carries a `catalog_id`.

### Step 3 — Scope Notes per day `[LOCKED · jsonb-additive]`
**Repo:** `sales-command` · `WTCCalculator.jsx` SowTab day card + `field_sow` day shape.

- Add `scope_notes: ''` to the `addDay` day shape (`:879`) and to `DAY_COERCE` (`:887`, passthrough).
- Add a full-width textarea in the day card (below the header row, above/beside Tasks) — matches the
  crew-ticket "SCOPE NOTES" callout. Design tokens per `sales-command` style rules (linen, no white).
- **Acceptance:** type scope notes on a day, save, reload → persists in `field_sow`.

### Step 4 — Material → Task tag (`task_ref`) `[AUDIT-SENSITIVE — angle 3 (framework-fit)]`
**Repo:** `sales-command` · `WTCCalculator.jsx` day-material entry.

- Add `task_ref` to each material (stores the day-task `id` it belongs to; blank allowed — Phase-0 §2).
- UI: a small "Task N" picker on the material row → renders as a chip.
- **HOLD until audit angle-3 returns:** the auditor is checking whether adding a per-material task
  picker forces the day-card restructure that D1 (lighter graft) is avoiding. If angle-3 says the
  graft holds → build as above. If it flags a restructure → re-scope with Chris before building.

### Step 5 — Amber confirm chip + tri-state Send gate `[AUDIT-SENSITIVE — angle 3 (legacy edges)]`
**Repo:** `sales-command` · `WTCCalculator.jsx` material entry + Send path.

- Tri-state per Phase-0 §2: `specs_confirmed` = confirmed / unconfirmed / absent (grandfathered
  legacy lines with no `catalog_id` → absent, never forced to confirm).
- Amber chip on unconfirmed specs; Send gate blocks on unconfirmed.
- **HOLD for audit:** angle-3 is walking the tri-state against grandfathered legacy Tab-3 lines for
  false-block / false-pass. Build after that finding lands.

### Step 6 — Catalog spec entry + fork-on-edit + Settings second editor `[LOCKED core]`
**Repo:** `sales-command` · `WTCCalculator.jsx` MaterialsTab catalog editor (`:431-467`) + `Settings.jsx:240-265`.

- Add spec columns to both catalog editors (the MaterialsTab one AND the second one in `Settings.jsx`
  — Phase-0 §4.1, the one the plan previously never named).
- Fork-on-spec-edit: editing specs/price on a NULL-tenant default forks to a tenant row (Phase-0
  §4.1 [C1]); the existing `(name, kit_size)` tenant-wins dedupe shadows the default.
- **Fix the silent no-op:** the catalog edit currently only catches errors (`:452-467`); RLS filters
  a system-row update to 0 rows with no error → surface "0 rows updated" as an error.
- Use the same case-insensitive `lower()` predicate the shipped index uses (Phase-0 build-amendment
  A1) — `WTCCalculator.jsx:443` already keys `lower(name)|lower(kit_size)`; mirror it.

### Step 7 — Revision badge read on the proposal screen `[LOCKED]`
**Repo:** `sales-command` · `src/components/ProposalDetail.jsx`

- Extend ProposalDetail's existing proposal load with `sow_revision_count` (extend-canonical, not a
  new loader — Phase-0 §4.3). Show "SOW updated in Schedule — this version is historical" when `> 0`.
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

## Audit-sensitive summary (fold when round-1 returns)
- **Step 4 (task_ref):** blocked on angle-3 restructure check.
- **Step 5 (Send gate):** blocked on angle-3 legacy-line edge check.
- **Step 1 ordering:** angle-1 is verifying the "Schedule-first" ordering holds; if it flags a wider
  window, tighten to same-deploy.
- Everything else (Steps 1 core, 2, 3, 6, 7) is locked and audit-independent — safe to build now.
