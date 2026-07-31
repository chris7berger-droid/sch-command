# SCH Handoff v30 — DMS-1 Phase 3 build COMPLETE (awaits review gate)

**Date:** 2026-07-31
**Repos/branches:** `sch-command` @ `feat/dms1-phase3` · `sales-command` @ `feat/dms1-phase3-task-size-unit` · `command-suite-db` @ `feat/dms1-phase3-migration`
**Plan:** `docs/plans/daily_material_schedule_phase3_build.md` (converged + corrected in-flight)
**State:** Build-only. **NOTHING pushed, deployed, or merged.** All three working trees clean.

## Status — ALL STEPS DONE
| Step | State | Commit(s) |
|---|---|---|
| Premise check | ✅ job_material_lines EMPTY; materials NOT in realtime (board-freeze pre-existing) | — |
| 0 — Sales size/unit | ✅ | sales-command `b74963c` |
| 1 — Schedule pass-through | ✅ | `ff13067` |
| 2 — read-only SOW tab | ✅ | `cd22681` |
| §2 rollup + BUILD-VERIFY (26/26) | ✅ | `859175d` |
| 3 — Logistics + repoint every reader/channel + fail-closed gate | ✅ | `5d28166`/`4a68514`/`cdb3fc2` + `eee7cad` |
| 4 — warehouse add (R5=unassigned) | ✅ | `9736fda` |
| §4 migration (rehearsed clean ×2) | ✅ | command-suite-db `ceaaec4` |
| 5 — assign trucks/equipment/power (job_assets) | ✅ | `af6bfab` |
| 6 — Settings asset-list editor (+/settings route) | ✅ | `412edf7` |
| 7 — confirm/lock + overrideSpec | ✅ | `0038c27` |
| 8 — finalize (R7=proposed-vs-actual label) | ✅ | `c4eae87` |

Every step `npx vite build`-verified. Rollup logic proven by `node src/lib/sowMaterials.verify.mjs` (26/26).

## Decisions ratified this build (folded into plan)
- **Writer column-split** (§1): SETs name/kit_size/coverage/supplier/qty_needed/coverage_status/coverage_reason; warehouse cols untouched.
- **REG-4 grain**: one row per REAL logical need (the "3 rows" premise was false — wtc_material_id collides across days on the proposal path).
- **R5**: warehouse-add = UNASSIGNED direct `wh_` row (amber can't-tell, enter Ordered directly), excluded from orphan cleanup.
- **R7**: finalize = labels only (board already IS the finalized schedule).
- **DMS-5** (BACKLOG, T2, Phase-5 owned): server-side ready-gate (`job_base_checklist_passes` + 3 triggers) still reads the dead `materials` table — deferred, verified safe (nothing trusts stored `ready_confirmed_at` without live recompute). Also DMS-4 (dead assignments channel).

## LOCKED next steps — DO NOT skip the order
1. **Review gate** (separate terminals, in order): **buildvsplan (T4) → code-review (T5) → security-review (T6).** No merge/deploy before these pass.
2. **Then deploy in LOCKED order (no same-deploy):**
   a. **Sales Step 0 → prod first** (merge `feat/dms1-phase3-task-size-unit`, deploy).
   b. **command-suite-db migration** — merge `feat/dms1-phase3-migration` to main, `npm run db:push` (already rehearsed clean; re-rehearse if baseline moved). Watch: additive-only; realtime add is a net upgrade.
   c. **Schedule** (merge `feat/dms1-phase3`, deploy).
3. **Smoke (§5, post-migration)** — the full in-browser smoke can only run AFTER the migration (Steps 3-6 use the new columns/table). Script in plan §5: author a SOW with sizes + coverage_rate → SOW tab → Logistics Needed-vs-Ordered flags (deliberate SHORT + a CAN'T-TELL) → warehouse add + confirm + one overrideSpec → promote a zero-line SOW job is HELD (fail-closed) → board realtime refreshes → reload survives → multi-WTC + same-material-two-days overcount check.

## Parallel-session note (Chris, 2026-07-31)
Another machine is fixing a **Material deposit button** on a different sch-command branch. My branch touches `StageJobCard.jsx` (one prop, ~line 736) and `queries.js` (appended functions) — both contain deposit code but my edits are in different regions, so a merge should be clean or a trivial conflict. Eyeball those two files when merging.

## To resume / hand to the gate
`cd ~/sch-command && git checkout feat/dms1-phase3`. Run `/buildvsplan` first. sales-command + command-suite-db each have their own branch (see top). Migration is authored + rehearsed but NOT pushed.
