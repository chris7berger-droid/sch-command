# Phase F — Post-Send Mobilization Editing (Schedule owns the live job's trips)

**Spine:** `command-suite-db/docs/MASTER_SCHEDULE.md` → Phase F (+ decision #5).
**Owner app:** Schedule Command (post-send). Touches sales-command (seed at send) + a one-time backfill.
**Status:** PLAN — not built. Written 2026-08-25 from three read-only verification sweeps.
**Big news vs the spine's assumption:** the `job_mobilizations` table is **already built** (no table creation) and Schedule's mobilization *display* is **already built** — Phase F is smaller than logged. One small additive migration remains (F0, `is_go_back`, for go-back tracking).

---

## Why this exists (the motivation, in plain English)

After a proposal is sent, a job sometimes needs **another trip to site** — go-back/warranty work, an added mobilization. Today there is nowhere to add one: mobilization authoring lives in the Sales proposal, which is frozen after send. Forcing an edit there means pulling the proposal back to Draft — and if anything's been **invoiced**, that's dangerous. The fix is to let **Schedule** add/edit the live job's trips directly, never touching the proposal or its lock.

---

## §0 Baseline — verified current state

**Verification mode:** the load-bearing DB facts are **run-verified** — queried live against prod (`pbgvgjjuhnpsumnowuym`) on 2026-08-25. The code facts are **read-verified** (three read-only agent sweeps + direct reads; file:line evidence in §1). Not app-run-verified (no UI walkthrough).

**Prod DB, live query 2026-08-25:**
- `job_mobilizations` = **0 rows** (`COUNT(*)` — observed empty, not inferred from "no writers").
- `job_mobilizations` columns today: `id, job_id, seq, label, start_date, end_date, created_at, updated_at` — **no `is_go_back`** (F0 adds it; confirmed absent via `information_schema`).
- `proposals` with a non-empty `mobilizations` jsonb: **4**.
- **F1 backfill target (measured):** live jobs carrying `mobilization_seq` on `job_wtcs.field_sow` days with **0** `job_mobilizations` rows = **2 jobs / 2 distinct job:seq pairs** (4 `job_wtcs` total, all with days). Tiny dataset, 1 tenant (HDSP).

**Code facts (read-verified — evidence in §1):**
- **Zero writers** to `job_mobilizations` anywhere (grep, 4 repos). Absence of a seeder is confirmed, not assumed.
- Field ignores mobilization entirely; `job_mobilizations` is not in its PowerSync bucket or `schema.js`.
- Schedule's mobilization **display** is built read-only (`queries.js:106-188`, `MobsModal.jsx`, MOBS card).
- Day→mob key = integer `mobilization_seq` inside `field_sow` jsonb ↔ `job_mobilizations.seq` (name mismatch: day key `mobilization_seq` vs column `seq`).

**What this feature changes vs that baseline:** adds a writer (seed at send) + a one-time backfill so those 0 rows become real job-owned records; adds the `is_go_back` column; adds Schedule write UI. Nothing above is altered destructively.

---

## 1. Verified ground truth (what's actually there)

All three confirmed by direct code/schema reads on 2026-08-25.

- **`job_mobilizations` table already exists, fully built — 0 writers. [LOCKED]**
  `command-suite-db/supabase/migrations/20260708120100_*.sql`. Columns: `id` (uuid PK), `job_id` (bigint, FK→`jobs.job_id` ON DELETE CASCADE), `seq` (int, CHECK >0, **UNIQUE(job_id, seq)**), `label` (text), `start_date`/`end_date` (date), `created_at`, `updated_at` (trigger). RLS enabled — 4 authenticated policies scoping via `jobs.call_log_id → call_log.tenant_id`. GRANTs present. `pull_tickets.job_mobilization_id` already FKs to it. **Nothing anywhere writes it** — the migration header says seeding is "app-side (send-to-schedule, sales-command) — NOT authored here," and it never was. **⇒ the table needs no creation; Phase F adds only one additive column (F0 `is_go_back`) for go-back tracking.**

- **Field Command is fully decoupled from mobilizations. [LOCKED]**
  `field-command` reads `job_wtcs.field_sow` (`TasksTab.js:88`) and groups days **by calendar date only**. Zero references to `mobilization_seq` or `job_mobilizations`; neither is in `schema.js` or the PowerSync bucket. **⇒ seeding the table + keeping `mobilization_seq` on days has zero Field impact.**

- **Schedule's mobilization DISPLAY is already built (read-only). [LOCKED]**
  The spine calls Phase C a "Coming soon" stub — it isn't. `getJobMobilizations`/`loadMobilizationsByCallLog` (`sch-command/src/lib/queries.js:106-188`) derive per-mob groupings off each day's `mobilization_seq`, hydrating **label + planned dates from the frozen `proposals.mobilizations` by seq**. Surfaced by the **MOBS scorecard** (`StageJobCard.jsx:265-273`) and read-only **`MobsModal.jsx`**. What's missing is any **write** affordance.

- **Schedule already has a field-SOW WRITE path + day editor. [LOCKED]**
  `CardSowModal.jsx` hosts `FieldSowBuilder.jsx` per WTC → `updateJobWtcFieldSow` (`queries.js:720`, audit-logged, calendar-scoped) → then `syncJobMaterialLines`. `FieldSowBuilder` can **add/remove days** and edit date/crew/hours/tasks/materials, but has **no `mobilization_seq` control** — it only *preserves* the seq via a passthrough spread (`FieldSowBuilder.jsx:260-278`; a prior whitelist bug had erased it). No go-back concept exists (billing's "Go Back" chip is unrelated). **⇒ the write half is a small addition to surfaces that already exist.**

- **Join key = `mobilization_seq` (int). [LOCKED]**
  `field_sow[].mobilization_seq` ↔ `job_mobilizations.seq` ↔ `proposals.mobilizations[].seq`. Not a table column; a key inside the day jsonb. (Name mismatch to note: day objects use `mobilization_seq`; the table column is `seq`.)

---

## 2. The model — lifecycle split at Send

| Stage | Source of truth | Location | Writer |
|---|---|---|---|
| Pre-send | Sales bid intent | `proposals.mobilizations` (uuid-keyed) | Sales (the WTC Step-1 editor, shipped 2026-08-25) |
| **At Send** | copy-at-send | → seeds `job_mobilizations` (seq, label, dates) + stamps `mobilization_seq` on days (already happens) | sales-command `commitSendToSchedule` (**F1, new**) |
| Post-send | the live job's trips | `job_mobilizations` | **Schedule** (F2, new) |
| Crew | day grouping only | reads `mobilization_seq` off days, ignores the rest | Field (unchanged) |

**Command-Suite data-contract answers (required for a cross-app entity):**
1. **Source of truth / one writer:** Sales pre-send (`proposals.mobilizations`); **Schedule post-send (`job_mobilizations`)**. Handoff at Send.
2. **Canonical location:** `job_mobilizations` becomes the real live-job home. `mobilization_seq` on days is the reference.
3. **Copy vs reference:** copy-at-Send (the contract already says this — F1 makes it real). After send they're independent; the frozen proposal never changes.
4. **Sync pipe:** PostgREST for Schedule (web). Field is unaffected (reads seq off `job_wtcs.field_sow`; `job_mobilizations` is not in its bucket — and stays out unless Phase E wants labels on the crew screen).

---

## 3. Decisions to ratify

- **D1 — Post-send source of truth = `job_mobilizations`.** Seed it at send; repoint Schedule's read helpers to it. *Recommend: yes.* (Today Schedule reads labels off `proposals.mobilizations`; that can't hold a NEW go-back mob that never existed on the proposal.)
- **D2 — Join key stays `mobilization_seq` (int, per job).** Do **not** switch days to an `id` FK. *Recommend: yes* — Field, the send stamp, and FieldSowBuilder's passthrough all already work on seq; changing it is a large, needless rewrite.
- **D3 (REVISED per Chris 2026-08-25) — A go-back IS a first-class, tracked thing.** There are now **two** post-send write actions: **"Add trip"** (a normal additional mobilization) and a distinct **"Add Go Back"** (a mobilization flagged as a go-back). The flag exists so go-backs are **countable/reportable per job and across jobs**, and so their **costs are captured** (the go-back mob's days carry crew/hours/materials = the cost inputs; we roll those up per go-back). Flag lives on the mobilization: **`job_mobilizations.is_go_back boolean NOT NULL DEFAULT false`** — one small additive column (see F0). Mechanically a go-back is still "a mobilization + its days," but it is *marked* and *measured*, not anonymous. *Locked by Chris.* (This is the scheduling+cost mechanism behind the standing "Go Backs" item — re-scheduling invoiced work.)
  - *Sub-note:* the flag could instead live per-day in the `field_sow` jsonb (migration-free), but a go-back is a whole trip and "track Go Backs" is per-trip, so the per-mob column is the right home. It re-adds one additive migration (rehearse-before-push applies again).
  - **Billing treatment** of a go-back (customer no-charge vs new billable invoice) still stays in the billing layer — OUT of scope here. This plan captures go-back **cost** for internal tracking, not customer billing.
- **D4 — Backfill existing live jobs** from `proposals.mobilizations` by seq (recover label/dates), so there's no permanent dual-source read. *Recommend: yes.*
- **D5 — Seed at send is app-side** (`commitSendToSchedule`), idempotent on re-send via `onConflict(job_id, seq)` — same pattern as the existing `job_wtcs` upsert. *Recommend: yes* (matches the migration header's stated intent; a DB trigger can't easily reach the proposal's mob list).

---

## 4. Build sequence (least-reversible first; each gated + smoked)

### F0 — Add the go-back flag · `command-suite-db` (migration)
- `ALTER TABLE job_mobilizations ADD COLUMN is_go_back boolean NOT NULL DEFAULT false;` — additive, back-fills every existing row to `false` automatically. No RLS/grant change (inherits the table's).
- **Shared-DB migration ⇒ rehearse first:** `cd ~/command-suite-db && ./scripts/rehearse.sh <migration>` before push (standing discipline — a change can read correct and only fail from scratch). Author + push from `command-suite-db` per its ledger.
- This is the one migration Phase F needs; everything else is app-side.
- **Smoke:** column present, existing rows `false`, insert with/without it works.

### F1 — Seed `job_mobilizations` at send · `sales-command`
- In `commitSendToSchedule` (`ProposalDetail.jsx`), right after the `job_wtcs` upsert: insert one `job_mobilizations` row per entry in the proposal's `mobilizations` (all of them, so a label exists for every seq), mapping `{job_id: newJobId, seq, label, start_date, end_date}`.
- Idempotent: `.upsert(rows, { onConflict: 'job_id,seq', ignoreDuplicates: true })`.
- Fail-safe: if this write errors, treat like the `job_wtcs` failure path (roll back / surface) — don't mark sent with no trips. [DERIVED — mirror the existing rollback block]
- **Smoke:** send a fresh multi-mob proposal → `job_mobilizations` has one row per mob with labels; re-send → no duplicates.

### F1-backfill — one-time populate existing live jobs
- For every `jobs` row with `job_wtcs` (or flat `jobs.field_sow`) carrying `mobilization_seq` values but no `job_mobilizations` rows: reconstruct from the source proposal's `mobilizations` (join `job_wtcs.proposal_wtc_id → proposal_wtc → proposals.mobilizations`, match by seq) to recover label/dates. Seqs with no proposal match → row with blank label.
- Run via `command-suite-db` `db query --linked -f` or a node script (service-role or minted-user JWT per the "drive edge fn programmatically" discipline). One-shot, verify row counts.
- **Smoke:** pick 2–3 existing sent jobs → `job_mobilizations` rows match the labels the MOBS card currently shows.

### F1b — Repoint Schedule reads → `job_mobilizations` · `sch-command`
- `getJobMobilizations`/`loadMobilizationsByCallLog` (`queries.js:106-188`) read labels/dates from `job_mobilizations` instead of `proposals.mobilizations`. Keep the `proposals.mobilizations` read as a **fallback only** until backfill is verified, then remove it.
- **Smoke:** MOBS card + MobsModal render identically before/after (labels now sourced from `job_mobilizations`).

### F2 — Write affordances (the actual feature) · `sch-command`
- **F2a — Editable mobilizations, two add-actions.** Turn `MobsModal` from read-only into an editor (reuse the display/edit pattern shipped in Sales 2026-08-25: settled rows + Edit/Delete + Save, add = new `job_mobilizations` row `seq = max+1`). **Two distinct buttons:**
  - **`+ Add trip`** → normal mobilization (`is_go_back = false`).
  - **`+ Add Go Back`** → mobilization flagged `is_go_back = true`, visually marked (badge/color) in the list and on the MOBS card.
  Delete does an **in-use scan** across the job's `job_wtcs.field_sow` days (block/warn if the seq is tagged) — same guard as Sales' `deleteMob`.
- **F2b — Per-day mobilization picker in `FieldSowBuilder`.** Add a Mobilization `<select>` on each day row (the field already round-trips via passthrough — just surface it), options = this job's `job_mobilizations` (go-backs labelled as such). Tagging sets `day.mobilization_seq`. **Adding go-back days** = `+ Add Day` → pick the go-back mob; those days carry crew/hours/materials = the go-back's cost inputs. Persists through `updateJobWtcFieldSow` (already audit-logged).
- **Scope-widening — RESOLVED (Chris):** yes, Schedule may add post-send scope, but **only through the explicit `+ Add Go Back` path**, precisely so those costs are captured and go-backs are tracked. `updateJobWtcFieldSow`'s "calendar, never scope" discipline stands for everything else.
- **Smoke:** on a live *invoiced* job, `+ Add Go Back` → "Mob 3 — warranty return" (flagged), add 2 go-back days with crew+hours, save → `job_mobilizations` row `is_go_back=true` + tagged days; **proposal untouched, no pull-back, no invoice guard tripped**; MOBS card shows the go-back badge.

### F3 — Go-back tracking + cost rollup · `sch-command`
- **Track:** the `is_go_back` flag makes go-backs countable/filterable per job (and, later, across jobs). Minimum now: a go-back count + badge on the job (MOBS card / JobDetail).
- **Capture costs:** roll up each go-back mob's days — crew_count × hours_planned (+ materials) — into a per-go-back and per-job go-back cost. The **dollar** conversion reuses the job's existing rate/bid math (`bid_breakdown` / Budget). [DESIGN-OPEN — which rate source powers the dollar figure; the cost *inputs* are captured regardless.]
- A dedicated cross-job "Go-Backs report" screen is a **follow-on**, not this phase — the data (flag + day cost inputs) is captured now so the report is later just a read.

### UI / layout
- Entry: the existing **MOBS card** on the job card (and/or JobDetail) opens the now-editable MobsModal. Day-level tagging lives where days are already edited (CardSowModal → FieldSowBuilder). No new top-level screen.
- Visual: reuse Sales' Step-1 editor pattern for consistency across the suite; Schedule tokens (`T`, Command Green accents) not Sales `C`.

---

## 5. Risks

- **Re-send idempotency** — must not duplicate `job_mobilizations` (onConflict guard).
- **Backfill correctness** — seq→label mapping via the proposal join; some seqs may have no proposal match (blank label) — acceptable, verify counts.
- **Read repoint grace** — jobs not yet backfilled must still render (fallback to `proposals.mobilizations`, or run backfill before removing fallback).
- **Delete-without-scan** — deleting a mob still tagged on days orphans them and would block a re-schedule; require the in-use scan (mirror Sales).
- **Scope-widening** — RESOLVED: Schedule adds post-send scope only via the explicit `+ Add Go Back` path (D3/F2).
- **One shared-DB migration returns (F0 `is_go_back`)** — additive/low-risk, but the **rehearse-before-push** discipline applies (`command-suite-db/scripts/rehearse.sh`) + the single shared ledger. Backfill (F1) is data-only; verify on a couple of jobs first.

---

## 6. Explicitly OUT of scope

- **Customer billing** of go-back work (no-charge vs a new billable invoice) — stays in the existing billing layer. This plan **captures the internal cost** of a go-back (crew/hours/materials on its days) and flags/tracks it, but does not decide or produce customer billing.
- The cross-job **Go-Backs report** screen — follow-on (data is captured now; F3 does the per-job count + cost, not a fleet report).
- Field crew-screen mobilization labels/grouping — that's Phase E (Field currently ignores mobilization entirely, by design).
- Any change to the join key or the day jsonb shape.

---

## 7. Spine corrections this plan surfaces (update MASTER_SCHEDULE.md)

- **Phase F:** drop "needs migration" — `job_mobilizations` already exists; F1 is app-side seed + backfill.
- **Phase C:** the mobilization display is **built read-only**, not a "Coming soon" stub — reclassify.
