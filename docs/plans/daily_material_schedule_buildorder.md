# Daily Material Schedule — Build Order (Phases 2–4)

**Companion to** `docs/plans/daily_material_schedule.md` (the audited Phase-0 plan — decisions
#1/#2, ownership matrix, Phase-1 as-built). That doc is the **why + the data spine**; this doc is
the **build order** for the phases that ship the printed ticket. It does not restate or rewrite the
audited decisions — it references them.

**Loop:** ERD #44 (`dms1-phase2-sales-sow`) · locked 2026-07-28 19:18 · branch `sch-command feat/dms1-phase2-plan`
**Repos touched:** `sales-command` (SOW authoring) · `sch-command` (SOW builder + output) · `command-suite-db` (Phase-1 migrations already shipped; Phase-5 retire deferred)
**Status:** DRAFT — for plan-audit (T2). No code ships from this doc until audited.

---

## §0 Baseline — observed current state (read-verified 2026-07-28)

All **read-verified** today (code read on freshly-pulled `sales-command` main + `sch-command`
`feat/dms1-phase2-plan` + `command-suite-db` main). Not run-verified — this is a plan; it changes
authoring + output surface, and each claim below is a file/line read, not a behavioral observation.
Extends the canonical Phase-0 §0 baseline (verified 2026-07-14) with what's directly in this plan's path.

1. **Sales SOW authoring = `WTCCalculator.jsx` Tab 4 "Scope of Work" (`SowTab`).** Day cards already carry `day_label`, `crew_count`, `hours_planned`, `date`, `mobilization_id`, `sq_ft`, `linear_ft` (render `~1029-1088`) and tasks with `pct_complete` (`~1098-1135`). **No `scope_notes` field and no per-material `task_ref` exist** — grep for both across `WTCCalculator.jsx` returns **zero hits**.
2. **Material spec inputs are number-typed where they must be text.** `mils`, `mix_time`, `qty_planned` render as `type="number"` (`:790, :803, :783`); the Tab-3 `isText` coercion list (`:480`) = `[product, kit_size, coverage_rate, supplier]` — it **omits `mils/mix_time/mix_speed/cure_time/unit`**, so a text spec like "20-25 mils" coerces to `20`.
3. **The two-hop catalog stamp is broken (confirms Phase-0 §0.3).** `addFromDB` (`:485`) builds a Tab-3 line with `id: Date.now()`, `from_catalog: true`, `coverage_rate: m.coverage` — it keeps **no `catalog_id`** and stamps **no `specs_stamped_at`**. Downstream the SOW stamp reads `m.coverage` while Tab-3 lines carry `coverage_rate`, so coverage stamps `""`.
4. **§0.2b live save-strip bug — confirmed firsthand.** `sch-command/src/components/FieldSowBuilder.jsx` `handleSave` (`:158-181`) rebuilds each day as `{id, day_label, date, crew_count, hours_planned, tasks, materials}` — it **omits `mobilization_seq`, `sq_ft`, `linear_ft`**, silently erasing live Screen-1·A data on any Schedule-side SOW edit.
5. **Phase-1 migrations are shipped** on `command-suite-db` main: `20260714120000_materials_catalog_spec_columns`, `120100` tenant/name/kit unique index, `120200` `job_wtcs` sow-revision stamp trigger, `120300` comment fix. Verified present on disk today.
6. **The output does not exist yet.** No Daily Material Schedule ticket render and no shortage-check summary in `sch-command`. The parked `rollupSowMaterials()` (branch `feat/mtrl-sow-rollup`, unmerged) is the only rollup logic and is preview-only.
7. **Canonical `field_sow` home = `job_wtcs[].field_sow`** (Phase-0 Decision #1). Both reference artifacts were filed this session under `docs/plans/assets/`.

---

## §0·A Acceptance test (the yardstick — build backward from it)

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

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-07-28. Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
This is a big, cross-app plan — it wires material specs and scope notes all the way from the sales bid to the printed crew ticket and the shop-manager shortage check. The riskiest parts aren't the data spine (already settled and half-shipped) — they're the **shortage math** (turning messy coverage-rate text into a real "did we order enough" number) and making sure **every save preserves the new fields** so nothing gets silently erased. Three reviewers, one on each: the data-flow, the math, and whether the "keep it simple" screen actually holds once the new fields land.

### Round
- Plan type: feature
- Current round: 1
- Plan revision under audit: 7ee0f79 (+ uncommitted §0 Baseline + manifest, committed next)
- Findings trend: n/a — round 1

### Prior rounds
none — this is round 1.

**Briefing for agents**: this is round 1; there is no prior-round record to avoid. Attack the whole plan. From round 2 on, do NOT re-find issues named in the revision-pass commit message.

### Deployment context
- **Live tenants**: 1 — HDSP (Sales Command). Schedule Command has **no office users yet** (Chris-only, testing).
- **Prod / staging / dev**: Sales SOW authoring is live in prod (WTC calculator used daily); the Schedule SOW builder + the new output are not customer-live. Phase-1 migrations are live.
- **Blocking feature flags**: none gating this surface.
- **Concurrency profile**: solo (Chris). No multi-user contention today.

Agents weight severity against these: cross-tenant findings cap at Med while `live_tenants == 1`; multi-user race findings cap at Low while solo; theoretical attacks against state that doesn't exist yet are not High. The §0.2b save-strip bug is the exception — it's a real live-data-loss path, cap does not apply.

### Time budget + finding cap
- **Time budget**: outcome loop (#44) — not time-locked; picture closes when the ticket prints. Defaulted per standing rule (cap is not a time-budget question).
- **Finding cap**: 8 findings (top-N surfaced; remainder → "Quarantined findings (not actionable this loop)").

### Surface
- Total lines: ~150
- Sections: 8 (§0 Baseline, §0·A Acceptance test, §1 Decisions, §2 Phase 2, §3 Phase 3, §4 Phase 4, §5 Open questions, §6 Guardrails)
- [LOCKED] decisions: 7 (D1–D6 + the audience split)
- [DESIGN-OPEN] items: 5 (§5 Q1–Q5)
- [OPEN] items: 1 (§5 Q7 — Phase-5 retire, deferred)
- Plan-to-code ratio: well under 50:1 (Phase 2–4 is hundreds of code lines across 3 repos vs ~150 plan lines) — not scope-crept.

### Layers touched
- UI / components (SowTab, FieldSowBuilder, ticket render, shortage view, Settings second editor)
- Data layer (queries.js `updateJobWtcFieldSow`, `rollupSowMaterials` fold, ProposalDetail load)
- State model (field_sow jsonb: `scope_notes`, per-material `task_ref`; Tab-3 line `catalog_id`/`specs_stamped_at`; `sow_revision_count` read)
- Cross-repo (sales-command ↔ sch-command ↔ command-suite-db; Field read-only consumer)
- Real-time / sync (PowerSync — field_sow jsonb additions ride the synced text column)
- Cost / performance (rollup + shortage math over per-day materials — minor)

### New mechanisms introduced
- New jsonb fields: `scope_notes` (field_sow day), `task_ref` (per-material)
- Tab-3 line additions: `catalog_id`, `specs_stamped_at`
- New helper: shortage-check NEED calculator (coverage-rate parser + batch multiplier + per-material area/length basis)
- Folded helper: `rollupSowMaterials()` (exists on parked branch, not yet in main)
- Amber "confirm specs" chip + tri-state Send gate (confirmed / unconfirmed / absent-grandfathered)
- Fork-on-spec-edit app path (Phase-1 trigger already shipped; app-side fork is new)
- (NOT new: the `job_wtcs` sow-revision trigger — shipped Phase 1)

### Cross-system reach
- `sales-command` (WTCCalculator, ProposalDetail, Settings) writes specs + field_sow
- `sch-command` (FieldSowBuilder, queries.js) edits canonical field_sow + renders output
- `command-suite-db` (materials_catalog specs, job_wtcs trigger) — source of truth
- `field-command` — read-only consumer of field_sow via PowerSync (must stay read-only)

### Irreversibility
- Phase 2–4: jsonb-additive + app code → **reversible**.
- Phase-1 migrations: already shipped, additive.
- Phase-5 (retire `materials` table + `jobs.field_sow` mirror): destructive but **deferred, out of this loop's core**.

### Known weak points
- **Ordering hazard (§2A first):** the Schedule `handleSave` passthrough MUST land first or same-deploy as the Sales field additions — otherwise `scope_notes`/`task_ref`/specs get stripped the same way `sq_ft`/`linear_ft` are today (§0.2b). If the build does Sales first, it widens the data-loss window.
- **Coverage-rate parsing is the load-bearing fuzzy step (§4B, §5 Q3):** the shortage NEED depends on turning free text ("125 Sqft per gallon", "50LF per gallon mixed", ".75 lbs per foot", "Varies") into a number. Garbage-in → wrong "order more" call, which is a material/money decision.
- **Per-material basis undefined (§5 Q4):** NEED divides by sqft OR linear-ft per material; nothing in the data says which. Wrong divisor → wildly wrong NEED (the screenshot already shows Sand NEED 1,447 vs on-order 1 — is that real or a basis error?).
- **"ON ORDER" source undefined (§5 Q2):** the shortage verdict is only as trustworthy as this number; not yet pinned to a column.
- **Spec-vs-artifact mismatch on `task_ref` (D5):** the reference crew ticket does NOT render the task tag, yet the plan builds it. Auditor should confirm it doesn't quietly force the day-card restructure that D1 (lighter graft) says it's avoiding.
- **Tri-state Send gate × grandfathered legacy lines:** confirmed/unconfirmed/absent interacts with pre-feature Tab-3 lines that have no catalog_id/specs — edge cases where the gate could false-block or false-pass.

### Open questions
- Count: 5 [DESIGN-OPEN] (§5 Q1–Q5) + 1 [OPEN] (Q7).
- Highest-pressure: Q3 (coverage-rate parsing) + Q4 (per-material area/length basis) — together they decide whether the shortage math is buildable from data that exists, or needs a new catalog field first.

### Suggested attack angles (3 total)
1. **Cross-repo data-flow + state trace (mandatory).** Covers state model, data layer, cross-repo write paths, PowerSync, Field-read-only. Required reading: `sales-command/src/pages/WTCCalculator.jsx` (SowTab, `addFromDB`, the two-hop stamp), `sch-command/src/components/FieldSowBuilder.jsx` `handleSave`, `sch-command/src/lib/queries.js` `updateJobWtcFieldSow`, Phase-1 migrations, Phase-0 §4.2/§4.4. Specific pressure: does EVERY writer preserve the new jsonb keys (`scope_notes`, `task_ref`) after the §2A passthrough fix? Does the two-hop stamp now reach `coverage_rate` correctly end-to-end? Does the §2A-first ordering actually hold in the build order? Do the jsonb additions reach Field with no schema.js change, and does anything create a Field write path?
2. **Shortage-math correctness + design-open cluster.** Covers the new NEED calculator + the §5 uncertainty. Required reading: `docs/plans/assets/6618-material-order-summary-shortage-check.png` (footnote formula), §4B, §5 Q1–Q5. Specific pressure: is the NEED math specifiable from data that EXISTS today, or does it need a new catalog field (basis, batch multiplier) first? Are Q2/Q3/Q4 build-blockers or deferrable? Pressure-test the coverage-rate parse rules against the real messy strings in the reference PDF.
3. **Framework-fit + spec-vs-artifact.** Covers UI graft + business logic. Required reading: `WTCCalculator.jsx` SowTab render, the crew-ticket reference PDF, Phase-0 §2 (confirm-gate tri-state rules). Specific pressure: does D1 (lighter graft) actually hold once `scope_notes` + `task_ref` land, or does the UI get forced into a restructure? Is building `task_ref` (D5) justified when the reference omits it? Walk the tri-state confirm gate against grandfathered legacy lines for false-block / false-pass.

### Suggested agent count: 3

Rationale: the criteria formula scores higher (5 layers + cross-system + novel mechanisms + 5 open questions → ~8 angles → caps at 5), but the three angles above cleanly absorb every layer without overlap — PowerSync/Field-read-only fold into angle 1 because Phase-0 already verified the sync path, and the migration layer is done. Three meaty agents match the sweet spot and avoid the thin-agent overstaffing the raw formula would produce; escalate to a round-2 cross-system pass only if angle 1 surfaces a real contract break.
