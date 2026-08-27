# Pull-Back → Re-Send Teardown — the empty-SOW lifecycle bug

**Status:** PLAN — **BUILD-READY** (round-2 audit 2026-08-26: 0H/0M, 5 Low plan-text folds applied;
no round 3). **Not built.** Plan-first because it crosses the Sales→Schedule→Field boundary and
touches shared prod data.
**Branch:** `fix/pullback-resend-teardown` (sch-command — plan home).
**Backlog:** PB-1 (sch-command `docs/BACKLOG.md`).
**Spine:** `command-suite-db/docs/MASTER_SCHEDULE.md` (SOW carrier = `job_wtcs.field_sow`).
**No migration** — the whole fix is app-level (see §4).

---

## §0 Reproduction

**Type:** bug. Premise **run-verified** against live prod (project `pbgvgjjuhnpsumnowuym`, 2026-08-26) — not assumed.

**Trigger (third-party reproducible):**
1. In Sales, send an approved proposal with ≥1 WTC to Schedule → inserts a `jobs` row + one `job_wtcs` per WTC.
2. In Schedule, **Delete** that job (`queries.js:1145 deleteJob` → soft delete, `deleted='Yes'`).
3. In Sales, re-send the proposal (optionally pull back + edit first — the tombstone does **not** block re-send; the send guard only checks for a `deleted='No'` job).
4. Query the new live job's `job_wtcs`.

**Observed pre-fix state (concrete, queried live 2026-08-26):**
- Reference job `call_log 3855` carries **three** `jobs` rows from repeated delete+resend — job **96** (deleted 21:04, 1 `job_wtcs`, hand-patched by a prior session), job **97** (deleted 21:29, **0** `job_wtcs`), job **98** (`deleted='No'` — LIVE, **0** `job_wtcs`). The job Field reads (98) has **no SOW at all**.
- Population query — live jobs (`deleted='No'`) whose source proposal has ≥1 `proposal_wtc` but the job has **0** `job_wtcs`: **6 rows** (job_ids 86, 87, 88, 89, 90, 98). **But only job 98 is caused by this bug** — a per-job holder analysis shows `slots_held_by_tombstone=1` for 98 and **`=0` for 86–90** (no tombstone holds their slots; they're empty for an unrelated reason and heal on a plain re-send). Names are **not** uniformly TEST (88 = "Field Sow to Field Command to PRT report", 89 = "Exterior Deck Waterproofing").

**Gate-variable evidence (the §2 root cause, verified — not inferred):**
- `job_wtcs.proposal_wtc_id` carries a **global UNIQUE index** `idx_job_wtcs_proposal_wtc_uniq` (`CREATE UNIQUE INDEX … ON public.job_wtcs (proposal_wtc_id)`) — **not** scoped to `job_id` or `deleted`. So the soft-deleted tombstone (job 96) permanently holds proposal_wtc `ae79beb7`'s only slot.
- Re-send upserts with `{ onConflict:"proposal_wtc_id", ignoreDuplicates:true }` (`sales-command/src/components/ProposalDetail.jsx:791`) → the held slot is **skipped, zero rows written, no error**.
- The "empty job is unusable" rollback (`ProposalDetail.jsx:792-817`) branches on `wtcErr` only; `ignoreDuplicates` returns success, so the guard never fires and the empty job is marked sent.

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
2. **Schedule "Delete" is a SOFT delete** — `deleteJob` (`sch-command/src/lib/queries.js:1145`,
   sets `deleted='Yes'` at `:1149`; restore = `Jobs.jsx:387 restoreJob`). It does **not** remove
   the job's `job_wtcs` rows. So the tombstoned job keeps *holding* that unique slot.
3. **Re-send skips the held slot, silently.** The send commit inserts a fresh `jobs` row
   (re-send is only blocked while a `deleted='No'` job exists — a tombstone doesn't block),
   then upserts `job_wtcs` with `{ onConflict: "proposal_wtc_id", ignoreDuplicates: true }`
   (`sales-command/src/components/ProposalDetail.jsx:789-791`). The slot is still owned by
   the tombstone → **the row is skipped → the new job gets zero WTCs.**

And the safety net misses it: the "job with zero job_wtcs is unusable" rollback
(`ProposalDetail.jsx:792-817`) fires only on `wtcErr` — an actual DB error.
`ignoreDuplicates` returns **success with zero rows written**, so the guard never trips.
The proposal is marked sent; the empty job goes live.

**Blast radius (2026-08-26, corrected in round-1 audit response):** exactly **one** live job is
empty *from this bug* — job **98** (its only slot is held by tombstone 96;
`slots_held_by_tombstone=1`). Five other empty live jobs (86, 87, 88, 89, 90) have **no tombstone
holder** (`=0`) — empty for an unrelated reason (pre-vertical / other test flows) and they
**self-heal on a plain re-send**, so they are out of scope for the fix mechanism. Names are
**not** uniformly TEST (88 = "Field Sow to Field Command to PRT report", 89 = "Exterior Deck
Waterproofing" — **hand-verify these two before any cleanup**). Real-world damage today ≈ zero,
but the bug is fully repeatable and will bite the first real pull-back-and-fix.

## 3. Why "who owns post-send edits" is the WRONG framing

The original brief posed this as a propagation-model / ownership design question (should
Sales edits flow to the job; should Schedule pull; etc.). **It is not.** The shared-data
contract already settled ownership: the job copy is the live source post-Send; Sales
freezes at Send; Schedule is the sole post-Send editor. The user here did nothing against
that model — they deleted and re-sent a corrected set, which is the intended repair path.
The disease is purely that **the delete→re-send cycle orphans the old SOW and the re-send
refuses to overwrite it.** A lifecycle bug, not an ownership decision.

## 4. The fix — two parts (round-1 audit response, ratified 2026-08-26)

Round-1 audit **cut the former §4.3** (pull-back hard-teardown) from this loop — its premise
was false and it was hygiene, not correctness (see §4.3 below). What remains, **§4.1 + §4.2,
delivers the correctness fix.**

### 4.1 Load-bearing — free the slot at the re-send choke point (correctness)

The single point *every* re-send passes through is the send commit. Before writing `job_wtcs`,
delete this proposal's **tombstone-held** `job_wtcs` rows, then insert fresh.

- **Why here, not at pull-back:** re-send does **not** require a pull-back. The send guard only
  blocks while a `deleted='No'` job exists, so a user can soft-delete in Schedule and re-send
  *without* pulling back (§0 confirms). The send commit is the one choke point both paths share.
- **Why delete-then-insert, not just drop `ignoreDuplicates`:** the held rows point at the
  **old** `job_id`. A plain overwrite-upsert would update rows still owned by the tombstone, not
  attach fresh rows to the new job. We must remove the tombstone's rows so the new job gets its own.
- **Scope the delete EXACTLY — both predicates mandatory (data-loss guard, audit #4):**
  ```
  DELETE FROM job_wtcs
  WHERE proposal_wtc_id IN (SELECT id FROM proposal_wtc WHERE proposal_id = <this proposal>)
    AND job_id          IN (SELECT job_id FROM jobs
                             WHERE source_proposal_id = <this proposal> AND deleted = 'Yes');
  ```
  Via the client: fetch this proposal's `proposal_wtc` ids **and** its tombstone (`deleted='Yes'`)
  job_ids, then `.delete().in('proposal_wtc_id', pwIds).in('job_id', tombstoneJobIds)`.
- **What each predicate actually protects (round-2 #4 — do not mislabel):** cross-proposal /
  sibling / CO isolation comes from **`proposal_wtc`'s 1:1 ownership** (each `proposal_wtc` belongs
  to exactly one proposal; verified — 0 cross-proposal `job_wtcs`), so the `proposal_wtc_id ∈ this
  proposal` predicate already prevents ever touching another proposal's rows. The `job_id ∈
  deleted='Yes' jobs` predicate does a **narrower** job: it stops the delete from stripping the slot
  off **this same proposal's own LIVE re-sent job**. **Never** scope the delete by `call_log_id` —
  siblings / CO jobs share a call_log, so a call_log-scoped delete would reach a live sibling's rows.
- **Both predicates are mandatory; never conditionally drop one (round-2 #2):** `.in(col, [])` is a
  safe no-op (supabase-js emits `col=in.()`, matches nothing) — so an empty `pwIds`/`tombstoneJobIds`
  needs no special-casing, **but** a builder must NOT "defend" an empty list by dropping the `job_id`
  predicate (that degrades to a `proposal_wtc_id`-only delete that can reach a live-held slot). If
  either list is empty, **skip the delete entirely**; otherwise keep BOTH `.in()`s.
- **Self-check after the delete — ordering + rollback (round-2 #1, the one with real consequence):**
  the `jobs` row is inserted **first** (`ProposalDetail.jsx:752`, needed for `newJobId` in
  `jobWtcRows`), so the delete + self-check necessarily run **after** the jobs insert but **before**
  the `job_wtcs` upsert. "Abort before insert" therefore means **before the `job_wtcs` upsert.**
  Re-query for any remaining tombstone-held slot among this proposal's `pwIds` (RLS delete can
  silently no-op — CLAUDE.md); if any slot is still tombstone-held, **roll back the just-inserted
  `jobs` row** (reuse the `:800-814` block), **`return` before the `:865` call_log Parked write**,
  and alert — the **same rollback discipline as §4.2**, else you strand exactly the empty-job +
  Parked-call_log state this fix exists to kill. This self-check is a **hard precondition** for §4.2
  (see §4.2's live-held bullet).
- **Non-atomicity is benign:** between the delete and the insert there is a window, but the delete
  only removes rows of an **already-dead tombstone**; nothing live is at risk, and an insert
  failure is caught by §4.2's rollback.
- File: `sales-command/src/components/ProposalDetail.jsx`, the send-commit path (the `jobWtcRows`
  upsert at ~789).

### 4.2 Safety net — make the short-write loud (MIG-1 discipline)

The send commit must treat "a proposal with WTCs produced **fewer** `job_wtcs` rows than it has
WTCs" as a **hard failure**.

- **Count check (audit #3) — `.select()` must be ADDED (round-2 #3):** the live upsert
  (`ProposalDetail.jsx:789-791`) destructures only `{ error: wtcErr }` — there is **no `.select()`
  today.** Add `.select('proposal_wtc_id')` and capture the result as `written`, then assert
  `written.length === jobWtcRows.length`. Adding `.select()` is behavior-neutral (the return was
  discarded), and the count is sound under `ignoreDuplicates` (`ON CONFLICT DO NOTHING RETURNING`
  omits skipped rows). Else roll back the just-inserted `jobs` row (reuse `ProposalDetail.jsx:800-814`),
  alert, and leave the proposal **NOT-sent**.
- **Placement + ordering:** the guard lives co-located with the existing `wtcErr` branch,
  **inside** the `if (newJobId)` block (before `:861`) and must `return` — so the
  `call_log.stage = "Parked"` write at `:865` is **skipped** on rollback (else a Parked call_log
  is stranded with no job).
- **Scope the guard to `job_wtcs` ONLY.** `job_mobilizations` and materials are deliberately
  **outside** it — backfillable, and the existing code already treats the mob seed as non-fatal
  (`:853-857`). Only the unrecoverable `job_wtcs` write gates the send.
- **Drop the earlier "the guard also catches the RLS-no-op delete" claim** — that is §4.1's
  self-check's job. The guard is a second, independent net, not the teardown's verifier.
- **Live-held-slot case — the alert is UNCONDITIONAL (audit #5 + round-2 #1 corollary):** because
  §4.1's self-check is a hard precondition that already aborts on **any** tombstone-held slot before
  we reach here, any short-write that reaches §4.2 is **by construction live-held** (a `deleted='No'`
  job holds the slot, so §4.1's delete correctly left it). So §4.2 does **not** need to disambiguate
  per slot — it rolls back and emits the live-held alert unconditionally: *"Another live job already
  holds these work types — resolve that job before re-sending."* Never silently ship the partial.

### 4.3 — CUT this loop (deferred → PB-2)

The former §4.3 (pull-back hard-teardown of schedule tombstones) is **removed from this loop.**
Two reasons: (1) its stated premise — *"no FK references `jobs`"* — is **false.** Round-1 audit +
re-verification found **9 FKs** referencing `jobs`: `job_wtcs`, `billing_worklist`, `job_assets`,
`job_material_lines`, `job_material_signoff`, `job_mobilizations`, `pull_tickets` all **CASCADE**,
while `assignments` and `billing_log` are **NO ACTION** (a hard `jobs` delete FK-throws if either
child exists). A hard-teardown is therefore a real cascade / NO-ACTION design problem, not the
trivial "explicit child deletes" the cut section assumed. (2) It is self-described **hygiene** —
§4.1 already guarantees the next re-send is clean; teardown only stops tombstone-row accumulation,
which is cosmetic. **Deferred to PB-2** (own plan + audit); the former §9 Q1 (teardown depth) moves
there too.

## 5. One-time data cleanup (separate, low-risk)

Cleanup method = **re-send, not delete.**
- **Job 98** (the one bug instance) needs the §4.1 path: tombstone 96's `job_wtcs` slot is
  released, then re-send from Sales (proves §4.1 end-to-end).
- **Jobs 86, 87, 88, 89, 90** have **no tombstone holder**, so a **plain re-send heals them** —
  no tombstone release needed.
- **Hand-verify 88 ("Field Sow…") and 89 ("Exterior Deck Waterproofing") with Chris before
  touching them** — they are not obviously disposable test data; confirm they're re-sendable first.

## 6. Shared-data-contract note

This resolves the practical edge of **open decision #6** (copy-vs-reference policy for
send-to-schedule) for the *re-send* case: the handoff stays a **snapshot at Send**, and a
re-send is a **clean rebuild** (tombstone released, fresh copy written) — not a merge into
a live job. Register this once built. No change to the steady-state SOW ownership (Schedule
sole post-Send editor) — this is only about the delete→re-send reset path.

## 7. Scope / repos / files

| Repo | Change | File |
|---|---|---|
| sales-command | §4.1 slot-free-then-insert + post-delete self-check on the send commit | `src/components/ProposalDetail.jsx` (send commit ~L789) |
| sales-command | §4.2 count-based short-write rollback guard (co-located with the `wtcErr` branch; returns before the `:865` call_log write) | `src/components/ProposalDetail.jsx:792-817` |
| — | one-time re-send of the 6 empty jobs (98 needs tombstone release first; 86–90 plain re-send) | manual re-send |

**No migration. No edge function. No RLS change.** All PostgREST writes from the app.
Former §4.3 pull-back teardown **deferred → PB-2** (separate plan). Correct code refs: soft-delete
= `sch-command/src/lib/queries.js:1145 deleteJob`; restore = `sch-command/src/views/Jobs.jsx:387 restoreJob`.
**Build note (round-2 #3):** the existing `job_wtcs` upsert at `:789-791` has no `.select()` — the
§4.2 count guard requires adding `.select('proposal_wtc_id')` and capturing the rows as `written`.

## 8. Verify / smoke plan (before merge)

1. **Reproduce first** (§0 discipline): on a throwaway proposal, send → soft-delete in
   Schedule → re-send → confirm the NEW job has zero `job_wtcs` (bug present).
2. Apply §4.1 + §4.2, repeat: NEW job has full `job_wtcs` incl. materials; Field reads them.
3. **Both paths:** (a) delete → pull back → edit → re-send; (b) delete → re-send with **no**
   pull-back. Both must yield a populated job.
4. **Scoping proof (data-loss guard):** a live sibling / CO job sharing the call_log, and a
   *different* proposal's tombstone, are both untouched by the §4.1 delete.
5. **Self-check fires:** simulate an RLS-no-op delete (leave the tombstone slot held) → send
   **aborts before insert**, no partial job created, alert shown.
6. **Count guard fires:** force a short write **using a LIVE-held slot** (round-2 #5 — a
   tombstone-held slot is caught earlier by §4.1's self-check, so a live holder is the only way to
   reach §4.2; this proves the two nets are distinct) → send rolls back the jobs row, proposal
   NOT-sent, call_log stage NOT left at Parked.
7. **Unaffected:** plain soft-delete → un-delete (`restoreJob`) → SOW intact (the fix never
   touches the restore path).
8. Run the §5 re-sends; re-query the §2/§0 "empty live job" set → returns 0.

## 9. Open questions to lock before build

1. **Cleanup confirmation** — Chris confirms 88/89 are disposable / re-sendable before the §5
   cleanup runs.
2. **Backlog home** — canonical row is PB-1 in sch-command; mirror a pointer into sales-command
   `docs/BACKLOG.md` since the code lives there.

**Resolved by round-1 audit (no longer open):** teardown depth (moved to PB-2); FK/cascade
reality (9 FKs — see §4.3); non-atomicity + guard-ordering (§4.1/§4.2 above).

---

## Backlog row (PB-1)

> **PB-1 · T2 · Open (round-1 audit response ratified 2026-08-26; not built)** — Pull-back →
> re-send silently produces an empty-SOW job. **Cross-repo (sales-command code; sch-command
> plan/home).** Schedule's soft-delete (`queries.js:1145 deleteJob`) leaves `job_wtcs` holding the
> globally-unique `proposal_wtc_id`; the re-send upsert (`ignoreDuplicates`, `ProposalDetail.jsx:791`)
> skips the held slot → new job gets zero WTCs, and the rollback guard catches only DB errors, not
> silent zero-row skips → empty job goes live, Field reads nothing. **Verified in prod:** call_log
> 3855 (jobs 96/97/98); **exactly one** live job affected by this bug (98, tombstone-held); five
> other empty live jobs (86–90) are unrelated (no holder; heal on plain re-send). **Fix (plan
> `docs/plans/pullback_resend_teardown.md`, 2 parts):** (1) at the send choke point, delete this
> proposal's **tombstone-held** `job_wtcs` (scoped to `proposal_wtc_id ∈ proposal` AND `job_id ∈
> deleted='Yes' jobs`; never by call_log_id) + a post-delete self-check that aborts on a silent RLS
> no-op; (2) count-based rollback guard (`written.length === WTC` else roll back the jobs row, leave
> proposal NOT-sent, before the call_log Parked write). No migration. Cleanup = re-send. **The former
> pull-back hard-teardown was CUT → PB-2** (false "no-FK" premise — 9 FKs, mixed CASCADE/NO-ACTION;
> hygiene only). Not built.

---

## Audit manifest

_Generated by `/auditcriteria` (round 1) 2026-08-26; **bumped to round 2** after the round-1 revision pass. Consumed by `/runaudit`._

### Bottom line (plain English)
Now a two-part, single-file fix (the teardown was cut to its own item, PB-2). The whole risk lives in one spot: does the slot-free delete hit *only* dead rows and never a live job's work. Two reviewers — one on that delete + its self-check, one on the roll-back-when-short-written alarm and its ordering in the send flow.

### Round
- Plan type: bug
- Current round: 2
- Plan revision under audit: the `Plan revision pass 1` commit that carries this manifest (see `git log`)
- Findings trend: round 1 (2H/3M caused-by + 1 scope-cut + 3 adjacent) → round 2 (?) — the surface **shrank** (3-part → 2-part), so a plateau here would be a real signal, not scope creep

### Prior rounds
- Round 1: `75baf90` (manifest `bf0b41b`) · **2H/3M caused-by + 1 scope-cut (§4.3 cluster) + 3 adjacent** · pattern: `false-FK-premise / teardown-over-reach`

**Briefing for agents**: do NOT re-find round-1 issues — they are addressed in the revision pass (§4.1 explicit scoping + self-check; §4.2 count-guard + ordering + live-held case; §4.3 CUT → PB-2; §2/§5 blast-radius corrected; code refs fixed). Attack ONLY the **revised §4.1/§4.2**. The teardown is out of scope this loop (PB-2).

### Deployment context
- **Live tenants**: 1 — HDSP only (multi-tenant onboarding blocked; SEC-2/SEC-6).
- **Prod / staging / dev**: the affected surface is **live in prod** for the one tenant — Sales send-to-Schedule (`scmybiz.com`). Not flag-gated.
- **Blocking feature flags**: none gate this path.
- **Concurrency profile**: solo / ≤5 office users. Two-sends-racing findings cap at Low.

Cross-tenant findings cap at Med while `live_tenants == 1`. **But within-tenant data-loss (a mis-scoped §4.1 delete) is NOT capped by single-tenancy — weight it full.**

### Time budget + finding cap
- **Time budget**: 60 min (Chris's ERD lock, confirmed)
- **Finding cap**: 6 findings

### Surface
- Total lines: ~206
- Sections: 11 (§0–§9 + backlog row)
- [LOCKED] decisions: 2 (§4.1 slot-free-then-insert + self-check; §4.2 count-based rollback guard)
- [DESIGN-OPEN] items: 0
- [OPEN] items: 2 (§9)
- Plan-to-code ratio: ~206 : ~40 ≈ 5:1 (not flagged)

### Layers touched
- Data layer (the `job_wtcs` send-write + tombstone-slot delete)
- State model (job lifecycle: soft-delete tombstones holding the unique `proposal_wtc_id` slot; re-send rebuild)
- (Cross-repo reach is code-location only — the fix is entirely in sales-command `ProposalDetail.jsx`; no schema contract change)

### New mechanisms introduced
- New columns / tables / triggers / RLS: none
- New logic paths (modifications to one existing handler): (1) scoped delete of tombstone-held `job_wtcs` + post-delete self-check; (2) count-based short-write rollback branch, co-located with the existing `wtcErr` guard

### Cross-system reach
- sales-command (`src/components/ProposalDetail.jsx` — send commit ~L789) — the only code changed
- Shared Supabase DB `pbgvgjjuhnpsumnowuym` (no service-role / bypass path)
(Former sch-command `JobCardList` copy tweak dropped; former `handlePullBack` teardown → PB-2)

### Irreversibility
none — no migration, no backfill. Cleanup = re-sends (§5); hand-verify jobs 88/89 first.

### Known weak points
- **§4.1 delete scoping (data-loss, highest-consequence)** — both predicates (`proposal_wtc_id ∈ proposal` AND `job_id ∈ deleted='Yes' jobs`) must be enforced together; verify the client `.in().in()` compiles to an AND (not two independent filters), and that a CO/sibling job sharing the call_log can't be reached.
- **§4.1 self-check completeness** — does the post-delete re-query actually detect an RLS silent no-op and abort *before* the insert? Any path where a slot stays held but the send still proceeds?
- **§4.2 guard feasibility + ordering** — does `upsert(...).select()` return the written rows under `ignoreDuplicates` so `written.length` is meaningful? Is the guard truly before the `:865` call_log Parked write and does it `return`?
- **§4.2 live-held vs tombstone-held disambiguation** — the guard alerts differently for a live-held slot; can it tell the two apart at that point, or does it need the §4.1 self-check's result?

### Open questions
- Count: 2 (see §9) — both operational (cleanup confirmation, backlog home); neither blocks the build design.

### Suggested attack angles (2 total)
1. **§4.1 scoped-delete correctness + data-loss** — covers Data layer + State model. Required reading: `sales-command/src/components/ProposalDetail.jsx` (send commit ~L760-817), `sch-command/src/lib/queries.js:1145 deleteJob`. Pressure: prove the delete can reach ONLY this proposal's `deleted='Yes'` tombstone `job_wtcs` and never a live/sibling/CO job's rows; that `.in().in()` is a conjunction; that delete-then-insert attaches fresh rows to the NEW `job_id`; that the self-check aborts on an RLS no-op before any insert.
2. **§4.2 short-write guard + send-flow ordering** — covers the MIG-1 invisible-failure discipline + send-commit control flow. Required reading: `ProposalDetail.jsx:786-871` (upsert → `wtcErr` rollback → mob seed → call_log Parked write). Pressure: is `written.length === jobWtcRows.length` sound under `ignoreDuplicates`; is the guard co-located + `return`ing before `:865`; does the live-held-slot case roll back with the right alert; are mobs/materials correctly left outside the guard.

### Suggested agent count: 2

Rationale: the surface shrank to two tightly-related changes in one handler; the third round-1 angle (teardown blast-radius) left with §4.3 → PB-2. Two angles cover the two remaining failure modes without overlap; a third would re-tread the same ~30 lines.
