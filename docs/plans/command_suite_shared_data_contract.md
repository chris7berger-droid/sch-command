# Command Suite — Shared-Data Contract  [DESIGN-SEED · DESIGN-OPEN]

**Status:** Design-open. This captures the question, the evidence, and the decision dimensions — **no answers**. For a dedicated design session, not a build.

**Origin:** Spun out of the staged-ready-cards build smoke test, 2026-05-28 (sch-command, `feat/staged-ready-cards`). That build worked on its own surface, but smoke testing kept surfacing cross-app data questions that no document answers. They're not separate bugs — they're symptoms of an unwritten shared-data contract.

**Home note:** Lives in sch-command for now because that's where the evidence originated. May belong in a canonical cross-suite location later (cf. the cross-repo precedent `~/sales-command/docs/plans/o7_migration_coordination.md`).

---

## Framing — ONE app, four drivers (Chris, 2026-05-28)

The suite began as **4 separately-sellable apps** sharing a DB. ~3/4 through the
build, Chris concluded that model can't deliver the experience he wants, and the
product is now **one app with four drivers** (Sales / Schedule / Field / AR as
modes of one product), not four independent products.

This **reframes — and mostly shrinks — the question below.** Most cross-app pain
is an artifact of the 4-sellable-apps model and should be *designed out*, not
contracted around:
- Ownership "treaty" → one product owns its data; pick the canonical table.
- Cross-domain links/auth (e.g. SOW port) → shared modules within one product.
- Copy-vs-reference snapshots → live references; no drift inside one app.

**The one boundary that stays real:** Field Command's offline-first mobile
runtime (PowerSync local SQLite). Crews need offline, so a phone will always
differ from the web. The "contract" therefore narrows to a single **web ↔
offline-mobile sync surface**, not a 4-way treaty.

Caveat: the running system is still 4 repos + 4 deploys. Becoming *physically*
one app (monorepo, merged web deploys) is its own strategic migration. This
doc's job is to set the design premise, not to pre-decide that migration.

## The core question (re-read under the one-app framing)

The 4 Command Suite apps — **Sales, Schedule, Field, AR** — run on **one shared Supabase DB** (`pbgvgjjuhnpsumnowuym`):

1. **Where do the 4 commands connect** — which entities cross app boundaries?
2. **What needs to be shared** — the actual shared-data set, no more, no less.
3. **How should the source of that sharing be shaped** — canonical storage, ownership, direction, mechanism.

## The two dimensions that make "shaped" concrete

Every shared entity must answer these, or it drifts:

- **Source of truth** — which app *writes* it (ideally exactly one); which apps *read* it, and read-only vs read-write.
- **Copy vs reference + sync pipe** — is the data a snapshot copied at a handoff (drifts after) or a live reference? And which mechanism carries it: **PostgREST** (Sales/Schedule/AR web) vs **PowerSync local SQLite** (Field Command)? They read differently, so "shaped" must name the pipe.

---

## Evidence — what the smoke test found

Each row is a place where ownership / canonical location is ambiguous *today*:

| Data | Direction | Current reality (the ambiguity) |
|---|---|---|
| **SOW (`field_sow`)** | Sales → Sch → Field | No single home. Card reads `job_wtcs[].field_sow` (per-WTC, preferred); Field Command reads `jobs.field_sow` (single); Sales authors `proposal_wtc.field_sow`. Three locations. Multi-work-type jobs are where it breaks. |
| **PRT + Daily Logs** | Field → Sch | ✅ Coherent. Field writes `daily_production_reports` + `daily_log_entries`; Sch reads. The one direction that *is* contracted. |
| **Notes (`jobs.notes`)** | Sch → Field (view-only) | Not wired. Field Command's "notes" are its own report notes; it doesn't read `jobs.notes`. |
| **PROP (`jobs.amount`)** | Sales → Sch | Card reads `jobs.amount`; where Sales sets it (send-to-schedule? copy?) unconfirmed. |
| **BILLED** | Sales → Sch | Card computes from `billing_log` (a Schedule table); no Sales write to it found; invoices live in `invoices`/`invoice_lines`. Three candidate owners. |
| **Attachments** | Sch ↔ Field (view-only) | Not built (§7 deferred). Needs canonical store + cross-app read + PowerSync rules. |

## Contracted entities — resolved, registered here

Unlike the design-open rows above, these have a settled four-dimension answer because the mechanism already shipped. They are the contract, not the question.

**Mobilizations (`mobilization_seq`)** — registered 2026-07-13 (Master Schedule Phase B).

| Dimension | Answer |
|---|---|
| **Direction** | Sales → Sch → Field |
| **Source of truth (writer)** | Sales — authored in `proposals.mobilizations`; stamped as `mobilization_seq` on each `field_sow` day at Send-to-Schedule; seeds `job_mobilizations` |
| **Canonical location** | `mobilization_seq` on `job_wtcs.field_sow` days (the carrier) + `job_mobilizations` seed table |
| **Readers** | Schedule groups by seq (job card / pull tickets); Field reads seq for the day banner — both read-only |
| **Copy vs reference** | **Snapshot at Send** (copy) — matches the send-to-schedule handoff; re-send / backfill stays open (decision #6) |
| **Sync pipe** | PostgREST (Sales / Sch web) · PowerSync (Field) |
| **Status** | ✅ CONTRACTED — writer shipped Master Schedule Phase A, 2026-07-12 |

(The other already-coherent direction, **PRT + Daily Logs**, is contracted in the Evidence table above.)

**SOW (`field_sow`)** — registered 2026-07-14 (DMS-1 Phase 0, ERD loop #42). Resolves open decision #1 below. Full rationale + ownership matrix: `docs/plans/daily_material_schedule.md`.

| Dimension | Answer |
|---|---|
| **Direction** | Sales → Sch → Field |
| **Source of truth (writer)** | Sales authors `proposal_wtc.field_sow` (draft until Send); **after Send, Schedule is the sole editor** of the canonical copy. Field never writes, ever. |
| **Canonical location** | `job_wtcs[].field_sow` (per-WTC — multi-work-type jobs carry one SOW per WTC by construction). Proposal copy is frozen at Send. `jobs.field_sow` flat mirror: **retires for WTC-backed jobs only (Tier 4, gated on the ReportTab migration + zero-hit re-grep); it REMAINS the permanent carrier for zero-WTC (archive) jobs** — backfilling `job_wtcs` is ill-formed for them (NOT NULL FKs to `proposal_wtc`/`work_type`). Keep-for-class ratified 2026-07-14, `daily_material_schedule.md` §1 (rounds 1–2 audits). |
| **Readers** | Schedule (read-write post-Send), Field (read-only), Sales (frozen proposal copy + derived badge) |
| **Copy vs reference** | **Snapshot at Send** (copy). Post-Send drift from the proposal is accepted and made honest by a derived badge: Schedule edits stamp `sow_revised_at/by/count` on `job_wtcs`; Sales renders "SOW updated in Schedule — this version is historical" when `sow_revised_at > sent_at`. Zero backflow. |
| **Sync pipe** | PostgREST (Sales / Sch web) · PowerSync `job_wtcs` table (Field) |
| **Status** | ✅ CONTRACTED — decision ratified 2026-07-14; revision-stamp columns pending Phase 1 migration |

**Material specs (catalog → SOW stamp)** — registered 2026-07-14 (DMS-1 Phase 0, ERD loop #42).

| Dimension | Answer |
|---|---|
| **Direction** | Material Memory (Sales-side) → SOW entries everywhere (bid → Schedule → Field ticket) |
| **Source of truth (writer)** | `materials_catalog` — specs (kit_size, mils, coverage rate, mix time/speed, cure time, unit) entered once per product; Admin/Manager write per money-table role rules |
| **Canonical location** | Catalog = master default. Each SOW material entry carries its own **stamped copy** — self-contained document, one format, all the data. |
| **Readers** | All apps. Schedule reads the catalog read-only (BF-11 scope decision stands); Field reads stamped specs inside `field_sow` via PowerSync. |
| **Copy vs reference** | **Stamp at pick** (copy). Catalog corrections apply to future SOWs only; historical SOWs keep what they were stamped with. Per-job/day override = edit the stamped copy. **Stamped ≠ confirmed:** specs land unconfirmed (amber chip) and Send is gated on human confirmation per material. |
| **Sync pipe** | PostgREST (web) · stamped inside `field_sow` via PowerSync `job_wtcs` (Field) |
| **Status** | ✅ CONTRACTED — decision ratified 2026-07-14; catalog spec columns pending Phase 1 migration |

## Open decisions to resolve in the design session

1. ~~**Canonical `field_sow` location**~~ — ✅ **RESOLVED 2026-07-14** (DMS-1 Phase 0): canonical = `job_wtcs[].field_sow`, Schedule sole post-Send editor, Field read-only, proposal frozen + derived badge, flat mirror retires. See the contracted SOW entry above + `docs/plans/daily_material_schedule.md`.
2. **`jobs.notes` → Field Command** — should it sync, view-only? If yes, which pipe.
3. **BILLED source of truth** — `billing_log` vs `invoices`/`invoice_lines`; which app owns billing state, and how the card derives % from it.
4. **PROP/amount origin** — confirm where `jobs.amount` is set and whether it's a copy or reference.
5. **Attachments (§7)** — canonical store, cross-app view-only contract, PowerSync sync rules. Its own build loop after this contract lands.
6. **Copy-vs-reference policy for send-to-schedule** — `proposal_wtc → job_wtcs` is a snapshot today; decide whether post-handoff drift is acceptable per entity, or edits must propagate.

## Explicitly not in scope here

Answers. This seed frames the design session; it must not pre-decide it. The SOW-builder port (reuse Sales Command `WTCCalculator` in sch-command) is **blocked on decision #1** — build it once the canonical location is set, not before.
