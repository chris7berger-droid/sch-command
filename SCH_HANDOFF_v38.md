# SCH_HANDOFF_v38 — Schedule data migration (YESv2 → HDSP) + onboarding matcher

**Date:** 2026-09-04
**Repos:** `sch-command` (feature + one-time scripts) · `command-suite-db` (draft-table migration)
**Branch merged:** `feat/schedule-data-migration` → `main` (both repos)
**Plan:** `docs/plans/schedule_data_migration.md` (read §4, §5, §6, §14 + the Build log)
**Shared DB:** `pbgvgjjuhnpsumnowuym` · **HDSP tenant_id:** `246f6551-60de-4965-bb97-9a52971bc05d`

---

## What this was

Move the old Google-Apps-Script schedule ("YES Schedule v2" / YESv2) into the live Schedule
Command **once**, then retire the old sheet. Old jobs don't line up cleanly with the real master
records (numbers repeat across COs, customer names vary) — so the heart of it is a **human matching
tool**, not an auto-match script. Built as a **permanent Customer Onboarding / Import feature**
(CSV-in, match-to-existing, additive), plus a **separate one-time test-data wipe+load** for HDSP.

## What shipped (merged to main)

**Feature (sch-command):**
- `src/lib/yesv2Import.js` (+ `.verify.mjs`, 21/21 pass) — pure engine: YESv2 header contract +
  validation (R3-4), §5 transforms (Active→Ongoing, text Yes/No flags, wall-clock dates, money
  strip, `_oldJobId` for the A2 remap, `call_log_id` null pre-match), crew_status last-wins
  collapse, crew derivation, smart-assist ranking (number → customer → job-name) + confidence tiers.
- `src/lib/importData.js` — right-pane loader (call_log match targets), draft save/load
  (`migration_match_draft`), **additive** Apply (crew first → jobs with old→new job_id remap
  capture → remapped children → collapsed crew_status), and A-14.1 backlink resolution.
- `src/views/Import.jsx` + `/import` route + nav (`App.jsx`) + `App.css` — upload w/ per-tab header
  validation, left/right panes, ranked candidates + **click-to-confirm** (not drag — same one-link
  result, steadier over ~120 rows), search, Internal/Unmatched states, **duplicate-target hard
  block**, Apply disabled until zero-unmatched & zero-dupes, draft autosave/restore, result shows
  backlinked count + review list.
- **A-14.1 backlinks:** on Apply, sets `source_call_log_id = call_log_id` and `source_proposal_id`
  from the matched call_log's **Sold, non-archive** proposal **only when exactly one exists** (else
  null + flagged for review — never guessed). Closes the "Sales creates a duplicate job on re-send"
  hole (Sales' guard keys on `jobs.source_proposal_id`). **No `DELETE FROM jobs` anywhere in the
  feature (R3-3).**

**One-time wipe+load (sch-command, standalone — outside feature runtime, R3-3):**
- `scripts/generate_hdsp_migration_sql.mjs` — reuses the engine + the confirmed match draft to emit
  ONE transaction: backup all 9 jobs-children + job_changes + jobs/crew/crew_status (§6.3) →
  rows-only FK-order wipe (§6.4) → empty-gate assert-or-rollback (§6.5/N3) → partial-unique guard
  index pre-insert (§6.6/N4) → staged load with the A2 remap → COMMIT. Stamps tenant_id explicitly
  (raw admin SQL has no `auth.uid()`, §5/A3). Emits A-14.1 backlinks via a `HAVING count(*)=1`
  scalar subselect. Refuses to generate if any job is unmatched.
- `scripts/HDSP_MIGRATION_RUNBOOK.md` — the operational sequence (below).

**Draft table (command-suite-db):**
- `supabase/migrations/20260904120000_migration_match_draft.sql` (+ rollback) — `tenant_id` DEFAULT
  `get_user_tenant_id()` + FK, RLS on, **4 standard tenant policies, no catch-all** (R3-2),
  `updated_at` trigger, unique `(tenant_id, migration_key)`. **Merged to main; NOT yet db:pushed.**

## Gate results — all four GO (context captured for the record)

| Terminal | Verdict | Notes |
|---|---|---|
| **Build-vs-plan (original build)** | GO | 0 Tier-1 blockers. 3 Tier-2 "watch during smoke", all by-design: draft persistence off until migration pushed; feature Apply additive/non-transactional (atomic path is the script); crew upsert assumes unique crew.name (it is). Verified R3-3, §5 transforms, A2 both paths, A3, §6 structure, R3-2, R3-4/N4. Engine 21/21; all target tables/columns live. |
| **Build-vs-plan (A-14.1)** | GO | 0/0. All 6 checks + pre-check pass. Confirmed additive (only 4 files touched, engine untouched); Sold+non-archive rule matches Sales (`ProposalDetail.jsx:141,741`); both paths write identical backlink logic; internal rows → null backlinks; A-14.2 correctly deferred. |
| **Code-review (T5)** | 0 ship-blockers | 2 HARDENING filed (→ IMP-1). Confirmed: A2 order-guard sound, feature≡script backlink semantics, is_archive filtered both sides, wall-clock preserved (no toISOString), verify harness does not fail-open. |
| **Security-review (T6)** | 0 exploitable-today | Draft table correctly isolated. R3-1 (legacy blanket policy on 5 schedule tables) = real weakness but **no victim at 1 tenant**, honestly documented (§4/§13 + code comment), gated pre-customer-#2. SQL escaping sound. 1 optional hardening (loose tenant-id regex) → IMP-1. |

## State now

- Both feature branches **merged to main and pushed.** sch-command main deploys to
  schedulecommand.com (Vercel) — the `/import` screen is live.
- The draft table migration is **applied to prod (2026-09-04)** and on command-suite-db main.
  Match progress now persists across refresh. (Earlier blocker — DMS-8 baseline drift — resolved
  as part of this; see step 1 below.)

## Remaining steps (the one-time move — all downstream, deliberate)

1. **Deploy the draft table — DONE 2026-09-04.** Resolved the DMS-8 baseline drift first (the +48
   column-grants were the 4 additive `tenant_config` columns from 20260902120000 — verified benign,
   no anon exposure; refreshed the baseline snapshot + bumped `EXPECT_COLUMN_GRANTS` 9172→9220 with
   changelog). Rehearsal then green on all fingerprints; `npm run db:push` passed every gate and
   applied `migration_match_draft` to prod (verified live: table exists, RLS on, 4 policies).
   **Match-progress persistence is now ON.**
2. **Run the one-time move** (per `scripts/HDSP_MIGRATION_RUNBOOK.md`):
   fresh export of the live sheet → match in `/import` (as an HDSP user) → export the confirmed
   draft → `node scripts/generate_hdsp_migration_sql.mjs …` → **REHEARSE on a prod-shaped copy
   (§6.7 — never skip)** → run the generated SQL via `supabase db query --linked -f` from
   command-suite-db → verify (§7: counts, spot-check 6507 multi-CO + Kalb name-variant, billing
   sanity, in-app render) → retire the old sheet.
3. **O2 (rehearse mechanism)** still open — confirm with the DB terminal what's realistic (branch DB
   / local restore / scratch schema) before the prod run.

## Backlog / follow-ups

- **IMP-1 (T3, filed):** import feature hardening — (a) hard-error on duplicate source JobIDs in the
  feature Apply (the script is already strict); (b) bound the draft jsonb payload if the importer
  generalizes past HDSP scale; (c) tighten the generator's `--tenant-id` regex to a strict uuid.
  None fire under the locked HDSP single-tenant scope; revisit with create-from-CSV.
- **R3-1 (command-suite-db backlog, gated pre-customer-#2):** drop the 5 blanket "authenticated can
  do everything" policies on jobs/assignments/billing_log/crew/crew_status and enforce tenant-only
  isolation (per `CLAUDE_RLS.md` 6-gate deploy). Hard prerequisite before a 2nd tenant onboards via
  this tool. Does NOT block the single-tenant HDSP load.
- **Out of scope (deferred, not misses):** create-from-CSV mode, generic column-mapping, A-14.2
  (per-job "Pull scope from Sales" action for active imported jobs that need a live SOW).

## Commit inventory (this session)

`sch-command` (on main after merge): `681d72a` engine · `ccee0a3` feature · `f287f5a` generator +
runbook · `7f9b7f9` plan built · `b7f709c` plan A-14 amendment · `10d753f` A-14.1 backlinks ·
`73304ce` backlog IMP-1 · plus this handoff + the merge commit.
`command-suite-db` (on main after merge): `5f0a72d` migration_match_draft table.

## Heads-up

Earlier a review machine's **local `main` was stale (behind GitHub)** — it simply hadn't pulled the
already-merged Daily-view / Schedule / modal work, so a gate compared against an out-of-date main and
mislabeled those files "unrelated changes on the branch." Verified: all of them are present on
`origin/main`, and against `origin/main` the branch was clean (only these 10 files). **Nothing is
unpushed or at risk of loss** — the fix is just to refresh that machine's copy (`git checkout main
&& git pull`); optional/cosmetic since a fetch catches it up anyway.
