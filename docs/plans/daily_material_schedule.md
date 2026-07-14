# Daily Material Schedule (DMS-1) — Phase-0 Plan + Ownership Matrix

**Status:** Phase-0 plan — decisions ratified, migrations NOT yet authored, no code ships from this doc. **Revision pass 1 applied 2026-07-14** (round-1 audit: 4H/2M, `wrong-premise-baseline` — reader/writer map corrected against source; C1 grandfather ratified). **Revision pass 2 applied 2026-07-14** (round-2 audit: 1H/5M+2 regressions, `shipped-surface-coverage` — shipped Schedule save/Field render surfaces scoped into phases; A1 fold-into-Phase-2 + E1 keep-for-class ratified; pass 2 also found the §0.2b live mob-stripping bug, urgency capped by no-office-users context).
**Loop:** ERD #42 (`mf-phase-d-phase0`) · locked 2026-07-14 11:28 · Fable terminal (T1 plan)
**Branch:** `sch-command feat/dms1-phase0-plan`
**Parents:** `command-suite-db/docs/MASTER_SCHEDULE.md` §4B step 2 · `sch-command/docs/BACKLOG.md` DMS-1 · `docs/plans/command_suite_shared_data_contract.md`
**Target:** the crew/warehouse "DAILY MATERIAL SCHEDULE" job ticket (built in Claude Web; crew loves it), reached by fixing the data spine first.

Everything below Tier 0 in the wall chart (`command-suite-db/docs/assets/wall_chart.html`) inherits this document.

---

## §0 Baseline — observed current state (verified 2026-07-14)

All **read-verified** (code/schema read on freshly-pulled main across 4 repos) except where marked. No run-verification was needed — this plan changes decisions and schema, not behavior; nothing below is assumed.

1. **`field_sow` exists in three places, and the flat copy has REAL readers + a live writer** (corrected in revision pass 1 — the draft claimed "no readers found"; that was a shallow grep, falsified by audit round 1):
   - `proposal_wtc.field_sow` — authored in `sales-command/src/pages/WTCCalculator.jsx:876` (day shape: `{id, day_label, date, mobilization_id, sq_ft, linear_ft, tasks[], crew_count, hours_planned, materials[]}`). Read by Sales AND by Field `ReportTab.js:39-40` as fallback.
   - `job_wtcs[].field_sow` — per-WTC stamp at Send, `sales-command/src/components/ProposalDetail.jsx:720-724`
   - `jobs.field_sow` — flat merged mirror at Send (`ProposalDetail.jsx:649-678`). **Readers:** Field `ReportTab.js:36-45` (**PRIMARY** SOW source — reads `jobs.field_sow` first, `proposal_wtc` fallback; smoke #10159 covered TasksTab only); Field `TasksTab.js:94-116` (legacy fallback for zero-WTC jobs — revision pass 2, R1); sch-command fallbacks for zero-WTC jobs at `FieldSowModal.jsx:160`, `StageJobCard.jsx:71`, `queries.js:69` (`hasFieldSow`). **Writer:** sch-command `CardSowModal.jsx` `saveLegacy` — allowlisted legacy writer for zero-WTC jobs (which exist: archive imports create no proposal/WTCs).
2. **Field Command syncs BOTH `job_wtcs` and `jobs.field_sow`:** PowerSync client schema (`field-command/src/lib/schema.js:156,174-185`) is an explicit column list carrying `jobs.field_sow` AND `job_wtcs.field_sow`; TasksTab reads `job_wtcs` primary **with a `jobs.field_sow` fallback for zero-WTC jobs (`TasksTab.js:94-116` — revision pass 2)**, ReportTab still reads the flat copy first.
2b. **LIVE BUG found in revision pass 2 (worse than the round-2 audit reported): Schedule's shipped save path strips ALREADY-LIVE fields.** `FieldSowBuilder.jsx:158-182` `handleSave` rebuilds each day/material from a key whitelist. The day whitelist = `{id, day_label, date, crew_count, hours_planned, tasks, materials}` — it **omits `mobilization_seq`, `sq_ft`, `linear_ft`**, all live in prod since Screen-1·A shipped 2026-07-12. Any SOW edit in Schedule today silently erases the mobilization tag + measurements from every day it saves — destroying shipped Phase-A data and breaking the step-6 mob-display floater's input. **Deployment context caps the urgency: Schedule Command has no office users yet (Chris-only, testing) — so no emergency hotfix; the fix ships with Phase 2 as ratified (A1 fold).** Interim guard: don't edit mob-carrying SOWs in Schedule until Phase 2 lands. The step-6 floater build must land AFTER (or with) this fix or its input data can be silently erased.
3. **The SOW material entry already carries spec fields, but the auto-fill is BROKEN TODAY** (corrected in revision pass 1): `WTCCalculator.jsx:735-739` stamps `{wtc_material_id, name, kit_size, qty_planned, mils, coverage_rate, mix_time, mix_speed, cure_time}` at pick time — but it picks from the WTC **Tab-3 cost lines**, not the catalog (a two-hop copy: catalog → `addFromDB` Tab-3 line `:483` → SOW entry). The Tab-3 line keeps **no catalog id** (`id: Date.now()`), and the stamp reads `m.coverage` while Tab-3 lines carry `coverage_rate` → **stamps `""` every time**. `mils`/`mix_time` default numeric `0`; Tab-3's `updateItem` coercion list (`:477-480`) parseFloats non-text keys, so a text spec like "20-25 mils" would corrupt to `20` on next edit.
4. **`materials_catalog` has NO spec columns beyond `coverage`:** live schema = `id, tenant_id, name, kit_size, price, coverage, supplier, active, created_at, updated_at` (`command-suite-db/supabase/migrations/20260416200000_materials_catalog.sql:7-19`). Absence of `mils`/`mix_time`/`mix_speed`/`cure_time`/`unit` verified by reading the full migration — no later ALTER exists (grepped `command-suite-db/supabase/migrations/` for `materials_catalog`; single hit).
5. **No revision stamp exists on `job_wtcs`** (no `sow_revised_*` anywhere; `job_wtcs` has only `created_at` — **no send timestamp either**, and `proposals.sent_at` means customer-email send and is nulled on pull-back, so it cannot anchor a badge). **A Schedule write path to `field_sow` ALREADY EXISTS** (corrected in revision pass 1 — the draft claimed it didn't): `sch-command/src/lib/queries.js:587-628` `updateJobWtcFieldSow()` writes canonical `job_wtcs[].field_sow` + derived date span with `job_changes` audit rows, driven by `CardSowModal` + `FieldSowBuilder` (which already adds materials from the catalog, BF-11). What was blocked on decision #1 is the full SOW-builder *port*, not the write path.
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
| `proposal_wtc.field_sow` | Sales authoring (`WTCCalculator.jsx`) | Sales; Field `ReportTab.js:39-40` (fallback — migrates with ReportTab, below) | **Keep — the authoring desk** |
| `job_wtcs[].field_sow` | Send-to-Schedule per-WTC stamp (`ProposalDetail.jsx:720-724`); Schedule post-Send via `updateJobWtcFieldSow` (`queries.js:587-628`) | Schedule cards + Field TasksTab primary (PowerSync `job_wtcs`, `schema.js:174-185`) | **CANONICAL** |
| `jobs.field_sow` | Send-to-Schedule flat merged mirror (`ProposalDetail.jsx:649-678`); sch-command `CardSowModal.saveLegacy` (zero-WTC jobs) | Field `ReportTab.js:36-45` (**primary**) + `TasksTab.js:94-116` (zero-WTC fallback); sch-command zero-WTC fallbacks (`FieldSowModal.jsx:160`, `StageJobCard.jsx:71`, `queries.js:69`) | **Retire for WTC-backed jobs only (Tier 4) — stays the zero-WTC (archive) carrier; see preconditions below (E1 keep-for-class, ratified pass 2)** |

### The ratified rule

> **Author in the proposal. Send snapshots it. After Send, `job_wtcs[].field_sow` is the one living truth: Schedule edits it, Field reads it, the proposal is frozen forever.**

- **Sales authors** `proposal_wtc.field_sow` inside the WTC. It is a draft until Send.
- **Send** copies it per-WTC onto `job_wtcs[].field_sow` (copy-at-Send — same contract shape as mobilizations, registered 2026-07-13). Per Plan 0 [G2]: the job copy is a **mirror the send flow writes, then Schedule owns and mutates** — it is not an immutable snapshot. **Named invariant (revision pass 1): Send is once-only per job today** (re-send is blocked once a job exists — verified round 1); MF4, if ever built, **must preserve or explicitly renegotiate this invariant**, because re-send overwriting Schedule's post-Send edits is the failure mode.
- **Schedule owns post-Send edits.** Real-world adjustments that don't justify a new proposal (room sequence, equipment/power/truck changes) are edited **in Schedule only**, through the existing audit-logged choke point `updateJobWtcFieldSow()` — never raw `job_wtcs` updates (its own doc-comment already enforces this).
- **Field is read-only. Always.** No SOW write path from field-command, ever.
- **The proposal is frozen at Send** and never back-filled. Honesty is handled by a **derived badge**, not data backflow: substantive Schedule edits bump `sow_revision_count` on the `job_wtcs` row (stamped `sow_revised_at/by` — §4.3); the Sales proposal screen shows **"SOW updated in Schedule — this version is historical"** when **`sow_revision_count > 0`**. (Revision pass 1: the draft's `sow_revised_at > sent_at` comparison was unbuildable — no send timestamp exists on `job_wtcs`, and `proposals.sent_at` means customer-email send and is nulled on pull-back. Count `> 0` needs no timestamp, no join: `job_wtcs` rows exist only post-Send, so any revision = edited-after-Send.) **Calendar exception:** assigning per-day *dates* is normal Schedule workflow (`dates_tbd` jobs arrive undated) and must NOT trip the badge — the stamp compares date-normalized `field_sow` (§4.3).
- **Record-keeping (right-sized at 1 tenant):** who + when + a revision counter on the job copy. No full field-level edit history now — but note `updateJobWtcFieldSow` already writes full before/after `job_changes` rows, so history exists in the audit log today.
- **`jobs.field_sow` (flat legacy mirror): retire (Tier 4, step 9 — plan-only there), gated on explicit preconditions:**
  1. Migrate Field `ReportTab.js:36-45` primary read to `job_wtcs` (and its `proposal_wtc` fallback) — **retiring before this breaks the crew report screen**;
  2. Zero-WTC-job carrier — **RESOLVED, keep-for-class (ratified revision pass 2, E1):** backfilling `job_wtcs` is ill-formed (`proposal_wtc_id` + `work_type_id` are NOT NULL FKs — `20260512120100:9-28` — and archive jobs have no `proposal_wtc` row). The flat column **retires for WTC-backed jobs only** and remains the carrier for zero-WTC (archive) jobs; `CardSowModal.saveLegacy` + the fallbacks stay for that class.
  3. Re-grep all 4 repos for readers/writers and record the zero-hit evidence (WTC-backed paths) in the Tier-4 plan.

### Multi-work-type jobs (the contract doc's test case)

Per-WTC canonical passes it by construction: each WTC carries its own `field_sow`, so a job with 3 work types has 3 independent SOWs — no flat-merge ambiguity. This is exactly what the flat `jobs.field_sow` mirror gets wrong.

---

## 2. Decision #2 — material specs: catalog master, stamped into the SOW `[LOCKED 2026-07-14]`

### The ratified rule

> **One SOW material format everywhere, self-contained, all the data. Specs are entered once on `materials_catalog` (Material Memory) and auto-STAMP (copy) into the SOW material entry at pick time. Stamped specs arrive UNCONFIRMED and must be human-confirmed before Send.**

Chris: *"Anywhere there's an SOW with material, there should only be one format, and it has all the data: coverage rate, kit sizes."*

- **Catalog = the master pad.** Specs (kit size, mils, coverage rate, mix time/speed, cure time, unit) live once per product on `materials_catalog`. Nobody re-types coverage rates job after job.
- **Stamp, not lookup — with a join key.** Picking a material copies its specs into the SOW entry right then, **along with `catalog_id` + `specs_stamped_at`** (revision pass 1 — without the id there is no linkage for auto-fill or staleness; today's two-hop copy drops it). The SOW document is self-contained forever — a printed ticket from March always matches what was sent in March. Catalog corrections apply to *future* SOWs only; existing SOWs keep what they were stamped with. (Lookup was considered and rejected: a catalog edit would silently rewrite historical SOWs.)
- **The stamp travels the existing two-hop path** (revision pass 1): hop 1 — `addFromDB` copies `catalog_id` + all spec columns onto the WTC Tab-3 cost line **and stamps `specs_stamped_at` right there** (revision pass 2, B1 — the stamp moment is when values leave the catalog; hop 2 copies the timestamp along with the values, never re-stamps `now()`, so a catalog correction between hops can't wear a fresh date on stale data); hop 2 — the SOW day-material picker stamps from the line (fixing today's broken `m.coverage` → `coverage_rate` read, §0.3). **Legacy Tab-3 lines (pre-feature, no `catalog_id`, no specs) day-picked after Phase 2 are grandfathered:** the SOW entry carries no `specs_confirmed` key (absent state, §2's ratified rule) — never initialized `false` on blank data, which would force the confirm-ritual §2 forbids. Field-mapping table in §4.2.
- **Per-job/day override is free:** editing the stamped copy on that day deviates without polluting the catalog default.
- **Stamped ≠ confirmed — the amber gate, tri-state (grandfather ratified 2026-07-14):**
  - `specs_confirmed` **absent** (any material stamped before this feature ships) → **exempt, passes the gate.** In-flight proposals keep sending; legacy hand-typed specs are today's accepted state. No confirm-ritual on blank data — that would train people to click through the gate.
  - `specs_confirmed: false` (every NEW stamp initializes to this) → amber chip, **blocks Send**: *"Specs pulled from Material Memory — confirm for this job's conditions."*
  - `specs_confirmed: true` → passes. **Editing any spec field on a confirmed entry resets it to `false`** — a changed spec is an unconfirmed spec.
  - **Custom (non-catalog) materials get the same gate**, different chip text: *"Custom material — confirm specs for this job."*
- **Enforcement points, named:** (1) Sales pre-Send validation (joins the existing mobilization gate); (2) post-Send there is no second Send, so Schedule-added materials are gated at the **Phase-4 ticket/MTRL print** — an unconfirmed spec can ride the SOW, but it cannot print onto the crew's material schedule.
- **Staleness visible:** each spec shows "last updated <date>" resolved via the stamped `catalog_id` → `specs_updated_at`; `NULL` (spec never entered) displays "no spec date"; a forked/superseded catalog row displays "catalog row superseded" rather than a false date.

**Failure mode this kills:** manufacturer updates a product, old coverage rate carries silently into an SOW, nobody re-checks, material doesn't go down at the proper rate, job is damaged.

### Why this is completing an existing pattern, not inventing one (verified in code; corrected in revision pass 1)

The SOW day-material entry **already** carries the spec fields — `WTCCalculator.jsx:735-739`:

```js
{ wtc_material_id, name, kit_size, qty_planned,
  mils: 0, coverage_rate: m.coverage || "", mix_time: 0, mix_speed: "", cure_time: "" }
```

The intent (stamp at pick) is shipped; the plumbing is broken in three ways (§0.3): the source is the WTC Tab-3 line, not the catalog; no catalog id survives the hop; and the `m.coverage` read misses Tab-3's `coverage_rate`, so even the one wired spec stamps `""`. The catalog has no columns for the rest (`materials_catalog` = name, kit_size, price, coverage, supplier only) — users hand-type mils/mix/cure per job today. Decision #2 = give the catalog the missing columns, carry `catalog_id` + specs across both hops, fix the broken read, then add the confirm gate.

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
| **SOW revision stamp** (`sow_revised_at/by/count` — NEW) | DB trigger on `job_wtcs` UPDATE (date-normalized diff, §4.3) — no client writes it | `job_wtcs` row | n/a (derived badge in Sales: `count > 0`) | trigger only | Sales (badge), audit | n/a (web only, not in client schema) |
| **Task % progress** | Field crew (Phase E — future) | TBD in Phase E plan; likely PRT-adjacent, NOT a `field_sow` write | — | — | Schedule, Field | — (Field writes stay in Field-owned tables; SOW read-only rule holds) |

**Legacy, scheduled to die (Tier 4, step 9):**

| Legacy | Why | Retirement gate |
|---|---|---|
| `jobs.field_sow` (flat merged mirror) | Superseded by per-WTC canonical; breaks multi-WTC jobs | **Gated by the §1 retirement preconditions (ReportTab migration, keep-for-class zero-WTC carrier, zero-hit re-grep) — retires for WTC-backed jobs only.** (Revision pass 2, R2: this cell previously repeated the falsified "zero readers" claim.) |
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
- Spec fields stay **text** — they're human instructions for a printed ticket, matching existing `coverage`/`kit_size` (already text); only `qty_planned` does math today. **Consequence (revision pass 1): the SOW-entry shape and coercion lists must change to match** — `mils`/`mix_time` currently default numeric `0` and Tab-3's `updateItem` parseFloats them ("20-25 mils" → `20`). §4.2 declares them text end-to-end.
- `specs_updated_at` is separate from `updated_at` (which fires on price edits) — it drives the "spec last updated <date>" staleness display. Set via trigger using `IS DISTINCT FROM` over the **enumerated column list `{mils, mix_time, mix_speed, cure_time, unit, coverage, kit_size}`** — `coverage` and `kit_size` included (revision pass 1): a coverage-rate correction is §2's exact floor-failure scenario and must bump the date.
- **RLS — verified against the live migration chain** (revision pass 1, re-verified against source after the audit's E1 was itself half-wrong):
  1. **Role gating ALREADY EXISTS** — `role_aware_money_rls.sql:132-165` gates all `materials_catalog` INSERT/UPDATE/DELETE on `tenant_id = get_user_tenant_id() AND is_admin_or_manager()`; no later migration loosens it (the two 2026-07-08 migrations only reference the table). **No new gating migration needed.** New spec columns inherit the table policies automatically. Consequence: **spec entry is Admin/Manager work** — consistent with the bookkeeping model (office maintains Material Memory); keep, don't loosen.
  2. **System-default rows (`tenant_id NULL`, ~160 seed rows, `materials_catalog.sql:60-226`) are un-updatable by design** (role_aware comment: "system rows remain non-writable from the app") — so "enter specs once on the catalog" is unfulfillable for every default, and the existing edit UI **no-ops silently** for them (RLS filters to 0 rows, no error — `WTCCalculator.jsx:452-467` only catches errors). **Fork-on-spec-edit:** editing specs (or price) on a NULL-tenant default auto-copies the row to a tenant row, then edits the copy — the existing (name, kit_size) tenant-wins dedupe already makes the fork shadow the default in every picker. Stamped `catalog_id`s pointing at the old default remain valid (stamps are self-contained; staleness display shows "catalog row superseded", §2). Fix the silent no-op while in there: surface "0 rows updated" as an error. **Fork hardening (revision pass 2, C1):**
     - Phase 1 adds a **partial unique index `(tenant_id, name, kit_size) WHERE tenant_id IS NOT NULL`** — today nothing stops a double-click making duplicate forks with an arbitrary dedupe winner.
     - **Superseded-detection rule, written:** a NULL-tenant row is "superseded" iff a same-tenant row with matching `(name, kit_size)` exists — the same predicate the picker dedupe already uses; the staleness display and Settings list both apply it.
     - **`Settings.jsx:240-265` is a second catalog editor** (tenant rows only) the plan previously never named — Phase 2 scope: spec columns, fork-awareness, and the same 0-rows error surfacing.

### 4.2 `field_sow` day/material jsonb + Tab-3 line shape — additive, NO migration

Per suite convention (additive jsonb, Plan 0):

- Day gains: `scope_notes` (text).
- Material entry gains: `catalog_id` (uuid, the join key — revision pass 1), `specs_stamped_at`, `task_ref` (link material → its TASK N; blank allowed — UI decision (c), Option A), `unit`, `specs_confirmed` (tri-state per §2: absent = pre-feature exempt / false / true), `specs_confirmed_by`, `specs_confirmed_at`.
- **WTC Tab-3 cost line gains** (hop 1 of the stamp): `catalog_id`, `mils`, `mix_time`, `mix_speed`, `cure_time`, `unit` (it already carries `kit_size`, `coverage_rate`, `supplier`, `from_catalog`).
- **Type change:** `mils`, `mix_time` become **text** end-to-end (were numeric-0 defaults). Every write AND render site (corrected + extended revision pass 2):
  - Sales Tab-3 `updateItem` isText list (`WTCCalculator.jsx:477`) adds `mils/mix_time/mix_speed/cure_time/unit`; the SOW day-material **spec inputs are `type="number"`** (`WTCCalculator.jsx:749-751, 787, 800` — corrected citation; round-1 text wrongly named `updateField`) → become text inputs.
  - **Schedule `FieldSowBuilder.jsx`**: `handleSave` whitelist (`:158-182`) gains **passthrough of unknown material/day keys** (the A1 fold — also fixes the §0.2b live bug); `numericKeys` list (`:124`) and the `parseFloat`s at `:175,177` drop `mils/mix_time`; number inputs at `:435,448` become text.
  - **Field `TasksTab.js:200-205`**: spec display gates on numeric truthiness (`mat.mils > 0 &&`, hardcoded `" min"` suffix) — text "20-25 mils" renders invisible. Becomes non-empty-string checks, no unit suffix assumptions. ReportTab + the Phase-4 MTRL/ticket renders get the same rule (A2).
  - Existing numeric values read fine as-is (additive, no backfill).
- Already present, no change: `sq_ft`, `linear_ft` (shipped Screen-1·A), `coverage_rate`, `mix_speed`, `cure_time`.

**Catalog → SOW field mapping (the stamp contract, both hops):**

| `materials_catalog` column | Tab-3 line field | SOW material entry field |
|---|---|---|
| `id` | `catalog_id` (NEW) | `catalog_id` (NEW) |
| `name` | `product` | `name` |
| `kit_size` | `kit_size` | `kit_size` |
| `coverage` | `coverage_rate` | `coverage_rate` ← **fixes the broken `m.coverage` read (§0.3)** |
| `mils` (NEW) | `mils` (NEW) | `mils` |
| `mix_time` (NEW) | `mix_time` (NEW) | `mix_time` |
| `mix_speed` (NEW) | `mix_speed` (NEW) | `mix_speed` |
| `cure_time` (NEW) | `cure_time` (NEW) | `cure_time` |
| `unit` (NEW) | `unit` (NEW) | `unit` (NEW) |
| — (stamp moment, hop 1) | `specs_stamped_at` (NEW — stamped when values leave the catalog) | `specs_stamped_at` (copied from the line, never re-stamped — B1) |

**Schedule's one-hop add** (`FieldSowBuilder.jsx:94-104` `addCatalogMaterialToDay` — picks straight from the catalog, no Tab-3 line): stamps `catalog_id` + specs + `specs_stamped_at = now()` directly, `specs_confirmed: false` (revision pass 2 — this path previously kept no catalog link by design; that design predates decision #2).

### 4.3 `job_wtcs` — revision stamp (SQL migration; respecced revision pass 1)

```
sow_revised_at     timestamptz
sow_revised_by     uuid REFERENCES auth.users(id)
sow_revision_count integer NOT NULL DEFAULT 0
```

- **Writer = a DB trigger, not app code** (precedent: `20260518185000_proposal_wtc_track_local_edits.sql`): BEFORE UPDATE ON `job_wtcs`, when **date-normalized** `field_sow` is distinct (strip each day's `date` key before comparing OLD/NEW — calendar-date assignment is normal `dates_tbd` workflow and must not trip the badge, §1), stamp `sow_revised_at = now()`, `sow_revised_by = auth.uid()`, `count + 1`. Trigger-side stamping also closes the integrity hole where any client (incl. Sales) could write the stamp columns directly. **Ordering note (revision pass 2):** until the Phase-2 `FieldSowBuilder` fix lands, its lossy save rewrites material values on ANY edit — so a date-only save WOULD false-fire the date-normalized diff. Accepted in the Phase-1→2 window (no office users); Phase 2 makes the save lossless and the exception real.
- **Send never writes `sow_revised_*`** — Send INSERTs `job_wtcs` rows (defaults apply); the trigger fires on UPDATE only. Named invariant: send is once-only per job today (§1); if MF4 ever re-sends via UPDATE, the trigger semantics must be revisited there.
- Sales badge = **`sow_revision_count > 0`** (derived; zero backflow; no timestamp comparison — see §1). **Read path (revision pass 2, over-cap):** the Sales proposal screen has no `job_wtcs` read today — Phase 2 adds a display-path select of `sow_revision_count` for sent proposals. **Known false-negative accepted:** jobs Schedule-edited before the Phase-1 trigger exists carry `count = 0` and never badge; at current usage (no office users yet) that set is test data only.
- App path unchanged: Schedule edits keep routing through `updateJobWtcFieldSow()` for `job_changes` audit rows; the trigger rides the same UPDATE.

### 4.4 PowerSync note (corrected revision pass 1)

The PowerSync **client schema is an explicit column list** (`field-command/src/lib/schema.js:174-185`) — new SQL columns do **NOT** ride along; they'd need a `schema.js` edit + app release. What does ride along invisibly: **jsonb additions inside `field_sow`** (synced as one text column) — which is everything Field actually needs (stamped specs, scope_notes, task_ref, confirm state). `sow_revised_*` is web-only (Sales badge) and deliberately NOT added to the client schema. Field does not read `materials_catalog` at all — specs reach the crew inside `field_sow`. Verify server-side sync-rule column selection during Phase 1 (dashboard-held, `SELECT * FROM job_wtcs` per code comment; confirm live).

---

## 5. Phase plan (mapped to wall chart §4B)

| DMS-1 phase | Wall-chart step | Repo | What |
|---|---|---|---|
| **0 — this doc** | 2 | sch-command (doc) + contract amendment | Ownership matrix + decisions #1/#2 ratified. **DONE when audited.** |
| **1 — migrations** | 3 | command-suite-db | §4.1 + §4.3 SQL + the C1 partial unique index, **with rollback pairs, via the repo's `npm run db:push` wrapper** + ledger-alignment checks per standing rules. Also fix the stale comment in `20260708120200_job_material_lines.sql:5-6,26` (`material_key` is the Tab-3 line id, not a catalog id — adjacent finding). |
| **2 — Sales SOW + Schedule save protection** | 4–5 (A2) | sales-command **+ sch-command (A1 fold, ratified pass 2)** | Sales: two-hop stamp with `catalog_id` + hop-1 `specs_stamped_at` (§4.2 mapping table) incl. the broken `m.coverage` fix; amber confirm chip + Send gate (tri-state, §2); scope_notes + task_ref entry; catalog spec-entry UI + fork-on-spec-edit + `Settings.jsx` second editor (§4.1); text-spec input/coercion changes (§4.2); badge read on the proposal screen (§4.3). Schedule (the fold): `FieldSowBuilder` passthrough-on-save (**also fixes the §0.2b live mob-stripping bug**), text coercion, one-hop catalog stamp (§4.2). **GATE at step 4: decision #3 reskin scope (a)/(b) — design session first, not build-first (ERD #41 lesson)** |
| **3 — Schedule SOW builder** | 7 | sch-command | **RETROFIT, not greenfield** (revision pass 1): extend the existing audit-logged `updateJobWtcFieldSow()` + `CardSowModal`/`FieldSowBuilder` — the write path and catalog picker already exist (BF-11). Adds: scope_notes + specs display, confirm gate on post-Send material adds, sqft/lf edit. Revision stamping arrives free via the §4.3 trigger. |
| **4 — output** | 7 | sch-command | MTRL = Material Order Summary (page 1, per-material totals across days) + per-day ticket cards + print/sign frame; folds parked BF-12 `rollupSowMaterials()` (branch `feat/mtrl-sow-rollup` — fold, then delete). Specs render as **text** (A2 rule); the print gate enforces `specs_confirmed` (§2). |
| **5 — backfill + retire** | 9 | command-suite-db | Retire `materials` table + `jobs.field_sow` mirror **subject to the §1 retirement preconditions (ReportTab migration, zero-WTC carrier, zero-hit re-grep)**; verify vs job 6618. **Amend `MASTER_SCHEDULE.md` §4B step 9 wording to include the `jobs.field_sow` mirror when this plan merges** — the spine doc currently names only the `materials` table (revision pass 1). |

**Downstream carry (Phase E / wall-chart step 8, field-command):** the crew day-view build inherits the A2 render rule — `TasksTab.js:200-205` numeric-truthiness spec display → non-empty text checks (no hardcoded `" min"` suffix), same for ReportTab — or text specs are invisible in the crew's primary view. Specced in §4.2; named here so Phase E's plan doesn't miss it.

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

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-07-14 (round 3). Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
Verification round. Two audit rounds are folded in and the trend is converging (severity 4H → 1H → expected 0); one reviewer walks the round-2 fixes against the source files and checks the two things pass 2 added on its own initiative (the live mob-stripping bug write-up and the trigger ordering note). If nothing new surfaces, this plan is done and the loop closes.

### Round
- Plan type: feature
- Current round: 3
- Plan revision under audit: bea54e4
- Findings trend: round 1 (9 caused-by, 4H) → round 2 (9 caused-by incl. 2 regressions, 1H) → 3 (?) — severity falling, count flat; round-2 scope-cut evaluation ran and found coverage gaps, not bloat

### Prior rounds
- Round 1: 5877539 · 4H/2M top-6 + 3 over-cap + 3 adjacent · pattern: wrong-premise-baseline · response 8864e98 (E1 RLS-half refuted on re-verify)
- Round 2: 8864e98 · 1H/5M/1L (incl. 2 regressions) + 2 over-cap + 1 adjacent · pattern: shipped-surface-coverage · response bea54e4 (A1 fold-into-Phase-2 + E1 keep-for-class ratified; pass 2 escalated A1 to the §0.2b live bug — handleSave also strips live mobilization_seq/sq_ft/linear_ft)

**Briefing for agents**: do NOT re-find round-1/2 issues; the two revision-pass commits are the canonical record. This is a VERIFICATION round: confirm the pass-2 fixes are faithful to the cited sources and attack only pass-2's own additions. Cite the file:line you read this round for any code/policy assertion.

**Plateau signal**: if round-3 surfaces new CAUSED-BY findings at flat-or-higher count, `/runaudit` MUST present scope-cut as the only build-prompt option.

### Deployment context
- **Live tenants**: 1 — HDSP only; multi-tenant onboarding blocked
- **Prod / staging / dev**: shipped SOW/mob pipeline live in prod; **Schedule Command currently has NO office users (Chris-only, testing)** — this capped the §0.2b live-bug urgency; everything this plan specs is unbuilt (paper only this loop)
- **Blocking feature flags**: none
- **Concurrency profile**: solo (Schedule), ≤5 elsewhere

### Time budget + finding cap
- **Time budget**: 30 min (verification round)
- **Finding cap**: 3 findings

### Surface
- Total lines: 317
- Sections: 8 (§0 Baseline incl. 0.2b, §0 why, §1–§6)
- [LOCKED] decisions: 2 (+3 UI carried) + 3 ratified calls (C1 grandfather, A1 fold, E1 keep-for-class)
- [DESIGN-OPEN] items: 0
- [OPEN] items: 4 (§6)
- Plan-to-code ratio: n/a this loop (paper only)

### Layers touched
(unchanged; round 3 attacks only pass-2 deltas)

### New material introduced IN PASS 2 (the round-3 attack surface)
- §0.2b live-bug write-up (handleSave strips live mobilization_seq/sq_ft/linear_ft; urgency-capped; step-6 floater ordering constraint)
- Hop-1 `specs_stamped_at` + copied-not-restamped rule; legacy-line grandfather at hop 2 (§2/§4.2)
- One-hop `addCatalogMaterialToDay` stamp spec (§4.2)
- Text-spec end-to-end site list (§4.2 — Sales inputs, FieldSowBuilder, TasksTab/ReportTab/MTRL renders)
- C1 fork hardening: partial unique index, superseded predicate, Settings.jsx scoping (§4.1)
- E1 keep-for-class rewording (§1 precondition 2, §3 cell)
- Badge read-path + accepted false-negative; trigger ordering note (§4.3)
- Phase 2 respecced as two-repo (§5)

### Cross-system reach / Irreversibility
- unchanged from round 2

### Known weak points (round 3)
- **§0.2b is pass-2's own finding — no adversarial eyes have checked it** (does the whitelist really strip mob fields? does CardSowModal's save path pass through handleSave for WTC-backed jobs? is the step-6 ordering constraint stated correctly?)
- **Phase 2 is now the heaviest phase** (two repos, ~10 distinct work items) — verify the §5 cell is buildable as one phase or should name an internal order
- **Grandfather-at-hop-2 vs one-hop `specs_confirmed: false`** — legacy Tab-3 lines get absent-state, but Schedule's one-hop add initializes `false` on possibly-blank catalog specs (defaults have no specs until entered) — is that the §2 click-through ritual again? (blank catalog specs stamped false → user confirms blank data)

### Open questions
- Count: 4 (§6, unchanged)

### Suggested attack angles (1 total)
1. **Verify pass 2 + attack its additions** — walk `git diff 8864e98..bea54e4` against the cited sources (`FieldSowBuilder.jsx:94-104,124,158-182,435,448`, `TasksTab.js:94-116,200-205`, `Settings.jsx:240-265`, `20260512120100:9-28`); pressure the three weak points above, esp. §0.2b's unaudited claims and the one-hop blank-specs-confirm question.

### Suggested agent count: 1

Rationale: verification round over two converged passes; the only unaudited material is pass-2's additions — one agent, finding cap 3.
