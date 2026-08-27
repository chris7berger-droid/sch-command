# Pull-Back → Re-Send Teardown — the empty-SOW lifecycle bug

**Status:** PLAN (design ratified with Chris 2026-08-26; **not built**). Plan-first
because it crosses the Sales→Schedule→Field boundary and touches shared prod data.
**Branch:** `fix/pullback-resend-teardown` (sch-command — plan home).
**Backlog:** PB-1 (sch-command `docs/BACKLOG.md`).
**Spine:** `command-suite-db/docs/MASTER_SCHEDULE.md` (SOW carrier = `job_wtcs.field_sow`).
**No migration** — the whole fix is app-level (see §4).

---

## 1. Real-world problem

A job is sent from Sales to Schedule. To correct it, the office does the *sanctioned*
thing: delete the job in Schedule (Sales won't let you pull back while a live schedule
exists), pull the proposal back, fix it, and re-send. **The re-send silently produces a
job with no SOW at all** — Field reads an empty plan and nothing signals that anything
is wrong. This is the invisible-failure class from MIG-1: dangerous *because* it's silent.

## 2. Verified root cause (traced in code + live prod data, 2026-08-26)

Live state for the reference job (call_log 3855):

| jobs row | deleted? | job_wtcs | materials | what it is |
|---|---|---|---|---|
| **96** | Yes (21:04) | 1 row | 5 | original send — *materials present only because a prior session hand-patched it* |
| **97** | Yes (21:29) | **0** | 0 | first re-send — got nothing |
| **98** | **No — LIVE** | **0** | **0** | current job Field reads — **empty SOW** |

Three facts line up to cause it:

1. **`job_wtcs.proposal_wtc_id` is globally UNIQUE** (the `onConflict` target). Each WTC
   can map to exactly one live job copy, ever.
2. **Schedule "Delete" is a SOFT delete** — `updateJobFields(jobId, {deleted:'Yes', deleted_at})`
   (`sch-command/src/components/JobCardList.jsx:89`). It does **not** remove the job's
   `job_wtcs` rows. So the tombstoned job keeps *holding* that unique slot.
3. **Re-send skips the held slot, silently.** The send commit inserts a fresh `jobs` row
   (re-send is only blocked while a `deleted='No'` job exists — a tombstone doesn't block),
   then upserts `job_wtcs` with `{ onConflict: "proposal_wtc_id", ignoreDuplicates: true }`
   (`sales-command/src/components/ProposalDetail.jsx:789-791`). The slot is still owned by
   the tombstone → **the row is skipped → the new job gets zero WTCs.**

And the safety net misses it: the "job with zero job_wtcs is unusable" rollback
(`ProposalDetail.jsx:792-817`) fires only on `wtcErr` — an actual DB error.
`ignoreDuplicates` returns **success with zero rows written**, so the guard never trips.
The proposal is marked sent; the empty job goes live.

**Blast radius (2026-08-26):** 6 live jobs currently sit empty this way (job_ids 86–90, 98)
— **all named TEST/Testing**, so real-world damage today ≈ zero. But it is fully repeatable
and will bite the first real pull-back-and-fix.

## 3. Why "who owns post-send edits" is the WRONG framing

The original brief posed this as a propagation-model / ownership design question (should
Sales edits flow to the job; should Schedule pull; etc.). **It is not.** The shared-data
contract already settled ownership: the job copy is the live source post-Send; Sales
freezes at Send; Schedule is the sole post-Send editor. The user here did nothing against
that model — they deleted and re-sent a corrected set, which is the intended repair path.
The disease is purely that **the delete→re-send cycle orphans the old SOW and the re-send
refuses to overwrite it.** A lifecycle bug, not an ownership decision.

## 4. The fix — three parts (ratified 2026-08-26)

It was never A-vs-B. The complete fix needs all three; they were debated as alternatives
but each covers a different gap.

### 4.1 Load-bearing — free the slot at the re-send choke point (correctness)

The single point *every* re-send passes through is the send commit. Before writing
`job_wtcs`, delete any existing `job_wtcs` rows for this proposal's `proposal_wtc_id`s
that belong to a **soft-deleted** job, then insert fresh.

- **Why here and not only at pull-back:** re-send does **not** require a pull-back. The
  send guard only blocks while a `deleted='No'` job exists, so a user can soft-delete in
  Schedule and re-send *without* pulling back. Teardown that lives only in pull-back leaves
  that path broken. The choke point covers both paths.
- **Why delete-then-insert, not just drop `ignoreDuplicates`:** the held rows point at the
  **old** `job_id`. A plain overwrite-upsert would update rows still owned by the tombstone,
  not attach fresh rows to the new job. We must remove the tombstone's rows so the new job
  gets its own.
- **Scope the delete tightly:** only `job_wtcs` rows whose `proposal_wtc_id ∈ this
  proposal's WTCs` AND whose `job_id` is a `deleted='Yes'` job for this proposal. Never
  touch a live job's rows.
- File: `sales-command/src/components/ProposalDetail.jsx`, the send-commit path (the
  `jobWtcRows` upsert at ~789).

### 4.2 Safety net — make the empty case loud (MIG-1 discipline)

Regardless of 4.1, the send commit must treat "a proposal with WTCs produced zero
`job_wtcs` rows" as a **hard failure**: roll back the just-inserted `jobs` row (reuse the
existing rollback block at `ProposalDetail.jsx:800-814`) and alert. Switch the guard from
*error-only* to *error-or-zero-rows-written* (the upsert `.select()` returns the written
rows; assert count == number of WTCs). This is belt-and-suspenders: even if some future
path recreates the orphan condition, it can never ship a silent empty job again.

### 4.3 Hygiene — teardown at pull-back (clean DB, Chris's "thorough" instinct)

Pull-back *is* "undo the send," so it should own cleaning up the schedule side. When
`handlePullBack` runs (`ProposalDetail.jsx:591`), instead of just *blocking* on a live job,
hard-remove the proposal's schedule tombstones: delete their `job_wtcs` (and derived
children — see below) and the `jobs` rows themselves, so we stop accumulating dead 96/97/98
rows. This is **hygiene, not correctness** — 4.1 already guarantees the next re-send is
clean; 4.3 keeps the DB from piling up tombstones.

- Keep this **distinct from a plain Schedule soft-delete**, which must stay restorable
  (`Jobs.jsx:342` un-delete). Only pull-back does the hard teardown.
- **Loose coupling helps:** no FK references `jobs` (verified), so there is no cascade to
  design and no FK to block — but also no cascade to rely on, so children must be deleted
  explicitly. Tables keyed to `jobs.job_id` for the dead job: `job_wtcs`, `job_material_lines`,
  `job_material_signoff`, `job_mobilizations`, `job_assets`, `pull_tickets`. Tables keyed
  to `call_log_id` (assignments/crew/billing_worklist/invoices) are **stable across
  re-send** and must be left alone. **Decide in build:** minimum viable teardown is
  `job_wtcs` only (frees the slot); the fuller child sweep is optional cleanup — weigh
  against `job_assets` (uploaded files may be worth preserving on the tombstone).
- After every delete, **verify it succeeded** — RLS delete can silently no-op
  (sales-command CLAUDE.md rule).

## 5. One-time data cleanup (separate, low-risk)

The 6 existing empty live jobs (86–90, 98) can't self-heal — their proposals' slots are
held by tombstones. Options, decide at build:
- Re-send each from Sales after this fix ships (proves 4.1 end-to-end), **or**
- A scripted heal: for each, delete the tombstones' `job_wtcs`, then re-run the send's
  `job_wtcs` build for the live job. All are test jobs, so deleting them outright is also
  acceptable.

## 6. Shared-data-contract note

This resolves the practical edge of **open decision #6** (copy-vs-reference policy for
send-to-schedule) for the *re-send* case: the handoff stays a **snapshot at Send**, and a
re-send is a **clean rebuild** (tombstone released, fresh copy written) — not a merge into
a live job. Register this once built. No change to the steady-state SOW ownership (Schedule
sole post-Send editor) — this is only about the delete→re-send reset path.

## 7. Scope / repos / files

| Repo | Change | File |
|---|---|---|
| sales-command | 4.1 slot-free-then-insert on send commit | `src/components/ProposalDetail.jsx` (~789) |
| sales-command | 4.2 zero-rows-written guard | `src/components/ProposalDetail.jsx:792-817` |
| sales-command | 4.3 pull-back teardown | `src/components/ProposalDetail.jsx:591` (`handlePullBack`) |
| sch-command | (optional) copy tweak on Delete: label it "delete & free for re-send" so the two-step flow is legible | `src/components/JobCardList.jsx:89` |
| — | one-time cleanup of 6 empty jobs | script / manual re-send |

**No migration. No edge function. No RLS change.** All PostgREST writes from the app.

## 8. Verify / smoke plan (before merge)

1. **Reproduce first** (§0 discipline): on a throwaway proposal, send → soft-delete in
   Schedule → re-send → confirm the NEW job has zero `job_wtcs` (bug present).
2. Apply 4.1 + 4.2, repeat: NEW job has full `job_wtcs` incl. materials; Field reads them.
3. **Both paths:** (a) delete → pull back → edit → re-send; (b) delete → re-send with **no**
   pull-back. Both must yield a populated job.
4. **Guard fires:** force a zero-write (e.g. temporarily point at a bad slot) → send rolls
   back the jobs row + alerts, proposal NOT marked sent.
5. **Undelete still works:** plain soft-delete → un-delete → SOW intact (4.3 didn't touch it).
6. **Pull-back teardown:** after pull-back, the proposal's tombstone `jobs`/`job_wtcs` are
   gone; a live job for a *different* proposal is untouched.
7. Run the §5 cleanup; re-query the §2 "empty live job" set → returns 0.

## 9. Open questions to lock before build

1. **Teardown depth in 4.3** — `job_wtcs`-only vs. full child sweep. Recommend `job_wtcs` +
   `job_material_lines` + `job_mobilizations` (all pure-derived); **preserve `job_assets`**
   (real uploads) unless Chris says otherwise.
2. **Cleanup method for the 6** — re-send vs. script vs. delete-as-test-data.
3. **Backlog home** — canonical row is PB-1 in sch-command; mirror a pointer into
   sales-command `docs/BACKLOG.md` since the code lives there.

---

## Backlog row (PB-1)

> **PB-1 · T2 · Open** — Pull-back → re-send silently produces an empty-SOW job.
> **Cross-repo (sales-command code; sch-command plan/home).** Schedule's soft-delete leaves
> `job_wtcs` holding the globally-unique `proposal_wtc_id`; the re-send upsert
> (`ignoreDuplicates`) skips the held slot → new job gets zero WTCs, and the rollback guard
> only catches DB errors, not silent zero-row skips → empty job goes live, Field reads
> nothing. Verified in prod (call_log 3855: jobs 96/97/98; 6 empty live jobs total, all TEST).
> **Fix (plan `docs/plans/pullback_resend_teardown.md`):** (1) free the slot at the re-send
> choke point — delete tombstones' `job_wtcs` for this proposal, then insert fresh; (2) guard
> = roll back on zero-rows-written, not just error; (3) pull-back hard-teardown of schedule
> tombstones (hygiene). No migration. One-time cleanup of the 6. **Plan-first, ratified
> 2026-08-26; not built.**
