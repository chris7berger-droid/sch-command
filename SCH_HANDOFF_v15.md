# SCH_HANDOFF_v15 — BUILD terminal · SOW Vertical + Schedule-side remediation

**Date:** 2026-06-16 · **Branch:** `feat/sow-vertical` · **Terminal:** build (terminal 3 of 4: plan → audit → **build** → buildvsplan). Covers build / smoke / migration-apply detail that planning's v14 deferred here.

## What this terminal owned
Built both plans (`sow_vertical.md` then `sow_vertical_schedule_remediation.md`), ran the smokes, applied the migrations, and fixed bugs the smoke surfaced. Did not author plans or run the audits.

## Session summary
Built the full SOW vertical across three repos: Sales authors per-day-dated + "dates TBD" SOW and writes canonical `job_wtcs`; Schedule edits the calendar on `job_wtcs` (scope frozen at the proposal); Field reads it day-grouped. The first Sales→Schedule smoke **failed** — the Schedule editor had been built into the retired JobDetail Planning tab while production had moved to the Option-D `StageJobCard` in-card modals. Planning produced a remediation plan (3 audit rounds); this terminal rebuilt the Schedule side onto the card design (steps 0–5), re-smoked **GREEN**, and the smoke caught a latent `FieldSowBuilder` id-collision bug (fixed). Field leg deferred to launch (D1). Not yet merged to main.

## Changes shipped

### sch-command (this repo)
**Original vertical build:**
- `749df9f` Clear RESUME ALERT — reconciled 3 live-but-ledger-absent migrations.
- `0aef0dd` SCH3 — `updateJobStatus()` stage-sync chokepoint (all status writers route through it; throws on unmapped).
- `3e53986` §6.6 migration file — `job_wtcs.start_date/end_date` DROP NOT NULL.
- `2300338` SCH1+SCH2 — Field SOW editor on `job_wtcs` + per-day date picker *(later superseded by the remediation — this placement was on the deprecated JobDetail tab)*.
- `75af661` SCH4 — Dates-TBD badge *(also re-placed by remediation)*.

**Schedule remediation (rebuild on current card design):**
- `c523986` step 0 — shared WTC-aware `hasFieldSow` predicate (JS, all 4 readers) + coupled SQL migration `20260616120000` (`CREATE OR REPLACE job_base_checklist_passes`, `jsonb_typeof` crash guard, body from `…133000`).
- `f2b34f4` step 1 — `CardSowModal`: per-WTC `FieldSowBuilder` in the `StageJobCard` in-card modal, writes `job_wtcs`. Findings B (`key={activeWtc.id}`), C (batched `proposal_wtc` materials threaded Jobs→lists→card), E (zero-WTC legacy fallback), F (SOW-empty demote + toast).
- `20ae61f` step 2 — Dates-TBD badge on `StageJobCard`.
- `61ab97c` step 3 — revert JobDetail Planning SOW editor + remove `mode=planning` deep-link + **delete dead `ScheduledCardList.jsx`**.
- `50356e0` step 4 — `DaysModal` canonical per-WTC + click-to-edit deep-link to the SOW modal (Option 3, zero write paths).
- `a24a1c1` step 5 — `FieldSowModal` → Print-only, per-WTC sections (no `jobs.field_sow` write).
- `f9c10c0` plan §7.1 prose fix — one legacy writer (post-revert).
- `7589234` **bug fix** — `FieldSowBuilder` id-collision (editing one day overwrote all): assign stable ids on load + persist on save.
- `9e5d43c` Print PDF — prefix sections with "WTC N —".

### sales-command (`feat/sow-vertical`)
- `5fe3546` S1/S2/S4 — per-day date, "Dates TBD" toggle (per-WTC, round-trips), durable UUID ids + `proposal_wtc.dates_tbd` migration.
- `1a9590c` S3 — Send-to-Schedule writes canonical `job_wtcs` rows (per-WTC `dates_tbd`, idempotent upsert); keeps `jobs.field_sow` mirror.

### field-command (`feat/sow-vertical`)
- `5f03b0a` F1 — `job_wtcs` PowerSync sync-rule + `schema.js` Table *(sync-rule deploy GATED — see D1)*.
- `5be7b2b` F2/F3 — `TasksTab` reads canonical `job_wtcs` + day-grouped render.
- `d27b6df` / `c62a2be` — backlog D1 (deferred PowerSync deploy + F1/F2/F3 smoke; amended with the stale-credential finding).

## DEPLOYED (migrations applied to prod — ledger-reconciled)
Shared Supabase `pbgvgjjuhnpsumnowuym`, applied via `supabase db query --linked --file …` + `migration repair --status applied`:
- `20260612120000` — `job_wtcs.start_date/end_date` nullable.
- `20260613120000` — `proposal_wtc.dates_tbd boolean NOT NULL DEFAULT false`.
- `20260616120000` — WTC-aware `job_base_checklist_passes` (verified NEW; `jsonb_typeof` guard present).
No edge functions, no app deploy (code on branch, not merged/deployed to prod web apps).

## Decisions / choices made
- **DaysModal = Option 3** (read-only overview + click-to-edit deep-link, no second write surface) — chose this over an editable DaysModal because "single canonical writer" means one write *function* (`updateJobWtcFieldSow`), and Option 3 keeps the DAYS surface write-free while still giving quick access.
- **Step-3 vs §7.1 reconciliation** — followed step 3 and *removed* the JobDetail legacy `field_sow` writer (the reverted tab), leaving the card modal as the **sole** legacy writer (one, not the two §7.1 originally listed). Fewer writers = safer; §7.1 prose corrected in `f9c10c0`.
- **id-collision fix** — chose assign-on-load + persist-on-save (not index-based updates), aligning with the S4 durable-id intent.

## Verification
- **Sales→Schedule smoke: GREEN** against prod (test job `job_id 92`, "ZZ TEST – SOW SMOKE"). Verified from the **card flow**: canonical card→`job_wtcs` write, per-day independence, span recompute, `proposal_wtc` frozen, JSON `job_changes` audit, DAYS→click-a-day handoff, Dates-TBD badge (shows + clears), Print per-WTC sections, cross-day % cap.
- **SOW→Field travel proven OFFLINE** — job 92's real `job_wtcs` run through Field's actual `mergeDaysByDate` (F3) produced the correct date-grouped crew view. **NOT verified on a live device** (PowerSync gated — see D1).
- buildvsplan PASSED (entry-point coverage clean); the one open gate it flagged (migration `20260616120000` apply) is now closed.

## NOT touched / deferred
- **Field leg on-device** — deferred to launch (D1). PowerSync instance reprovisioned but its Supabase DB connection fails on a **stale `postgres` password** — fixing that is **step 0** of the Field-launch deploy (D1 amended).
- **Design-pass items NOT yet filed as backlog rows:** enhancements #1 (carry material specs), #2 (menu-first task + 100% cap), #3 (ordered-qty header), #4 (completeness gate at lock), #5 (burden-rate law) — these live in `sales-command`/`sch-command` editors; bug #7 (MaterialsModal closes per-edit, sch-command). #6/#8/#10/#11 were built in the remediation.
- **`ZZ TEST` job (`job_id 92`) still in prod** — needs cleanup.
- **Not merged to main** (all on `feat/sow-vertical`, three repos).

## NEXT SESSION POINTERS
1. **Merge** `feat/sow-vertical` → main in sales-command + sch-command (Field can ride along or wait for launch). Migrations already applied, so merge = code only.
2. **File the design-pass items** (#1–#5, #9, #7) into the right repo backlogs.
3. **Clean up** the `ZZ TEST` job (`job_id 92`) from prod.
4. **Field launch (D1):** step 0 = fix the PowerSync `postgres` credential (Database Connections → Edit, password from Supabase → Project Settings → Database), then deploy the `job_wtcs` sync-rule draft, then smoke F2/F3 on a device.
5. Pre-flight: `git fetch` all three repos; migrations are live, so any new branch must pick clear-of-ledger timestamps (ledger max `20260616120000`).

## FILES TO PROBABLY KNOW ABOUT NEXT SESSION
- `src/components/CardSowModal.jsx` — the new canonical in-card SOW editor (per-WTC).
- `src/components/FieldSowBuilder.jsx` — shared editor; id-collision fix + `focusDayIndex`.
- `src/components/DaysModal.jsx` — per-WTC overview + click-to-edit handoff.
- `src/components/FieldSowModal.jsx` — now Print-only, per-WTC sections.
- `src/lib/queries.js` — `hasFieldSow`, `updateJobWtcFieldSow`.
- `supabase/migrations/20260616120000_job_base_checklist_wtc_aware_sow.sql` — applied.
- `docs/plans/sow_vertical_schedule_remediation.md` — the remediation plan + acceptance gates.

## GIT STATE ON CLOSE
- Branch `feat/sow-vertical` in all three repos; not merged to main.
- sch-command HEAD `afe68d4` (this handoff adds v15 on top). sales-command `1a9590c`. field-command `c62a2be`.
- Working trees clean; all build work pushed.

## END STATE
Sales→Schedule remediation built + smoke-verified GREEN; migrations applied to prod; Field leg deferred to launch (D1). Branches open, not merged. ERD loop #34 closes after this handoff.
