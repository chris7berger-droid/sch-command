# Daily Material Schedule — Build Order (Phases 2–4)

**Companion to** `docs/plans/daily_material_schedule.md` (the audited Phase-0 plan — decisions
#1/#2, ownership matrix, Phase-1 as-built). That doc is the **why + the data spine**; this doc is
the **build order** for the phases that ship the printed ticket. It does not restate or rewrite the
audited decisions — it references them.

**Loop:** ERD #44 (`dms1-phase2-sales-sow`) · locked 2026-07-28 19:18 · branch `sch-command feat/dms1-phase2-plan`
**Repos touched:** `sales-command` (SOW authoring) · `sch-command` (SOW builder + output) · `command-suite-db` (Phase-1 migrations already shipped; Phase-5 retire deferred)
**Status:** Revision pass 1 applied 2026-07-28 (round-1 audit: 2H/6M, `scope-cut-shortage-math + partial-fix-propagation`). §4B shortage view cut to its own loop (ratified by Chris); buildable spine (§2A/2B/3/4A) hardened for 8 findings. Ready for round-2 re-audit (light pass — scope-cut + text tightening, no new mechanism).

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
- **[A1] Fix `handleSave` (§0.2b live bug):** `FieldSowBuilder.jsx` `handleSave` (~:158-182) rebuilds each day/material from a key whitelist that **omits `mobilization_seq`, `sq_ft`, `linear_ft`** — silently erasing live Screen-1·A data on any edit. → **passthrough-on-save**: spread the day/material, don't whitelist.
- **[A2] The `handleSave` fix ALONE is insufficient — seed the new keys at EVERY entry constructor too.** A spread only preserves keys that exist on the object; the constructors must put them there. Add `task_ref`, `catalog_id`, `specs_stamped_at` (blank/null defaults) at: sch `addMaterialToDay` / `addCatalogMaterialToDay` / `addCustomMaterialToDay` (`FieldSowBuilder.jsx:79-113`) AND sales `addMaterial` (`WTCCalculator.jsx:738`). Name all four in the build.
- **[C2/C3] Text coercion — BOTH editors + the keystroke coercers.** Stop `parseFloat`-ing text specs on save AND at keystroke: sch `updateMaterialField` `numericKeys` (`:124`) must drop `mils/mix_time/cure_time`. (Sales side in 2B.)
- One-hop catalog stamp on Schedule-side material adds (BF-11 picker already reads the catalog).

### 2B — Sales SOW authoring — `sales-command/src/pages/WTCCalculator.jsx`
- **[C1] Two-hop stamp — one canonical spec-key set, ALL fields, not just coverage.** Define the spec-key set once: `{mils, coverage_rate, mix_time, mix_speed, cure_time, unit}`. Today `mils`/`mix_time`/etc are hardcoded `0`/`""` — the same gap coverage has. Stamp ALL of them + `catalog_id` + `specs_stamped_at` at Hop 1.
  - Hop 1 — `addFromDB` (~:485): copy every spec column from the catalog row + `catalog_id: m.id` + stamp `specs_stamped_at` at pick time. **Note: `catalog_id` + `specs_stamped_at` are NET-NEW keys, not a "fix" of existing ones.**
  - Hop 2 — SOW day-material picker (~:735-741): stamp from the line; **fix the broken `m.coverage` → `coverage_rate` read** (§0.3 — stamps `""` today); carry `specs_stamped_at` (do not re-stamp `now()`).
- **[C2/C3] Spec inputs number→text — BOTH editors.** (1) Tab-3 `updateItem` isText list (~:480) add `mils, mix_time, mix_speed, cure_time, unit`. (2) **`FieldSowMaterialPicker.specInput` (~:752-790) — the one whose values reach the crew ticket** — `mils`/`mix_time` are `type="number"` there too; make text.
- **[D1] Catalog INSERT-stamp contract (write it verbatim in the build).** Migration `20260714120000`'s trigger stamps `specs_updated_at` on UPDATE only — **NOT on INSERT** (build-amendment A2). So every fork/insert path must set `specs_updated_at` **by hand**: typed specs → `now()`; price-only fork → **copy the source row's value** (never `now()` on inherited data). Also the **confirm-gate init rule:** initialize `specs_confirmed = false` only when the source row has ≥1 non-empty spec; blank-spec rows stay absent (no forced confirm ritual — Phase-0 §2).
- **[D2] Fork-on-write + row-count error land in BOTH catalog editors (duplicated code).** `WTCCalculator.jsx:459-471` AND `Settings.jsx:257-275`. Either extract a shared `saveCatalogRow(...)` (preferred) or build both as separate line items. Each: fork NULL-tenant default → tenant row on spec/price edit (Phase-0 §4.1 [C1], `lower()` predicate per amendment A1); surface "0 rows updated" as an error (fixes today's silent RLS no-op).
- **Amber "confirm specs" chip + Send gate** (tri-state per Phase-0 §2: confirmed / unconfirmed / absent-grandfathered). Send blocks on unconfirmed specs. `[AUDIT-SENSITIVE — angle-3 legacy edges]`
- **Scope Notes** — new per-day textarea in the `SowTab` day card (jsonb-additive, no migration).
- **task_ref (D5)** — per-material TASK N picker on the day-material entry → stored on the material, rendered as a chip. jsonb-additive. `[AUDIT-SENSITIVE — angle-3 restructure check]`
- **[E1] Revision badge — read from `job_wtcs`, NOT a `proposals` column.** `sow_revision_count` lives on `job_wtcs` (Phase-1 trigger), and there can be multiple WTCs per job. Extend ProposalDetail's load with a **`job_wtcs` join by `call_log_id` + a `MAX(sow_revision_count)` aggregate**; show "SOW updated in Schedule — this version is historical" when the max `> 0` (Phase-0 §4.3). (The pre-audit draft wrongly treated it as a proposals column.)

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

## §4 Phase 4 — Output — `sch-command`

**[Revision pass 1, round-1 audit] Scope-cut ratified by Chris 2026-07-28:** §4A (crew ticket) ships
THIS loop — it prints what's on the SOW, no NEED math, buildable today. **§4B (shop-manager shortage
view) is DEFERRED to its own loop** — the shortage math is not buildable from existing schema (no
per-material area/length basis column, no batch-multiplier column → breaks §6 no-migration), the
coverage parser is unspecified and there's already a table doing half the job (`job_material_lines`,
migration `20260708120200`, carries `qty_ordered` + `coverage_status` OK/VERIFY/SHORT). See §5.

### 4A — Crew ticket (print) `[ships this loop]`
- **Material Order Summary (page 1, crew):** per-material totals rolled up across all days → plain checklist. **Folds parked BF-12 `rollupSowMaterials()`** (branch `feat/mtrl-sow-rollup` — fold, then delete the branch).
- **Per-day cards** matching the reference: day label, subline, Work to Complete (tasks+%), Scope Notes callout, Materials Needed table (specs as **text**, D3), TASK N chips (D5).
- **Print/sign frame:** logo, JOB/CUSTOMER/PREPARED BY header, LEAD/SALES signatures, `N DAYS SCHEDULED · GENERATED <date>` footer.
- **Print gate:** enforce `specs_confirmed` before allowing print (Phase-0 §2 — no stale/unconfirmed specs go to the crew).

### 4B — Shop-manager shortage view (screen, pre-job) `[DEFERRED — blocked, own loop]`

**BLOCKED pending Q2/Q3/Q4/Q5/Q8 + the `job_material_lines` reuse decision.** Not built this loop.
Preserved here as the seed for its own loop:
- **NEED** = job total sqft (or LF) ÷ coverage_rate × batch multiplier, rounded up. Graceful fallback: range → "verify on site"; text-sourced rate → asterisk; no rate → "Not applicable" (uncounted).
- **STATUS** = NEED vs ON ORDER → OK (+buffer) / Short N units / Verify / N/A. Three count buckets on top.
- Inputs it needs that **don't exist as clean data yet**: per-material **basis** (area vs length — no column, Q4), **batch multiplier** (no column, Q5), a **coverage-rate parser** (Q3), a **coverage-unit → kit_size bridge** (Q8 — "45 sqft per kit" vs ordering kits; the reference conflates lbs vs kits, e.g. Sand "short 1,446" is really ~14 kits).
- **Reconcile, don't reinvent (Q2):** `job_material_lines` (migration `20260708120200`) already has `qty_ordered` + `coverage_status` (OK/VERIFY/SHORT). The shortage loop decides how to reuse it before adding anything.

---

## §5 Open questions

**Q1–Q5 + Q8 belong to the DEFERRED §4B shortage-view loop, not this one.** Listed here so that loop starts with them.

1. **[DEFERRED-LOOP] Where the shop-manager shortage view lives** — Schedule (warehouse/office side) route? A tab on the job? New screen? Not yet decided (Phase-0 §6 flagged it too).
2. **[DEFERRED-LOOP] Reconcile against `job_material_lines`, don't reinvent** — migration `20260708120200` already carries `qty_ordered` + `coverage_status` (OK/VERIFY/SHORT). The shortage loop's FIRST decision: reuse that table's ordered-qty + status, or add alongside. "ON ORDER" resolves from here, not a new field. Ties to Phase-5 `materials`-table retirement.
3. **[DEFERRED-LOOP] Coverage-rate parsing** — extracting a number from free text ("125 Sqft per gallon", "50LF per gallon mixed", ".75 lbs per foot", "Varies"). Note the round-1 audit: the reference version gets ".75 lbs per foot" backwards. Define parse rules + range/asterisk/N-A fallbacks concretely, with test cases.
4. **[DEFERRED-LOOP] Per-material basis (area vs length)** — the NEED formula divides by sqft *or* LF per material; **no column exists** for this. Needs a `materials_catalog` field (migration). This alone makes §4B un-buildable this loop.
5. **[DEFERRED-LOOP] Batch multiplier** ("bags per mix") — **no column exists**; needs a field. Source + entry point undecided.
8. **[DEFERRED-LOOP] Coverage-unit → kit_size bridge** — coverage "45 sqft per kit" vs ordering in kits (a kit = N gallons/lbs). The reference conflates lbs vs kits (Sand "short 1,446" is really ~14 kits). The shortage math must map the coverage unit to the purchased unit.
6. **[DERIVED] Confirm the D1 graft-not-restructure call** against the actual `SowTab` render — auditor should verify no restructure is forced by scope_notes + task_ref. (Angle-3, this loop.)
7. **[OPEN] Phase 5 (retire `materials` table + `jobs.field_sow` mirror)** — deferred, subject to Phase-0 §1 retirement preconditions. Ties to Q2.

---

## §5·A Adjacent findings — file as backlog (round-1 audit, not this loop's build)

- **Legacy rollup "verify on site" must not be silently uncounted** — a material whose coverage is unparseable should surface as VERIFY, not vanish from the count (ties to the deferred §4B loop; note now so the §4A rollup labels honestly).
- **Print gate reuses the tri-state, not truthiness** — §4A's `specs_confirmed` print gate must read the tri-state (confirmed/unconfirmed/absent), not a JS-truthy check that would treat "absent-grandfathered" as unconfirmed and false-block printing.
- **Catch unique-violation with a friendly message** — the catalog fork can hit the `(tenant, lower(name), lower(kit_size))` unique index; catch `23505` and show "material already in your catalog," not a raw error.
- **Amber uses a design token** — the confirm chip's amber should be a named token, not a hardcoded hex, per the design-system rules.

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
Round 2 — a light verification pass. The hard call (defer the shop-manager shortage math to its own loop) is made; the plan is now just the crew ticket + the authoring pipeline. Two reviewers double-check that round-1's fixes fully landed (they were "fix it in one place but not all the places" issues) and that cutting the shortage math didn't leave a loose wire. Should come back small.

### Round
- Plan type: feature
- Current round: 2 (verification pass)
- Plan revision under audit: 834892b (revision pass 1)
- Findings trend: round 1 (8 top-N: 2H/6M) → round 2 (?) — expect a drop; round 1 CUT a whole mechanism (§4B) rather than adding, so no scope-creep plateau risk.

### Prior rounds
- Round 1: 0e6137f · 2H/6M top-N (+4L adjacent) · pattern: `scope-cut-shortage-math + partial-fix-propagation`

**Briefing for agents**: round-1 findings are recorded in the `Plan revision pass 1` commit (834892b) — A1/A2 (seed keys at every constructor), C1 (stamp all spec fields), C2/C3 (number→text both editors + keystroke coercers), D1 (INSERT-stamp contract + confirm-gate init), D2 (both catalog editors), E1 (badge from job_wtcs MAX join), plus the §4B scope-cut. Do NOT re-find these. Verify each fix actually took in the revision text, then attack ONLY material new to 834892b. This is a light verification pass — no new mechanism was added.

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

### Suggested attack angles (2 total — verification pass)
1. **Spine-fix propagation verification (regression-style).** The round-1 pattern was *partial-fix-propagation* — a fix named at one call-site but not all. Verify each round-1 fix names EVERY site: [A2] all four constructors (sch `addMaterialToDay`/`addCatalogMaterialToDay`/`addCustomMaterialToDay` + sales `addMaterial`) seed `task_ref`/`catalog_id`/`specs_stamped_at`; [C2/C3] number→text in BOTH editors AND the keystroke coercers (`updateItem` isText, `FieldSowMaterialPicker.specInput`, sch `updateMaterialField` numericKeys, sch save); [C1] all spec fields stamped, not just coverage; [D2] both catalog editors; [E1] badge reads `job_wtcs` not `proposals`. Required reading: revised §2A/§2B + the cited files. Pressure: find the ONE site the revision still missed.
2. **Scope-cut cleanliness + no-new-mechanism.** Verify the §4B cut is clean: nothing in §2/§3/§4A still depends on the deferred shortage math; §4A (crew ticket) is buildable with no NEED math; the §5 deferred-loop questions (Q2 `job_material_lines` reuse, Q4 basis, Q5 batch, Q8 kit bridge) are captured, not lost. Confirm revision pass 1 added NO new mechanism (it should only cut + tighten text). Required reading: revised §4/§5/§5·A. Pressure: any hidden coupling to §4B, or any new mechanism smuggled in under "tightening."

### Suggested agent count: 2

Rationale: round 1 cut a whole mechanism (§4B) instead of adding, so the surface SHRANK — the shortage-math angle is gone entirely. What remains is verifying the partial-fix-propagation fixes fully propagated (angle 1) and the cut is clean with no new mechanism (angle 2). Two agents; a third would be padding. If angle 1 finds another missed call-site, that's a round-3 tighten, not an escalation.
