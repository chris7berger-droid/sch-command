# SCH_HANDOFF_v31 — DMS-1 Phase 3 SHIPPED + LIVE (Schedule SOW read + warehouse Logistics)

**Repo:** sch-command · **Branch:** `main` · **Date:** 2026-07-31
**Production:** https://schedulecommand.com — LIVE.
**Cross-repo:** sales-command (Step 0 + UX) + command-suite-db (one additive migration, applied).
Spine: `command-suite-db/docs/MASTER_SCHEDULE.md`. Plan: `docs/plans/daily_material_schedule_phase3_build.md`.

> **Numbering:** v29 was this build's mid-session pause handoff; v30 is the parallel deposit
> session's (multi-deposit fix). This picks up v31.

---

## 1. Session summary

Built and shipped **DMS-1 Phase 3** end to end (plan → build → 3-terminal review gate → deploy →
live smoke). Phase 3 is the Schedule-side read of the SOW plus the warehouse **Logistics** workspace:
a read-only SOW tab, a needed-vs-ordered material tracker with a covered/short/can't-tell flag,
truck/equipment/power assignment, a Settings page to manage those asset lists, and spec confirm/lock
with a typed-reason override. Spanned three repos (sch-command bulk, one Sales reach-back for per-task
size/unit, one additive command-suite-db migration). The build went through buildvsplan (T4),
code-review (T5), and security-review (T6) — all green — then deployed in the locked order
Sales → migration → Schedule. Two preview-only bugs were caught and fixed before prod. Chris
live-smoked the final site. All three feature branches deleted; repos clean on main. Two mid-build
scope questions (warehouse-add attach point, finalize scope) were ratified by Chris; one grain premise
in the plan was found false and corrected. Phases 4 (the printable crew ticket) and 5 (retire the old
`materials` table) remain — the rest of the big DMS build.

## 2. Changes shipped

**sch-command (main, this session — grouped by phase of work):**
- `e8f9cfa` premise-check folded into plan §0/§1 + filed DMS-4. Verified live before building:
  `job_material_lines` empty; `materials` never in `supabase_realtime` (board-freeze pre-existing).
- `ff13067`/`cd22681` Steps 1–2 — Schedule task size/unit passthrough + read-only SOW tab (extracted
  shared `FieldSowView`).
- `859175d` §2 — `src/lib/sowMaterials.js` pure rollup (coverage parse + needed math + stable grouping)
  + `sowMaterials.verify.mjs` (26/26; proves same-material-across-days counts once).
- `4872dbb` folded ratifications (REG-4 one-row-per-need grain; DMS-5 gate defer).
- `eee7cad`/`5d28166`/`4a68514`/`cdb3fc2` Step 3 — job_material_lines writer/reader/warehouse-edit +
  fail-closed gate; shared `LogisticsMaterials`; repointed EVERY `materials` reader + realtime channel
  (re-grep clean); nav Materials→Logistics.
- `9736fda` Step 4 warehouse add (unassigned `wh_` row). `af6bfab` Step 5 job_assets assignment.
  `412edf7` Step 6 Settings asset-list editor (+/settings route). `0038c27` Step 7 confirm/lock +
  overrideSpec. `c4eae87` Step 8 proposed-vs-actual labels.
- `73c583b` filed SEC-5. `9b2fe99` T4 fix (drop 'unit' from hasAnySpec). `ddecf9a` T5 fixes (4 Low).
- `b22805a` merged origin/main (deposit session) — code auto-merged clean, only the v30 handoff collided.
- `e0ba02e` **fix: undecidedMats ReferenceError** (blank planning screen — my T5 fix left a dangling ref).
- `44eb3bc` **fix: Logistics modal vanishing on write** (made the board's realtime/onJobUpdate refresh
  background so it stops unmounting open modals).
- `f172572` filed DMS-6 (warehouse-add price/note/job-costing).

**sales-command (main):** `b74963c` Step 0 per-task size+unit; `6249888` SQFT/LF as a visible two-button
toggle (the dropdown read as a static label); `fcbc45a` removed the redundant day-level Sq Ft/Linear Ft
(size is per-task now — traced end-to-end first, nothing computed on the day fields).

**command-suite-db (main):** migration `20260731130000_dms1_phase3_material_tracker_and_job_assets.sql`
(+ rollback) — additive: 4 cols on job_material_lines, new `job_assets` (verbatim RLS chain +
cross-tenant asset_id trigger), realtime publication add. Timestamp was deconflicted from `…120000`
(the deposit migration) to `…130000`.

## 3. Deployed

- **Project ref:** pbgvgjjuhnpsumnowuym. Deploy order (locked, no same-deploy): Sales → migration → Schedule.
- **sales-command** → scmybiz.com (Vercel, main). Task size/unit + toggle + day-field removal live.
- **command-suite-db migration `20260731130000`** → applied to prod. **Applied via the Supabase management
  API (execute path), NOT `npm run db:push`** — the CLI `db push` needed the DB password and the
  interactive prompt kept failing; once Chris reset the password it went via CLI. Ledger recorded the
  **exact** version `20260731130000` (verified). Rehearsed clean twice (idempotent, no anon exposure).
- **sch-command** → schedulecommand.com (Vercel, main @ `44eb3bc` + DMS-6). No edge fns, no config.

## 4. Decisions

- **REG-4 — one row per real need, not "3 days = 3 rows."** The plan's grain rested on a false premise:
  `wtc_material_id` collides across days on the proposal path (the DB author's own header confirmed it),
  so per-day rows are physically impossible there. Ratified: key on the stable logical need. Why it
  matters: it's what makes the warehouse edit one Ordered box per material and avoids the N× overcount.
- **DMS-5 — deferred the server-side ready-gate move.** The DB `job_base_checklist_passes` + 3 triggers
  still read the dead `materials` table (stale-lenient). Deferred to Phase 5 (a function rewrite is a
  different risk class than an additive migration). Verified safe: nothing trusts the stored
  `ready_confirmed_at` without a live recompute (all 3 repos + all DB views/policies/cols checked).
- **R5 — warehouse-add is unassigned.** A hand-added material is a standalone tracker row (`wh_` key),
  not written to the frozen SOW; warehouse types Ordered directly. R7 — finalize is labels-only (the
  board already IS the finalized schedule).
- **Migration applied via API.** Chose the authenticated management-API path over fighting the CLI
  password prompt, but controlled the ledger version to keep it aligned with the repo + the deposit
  session's ledger.

## 5. Verification

- **Build:** every step `npx vite build` green. **Rollup:** `node src/lib/sowMaterials.verify.mjs` 26/26.
- **Review gate:** T4 buildvsplan (0 blockers), T5 code-review (0 blockers, 4 Low fixed in-flow),
  T6 security-review (0 exploitable-today) — all against the migration file as source of truth.
- **Migration:** verified against prod after apply — 4 cols, job_assets table + 4 RLS policies +
  2 triggers, realtime membership, ledger version all present.
- **Live smoke (Chris, on prod):** SOW tab, Logistics open, status change persists, add-material,
  Settings nav — all confirmed working. The two preview bugs were caught on the branch's Vercel preview
  **before** prod (not on the live site).
- **NOT verified:** the full §5 smoke script's multi-WTC + deliberate-SHORT/CAN'T-TELL matrix and the
  print-gate predicate under real print (Phase 4). Old jobs (no per-task size) correctly read "can't-tell".

## 6. Not touched this session

- **Phase 4** (the printable Material Order Summary + per-day crew ticket + Print PDF) — the real payoff,
  not started; needs its own plan.
- **Phase 5** (retire legacy `materials` table + backfill + verify vs job 6618) — includes executing DMS-5.
- SEC-5 (/settings not role-gated), DMS-4 (dead assignments realtime channel) — filed, deferred.

## 7. Next session pointers

1. **Phase 4 is plan-first** — stand up a planning terminal + `/erd-start` before building. It's the crew
   ticket/print output and the master schedule has a bigger warehouse vision behind it (receiving, pull
   tickets, sign-off/release). Roughly a full build cycle like Phase 3.
2. Before any DB work: migrations only via command-suite-db; rehearse (`./scripts/rehearse.sh`) before push.
3. DMS-6 (warehouse-add price + note + job-costing) is a plan-mode item — decide the job-costing wiring
   + whether warehouse-adds attach to a SOW day/task.
4. The command-suite-db DB password was rotated at close (it had appeared in a session transcript).

## 8. Files to probably know about next session

- `src/lib/sowMaterials.js` — the pure rollup (coverage parse + grouping + reasons); `verify.mjs` beside it.
- `src/lib/queries.js` — `syncJobMaterialLines`/`updateJobMaterialLineField`/`addWarehouseMaterialLine`,
  job_assets + tenant-asset CRUD, `materialsDecided` (single-source gate helper), fail-closed `baseChecklistPasses`.
- `src/components/LogisticsMaterials.jsx` / `LogisticsAssets.jsx` — the warehouse views.
- `src/components/FieldSowBuilder.jsx` — Step 7 confirm/lock/overrideSpec + SPEC_KEYS + materialBlocksPrint.
- `src/views/Jobs.jsx` — `loadData({ background })`: refreshes are background so open modals survive.
- `command-suite-db/supabase/migrations/20260731130000_*.sql` — the Phase-3 migration (live).

## 9. Git state on close

- Branch `main`, all three DMS-1 Phase 3 feature branches deleted (local + remote). Repos clean on main.
- sales-command `main` + command-suite-db `main` also carry this session's work, on main, pushed.
- Resume pointer (`~/.claude-commands/active-work.txt`) updated to "DMS-1 Phase 3 SHIPPED + LIVE".
- No open PRs from this work. Parallel deposit session's branches are theirs — not touched.

## 10. End state

Merged, deployed, live-smoked — DMS-1 Phase 3 done. Phases 4 (crew ticket) and 5 (retire `materials`) remain, plan-first.
