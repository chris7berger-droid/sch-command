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

## 3. Decisions — RATIFIED 2026-08-25 (Chris)

- **D1 — Post-send source of truth = `job_mobilizations`.** ✅ Seed it at send; repoint Schedule's read helpers to it. (Today Schedule reads labels off `proposals.mobilizations`; that can't hold a NEW go-back mob that never existed on the proposal.)
- **D2 — Join key stays `mobilization_seq` (int, per job).** ✅ Do **not** switch days to an `id` FK.
- **D3 — A go-back IS a first-class, tracked thing.** ✅ Two post-send add-actions: **"Add Day"** (reschedules the *sold* work — not tracked as a go-back) and **"Add Go Back"** (new return-trip work; flagged). Flag lives on the mobilization: **`job_mobilizations.is_go_back boolean NOT NULL DEFAULT false`** (F0). Go-backs are counted, badged, and **cost-captured** (see D6). Billing treatment (customer no-charge vs billable) stays in the billing layer.
- **D4 — Backfill existing live jobs** from `proposals.mobilizations` by seq. ✅
- **D5 — Seed at send is app-side** (`commitSendToSchedule`). ✅ **Correction (audit E):** real re-send idempotency is the existing **jobs 23505 guard** (`idx_jobs_source_proposal_id`, `ProposalDetail.jsx:~741`) — the whole send bails there before the seed re-runs, so no duplicate mobs. `onConflict(job_id,seq) ignoreDuplicates` is kept only as a belt-and-suspenders, NOT the primary guard, and is NOT "the same onConflict as job_wtcs" (that uses `proposal_wtc_id`). The seed is **non-fatal** — see F1.
- **D6 — Keep the go-back DOLLAR rollup in scope.** ✅ *(reversed from the audit's "defer" — the audit's blocker A1 was wrong: `materials_catalog.price` exists.)* A go-back's cost is computed, not just its inputs:
  - **Material $** = `Σ (day material qty_planned × materials_catalog.price)` matched by name (materials are picked from Material Memory). Off-catalog free-typed name → `$0` **with a visible "unpriced" flag**, never a silent zero.
  - **Labor $** = `Σ (day.hours_planned × burden_rate)`. **`hours_planned` is already TOTAL man-hours for the day** (Chris: "16 with four guys = four hours each") — so `crew_count` is **NOT** a cost multiplier, it's informational. Rate = the day's WTC `bid_breakdown.burden_rate`; **fallback to tenant `default_burden_rate`** when the WTC is unstamped, never a silent $0.
  - **Stored vs derived:** derive on read (live) from current catalog price + rate. Accepted tradeoff: a later catalog-price change restates a past go-back's cost — fine for internal tracking at 1 tenant; revisit (snapshot) only if it ever matters.
  - **UI clarifier** (Chris authorized): helper text on the Hours Planned field — *"Total work hours for the day, all crew combined (e.g. 16 = two people × 8h, or four × 4h)."*
- **D7 — Scope gate: none (option b).** ✅ Do **not** lock day-adds. Keep plain **Add Day** (reschedules sold work) and **Add Go Back** (new tracked work) both available, **clearly labeled**, and trust the scheduler to pick. A hard lock would mislabel legitimate rescheduling as go-backs. (Audit finding G is thereby accepted as a deliberate design choice, not a risk.)
- **D8 — Keep the name "Go Back."** ✅ Billing already has a "Go Back" (= *nothing to bill*); the schedule flag is a *return trip*. They are **separate fields** (`billing_worklist.nothing_to_bill` vs `job_mobilizations.is_go_back`) — Chris runs billing and knows the difference; no rename, no code reconciliation. Any future report must be explicit about which field it reads. (Audit finding I.)

---

## 4. Build sequence (least-reversible first; each gated + smoked)

### F0 — Add the go-back flag · `command-suite-db` (migration)
- `ALTER TABLE job_mobilizations ADD COLUMN is_go_back boolean NOT NULL DEFAULT false;` — additive, back-fills every existing row to `false` automatically. No RLS/grant change (inherits the table's).
- **Shared-DB migration ⇒ rehearse first:** `cd ~/command-suite-db && ./scripts/rehearse.sh <migration>` before push (standing discipline — a change can read correct and only fail from scratch). Author + push from `command-suite-db` per its ledger.
- This is the one migration Phase F needs; everything else is app-side.
- **Smoke:** column present, existing rows `false`, insert with/without it works.

### F1 — Seed `job_mobilizations` at send · `sales-command`
- In `commitSendToSchedule` (`ProposalDetail.jsx`), after the `job_wtcs` upsert: insert one `job_mobilizations` row per entry in the proposal's mobilizations, mapping `{job_id: newJobId, seq, label, start_date, end_date, is_go_back:false}`.
- **Source the label/dates from `review.mobilizations`** (has `label`/`start_date`/`end_date`), **not** `mobById` (audit F3: that's an id→seq map and would write null labels). Filter `seq > 0` (the `job_mobilizations_seq_positive_chk` CHECK aborts on seq 0).
- **Guard on `p.call_log_id` present** (audit O4): the `job_mobilizations` INSERT RLS scopes via `jobs → call_log → tenant_id`; a null `call_log_id` fails closed. Safe today at 1 tenant, but guard explicitly.
- **Non-fatal (audit E):** if this seed errors, **warn and continue** — the job stays sent; mobs are backfillable. Do **NOT** mirror the `job_wtcs` job-killing rollback (`ProposalDetail.jsx:~787-801`) — that would delete a valid job + frozen bid over a labels-only failure. `job_wtcs` is unrecoverable; mobs are not.
- Idempotency comes from the existing **jobs 23505 guard** (a re-send bails before the seed); `onConflict('job_id,seq', ignoreDuplicates:true)` is a belt-and-suspenders only (audit E1/O5).
- **Smoke:** send a fresh multi-mob proposal → one `job_mobilizations` row per mob with labels; re-send → no duplicate, no error.

### F1-backfill — one-time populate existing live jobs (measured target: 2 jobs / 2 job:seq pairs)
- For each live job with `mobilization_seq` on `job_wtcs.field_sow` days but no `job_mobilizations` rows: reconstruct label/dates from the source proposal's mobilizations via the **full chain** `job_wtcs.proposal_wtc_id → proposal_wtc.proposal_id → proposals.mobilizations`, matched by seq.
- **`SELECT DISTINCT (job_id, seq)` (audit F1):** a job with N WTCs off one proposal would otherwise fan the mob array out N times and blow `UNIQUE(job_id,seq)`. The audit also flagged the plan dropped the `proposal_wtc.proposal_id → proposals.id` hop — include it.
- **`WHERE seq > 0`** (CHECK), **`onConflict('job_id,seq', ignoreDuplicates:true)`** so a second run is safe (audit F2). **Drop the "flat `jobs.field_sow`" clause** — unreachable by this join (audit F3).
- Run once via `command-suite-db db query --linked -f` (or node w/ service-role — a deliberate RLS bypass writing tenant-correct `job_id`s). Verify row counts (expect 2).
- **Smoke:** the 2 target jobs' `job_mobilizations` rows match the labels the MOBS card shows today.

### F1b — Repoint Schedule reads → `job_mobilizations` · `sch-command`
- **New reader keyed by `job_id` (audit B1):** add `loadMobilizationsByJobId(jobId)` reading `job_mobilizations`. Do **not** reuse `loadMobilizationsByCallLog` — it keys by `call_log_id` (`queries.js:160,167`), but `job_mobilizations` keys by `job_id`, and a call_log can carry multiple jobs (archive + live — the dedup at `:171` proves it happens), so a call_log-keyed read returns the wrong job's mobs. Rewire the caller (`StageJobCard.jsx:588`) to pass `job.job_id`.
- **Fallback granularity (audit B2):** the `proposals.mobilizations` fallback is **per-job** (a job with 0 `job_mobilizations` rows falls back wholesale) — not a per-seq merge (a partially-seeded job must not mix sources). **Gate fallback removal on a verified row-count check** (job_mobilizations rows ≥ distinct tagged seqs for every live job), not a manual "after backfill" promise.
- **Smoke:** MOBS card + MobsModal render identically before/after; a job with an archive+live call_log shows the *live* job's mobs.

### F2 — Write affordances (the actual feature) · `sch-command`
- **F2a — Editable MobsModal, sourced from the table (audit C1).** Turn `MobsModal` from read-only into an editor (reuse the Sales Step-1 display/edit pattern: settled rows + Edit/Delete + Save). **The editor's row list reads `job_mobilizations` rows directly** — NOT the day-derived `getJobMobilizations` array (which enumerates only from tagged days, `queries.js:117-119`, so a freshly-added dayless go-back would be invisible and un-taggable). Keep the day-derived grouping only for the read-only display, not the editor.
  - **Two buttons:** **`+ Add Go Back`** (`is_go_back = true`, badged) and **`+ Add trip`** (`is_go_back = false`).
  - **`seq = max+1` computed over BOTH `job_mobilizations.seq` AND every day's `mobilization_seq`** (audit O2) so a new mob can't collide with a seq that exists only on days.
  - **Delete in-use scan covers BOTH (audit D):** (1) `field_sow` days across **all** the job's `job_wtcs` by `mobilization_seq` — plumb the full WTC list into the modal (not one WTC); (2) **`pull_tickets` by `job_mobilization_id`** — it's `ON DELETE CASCADE` (`baseline:5133`), so deleting a mob would silently destroy pull tickets + their numbering. Block/warn if either is non-empty.
  - **Audit-logged (audit H):** route add/delete through a helper that writes a `job_changes` row (repo rule: all job writes are audit-logged) — the go-back actions D3 wants countable must leave history.
  - **Refresh (audit O1):** MobsModal takes an `onUpdated` → parent reloads (`mobsByCallLog` is loaded once at `Jobs.jsx:290`); mirror `CardSowModal:60` so the card isn't stale after a write.
- **F2b — Per-day mobilization picker in `FieldSowBuilder`.** Add a Mobilization `<select>` per day row (the field already round-trips via passthrough — surface it), options = this job's `job_mobilizations`. Tagging sets `day.mobilization_seq`; persists through `updateJobWtcFieldSow` (audit-logged). Add the **Hours Planned clarifier** helper text here (D6).
- **D7 note (no gate):** plain **Add Day** stays available for rescheduling sold work; **Add Go Back** is the tracked new-work path. Both clearly labeled; no code guard on `updateJobWtcFieldSow` (a lock would mislabel rescheduling — accepted design choice, audit G).
- **Smoke:** on a live *invoiced* job, `+ Add Go Back` → "Mob 3 — warranty return" (badged, shows immediately though dayless), add 2 days with crew+hours, tag them, save → `job_mobilizations` row `is_go_back=true` + tagged days + a `job_changes` row; **proposal untouched, no pull-back, no invoice guard**; deleting a mob with a pull ticket is blocked.

### F3 — Go-back tracking + cost rollup · `sch-command`
- **Track:** `is_go_back` makes go-backs countable/badged per job. **Count only mobs with ≥1 tagged day** (audit O3) — a seeded-but-never-scheduled mob is not a real trip.
- **Cost (per D6 — dollar rollup IS in):** per go-back mob, over its tagged days:
  - **Material $** = `Σ qty_planned × materials_catalog.price` (by name; off-catalog → $0 + "unpriced" flag).
  - **Labor $** = `Σ hours_planned × burden_rate` (day's WTC `bid_breakdown.burden_rate`; tenant `default_burden_rate` fallback; `crew_count` NOT a multiplier).
  - **Whole tagged day = go-back cost** (audit O6): a day tagged to a go-back mob counts entirely as go-back cost (the flag is per-mob; we don't split a day).
  - Derived on read (D6 tradeoff noted).
- A cross-job "Go-Backs report" screen is a **follow-on** — the flag + priced rollup are in place, so it's later just a read.

### UI / layout
- Entry: the existing **MOBS card** on the job card (and/or JobDetail) opens the now-editable MobsModal. Day-level tagging lives where days are already edited (CardSowModal → FieldSowBuilder). No new top-level screen.
- Visual: reuse Sales' Step-1 editor pattern for consistency across the suite; Schedule tokens (`T`, Command Green accents) not Sales `C`.

---

## 5. Risks (post-audit; round-1 findings folded into §3/§4)

- **F0 rehearsal will hard-fail on a stale baseline (audit ADJ3).** `command-suite-db/scripts/rehearse.sh` age-gates the baseline (`BASELINE_MAX_AGE_DAYS=14`); the dump was last refreshed ~2026-08-07/10, so today (08-25) it's over the limit and the script refuses. **Before F0: refresh the baseline dump (needs prod network) or the migration can't be rehearsed** — do not skip the rehearsal to get around it (MIG-1 lesson).
- **Backfill correctness** — the DISTINCT + full-chain join (F1-backfill) is the fix; verify the 2 target rows land, and that no seq>0 CHECK / UNIQUE abort occurs.
- **Read-repoint by the right key** — `job_id`, not `call_log_id` (F1b); the archive+live call_log case is the trap.
- **Delete cascade** — the `pull_tickets` CASCADE is the sharp edge; the two-part in-use scan (F2a) must be in place before delete ships.
- **Non-fatal seed** — the seed must never take down a valid send (F1); confirm the failure path warns, doesn't roll back.
- **Labor rate fallback** — an unstamped WTC must fall back to tenant `default_burden_rate`, never silent $0 (D6/F3).
- **Design choices accepted (not risks):** no scope gate (D7), "Go Back" name kept (D8) — both deliberate.

---

## 6. Explicitly OUT of scope

- **Customer billing** of go-back work (no-charge vs a new billable invoice) — stays in the existing billing layer. This plan computes the go-back's **internal cost** (labor + materials, D6) and flags/counts it, but does not decide or produce a customer invoice.
- The cross-job **Go-Backs report** screen — follow-on (the flag + priced per-job rollup are built now; the fleet report is later just a read).
- Field crew-screen mobilization labels/grouping — that's Phase E (Field currently ignores mobilization entirely, by design).
- Any change to the join key or the day jsonb shape.
- **Go-back tracking is forward-only (audit ADJ2):** past return-trip work that lives only in billing's `nothing_to_bill` cannot be reclassified into `is_go_back` retroactively. New go-backs from here are tracked; historical ones aren't backfilled. Stated, accepted.
- Backlog (pre-existing, not this plan): `job_mobilizations` has no `tenant_id` column (tenant derived via `jobs→call_log`) + single PowerSync bucket — the MIG-4 pattern, capped Med at 1 tenant (audit ADJ1).

---

## 7. Spine corrections this plan surfaces (update MASTER_SCHEDULE.md)

- **Phase F:** drop "needs migration" — `job_mobilizations` already exists; F1 is app-side seed + backfill.
- **Phase C:** the mobilization display is **built read-only**, not a "Coming soon" stub — reclassify.

---

## Audit manifest

_Generated by `/auditcriteria` on 2026-08-25. Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
Medium-sized, cross-app change that seeds a table, backfills a little live data, and adds go-back editing in Schedule — so it deserves a real check, but not a huge one. Four reviewers, one each on: the send-time seeding, the migration+backfill, the Schedule editing screen, and the go-back cost tracking. The live data it touches is tiny (one tenant, two jobs), so blast radius is small; correctness matters because it sets the pattern every future send follows.

### Round
- Plan type: feature
- Current round: 1
- Plan revision under audit: d49bd84
- Findings trend: n/a — round 1

### Prior rounds
none — this is round 1.

**Briefing for agents**: attack the plan revision under audit (d49bd84). The `[LOCKED]` findings in §1 came from a prior read-only agent sweep — do NOT trust them; independently re-verify against actual code/schema and try to break them.

**Plateau signal**: n/a at round 1. If a round 2 is needed and its count is steady or higher, that's scope creep — `/runaudit` must present scope-cut as the only build-prompt option.

### Deployment context
- **Live tenants**: 1 — HDSP only (multi-tenant onboarding F-tier/blocked).
- **Prod / staging / dev**: Sales send + Schedule are LIVE in prod; `job_mobilizations` is empty (0 rows); the F2 write UI is net-new.
- **Blocking feature flags**: none gating this surface.
- **Concurrency profile**: ≤5 office users (Joe/John/Denise), effectively solo-per-job.

Agents weight severity against these: cross-tenant findings cap at **Med** while `live_tenants == 1`; multi-user race findings cap at **Low** while concurrency is ≤5/solo; theoretical attacks against state that doesn't exist yet (e.g. large backfill volume — actual target is 2 rows) are not High.

### Time budget + finding cap
- **Time budget**: 120 min (defaulted — Phase F build not yet in an ERD loop; sized for a round-1 audit of the cross-repo foundation).
- **Finding cap**: 12 findings.

Synthesis MUST surface only the top-12 most consequential findings. Remainder → "Quarantined findings (not actionable this loop)."

### Surface
- Total lines: 152
- Sections: 9
- [LOCKED] decisions: 5
- [DESIGN-OPEN] items: 1 (F3 dollar rate source)
- [OPEN] items: 0
- Plan-to-code ratio: 152 : ~400 est code lines (~0.4:1 — plan smaller than the build; not scope-crept)

### Layers touched
- UI / components (editable MobsModal; per-day picker in FieldSowBuilder)
- Data layer (queries.js reads + writes; send-flow insert)
- State model (`is_go_back` column; `mobilization_seq` semantics; go-back cost derivation)
- Migrations / schema (F0 additive column)
- RLS / auth / multi-tenancy (job_mobilizations write must satisfy the jobs→call_log→tenant_id policy; backfill service-role bypass)
- Cross-repo (command-suite-db + sales-command + sch-command)
- Audit logging (updateJobWtcFieldSow → job_changes)

### New mechanisms introduced
- New column: `job_mobilizations.is_go_back` (boolean NOT NULL DEFAULT false)
- New helpers: seed-at-send in `commitSendToSchedule` (sales-command); one-time backfill (command-suite-db); read repoint of `getJobMobilizations`/`loadMobilizationsByCallLog` (sch-command); editable `MobsModal` with two add-actions (`+ Add trip` / `+ Add Go Back`); per-day mobilization `<select>` in `FieldSowBuilder`; go-back cost rollup fn
- New tables: none (job_mobilizations already exists)
- New triggers / RLS policies: none (inherits existing)
- New routes / cron / webhooks: none

### Cross-system reach
- command-suite-db — F0 migration + backfill (single shared ledger)
- sales-command — seed at send (`ProposalDetail.jsx` `commitSendToSchedule`)
- sch-command — read repoint + write UI
- field-command — verified UNAFFECTED (ignores mobilization; not in its PowerSync bucket) — no angle needed
- Service-role / bypass path: the one-time backfill (bypasses RLS) — must write tenant-correct `job_id`s

### Irreversibility
- F0 migration: additive (`is_go_back` default false) — reversible (drop column); shared-ledger coordinated; rehearse-before-push
- F1 seed + backfill: additive data — reversible (delete rows)
- No destructive schema changes, no public API changes

### Known weak points
- **Seed ordering vs RLS (§F1):** the `job_mobilizations` INSERT policy scopes via `jobs.call_log_id → call_log.tenant_id`; the seed runs right after the jobs insert — `call_log_id` must be populated on the jobs row at seed time or the RLS INSERT check fails.
- **Idempotency (§F1):** `onConflict(job_id,seq)` must target the real UNIQUE index; partial-send (job_wtcs written, seed fails) needs rollback parity with the existing job_wtcs failure path.
- **Backfill mapping (§F1-backfill):** seq→label via `job_wtcs.proposal_wtc_id → proposal_wtc → proposals.mobilizations` by seq — edge cases: null `proposal_wtc_id` (archive-import), legacy flat `jobs.field_sow`, a seq on a day with no matching proposal mob. Dataset is tiny (2 pairs) but it sets the pattern for every future send.
- **Read-repoint grace (§F1b):** un-backfilled jobs must keep rendering via the `proposals.mobilizations` fallback; removing the fallback before backfill is verified drops labels.
- **Delete without in-use scan (§F2):** deleting a `job_mobilizations` row still tagged on `field_sow` days orphans them and blocks re-schedule/send — needs the scan across ALL of the job's `job_wtcs.field_sow`.
- **Scope-widening enforceability (§F2):** post-send scope adds are allowed ONLY via `+ Add Go Back`; verify plain `+ Add Day` in FieldSowBuilder can't still inject scope.
- **Name mismatch:** day key `mobilization_seq` vs column `seq` — mapping-bug risk in seed / backfill / rollup.
- **Go-back cost attribution (§F3):** flag is on the mob, cost inputs on the days — the rollup must sum the flagged mob's days correctly; dollar rate source unresolved.

### Open questions
- Count: 1 (see §F3)
- Highest-pressure: which rate source powers the go-back dollar figure (`bid_breakdown`/Budget), and whether go-back cost is stored or derived on read.

### Suggested attack angles (4 total)
1. **Send-path seed correctness (state trace)** — covers Data layer + State model + Audit + cross-repo send. Required reading: `sales-command/src/components/ProposalDetail.jsx` (`commitSendToSchedule`, ~658-805), the `job_mobilizations` RLS policies. Specific pressure: seed insert ordering vs jobs/job_wtcs writes and the RLS INSERT check (call_log_id present?), idempotency onConflict(job_id,seq), partial-send/rollback parity, mobilization_seq→seq mapping, seed-all-mobs vs only-tagged.
2. **Migration + backfill + RLS/tenancy** — covers Migrations + RLS + cross-repo data. Required reading: `command-suite-db/supabase/migrations/20260708120100_*.sql` + baseline, the plan's F0/F1-backfill. Specific pressure: additive-column safety + shared ledger + rehearse discipline; backfill seq→label reconstruction edge cases (null proposal_wtc_id, legacy flat field_sow, unmatched seq); service-role bypass writing tenant-correct rows.
3. **Schedule read-repoint + write UI** — covers UI + Data layer. Required reading: `sch-command/src/lib/queries.js:106-188` + `720` (updateJobWtcFieldSow), `MobsModal.jsx`, `FieldSowBuilder.jsx:260-278`, `CardSowModal.jsx`. Specific pressure: F1b grace window / fallback removal, F2 delete-in-use-scan across all field_sow, scope-widening enforced only via Add Go Back, passthrough preserving mobilization_seq.
4. **Go-back model + cost capture** — covers State model + cost/reporting logic. Required reading: plan §F2a/§F3, `is_go_back` usage, existing bid_breakdown/Budget cost math in sch-command. Specific pressure: cost attribution to the flagged mob's days, stored-vs-derived, dollar rate source (DESIGN-OPEN), go-back countability/tracking, per-mob flag vs per-day coherence.

### Suggested agent count: 4

Rationale: genuinely cross-repo (3 repos) with 6 novel mechanisms and an additive migration pushes above the 3-agent sweet spot, but the surface groups cleanly into 4 angles; not 5 because field-command is verified unaffected (no angle) and open-questions are low (1).
