# SCH_HANDOFF_v28 — DMS-1 Phase 2 SHIPPED (Sales SOW authoring + Schedule save-protection)

**Repo:** sch-command · **Branch:** `main` (`5ac2e20`) · **Date:** 2026-07-28
**Production:** https://schedulecommand.com — Step 1 (Schedule save-protection) LIVE.
**ERD:** Loop #44 (`dms1-phase2-sales-sow`) — **still OPEN** (picture = the whole printed ticket; Phase 2 logged as a milestone, see §6).
**Cross-repo:** shipped in tandem with `sales-command` (Steps 2–7). See `SC_Handoff_v171.txt` there.

> Full record lives in the plan docs — this handoff points, doesn't duplicate:
> `docs/plans/daily_material_schedule_phase2_build.md` (Steps 1–7, build-ready after round-2),
> `docs/plans/daily_material_schedule_buildorder.md` §2 (audited), `docs/plans/daily_material_schedule.md` §1/§2/§4 (Phase-0).

---

## 1. Session summary

DMS-1 Phase 2 — the Sales→Schedule specs/scope-notes authoring pipeline — was built cross-repo,
gated through T4/T5/T6, smoke-verified on the shared DB, and merged to both prods in the correct
order (Schedule first). This is the foundation for the crew ticket (Phase 4). The plan went through
2 audit rounds (8→2, converged) before build; this session was build → gates → ship.

## 2. Changes shipped — sch-command (Step 1 / §2A, landed FIRST)

- **`FieldSowBuilder.jsx` `handleSave` → passthrough-spread** — fixes the §0.2b live bug that silently
  stripped `mobilization_seq` / `sq_ft` / `linear_ft` on any Schedule SOW edit.
- **Seed `task_ref` / `catalog_id` / `specs_stamped_at`** at all 3 material constructors + one-hop
  catalog stamp on Schedule-side adds.
- **Specs text end-to-end** — `numericKeys` (keystroke) + `specInput` render inputs (`:435` mils, `:448`
  mix_time) no longer coerce text specs to numbers.
- **`queries.js` `loadMaterialsCatalog`** selects the Phase-1 spec columns.

Why Schedule first: the passthrough had to be live before Sales began writing the new fields, else the
strip window would have eaten them too (plan §2 internal-order rule).

## 3. Deployed

- **sch-command** `main` `5ac2e20` → schedulecommand.com (merged **first**).
- No migration, no edge fn, no config — jsonb-additive + app code only. Phase-1 migrations
  (`20260714120000–120300`) were already live.

## 4. Gates (all green)

- **T4 buildvsplan** — 0 blockers; live-schema probe confirmed every referenced column deployed; all
  round-1 fixes propagated; Send wiring spread-preserved → SMOKE GO.
- **Smoke** (preview, shared DB) — full pipeline proven: authored → confirmed → sent (**job 95 /
  display 10021**) → landed clean on `job_wtcs[].field_sow` (day, task, Crown 8202, coverage 200,
  scope_notes, mobilization_seq, specs_confirmed all present).
- **T5 code-review** — 0 ship-blockers; filed DMS-2 + DMS-3.
- **T6 security-review** — 0 exploitable-today; `role_aware_money_rls` is the real gate and the new
  client write path correctly adds no new exposure.

## 5. Backlog filed this loop (carry forward — do NOT close)

- **DMS-2** (T2, **Phase-3 BLOCKER**) — Schedule confirm UI must add reset-on-edit, or Schedule-edited
  specs keep a stale confirmation (would let the Phase-4 print gate pass unverified specs). `docs/BACKLOG.md:53`.
- **DMS-3** (T3) — `hasAnySpec` key-list drift across repos; latent, cosmetic Low. `docs/BACKLOG.md:54`.

## 6. Current state & next steps

- **`main` is clean and live.** Both feature branches (`feat/dms1-phase2-plan`, `feat/dms1-phase2`)
  deleted local + remote.
- **ERD #44 stays OPEN.** Its picture is the whole printed Daily Material Schedule ticket. Phase 2 is a
  **milestone**, not the close — logged to the ERD log. #44 closes when the ticket prints.
- **Still open (future loops, under #44):**
  - **Phase 3** — Schedule-side scope-notes/specs display + confirm gate. **Carries DMS-2** (must add
    reset-on-edit).
  - **Phase 4** — crew-ticket print (the "Daily Material Schedule" output). NOTE: the existing "Field
    SOW and Production Rate Tracker" PDF is the OLD print, **not** this ticket.
  - **Phase 5** — retire the `materials` table + `jobs.field_sow` mirror (Phase-0 §1 preconditions).

## 7. Files to know

- Build spec (executed): `docs/plans/daily_material_schedule_phase2_build.md`
- Audited plan: `docs/plans/daily_material_schedule_buildorder.md`
- Phase-0 decisions: `docs/plans/daily_material_schedule.md`
- Ticket references (Phase-4 acceptance test): `docs/plans/assets/6618-*.{pdf,png}`
- Shipped code: `src/components/FieldSowBuilder.jsx`, `src/lib/queries.js`
