# Daily Material Schedule — Build Order (Phases 2–4)

**Companion to** `docs/plans/daily_material_schedule.md` (the audited Phase-0 plan — decisions
#1/#2, ownership matrix, Phase-1 as-built). That doc is the **why + the data spine**; this doc is
the **build order** for the phases that ship the printed ticket. It does not restate or rewrite the
audited decisions — it references them.

**Loop:** ERD #44 (`dms1-phase2-sales-sow`) · locked 2026-07-28 19:18 · branch `sch-command feat/dms1-phase2-plan`
**Repos touched:** `sales-command` (SOW authoring) · `sch-command` (SOW builder + output) · `command-suite-db` (Phase-1 migrations already shipped; Phase-5 retire deferred)
**Status:** DRAFT — for plan-audit (T2). No code ships from this doc until audited.

---

## §0 The acceptance test (this is the yardstick — build backward from it)

Two reference artifacts, filed this session, define "done." Every field on them must flow
Sales bid → Schedule SOW → print. If the artifact renders it, the data must exist and carry.

1. **Crew ticket** — `docs/plans/assets/6618-lakes-crossing-crew-ticket.pdf` (built in Claude web; the crew loves it).
   - **Page 1 — Material Order Summary (crew version):** plain checklist. `# · MATERIAL · TOTAL NEEDED` (count pill) · checkbox. Header (logo, JOB/PROJECT, JOB NUMBER, CUSTOMER, PREPARED BY). Footer: LEAD / SALES signature + date. **No shortage math on the crew copy.**
   - **Per-day cards:** day label (free text, supports ranges e.g. "Day 4-5") · subline `CREW · HOURS · SQ FT · LINEAR FT · WTC` · **WORK TO COMPLETE** (tasks with inline %) · **SCOPE NOTES** (callout box) · **MATERIALS NEEDED** table (`MATERIAL · QTY (kit) · NOTES` where NOTES = specs as text: `Mils · Coverage · Mix time · Mix speed`) · checkbox per material.
   - **Footer:** `N DAYS SCHEDULED · GENERATED <date>`.

2. **Shop-manager shortage check** — `docs/plans/assets/6618-material-order-summary-shortage-check.png`.
   - Same Material Order Summary, **enhanced for the shop manager only** (pre-job procurement — NOT on the crew copy).
   - "Calculated against **1,085 sq ft** total for this job. Linear-feet materials calculated against **418 LF**."
   - Three count buckets: **OK TO PULL · VERIFY ON SITE · SHORT — ORDER MORE**.
   - Table: `MATERIAL · KIT SIZE · NEED · ON ORDER · STATUS` (`Short N units` / `OK · +N buffer` / `Not applicable` / verify).
   - Footnote (the formula, verbatim intent): *"Need = total square footage (or linear feet) ÷ coverage rate, × any batch multiplier (like bags per mix), rounded up to whole units. A range means the mixing ratio itself varies, so anything in between is worth a visual check on site. * means the coverage rate came from the scope description text rather than the Coverage Rate column. Materials without a coverage rate (like additives) show as not applicable and aren't counted."*

**Audience split [LOCKED #44]:** crew sees the plain checklist; shop manager gets the shortage view. Two renders of the same summary, different audience.

---

## §1 Design decisions locked this session (ERD #44)

These refine / override the earlier "locked UI decisions" in the Phase-0 doc where noted. Tagged for the auditor.

| # | Decision | vs. Phase-0 doc |
|---|---|---|
| D1 | **Lighter reskin (option a).** Graft the new fields into the existing `SowTab` day cards — do NOT restructure the day card (no grouping materials under tasks). | **Resolves** open item #2 "Decision #3 — reskin scope (a)/(b)". Gate CLEARED. |
| D2 | **Scope Notes** added per day (free-text callout). | New — the key missing field; richest content on the crew ticket. |
| D3 | **Material specs are text + auto-fill works.** Spec inputs number→text; fix the broken two-hop catalog stamp. | Confirms Phase-0 §0.3 / §4.2 (was flagged broken). |
| D4 | **Day label only — drop the "DAY X OF 7" badge.** | Matches Phase-0 "locked UI (a)". Re-confirmed after Chris toggled and reverted. |
| D5 | **KEEP the material→task "TASK N" tag** (per-material task picker → chip on ticket). | Matches Phase-0 "locked UI (c)". Chris ratified: a fast-read trigger for the field guy, error mitigation. NOTE: the reference crew ticket does NOT show the tag — building it anyway per Chris. |
| D6 | **Shortage check is shop-manager-only.** Crew ticket page-1 stays a plain checklist. | New — splits Phase 4 output into two renders. |

---

## §2 Phase 2 — Sales SOW authoring + Schedule save protection

**Repos:** `sales-command` (primary) + `sch-command` (the A1 "fold"). **Heaviest phase.**
**Internal order [LOCKED, Phase-0 §5]:** the Schedule passthrough-on-save lands **first or same-deploy** as the Sales field work — else the §0.2b data-destruction window applies to the new fields too.

### 2A — Schedule save protection (do this first) — `sch-command`
- **Fix the §0.2b live bug:** `FieldSowBuilder.jsx` `handleSave` (~:158-182) rebuilds each day/material from a key whitelist that **omits `mobilization_seq`, `sq_ft`, `linear_ft`** — silently erasing live Screen-1·A data on any edit. → **passthrough-on-save**: preserve all keys (spread, don't whitelist), so future fields (scope_notes, task_ref, specs) can't be stripped either.
- Text coercion for spec fields on save (stop parseFloat-ing text specs).
- One-hop catalog stamp on Schedule-side material adds (BF-11 picker already reads the catalog).

### 2B — Sales SOW authoring — `sales-command/src/pages/WTCCalculator.jsx`
- **Fix the two-hop spec stamp (Phase-0 §4.2):**
  - Hop 1 — `addFromDB` (~:485) copies `catalog_id` + all spec columns onto the Tab-3 cost line **and stamps `specs_stamped_at`** at pick time.
  - Hop 2 — SOW day-material picker stamps from the line; **fix the broken `m.coverage` → `coverage_rate` read** (§0.3 — stamps `""` today).
- **Spec inputs number→text** (`mils, mix_time, mix_speed, cure_time, unit`); add these to Tab-3 `updateItem` isText list (~:477) so text like "20-25 mils" stops corrupting to `20`.
- **Amber "confirm specs" chip + Send gate** (tri-state per Phase-0 §2: confirmed / unconfirmed / absent-grandfathered). Send blocks on unconfirmed specs.
- **Scope Notes** — new per-day textarea in the `SowTab` day card (jsonb-additive, no migration).
- **task_ref (D5)** — per-material TASK N picker on the day-material entry → stored on the material, rendered as a chip. jsonb-additive.
- **Catalog spec-entry UI** — spec columns in the `MaterialsTab` catalog editor + **`Settings.jsx:240-265` second editor** (Phase-0 §4.1); **fork-on-spec-edit** (editing specs/price on a NULL-tenant default forks to a tenant row); **surface "0 rows updated" as an error** (fixes today's silent no-op).
- **Badge read on the proposal screen** — extend `ProposalDetail`'s existing proposal load with `sow_revision_count`; show "SOW updated in Schedule — this version is historical" when `> 0` (Phase-0 §4.3).

### 2C — Gate at step 4 (reskin scope) — **CLEARED**
Phase-0 §5 gated Phase 2 on "decision #3 reskin scope, design session first." **Resolved this session = D1 (lighter reskin).** No further design session needed; auditor should confirm the graft-not-restructure call against the `SowTab` layout.

---

## §3 Phase 3 — Schedule SOW builder — `sch-command`

**RETROFIT, not greenfield** (Phase-0 §5): the write path + catalog picker already exist
(`queries.js:587-628` `updateJobWtcFieldSow`, `CardSowModal`/`FieldSowBuilder`, BF-11).
- Display + edit **Scope Notes** and **specs** in the Schedule SOW builder.
- **Confirm gate** on post-Send material adds (same tri-state as Sales).
- Edit **sqft / linear_ft** per day.
- Revision stamping arrives free via the Phase-1 §4.3 trigger.

---

## §4 Phase 4 — Output (the printed ticket + shop shortage view) — `sch-command`

### 4A — Crew ticket (print)
- **Material Order Summary (page 1, crew):** per-material totals rolled up across all days → plain checklist. **Folds parked BF-12 `rollupSowMaterials()`** (branch `feat/mtrl-sow-rollup` — fold, then delete the branch).
- **Per-day cards** matching the reference: day label, subline, Work to Complete (tasks+%), Scope Notes callout, Materials Needed table (specs as **text**, D3), TASK N chips (D5).
- **Print/sign frame:** logo, JOB/CUSTOMER/PREPARED BY header, LEAD/SALES signatures, `N DAYS SCHEDULED · GENERATED <date>` footer.
- **Print gate:** enforce `specs_confirmed` before allowing print (Phase-0 §2 — no stale/unconfirmed specs go to the crew).

### 4B — Shop-manager shortage view (screen, pre-job) [several DESIGN-OPEN items]
- **NEED** = job total sqft (or LF) ÷ coverage_rate × batch multiplier, rounded up. Graceful fallback: range → "verify on site"; text-sourced rate → asterisk; no rate → "Not applicable" (uncounted).
- **STATUS** = NEED vs ON ORDER → OK (+buffer) / Short N units / Verify / N/A. Three count buckets on top.
- Inputs needed: job total **sqft + LF**, per-material **coverage_rate** (from the specs pipeline — this is why 2B matters), **ON ORDER** quantity, **batch multiplier**, per-material **basis** (area vs length).

---

## §5 Open questions for plan-audit

1. **[DESIGN-OPEN] Where the shop-manager shortage view lives** — Schedule (warehouse/office side) route? A tab on the job? New screen? Not yet decided (Phase-0 §6 flagged it too).
2. **[DESIGN-OPEN] "ON ORDER" data source** — the `materials` table qty, the SOW `qty_planned`, or a new field? The shortage math is only as good as this number. Ties to Phase-5 `materials`-table retirement.
3. **[DESIGN-OPEN] Coverage-rate parsing** — extracting a number from free text ("125 Sqft per gallon", "50LF per gallon mixed", ".75 lbs per foot", "Varies"). Define the parse rules + the range/asterisk/N-A fallbacks concretely.
4. **[DESIGN-OPEN] Per-material basis (area vs length)** — the NEED formula picks sqft *or* LF per material. Where does that come from — parsed from the coverage unit, or a catalog field?
5. **[DESIGN-OPEN] Batch multiplier** ("bags per mix") — source and where it's entered.
6. **[DERIVED] Confirm the D1 graft-not-restructure call** against the actual `SowTab` render — auditor should verify no restructure is forced by scope_notes + task_ref.
7. **Phase 5 (retire `materials` table + `jobs.field_sow` mirror)** — deferred, subject to Phase-0 §1 retirement preconditions. Named, not in this loop's core, but ties to Q2.

---

## §6 Guardrails carried from standing rules

- **Migrations already shipped (Phase 1)** — `20260714120000-120300` in `command-suite-db`. Phases 2–4 are jsonb-additive (scope_notes, task_ref) + app code; **no new migration expected**. If one surfaces, it goes through `command-suite-db` only, rehearsed (`scripts/rehearse.sh`) before push.
- **PowerSync (Phase-0 §4.4):** jsonb additions inside `field_sow` ride the synced text column automatically — scope_notes, task_ref, specs reach Field with no `schema.js` change. `sow_revised_*` stays web-only.
- **Field is read-only, always.** No SOW write path from field-command.
- **Terminal flow:** this doc → plan-audit (T2) → build (T3) → buildvsplan (T4) → code-review (T5) → security-review (T6). Loop #44 stays open until the ticket prints (closes at built outcome).
