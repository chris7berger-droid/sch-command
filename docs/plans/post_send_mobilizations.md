# Phase F — Post-Send Mobilization Editing (Schedule owns the live job's trips)

**Spine:** `command-suite-db/docs/MASTER_SCHEDULE.md` → Phase F (+ decision #5).
**Owner app:** Schedule Command (post-send). Touches sales-command (seed at send) + a one-time backfill.
**Status:** PLAN — not built. Written 2026-08-25 from three read-only verification sweeps.
**Big news vs the spine's assumption:** **no migration needed**, and Schedule's mobilization *display* is **already built**. Phase F is smaller than logged.

---

## 0. Why this exists (the motivation, in plain English)

After a proposal is sent, a job sometimes needs **another trip to site** — go-back/warranty work, an added mobilization. Today there is nowhere to add one: mobilization authoring lives in the Sales proposal, which is frozen after send. Forcing an edit there means pulling the proposal back to Draft — and if anything's been **invoiced**, that's dangerous. The fix is to let **Schedule** add/edit the live job's trips directly, never touching the proposal or its lock.

---

## 1. Verified ground truth (what's actually there)

All three confirmed by direct code/schema reads on 2026-08-25.

- **`job_mobilizations` table already exists, fully built — 0 writers. [LOCKED]**
  `command-suite-db/supabase/migrations/20260708120100_*.sql`. Columns: `id` (uuid PK), `job_id` (bigint, FK→`jobs.job_id` ON DELETE CASCADE), `seq` (int, CHECK >0, **UNIQUE(job_id, seq)**), `label` (text), `start_date`/`end_date` (date), `created_at`, `updated_at` (trigger). RLS enabled — 4 authenticated policies scoping via `jobs.call_log_id → call_log.tenant_id`. GRANTs present. `pull_tickets.job_mobilization_id` already FKs to it. **Nothing anywhere writes it** — the migration header says seeding is "app-side (send-to-schedule, sales-command) — NOT authored here," and it never was. **⇒ Phase F needs NO migration.**

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
- **D3 — "Go-back" is not a data-model concept.** It's simply *a new mobilization added post-send + new days tagged to it.* No flag. Billing treatment of a go-back (no-charge vs new billable) stays in the existing billing layer — out of scope here. *Recommend: yes.* (Connects to the standing "Go Backs" item: this is the scheduling mechanism that unblocks re-scheduling invoiced work.)
- **D4 — Backfill existing live jobs** from `proposals.mobilizations` by seq (recover label/dates), so there's no permanent dual-source read. *Recommend: yes.*
- **D5 — Seed at send is app-side** (`commitSendToSchedule`), idempotent on re-send via `onConflict(job_id, seq)` — same pattern as the existing `job_wtcs` upsert. *Recommend: yes* (matches the migration header's stated intent; a DB trigger can't easily reach the proposal's mob list).

---

## 4. Build sequence (least-reversible first; each gated + smoked)

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
- **F2a — Editable mobilizations.** Turn `MobsModal` from read-only into an editor (reuse the exact display/edit pattern shipped in Sales 2026-08-25: settled summary rows + Edit/Delete + Save, add = new `job_mobilizations` row `seq = max+1`). Delete does an **in-use scan** across the job's `job_wtcs.field_sow` days (block/warn if the seq is tagged) — same guard as Sales' `deleteMob`.
- **F2b — Per-day mobilization picker in `FieldSowBuilder`.** Add a Mobilization `<select>` on each day row (the field already round-trips via passthrough — just surface it), options = this job's `job_mobilizations`. Tagging sets `day.mobilization_seq`. Adding a **go-back** = existing `+ Add Day` → pick the new mob. Persists through `updateJobWtcFieldSow` (already audit-logged).
- **Policy note to surface:** this deliberately widens Schedule's remit — `updateJobWtcFieldSow`'s comment says "moves the calendar, never scope." Adding go-back days/trips **is** new scope. That's intended for post-send go-backs; call it out so it's a decision, not a silent drift. [DESIGN-OPEN — confirm the scope-widening is acceptable, or gate go-back day-adds behind an explicit "Add go-back" action rather than the plain +Add Day]
- **Smoke:** on a live invoiced job, add a "Mob 2 — warranty return," add 2 go-back days tagged to it, save → job_mobilizations + field_sow updated, **proposal untouched, no pull-back, no invoice guard tripped**; MOBS card shows Mob 2.

### UI / layout
- Entry: the existing **MOBS card** on the job card (and/or JobDetail) opens the now-editable MobsModal. Day-level tagging lives where days are already edited (CardSowModal → FieldSowBuilder). No new top-level screen.
- Visual: reuse Sales' Step-1 editor pattern for consistency across the suite; Schedule tokens (`T`, Command Green accents) not Sales `C`.

---

## 5. Risks

- **Re-send idempotency** — must not duplicate `job_mobilizations` (onConflict guard).
- **Backfill correctness** — seq→label mapping via the proposal join; some seqs may have no proposal match (blank label) — acceptable, verify counts.
- **Read repoint grace** — jobs not yet backfilled must still render (fallback to `proposals.mobilizations`, or run backfill before removing fallback).
- **Delete-without-scan** — deleting a mob still tagged on days orphans them and would block a re-schedule; require the in-use scan (mirror Sales).
- **Scope-widening** (D3/F2b policy note) — Schedule gaining "add scope" post-send is a real product decision, not just code.
- **No shared-DB migration** — so the rehearse-before-push landmine does **not** apply here (nice). Backfill is data-only; still verify on a couple of jobs first.

---

## 6. Explicitly OUT of scope

- Billing treatment of go-back work (no-charge vs billable) — stays in the existing billing layer; this plan only schedules the trip.
- Field crew-screen mobilization labels/grouping — that's Phase E (Field currently ignores mobilization entirely, by design).
- Any change to the join key or the day jsonb shape.

---

## 7. Spine corrections this plan surfaces (update MASTER_SCHEDULE.md)

- **Phase F:** drop "needs migration" — `job_mobilizations` already exists; F1 is app-side seed + backfill.
- **Phase C:** the mobilization display is **built read-only**, not a "Coming soon" stub — reclassify.
