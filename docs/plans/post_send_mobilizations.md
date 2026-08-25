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
  - **Material $** — **join on `catalog_id` (audit A1, ratified (a) 2026-08-25).** The day material already carries a `catalog_id` FK (`FieldSowBuilder.jsx:111,149,166`, preserved by passthrough `:263`); use it: `qty_planned × materials_catalog.price` for that id. Fall back to `(name, kit_size)` match ONLY when `catalog_id` is null (pre-catalog custom lines). Off-catalog = `catalog_id` null **and** no name match → `$0` **with a visible "unpriced" flag**, never a silent zero. Do NOT join by name-only (duplicate names / whitespace drift → silent $0 or wrong row). Where the proposal material carried a stamped `price_per_unit`, prefer it over a re-lookup for original (non-go-back) lines.
    - **Units (audit A2):** `materials_catalog.price` is **per catalog unit** (a 5-gal kit, a box), so `qty_planned` MUST mean *number of priced units (kits/boxes)*, not gallons — else a per-kit price × a gallon count mis-costs (e.g. 5×). Define this in the F2b clarifier; **confirm against how quantities are actually entered at smoke** (a domain check like the hours one).
  - **Labor $** = `Σ (day.hours_planned × rate)`. **`hours_planned` is already TOTAL man-hours for the day** (Chris: "16 with four guys = four hours each") — so `crew_count` is **NOT** a cost multiplier, it's informational. Rate source (audit B1): a **stamped** WTC's `bid_breakdown.burden_rate` is already PW-correct (`calc.js:151-155` stamps `prevailing_wage ? pw_rate : burden_rate`) — use it. For an **unstamped** WTC: fall back to tenant `default_burden_rate` ONLY on a non-PW job; on a **prevailing-wage job, surface "needs rate" — never apply the standard ~$56.50 default** (it would 2–3× undercost the PW go-back). Note: `default_burden_rate` is not currently selected in the job read path (`queries.js:1060` pulls only `default_billing_terms`) — the fallback needs it added to the select.
  - **Stored vs derived:** derive on read (live) from current catalog price + rate. Accepted tradeoff: a later catalog-price change restates a past go-back's cost — fine for internal tracking at 1 tenant; revisit (snapshot) only if it ever matters.
  - **UI clarifiers** (Chris authorized): on **Hours Planned** — *"Total work hours for the day, all crew combined (e.g. 16 = two people × 8h, or four × 4h)"* (audit B2 — add a validation note too, don't rely on convention alone); on the go-back material **qty** — that it's the number of priced units (kits/boxes), per the units note above.
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
- **New reader keyed by `job_id` (round-1 B1):** add `loadMobilizationsByJobId(jobId)` reading `job_mobilizations`. Do **not** reuse `loadMobilizationsByCallLog` — it keys by `call_log_id` (`queries.js:160,167`), but `job_mobilizations` keys by `job_id`, and a call_log can carry multiple jobs (archive + live — the dedup at `:171` proves it happens), so a call_log-keyed read returns the wrong job's mobs.
- **Rewire ALL 5 sites, not 1 (audit E1).** The call_log→job_id change is not just `StageJobCard.jsx:588`; the mob map is loaded and prop-drilled through the list views. Rewire every site or the loader stays keyed by `call_log_id` and every card falls back to "Mob N":
  1. `Jobs.jsx:290` — the loader (`mobsByCallLog` → key by `job_id`)
  2. `StagedCardList.jsx:44,61` — prop pass-through
  3. `AllJobsList.jsx:33,65` — prop pass-through
  4. `OnHoldCardList.jsx:5,27` — prop pass-through
  5. `StageJobCard.jsx:588` — the consumer (pass `job.job_id`)
- **Fallback is PERMANENT (audit E2), not gate-removable.** Because the seed is non-fatal (F1), a live job can always legitimately have 0 `job_mobilizations` rows but tagged days, so a row-count removal gate can never reliably latch. Keep the `proposals.mobilizations` read as a **standing per-job fallback** (a job with 0 rows falls back wholesale — never a per-seq merge). A correct fallback is fine to keep indefinitely.
- **Smoke:** MOBS card + MobsModal render identically before/after; a job with an archive+live call_log shows the *live* job's mobs; a card in each of the three list views shows the right labels.

### F2 — Write affordances (the actual feature) · `sch-command`
- **F2a — Editable MobsModal, sourced from the table (audit C1).** Turn `MobsModal` from read-only into an editor (reuse the Sales Step-1 display/edit pattern: settled rows + Edit/Delete + Save). **The editor's row list reads `job_mobilizations` rows directly** — NOT the day-derived `getJobMobilizations` array (which enumerates only from tagged days, `queries.js:117-119`, so a freshly-added dayless go-back would be invisible and un-taggable). Keep the day-derived grouping only for the read-only display, not the editor.
  - **Two buttons:** **`+ Add Go Back`** (`is_go_back = true`, badged) and **`+ Add trip`** (`is_go_back = false`).
  - **`seq = max+1` computed over BOTH `job_mobilizations.seq` AND every day's `mobilization_seq`** (audit O2) so a new mob can't collide with a seq that exists only on days.
  - **Delete in-use scan — split by reversibility (audit C1, refined from round 1's "block/warn if either").** (1) **`pull_tickets` by `job_mobilization_id` = HARD BLOCK, no override** — it's `ON DELETE CASCADE` (`baseline:5133`), so proceeding silently destroys pull tickets + lines + per-mob `ticket_no` numbering (irreversible). (2) **`field_sow` day-tags across ALL the job's `job_wtcs` (by `mobilization_seq`) = warn + confirm** (recoverable — days can be re-tagged). Do NOT collapse the two into one Sales-style confirm→proceed, which would allow click-through pull-ticket loss. (The full WTC list is already on the job object the modal receives, `queries.js:130` — no extra plumbing; the `pull_tickets` scan works because F2a reads `job_mobilizations` rows directly, which carry `id`.)
  - **Named, audit-logged writers (audit D1/H):** no `job_mobilizations` writer exists in sch-command today, and `updateJobField` is jobs-table-only — so **create `addJobMobilization` / `deleteJobMobilization` in `queries.js`** that do the table write **and** call `logJobChange` (`queries.js:956`). The go-back actions D3 wants countable must leave a `job_changes` row.
  - **`seq = max+1` over BOTH `job_mobilizations.seq` AND every day's `mobilization_seq`** (audit O2) so a new mob can't collide with a seq that exists only on days.
  - **Refresh (audit O1):** MobsModal takes an `onUpdated` → parent reloads (`mobsByCallLog` is loaded once at `Jobs.jsx:290`); mirror `CardSowModal:60` so the card isn't stale after a write.
- **F2b — Per-day mobilization picker in `FieldSowBuilder`.** Add a Mobilization `<select>` per day row (the field already round-trips via passthrough — surface it), options = this job's `job_mobilizations`. **Source the options from a fresh `loadMobilizationsByJobId` load, refreshed on `onUpdated` (audit D2)** — FieldSowBuilder has no `job_mobilizations` wiring today, so a stale prop would make a just-added dayless go-back un-taggable in the same session (and, since `getJobMobilizations` enumerates only from tagged days, invisible everywhere else). Tagging sets `day.mobilization_seq`; persists through `updateJobWtcFieldSow` (audit-logged). Add the **Hours Planned** and **material qty** clarifiers here (D6).
- **D7 note (no gate):** plain **Add Day** stays available for rescheduling sold work; **Add Go Back** is the tracked new-work path. Both clearly labeled; no code guard on `updateJobWtcFieldSow` (a lock would mislabel rescheduling — accepted design choice, audit G).
- **Smoke:** on a live *invoiced* job, `+ Add Go Back` → "Mob 3 — warranty return" (badged, shows immediately though dayless), add 2 days with crew+hours, tag them, save → `job_mobilizations` row `is_go_back=true` + tagged days + a `job_changes` row; **proposal untouched, no pull-back, no invoice guard**; deleting a mob with a pull ticket is blocked.

### F3 — Go-back tracking + cost rollup · `sch-command`
- **Track:** `is_go_back` makes go-backs countable/badged per job. **Count only mobs with ≥1 tagged day** (audit O3) — a seeded-but-never-scheduled mob is not a real trip.
- **Cost (per D6 — dollar rollup IS in):** per go-back mob, over its tagged days:
  - **Material $** = `Σ qty_planned × materials_catalog.price` **joined on `catalog_id`** (fallback `(name,kit_size)` only when null; off-catalog → $0 + "unpriced" flag). `qty_planned` = number of priced units (see D6 units note).
  - **Labor $** = `Σ hours_planned × rate` — stamped WTC `bid_breakdown.burden_rate` (already PW-correct); unstamped → tenant `default_burden_rate` **only on non-PW jobs**, else **"needs rate"** (D6/B1). `crew_count` NOT a multiplier.
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
- **Backlog (T6 security-review #6, hardening — deferred):** the pull-ticket delete hard-block lives in the JS writer (`deleteJobMobilization`) + a UI pre-check. RLS scopes DELETE to the caller's own tenant, so the only residual risk is a same-tenant authorized user deleting a mob via the direct API and cascade-destroying its own pull tickets (never cross-tenant). Defense-in-depth = a `BEFORE DELETE` trigger on `job_mobilizations` that raises when a `pull_tickets` row references it. Not built here — it's a new shared-DB migration; author as a follow-on if the guard is wanted server-side.

---

## 7. Spine corrections this plan surfaces (update MASTER_SCHEDULE.md)

- **Phase F:** drop "needs migration" — `job_mobilizations` already exists; F1 is app-side seed + backfill.
- **Phase C:** the mobilization display is **built read-only**, not a "Coming soon" stub — reclassify.


---

## Audit manifest

_Generated by `/auditcriteria` on 2026-08-25 (round 2). Consumed by `/runaudit` to size the adversarial audit pass._

### Bottom line (plain English)
Round 1 already did the heavy lifting and its 12 findings are all folded in. This second pass is a tighter check, not a fresh scan: three reviewers to (1) pressure-test the newly-added money math — especially materials priced by name and labor on prevailing-wage jobs — and (2) confirm the round-1 fixes actually hold, not just that they were written down. If it comes back near-clean, that's the expected outcome and the plan is ready to build.

### Round
- Plan type: feature
- Current round: 2
- Plan revision under audit: 687902b (Plan revision pass 1)
- Findings trend: round 1 (12) → round 2 (?) — plateau if round 2 ≥ 12 (would signal the pass-1 revision added surface faster than it closed it; cut, don't pile on)

### Prior rounds
- Round 1: 687902b · 0C/4H/7M/1L · pattern: plan-cites-mismatched-mechanism

**Briefing for agents**: do NOT re-find round-1 issues — they are folded into §3/§4 (see the pass-1 commit). Two jobs only: (a) adversarially VERIFY each round-1 fix resolves the issue against real code (did it work, or move the bug?), and (b) attack material NEW or CHANGED in the pass-1 revision — chiefly the D6 dollar rollup.

**Plateau signal**: if round-2 count ≥ round 1 (12), that's scope creep from the pass-1 additions — `/runaudit` must present scope-cut as the only build-prompt option, not "do X plus N more."

### Deployment context
- **Live tenants**: 1 — HDSP only.
- **Prod / staging / dev**: Sales send + Schedule live in prod; `job_mobilizations` still empty (0 rows); F2 write UI + F3 cost rollup are net-new.
- **Blocking feature flags**: none gating this surface.
- **Concurrency profile**: ≤5 office users, solo-per-job.
- **Prevailing wage**: if HDSP runs PW jobs, the labor-rate source (burden_rate vs pw_rate) is a real correctness axis — but still capped at 1 tenant.

Weight severity against these: cross-tenant caps at Med, multi-user race caps at Low, theoretical-volume attacks (backfill target is 2 rows) are not High.

### Time budget + finding cap
- **Time budget**: 90 min (defaulted — narrower verification round).
- **Finding cap**: 9 findings.

Synthesis surfaces only the top-9; remainder → "Quarantined findings (not actionable this loop)."

### Surface
- Total lines: 172 (body)
- Sections: 10
- [LOCKED] findings: 5 (§1)
- Ratified decisions: 8 (D1–D8, all ✅)
- [DESIGN-OPEN] items: 0 (round 1's one open — the go-back $ rate source — was resolved in D6)
- [OPEN] items: 0
- Plan-to-code ratio: 172 : ~450 est code lines (~0.4:1 — healthy)

### Layers touched (by the pass-1 additions)
- Data layer (cost computation reads; loadMobilizationsByJobId; delete scan)
- State model (go-back cost derivation; is_go_back)
- External pricing data (materials_catalog.price by name; bid_breakdown / pw_rate for labor)
- Audit logging (go-back add/delete → job_changes)
- Cross-repo (command-suite-db + sales-command + sch-command)
- Migrations (F0 — unchanged since round 1; F0 rehearsal gated on a stale baseline, ADJ3)

### New / changed mechanisms in the pass-1 revision
- Go-back cost rollup: material $ = qty × materials_catalog.price (by name); labor $ = hours_planned × burden_rate (+ default fallback; crew_count NOT a multiplier)
- `loadMobilizationsByJobId` (replaces the call_log-keyed read)
- Two-part delete in-use scan (field_sow across all WTCs + pull_tickets CASCADE)
- Audit-logging helper for go-back add/delete
- `seq = max+1` over both job_mobilizations.seq and day mobilization_seq
- Non-fatal seed path (warn, don't roll back)

### Cross-system reach
- 3 repos (command-suite-db + sales-command + sch-command); field-command verified UNAFFECTED — no angle
- Service-role bypass: the one-time backfill (2 rows)

### Irreversibility
- F0: additive column (reversible); F1 seed + backfill: additive data (reversible). No destructive/public-API changes.

### Known weak points (post-revision)
- **PW labor rate:** labor $ uses `bid_breakdown.burden_rate`; a prevailing-wage go-back should use `pw_rate` — undercost risk if not handled.
- **Material name-join:** `materials_catalog.price` matched by name — case/whitespace/tenant-scope fragility; off-catalog free-typed name must flag "unpriced", not silent $0.
- **Non-fatal seed window:** a just-sent job with a failed seed has 0 rows until backfill — the per-job fallback (F1b) must cover it, and the fallback-removal row-count gate must not fire while such a job exists.
- **Caller completeness:** every caller of the old call_log-keyed read must move to `loadMobilizationsByJobId` — a missed one shows the wrong job's mobs.
- **Delete-scan completeness:** `pull_tickets` is one FK; verify no OTHER FK/reader of `job_mobilizations`/`mobilization_seq`; confirm the cited Sales `deleteMob` "mirror" is actually extended (it scans `proposal_wtc.field_sow`, not `pull_tickets`).

### Open questions
- Count: 0 formal (D6 resolved the round-1 open). Highest-pressure verification target: PW labor rate + material name-join reliability.

### Suggested attack angles (3 total)
1. **Go-back cost-rollup correctness (D6, the new surface)** — covers State model + external pricing data. Required reading: plan §D6/§F3, `sales-command/src/lib/calc.js` (`calcMaterialRow`, `calcLabor`), `materials_catalog` schema, `proposal_wtc.prevailing_wage`/`pw_rate`, `bid_breakdown` stamp. Pressure: material name-join (case/whitespace/tenant scope/unit + off-catalog flag), labor rate on PW jobs (burden_rate vs pw_rate), unstamped-WTC fallback, derive-on-read drift, whole-day cost attribution.
2. **Round-1 fix verification — seed / backfill / read-repoint** — covers Data layer + cross-repo. Required reading: `sales-command/.../ProposalDetail.jsx` (commitSendToSchedule seed), the F1-backfill SQL, `sch-command/src/lib/queries.js` (loadMobilizationsByJobId + all callers of the call_log-keyed read), `StageJobCard.jsx:588`. Pressure: non-fatal seed + fallback window + removal-gate; backfill DISTINCT/full-chain/seq>0/onConflict; caller completeness; seq-max-over-both.
3. **Delete-scan + FK/reader completeness** — covers Data layer + audit logging. Required reading: `pull_tickets` FK (`baseline:5133`), any other FK/reader of `job_mobilizations`/`mobilization_seq`, Sales `MobilizationsEditor.jsx:156-167` (deleteMob), `updateJobWtcFieldSow` audit path. Pressure: two-part scan actually covers pull_tickets + all WTCs; go-back add/delete writes job_changes; the "mirror Sales deleteMob" claim is genuinely extended, not just copied.

### Suggested agent count: 3

Rationale: a round-2 verification round is narrower than round 1's breadth sweep — one concentrated new surface (the cost rollup) plus fix-verification across the seed/backfill/delete paths group cleanly into 3; field-command is verified unaffected and there are no open design questions, so 3 over 4/5.
