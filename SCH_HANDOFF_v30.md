# SCH_HANDOFF_v30 — Deposit tag reads the job's deposit INVOICES (multi-deposit fix)

**Repo:** sch-command · **Branch:** `main` (`452ef78`) · **Date:** 2026-07-31
**Production:** https://schedulecommand.com — LIVE.
**Cross-repo:** driven by `sales-command` (invoicing fix) + `command-suite-db` (migration).
Full narrative lives in `sales-command/docs/handoffs/SC_Handoff_v172.txt`; the DB/gate story is in
`command-suite-db/docs/handoffs/CSDB_Handoff_v6.txt`. This handoff points, it doesn't duplicate.

> **Numbering note:** v29 is taken by the in-flight DMS-1 Phase 3 build on `feat/dms1-phase3`
> (committed there, not on main). This session skipped to v30 rather than collide with it.

---

## 1. Session summary

Sales Command could only mark ONE deposit invoice per job, which broke on job 7215 (multiple WTCs, a
material deposit each). The flag moved from the job (`call_log.deposit_invoice_id`) onto the invoice
(`invoices.is_deposit`, migration `20260731120000`). Schedule's deposit indicator consumed that
pointer, so it was rewritten to derive from the job's deposit invoices instead. The job-level
`deposit_required` / `deposit_amount` fields are retired — Chris never used them (they meant manual
math kept in sync by hand), so the invoices now tell the whole story.

Schedule's changes are small and read-only against Sales-owned data. `StageJobCard` was touched only
for the tooltip; its `{status, amount, daysSince, dueDate}` contract is unchanged.

## 2. Changes shipped

`fbe1943` **Deposit tag reads the job's deposit INVOICES, not a one-per-job pointer**
- `queries.js` `CALL_LOG_SELECT` + `normalizeJob`: dropped the retired trio (`deposit_required`,
  `deposit_amount`, `deposit_invoice_id`). `_deposit` still attached by `loadJobs`.
- `depositState(job, depositsByJob)` rewritten to take a LIST per job:
  `required` = any deposit invoice still unsent · `sent` = all sent, some unpaid (age off the OLDEST
  send, show the EARLIEST unpaid due date) · `paid` = all paid. Tag hidden when the job has no deposit
  invoices at all (was: no `deposit_required` flag).
- `attachDepositState` looks up by `call_log_id` with `.eq('is_deposit', true)`, active-filtered —
  covered by the migration's partial index `invoices_is_deposit_call_log_idx`.

`43be7b1` **T4 gate fix: surface deposit-load failures instead of swallowing them**
- The loader destructured only `{ data }`, so a failed query and "this job has no deposits" both
  rendered as no tag. Deployed before the migration landed, the indicator would have silently never
  appeared. Now `console.warn`s; still best-effort, so the job list always renders.

`3b03a3b` **Deposit tag shows what's STILL OWED, not the job's deposit size**
- `amount` = sum of the UNPAID deposits while anything is unpaid, flipping to the full total once all
  are paid. `amountTotal` always carries the sum.
- `StageJobCard` tooltip names which figure it is — "Deposit outstanding $6,000 of $10,000" /
  "Deposit paid — $10,000". A bare dollar figure beside a yellow tag read as the whole deposit.

## 3. Deployed

- `main` `452ef78` → schedulecommand.com. No migration authored here (it lives in `command-suite-db`
  and was applied from there), no edge fn, no config.
- Deploy order mattered: the migration went FIRST. This app's new code queries `is_deposit`; without
  the column the query errors and (before `43be7b1`) would have failed silently.

## 4. Decisions

- **Tag semantics = outstanding, not total.** Judgment call ratified with Chris after the T4 review
  raised it. A $10k tag on a job with $4k collected answers the wrong question; the tag's job is
  scheduling readiness. Colors unchanged — it stays yellow until the last deposit is paid, so a job
  can't read as paid-up while a deposit check is missing.
- **Retired columns not dropped.** This repo's own deployed main was still selecting them at migration
  time, as is the in-flight `feat/dms1-phase3` branch. Dropping them would have broken the job board
  and that paused build. Tracked as sales-command B51, blocked until both apps are live.

## 5. Verification

- Build passes.
- Migration verified against prod from `command-suite-db` (5 existing deposits carried over, index
  present, anon column grant correct).
- Cross-branch safety checked TWICE — once before writing code, once after — including a real
  `git merge-tree` trial merge against `origin/feat/dms1-phase3`: clean, no conflicts. Their edits to
  `queries.js` sit at lines 1–82 and 636+; this session's are 105–232.
- **NOT verified by eye: the deposit tag itself on the Schedule board.** Code-only confidence.
  Expected for job 7215 right now: red "Due", **$20,607** outstanding (10140 $7,350 sent + 10141
  $13,257 unsent). If it shows anything else, that's the first thing to chase.

## 6. Not touched this session

- **DMS-1 Phase 3** (`feat/dms1-phase3`, paused mid-Step-3 on the other machine) — deliberately left
  alone. Nothing merged into it; its handoff v29 stands.
- `docs/BACKLOG.md` here — the new items (B66, B67) were filed in sales-command, where the deposit
  feature lives.

## 7. Next session pointers

1. Look at the 7215 deposit tag on the board — the one unverified surface.
2. If resuming DMS-1 Phase 3: `git pull` main into `feat/dms1-phase3` first. Main moved (`452ef78`),
   and that branch still carries the retired deposit columns in its copy of `queries.js`. They still
   exist in the DB, so it will keep working — but the merge should happen before B51 drops them.

## 8. Files to probably know about next session

- `src/lib/queries.js` — `depositState` (list-based, outstanding-vs-total) + `attachDepositState`.
- `src/components/StageJobCard.jsx` — deposit tag render + tooltip wording.

## 9. Git state on close

- Branch `main` @ `452ef78`, pushed. Merge commit of `fix/multi-deposit-invoices` (`--no-ff`).
- `fix/multi-deposit-invoices` exists local + remote, fully merged — deletion offered at close.
- Untouched: `feat/dms1-phase3` (local + remote), the other machine's stream.
- Sibling repos: sales-command `main` `242f5ef`, command-suite-db `main` `09b55d9`.

## 10. End state

Merged, deployed, migration live. Board tag unverified by eye. Ready for a fresh session.
