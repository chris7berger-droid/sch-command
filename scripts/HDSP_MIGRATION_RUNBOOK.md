# HDSP one-time schedule migration — runbook

The step-by-step for moving the old "YES Schedule v2" sheet into the live
Schedule Command **once**. Plan: `docs/plans/schedule_data_migration.md` (read §6
alongside this). Shared DB `pbgvgjjuhnpsumnowuym`. HDSP tenant_id
`246f6551-60de-4965-bb97-9a52971bc05d`.

**Golden rules**
- The shipped Import feature only ever *adds*. The one destructive step (the
  wipe) lives ONLY in the generated SQL below, and only runs deliberately.
- **Rehearse the wipe+load on a prod-shaped copy before prod (§6.7). Never run
  the generated SQL against prod until the rehearsal passes.**
- The generated SQL is ONE transaction — if anything fails it rolls back whole.

---

## Step 1 — Fresh export

Export every tab of the live "YES Schedule v2" sheet to CSV and drop them at the
sch-command repo root, replacing the stale April files (exact names matter):

- `YES Schedule v2 - Jobs.csv`
- `YES Schedule v2 - Assignments.csv`
- `YES Schedule v2 - BillingLog.csv`
- `YES Schedule v2 - CrewStatus.csv`

Re-check the row counts against §2 before continuing (`node
src/lib/yesv2Import.verify.mjs` prints per-tab counts and re-validates headers).

## Step 2 — Match in the app

Open Schedule Command → **Import** (as an HDSP user). Upload the four CSVs;
confirm each shows "columns OK". Match every old job to a real record, or mark it
**Internal**. The match auto-saves as a draft (survives refresh). You're done
when the tally reads **0 unmatched** and there are **no duplicate targets**.

> For the one-time HDSP load we do NOT press "Apply" in the app (Apply is the
> additive path for future/empty tenants). HDSP has test data to clear first, so
> we use the atomic wipe+load SQL below instead.

## Step 3 — Export the confirmed draft

Save the confirmed match as `hdsp_draft.json`. Its shape:

```json
{ "decisions": { "<oldJobID>": <call_log.id>, "<oldJobID>": "internal", ... } }
```

That is exactly the `state.decisions` object stored in the `migration_match_draft`
row. Pull it with:

```sql
select state->'decisions' from public.migration_match_draft
where migration_key = 'yesv2_hdsp';
```

Wrap it as `{ "decisions": <that object> }` in `hdsp_draft.json`.

## Step 4 — Generate the wipe+load SQL

```bash
node scripts/generate_hdsp_migration_sql.mjs \
  --dir . \
  --draft ./hdsp_draft.json \
  --tenant-id 246f6551-60de-4965-bb97-9a52971bc05d \
  --stamp $(date +%Y%m%d%H%M) \
  --out ./hdsp_wipe_and_load.sql
```

It refuses to generate if any job is still unmatched (mirrors the app's
Apply-blocked rule). Open the file and skim it — it backs up all 9 jobs-children
+ `job_changes` + jobs/crew/crew_status, wipes rows in FK order, asserts empty,
creates the guard index, then loads crew → jobs (with the old→new id remap) →
children → crew_status, in one transaction.

## Step 5 — Rehearse on a prod-shaped copy (REQUIRED, §6.7)

Do NOT skip. Run the generated SQL against a throwaway prod-shaped copy first and
confirm: it commits without the empty-gate firing; final counts equal the fresh
export; a spot-check of a multi-CO job (e.g. 6507) and a name-variant (Kalb)
lands on the right master record + customer. Rehearse mechanism (§8 O2) — confirm
with the DB terminal which is realistic (branch DB / local restore / scratch
schema).

## Step 6 — Run on prod

Only after Step 5 passes. Apply the generated SQL via the command-suite-db linked
tooling (single file, single transaction), e.g.
`supabase db query --linked -f hdsp_wipe_and_load.sql` from `~/command-suite-db`.
The backups land in schema `migration_backup` (restore source if needed).

## Step 7 — Verify (§7) then retire the old sheet

- Counts: after-load == fresh-export counts; Internal count == the tool's
  internal bucket.
- Every non-internal job has a `call_log_id`.
- Spot-check ~10 jobs incl. 6507 (multi-CO) and Kalb (name-variant).
- Billing sanity: billed-to-date / cumulative percent match the sheet for a few
  known jobs. Remember `deleted = 'No'` is TEXT, not boolean (C2).
- Open Schedule Command: migrated jobs render with crew + dates.
- Only then: retire the old "YES Schedule v2" app.

---

## Prerequisites already built (this branch)

- Import engine + feature + `/import` screen (sch-command).
- `migration_match_draft` table (command-suite-db `feat/schedule-data-migration`,
  migration `20260904120000`) — **must be pushed before Step 2** so the draft can
  save. Author/push from command-suite-db (`npm run db:push`), not here.

## Not RLS-isolated yet (§4 / R3-1)

The 5 schedule tables carry a legacy blanket "authenticated can do everything"
policy that overrides tenant isolation. Harmless at 1 tenant (HDSP), but dropping
those 5 policies in command-suite-db is a **hard prerequisite before a 2nd tenant
onboards** via this tool. This migration does not depend on it.
