I have enough. Now I'll deliver the complete plan. Given my read-only constraints, I'll provide the full markdown plan content as my response for you to save to `~/sch-command/docs/plans/jobs_ia_refactor_implementation.md`.

---

# Brief summary (≤300 words)

This plan handles the **downstream sch-command side** of the Jobs IA refactor, complementing the just-completed sales-command Send-to-Schedule Wizard plan.

**Scope locked in:** drop the Parked tile + Pipeline tab; rename Ready → Scheduled (now a real list view); add On Hold tile + tab; build `ScheduledCardList.jsx` as a purpose-built card (NOT a `JobCardList` mode flag); drop JobDetail's readiness checklist and embedded crew grid; replace with a "Schedule this job" deep-link to `/schedule` on the start week; implement the per-job per-week multi-week pulse (M6-tightened criterion). 7 tiles total, 4 tabs total.

**Migrations (sch-command owns per table-ownership rule):** four files paired with rollbacks in a new `~/sch-command/supabase/rollbacks/` dir.
- M1 `jobs.material_status` text column + CHECK (pure schema)
- M2 `job_wtcs` join table + 4 RLS policies scoped via `jobs.call_log_id → call_log.tenant_id` (NEW table → 6-gate does NOT apply; net-additive policy on new surface)
- M3 drop the blocker `idx_jobs_source_proposal_id` UNIQUE (sequenced AFTER sales edge fn ships)
- M4 (deferred) lazy backfill of legacy `materials_needed` boolean rows

**Q6 hybrid is preserved on the read side:** `loadJobs()` gets a new `withWTCs` option; readers fall back to `jobs.field_sow` / `jobs.materials_needed` when `job_wtcs` is empty. Card label format (Q4 + NEW-G) lives in a new `src/lib/jobCardLabel.js` helper shared by both list components.

**Legacy `Parked`-status jobs during transition:** normalize at read-time via a `normalizeJobStatus()` helper that maps `Parked → Scheduled` for grouping purposes. No data migration. After 30 days, optional one-time `UPDATE jobs SET status='Scheduled' WHERE status='Parked'` cleanup.

**New risks not in prior docs:** (1) Realtime subscription on `jobs` table doesn't yet listen to `job_wtcs` — multi-tab edits to per-WTC attributes won't propagate without a second channel. (2) The `urgencyScore` function in `Jobs.jsx:75-100` has a `Parked → -5000` rule that drives sort order; removing it changes how the All tab sorts. (3) `Schedule.jsx` is 1092 lines and pre-dates queries.js; multi-week pulse code lands in a file that already needs a refactor pass.

---

The full plan content to be saved at `~/sch-command/docs/plans/jobs_ia_refactor_implementation.md`:

````markdown
# Jobs IA Refactor — sch-command Implementation Plan

_Draft v0.1, 2026-05-11. Owner: Plan subagent (read-only). Source-of-truth contract: `~/sch-command/docs/planning/JOBS_IA_REFACTOR.md`. Companion plan (upstream): `~/sales-command/docs/plans/send_to_schedule_wizard.md`. Scope: sch-command UI refactor + the shared cross-app schema migration this repo owns. Out of scope: sales-command UI/edge function/wizard work._

Tags: **[LOCKED]** (durable from planning doc + sales plan) · **[DERIVED]** (mechanical from codebase) · **[RESOLVED]** (this plan resolves a deferred item) · **[OPEN]** (open ask back to Chris).

---

## §1 Problem statement

**[LOCKED]** Today's `/jobs` picker mixes three vocabularies — "Parked"/"Ready"/"Scheduled" — and routes the "Ready" tile to the crew grid (not a list). JobDetail still owns a readiness checklist that the new wizard will pre-satisfy upstream, plus an embedded crew scheduler that duplicates `/schedule`. After the sales-command Send-to-Schedule Wizard ships, jobs will arrive in this app already date-set, SOW-set, materials-decided — but only if the receiving UI matches the new vocabulary and absorbs the new `job_wtcs` per-WTC join table.

This refactor:
- Renames pipeline stages so picker tiles, page headers, and `getJobStatus()` normalizers all use the same words (Scheduled · Active · On Hold · Billing).
- Replaces the Pipeline tab with a real Scheduled list view rendered by a NEW purpose-built `ScheduledCardList.jsx` (Q2 closed; no mode flag on `JobCardList`).
- Adds an On Hold tile + tab (carry-forward from prior IA work — return-path requirement).
- Removes the readiness checklist from JobDetail (the wizard guarantees its inputs upstream).
- Removes the embedded crew grid from JobDetail and adds a "Schedule this job" deep-link to `/schedule` on the job's start week.
- Implements the M6-tightened multi-week alert: per-job per-week pulse in picker + Live Schedule when this specific job has zero crew assigned in any week it spans beyond the start week.
- Adds the `material_status` column on `jobs` and the new `job_wtcs` join table so the wizard's per-WTC payload has a place to land. `jobs.job_id` remains the single card identity (Q6 = hybrid).

**Shipping constraint (locked in companion plan §5.3.1):** This sch-command refactor must ship FIRST, or TOGETHER with the wizard. The wizard must NOT ship first. If the wizard ships before this refactor, new `'Scheduled'`-status cards land under the stale "Ready" tile that routes to `/schedule`, with no list view to view them in.

---

## §2 Locked decisions (do not reopen)

| # | Source | Decision |
|---|---|---|
| Q2 | Planning doc | Purpose-built `ScheduledCardList.jsx` — do NOT extend `JobCardList` with mode flags. |
| Q3 | Planning doc | Jobs arrive directly as `Scheduled` (no readiness gate). |
| Q4 + NEW-G | Planning doc | Single-WTC: `10085 - Test - Epoxy`. Joined: `10085 - Test - 5 work types`. Chip below = `WTC 1, WTC 2…`. |
| Q5 | Planning doc | Drop embedded crew grid from JobDetail; add "Schedule this job" deep-link to `/schedule`. |
| Q6 | Sales plan §3 | Hybrid: `jobs.job_id` = card identity (single FK target); new `job_wtcs` holds per-WTC attributes. Legacy rows continue working with zero `job_wtcs` children. |
| M5 | Sales plan §4 | sch-command owns the migration files. 5-step pure-schema additive sequence. Forward + rollback pairs. |
| M6 | Planning doc | Multi-week alert = per-job per-week (not "any unassigned day"). |
| Wizard status value | Sales plan §5.3.1 | Wizard writes `status = 'Scheduled'`. No interim `'Parked'` bridge. |
| Shipping order | Sales plan §5.3.1 + §10 | This refactor ships first or together; wizard must NOT ship first. |
| `call_log.stage` | Planning doc + sales plan §1 | Wizard does NOT touch `call_log.stage`. Sales-side pipeline ends at `'Sold'`. |
| `material_status` enum | Planning doc | Snake-case storage: `ordered`, `partially_ordered`, `not_ordered`, `on_hand`, `local_store_pickup`. Card-level can also be `mixed`. Display labels mapped in UI. |

---

## §3 Schema migration — what this repo owns

### 3.1 Why sch-command owns these files

- `jobs` is sch-command-owned per `~/sch-command/CLAUDE.md` ("Schedule-owned tables: jobs, crew, assignments, crew_status, materials, billing_log, job_changes, job_crew").
- `job_wtcs` is a sch-command extension of `jobs` even though sales-command writes the initial row at wizard send-time (same precedent as `materials`).
- This is the **first migration we paired with a rollback file** — establish the convention now.

### 3.2 Migration file inventory

All paths absolute. The `~/sch-command/supabase/rollbacks/` directory does NOT yet exist — it must be created (mkdir, then `git add` an empty `.gitkeep` if needed).

| # | Forward file | Rollback file | RLS-touching? | Gate model |
|---|---|---|---|---|
| M1 | `~/sch-command/supabase/migrations/20260512120000_jobs_material_status_additive.sql` | `~/sch-command/supabase/rollbacks/20260512120001_revert_jobs_material_status_additive.sql` | No | Lighter additive-mutate-cleanup |
| M2 | `~/sch-command/supabase/migrations/20260512120100_job_wtcs_create.sql` | `~/sch-command/supabase/rollbacks/20260512120101_revert_job_wtcs_create.sql` | Yes (NEW table only — net-additive surface, no overlap with existing policies) | Lighter pattern still applies (no existing policy disturbed) |
| M3 | `~/sch-command/supabase/migrations/20260512120200_jobs_drop_source_proposal_unique.sql` | `~/sch-command/supabase/rollbacks/20260512120201_revert_jobs_drop_source_proposal_unique.sql` | No | Pure index drop. **Sequenced AFTER sales edge fn deploys with the new `job_wtcs.proposal_wtc_id` UNIQUE-based guard** (coordinated with sales plan §10). |
| M4 | `~/sch-command/supabase/migrations/20260512120300_jobs_material_status_backfill.sql` (DEFERRED — document but do NOT apply in v1) | `~/sch-command/supabase/rollbacks/20260512120301_revert_jobs_material_status_backfill.sql` | No | Lazy backfill, optional. |

**Note on gate model:** Sales plan §4.2 reasoned that creating a brand-new table with sane RLS policies is "no policy-impact" because no existing read or write path changes. We follow the same reasoning here: 6-gate does NOT apply. This is the lighter additive-mutate-cleanup pattern per `~/sch-command/docs/planning/JOBS_IA_REFACTOR.md` "For non-RLS schema migrations" block.

**However** — the RLS policies on `job_wtcs` are real and load-bearing. They must be reviewed against `~/sch-command/CLAUDE_RLS.md`:
- They use `EXISTS (SELECT 1 FROM jobs j JOIN call_log cl ON cl.id = j.call_log_id WHERE j.job_id = job_wtcs.job_id AND cl.tenant_id = public.get_user_tenant_id())`. This is **NOT** in the `signing_token IS NOT NULL` anti-pattern shape. There is no anon-role surface.
- All four CRUD verbs (SELECT, INSERT, UPDATE, DELETE) get a separate policy with identical USING/WITH CHECK predicates.

### 3.3 M1 — `jobs.material_status` text column

**Forward (`20260512120000_jobs_material_status_additive.sql`):**

```sql
-- ============================================================
-- M1: Add jobs.material_status (replaces legacy materials_needed bool)
-- Pure schema; not RLS-touching.
-- Nullable to preserve legacy rows unchanged. Card-level value;
-- per-WTC granularity lives on job_wtcs.material_status (M2).
-- ============================================================
BEGIN;

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS material_status text;

ALTER TABLE public.jobs
  ADD CONSTRAINT jobs_material_status_chk CHECK (
    material_status IS NULL
    OR material_status IN (
      'ordered',
      'partially_ordered',
      'not_ordered',
      'on_hand',
      'local_store_pickup',
      'mixed'
    )
  );

COMMENT ON COLUMN public.jobs.material_status IS
  'Per-card material status (new wizard). NULL = legacy row / not decided. '
  '"mixed" reserved for joined cards with non-uniform child WTC statuses. '
  'Per-WTC granularity lives on job_wtcs.material_status.';

COMMIT;
```

**Rollback (`20260512120001_revert_jobs_material_status_additive.sql`):**

```sql
BEGIN;
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_material_status_chk;
ALTER TABLE public.jobs DROP COLUMN IF EXISTS material_status;
COMMIT;
```

**Verification queries:**

```sql
-- After forward:
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_name='jobs' AND column_name='material_status';
-- Expect 1 row: material_status, text, YES

SELECT conname FROM pg_constraint
 WHERE conname = 'jobs_material_status_chk';
-- Expect 1 row.

-- After rollback:
SELECT column_name FROM information_schema.columns
 WHERE table_name='jobs' AND column_name='material_status';
-- Expect 0 rows.
```

### 3.4 M2 — `job_wtcs` join table + RLS

This is the load-bearing migration. The table shape mirrors sales plan §3.3 exactly so the SECURITY DEFINER `send_to_schedule()` RPC (owned in sales plan §5.2 / §5.3) inserts cleanly.

**Forward (`20260512120100_job_wtcs_create.sql`):**

```sql
-- ============================================================
-- M2: Create job_wtcs join table (Q6 hybrid model).
-- One job_wtcs row per WTC sent to Schedule.
-- jobs.job_id remains the single FK target for billing_log,
-- materials, assignments, job_changes — unchanged downstream.
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.job_wtcs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           int8 NOT NULL REFERENCES public.jobs(job_id) ON DELETE CASCADE,
  proposal_wtc_id  uuid NOT NULL REFERENCES public.proposal_wtc(id) ON DELETE RESTRICT,
  work_type_id     int  NOT NULL,
  work_type_name   text NOT NULL,
  position         int  NOT NULL,
  field_sow        jsonb NOT NULL,
  material_status  text NOT NULL,
  start_date       date NOT NULL,
  end_date         date NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_job_wtcs_job_id
  ON public.job_wtcs(job_id);
CREATE INDEX IF NOT EXISTS idx_job_wtcs_proposal_wtc_id
  ON public.job_wtcs(proposal_wtc_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_job_wtcs_proposal_wtc_uniq
  ON public.job_wtcs(proposal_wtc_id);

ALTER TABLE public.job_wtcs
  ADD CONSTRAINT job_wtcs_material_status_chk CHECK (
    material_status IN (
      'ordered',
      'partially_ordered',
      'not_ordered',
      'on_hand',
      'local_store_pickup'
    )
  );

COMMENT ON TABLE public.job_wtcs IS
  'Per-WTC attributes for a job card (Q6 hybrid model). Legacy merged-row '
  'jobs have zero job_wtcs children; readers fall back to jobs.field_sow '
  'and jobs.materials_needed in that case.';

-- ── RLS ────────────────────────────────────────────────────
ALTER TABLE public.job_wtcs ENABLE ROW LEVEL SECURITY;

-- Scope via the parent jobs.call_log_id -> call_log.tenant_id chain.
-- jobs itself has no tenant_id column. This mirrors the pattern that
-- materials and assignments use in sch-command.
CREATE POLICY job_wtcs_select_authenticated
  ON public.job_wtcs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.jobs j
        JOIN public.call_log cl ON cl.id = j.call_log_id
       WHERE j.job_id = job_wtcs.job_id
         AND cl.tenant_id = public.get_user_tenant_id()
    )
  );

CREATE POLICY job_wtcs_insert_authenticated
  ON public.job_wtcs
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.jobs j
        JOIN public.call_log cl ON cl.id = j.call_log_id
       WHERE j.job_id = job_wtcs.job_id
         AND cl.tenant_id = public.get_user_tenant_id()
    )
  );

CREATE POLICY job_wtcs_update_authenticated
  ON public.job_wtcs
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.jobs j
        JOIN public.call_log cl ON cl.id = j.call_log_id
       WHERE j.job_id = job_wtcs.job_id
         AND cl.tenant_id = public.get_user_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.jobs j
        JOIN public.call_log cl ON cl.id = j.call_log_id
       WHERE j.job_id = job_wtcs.job_id
         AND cl.tenant_id = public.get_user_tenant_id()
    )
  );

CREATE POLICY job_wtcs_delete_authenticated
  ON public.job_wtcs
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.jobs j
        JOIN public.call_log cl ON cl.id = j.call_log_id
       WHERE j.job_id = job_wtcs.job_id
         AND cl.tenant_id = public.get_user_tenant_id()
    )
  );

COMMIT;
```

**Rollback (`20260512120101_revert_job_wtcs_create.sql`):**

```sql
BEGIN;
DROP TABLE IF EXISTS public.job_wtcs;
COMMIT;
```

**Verification queries:**

```sql
-- After forward:
SELECT count(*) FROM public.job_wtcs;  -- 0
SELECT indexname FROM pg_indexes WHERE tablename='job_wtcs';
-- Expect: idx_job_wtcs_job_id, idx_job_wtcs_proposal_wtc_id, idx_job_wtcs_proposal_wtc_uniq, job_wtcs_pkey

SELECT polname, polcmd FROM pg_policy WHERE polrelid='public.job_wtcs'::regclass;
-- Expect 4 rows: job_wtcs_select_authenticated (r), _insert_authenticated (a), _update_authenticated (w), _delete_authenticated (d)

-- Confirm RLS is enabled:
SELECT relrowsecurity FROM pg_class WHERE oid='public.job_wtcs'::regclass;
-- Expect: t

-- Confirm constraint:
SELECT conname FROM pg_constraint WHERE conname='job_wtcs_material_status_chk';
-- Expect 1 row.
```

**RLS sanity check (manual, post-deploy):**

```sql
-- As an authenticated user on tenant A:
SELECT count(*) FROM job_wtcs
 WHERE job_id IN (SELECT job_id FROM jobs j JOIN call_log cl ON cl.id=j.call_log_id WHERE cl.tenant_id <> public.get_user_tenant_id());
-- Expect 0 (cross-tenant rows invisible).

-- Direct PostgREST as authenticated:
-- curl ${SUPABASE_URL}/rest/v1/job_wtcs \
--   -H "apikey: $ANON_KEY" -H "Authorization: Bearer $JWT"
-- Expect only own-tenant rows.

-- Direct PostgREST as anon (no JWT):
-- Expect 401 or empty array (anon role has no policy).
```

### 3.5 M3 — drop the blocker UNIQUE index

The existing `idx_jobs_source_proposal_id` (created by `~/sch-command/add_source_columns.sql`) is a partial UNIQUE on `jobs(source_proposal_id) WHERE source_proposal_id IS NOT NULL`. It blocks the second WTC from the same proposal under any Q6 model. Drop it.

**Critical sequencing:** Run M3 only AFTER sales-command's edge function deploys with the new `job_wtcs.proposal_wtc_id` UNIQUE-based guard. Coordinated in sales plan §10 step 8.

**Forward (`20260512120200_jobs_drop_source_proposal_unique.sql`):**

```sql
-- ============================================================
-- M3: Drop the blocker UNIQUE index that prevented multi-WTC
-- sends from the same proposal. The new guard is the per-WTC
-- UNIQUE on job_wtcs.proposal_wtc_id (created in M2).
--
-- SEQUENCING: Run AFTER sales-command's send-to-schedule edge
-- function deploys with the new job_wtcs.proposal_wtc_id-based
-- duplicate check. See sales plan §10.
-- ============================================================
BEGIN;

DROP INDEX IF EXISTS public.idx_jobs_source_proposal_id;

-- Defense in depth: keep a non-unique index for query perf.
-- (queries.js loadJobs / sales ProposalDetail.jsx:492 still
-- query jobs.source_proposal_id; we want this fast.)
CREATE INDEX IF NOT EXISTS idx_jobs_source_proposal_id_nonunique
  ON public.jobs(source_proposal_id)
  WHERE source_proposal_id IS NOT NULL;

COMMIT;
```

**Rollback (`20260512120201_revert_jobs_drop_source_proposal_unique.sql`):**

```sql
-- WARNING: this rollback can fail if any proposal now has ≥2
-- jobs rows pointing at it (post-wizard normal state). If
-- failure, manually consolidate first.
BEGIN;
DROP INDEX IF EXISTS public.idx_jobs_source_proposal_id_nonunique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_source_proposal_id
  ON public.jobs(source_proposal_id)
  WHERE source_proposal_id IS NOT NULL;
COMMIT;
```

### 3.6 M4 — lazy backfill (DEFERRED)

Document but do not apply in v1. Per sales plan §4.3 decision: skip backfill for `materials_needed = false` (true negative — those rows stay NULL); map `materials_needed = true` rows by inspecting their child `materials` rows. Apply only after the UI fully reads the new column and Chris has signed off on the inferred values per row.

**Forward (`20260512120300_jobs_material_status_backfill.sql`) — DOCUMENTED, NOT APPLIED:**

```sql
-- ============================================================
-- M4 (DEFERRED): Lazy backfill of jobs.material_status from
-- legacy materials_needed boolean + child materials rows.
--
-- Behavior:
--   materials_needed = NULL  → leave NULL (not decided)
--   materials_needed = false → leave NULL (true negative;
--                              mapping would silently re-open
--                              a closed loop per sales plan §4.3)
--   materials_needed = true  → if every child material has
--                              status='Ordered', set 'ordered';
--                              else 'not_ordered'.
-- ============================================================
BEGIN;

UPDATE public.jobs j
   SET material_status =
       CASE
         WHEN NOT EXISTS (
           SELECT 1 FROM public.materials m
            WHERE m.job_id = j.job_id
              AND m.status <> 'Ordered'
         ) THEN 'ordered'
         ELSE 'not_ordered'
       END
 WHERE j.materials_needed = true
   AND j.material_status IS NULL;

COMMIT;
```

**Rollback (`20260512120301_revert_jobs_material_status_backfill.sql`):**

```sql
-- Rollback wipes only the backfilled rows (those still flagged
-- as having legacy materials_needed = true).
BEGIN;
UPDATE public.jobs
   SET material_status = NULL
 WHERE materials_needed = true
   AND material_status IN ('ordered', 'not_ordered');
COMMIT;
```

### 3.7 Cross-repo grep checklist (run before each push)

Per `~/sch-command/CLAUDE_RLS.md`:

```bash
# Before M1 (jobs.material_status):
grep -rn "from('jobs')\|from(\"jobs\")\|materials_needed\|material_status" ~/sales-command/src ~/sch-command/src ~/field-command/src 2>/dev/null
# Expect: any reader writes must be additive only. sales-command's
# new wizard writes material_status; old handleSendToSchedule still
# writes materials_needed during the additive window.

# Before M2 (job_wtcs):
grep -rn "job_wtcs" ~/sales-command/src ~/sch-command/src ~/field-command/src 2>/dev/null
# Expect: zero existing references (net new table).

# Before M3 (drop UNIQUE):
grep -rn "23505\|idx_jobs_source_proposal_id\|source_proposal_id" ~/sales-command/src ~/sch-command/src 2>/dev/null
# Expect: sales-command's edge function must already reference
# job_wtcs.proposal_wtc_id as the duplicate guard (it does, per
# sales plan §5.2 step 6). Old ProposalDetail.jsx:557 '23505'
# fallback can stay during overlap — non-breaking once UNIQUE drops.
```

### 3.8 Status-name normalization (not a migration — UI-level)

Legacy `'Parked'`-status rows from the old 1-click handler must continue to be visible during the transition. **Decision: read-time normalization, NO data migration.** Rationale:

- A `UPDATE jobs SET status='Scheduled' WHERE status='Parked'` migration is reversible-but-noisy (cluttering `job_changes` with N audit rows for every legacy job, attributed to "system" with no `changed_by`).
- The existing `getJobStatus()` normalizers in `JobsPicker.jsx:4-13`, `JobCardList.jsx:18-27`, `Jobs.jsx:46-55`, `PipelineTab.jsx:10-19`, and `ActiveTab.jsx:4-13` are already tolerant of any status string.
- The refactor adds ONE central helper (`src/lib/jobStatus.js`) that maps `'Parked' → 'Scheduled'` for grouping purposes — so legacy Parked-status cards surface under the new Scheduled tile.
- After 30+ days of stable production, an OPTIONAL one-off cleanup `UPDATE jobs SET status='Scheduled' WHERE status='Parked'` can be applied. Out of scope for v1.

This decision is surfaced explicitly because it shapes how the picker/Jobs/JobCardList helpers are unified (see §4).

---

## §4 File-by-file implementation plan

Order matters. Each row's "depends on" makes the dependency chain explicit. Execute top to bottom.

| # | Path | New/Mod | Responsibilities | Depends on |
|---|---|---|---|---|
| 1 | `~/sch-command/supabase/rollbacks/.gitkeep` | NEW | Create the new rollbacks dir. (Pair with M1 forward.) | — |
| 2 | `~/sch-command/supabase/migrations/20260512120000_jobs_material_status_additive.sql` | NEW | M1 forward (§3.3). | — |
| 3 | `~/sch-command/supabase/rollbacks/20260512120001_revert_jobs_material_status_additive.sql` | NEW | M1 rollback. | — |
| 4 | `~/sch-command/supabase/migrations/20260512120100_job_wtcs_create.sql` | NEW | M2 forward — table + RLS (§3.4). | 2 |
| 5 | `~/sch-command/supabase/rollbacks/20260512120101_revert_job_wtcs_create.sql` | NEW | M2 rollback. | — |
| 6 | `~/sch-command/src/lib/jobStatus.js` | NEW | Single source of truth for status normalization. Exports `getJobStatus(j)` returning `'Scheduled' | 'In Progress' | 'On Hold' | 'Complete' | 'Ongoing'`. Maps **legacy `'Parked'` → `'Scheduled'`** so old 1-click cards surface in the new Scheduled tile. Also exports `STATUS_OPTIONS_PICKER` and `STATUS_BADGE_CLASS`. | — |
| 7 | `~/sch-command/src/lib/jobCardLabel.js` | NEW | Card title + chip helpers used by both list components. Exports `getCardTitle(job, wtcs)` and `getWtcChips(wtcs)` per Q4 + NEW-G. Single-WTC: `<jobNum> - <jobName> - <workTypeName>`. Joined: `<jobNum> - <jobName> - N work types`. Chip: array of `WTC 1, WTC 2, …`. Handles legacy rows where `wtcs = []` by falling back to `job.work_type` (comma-split). | — |
| 8 | `~/sch-command/src/lib/queries.js` | MOD | Add `loadJobs({ withWTCs = false })` option that does a left-join on `job_wtcs` (`select \`*, ${CALL_LOG_SELECT}, job_wtcs(*)\``). Normalizer attaches `_wtcs` array to each job (`row.job_wtcs || []`). Card-level fields (`field_sow`, `start_date`, `end_date`, `material_status`) keep falling back to the `jobs` column when `_wtcs` is empty. Add `loadJobWithWTCs(jobId)` for JobDetail. Add `getJobMultiWeekAlert(job, assignments, today)` helper that computes per-job per-week unassigned-week count. | 4 |
| 9 | `~/sch-command/src/components/JobsPicker.jsx` | MOD | **Drop** `jh-tile-parked` button (lines 65-75) and the `parked` count from `buckets` (line 34). **Rename** `jh-tile-ready` to a new "Scheduled" tile that routes to `/jobs?tab=scheduled` (not `/schedule`). **Add** `jh-tile-on-hold` tile that routes to `/jobs?tab=on-hold`. Keep Active, Billing, All Jobs, Live Schedule, Production Rate (7 tiles total — same count, different mix). New count `multiWeekAlertCount` from §4 helper drives a badge on the Scheduled tile. Update copy: Scheduled tile description = "Date set, materials decided. Awaiting crew assignment + kickoff." Replace local `getJobStatus` with import from `src/lib/jobStatus.js`. | 6, 8 |
| 10 | `~/sch-command/src/components/ScheduledCardList.jsx` | NEW | Purpose-built card per Q2. Renders the new Scheduled list. **Visible fields:** card title (via `getCardTitle`), WTC chips (via `getWtcChips`), start date, days-until-kickoff (color-coded: red < 0, soon ≤ 7, normal otherwise), crew coverage ("3 of 5 days covered" or "No crew yet"), multi-week badge (orange pulse if `getJobMultiWeekAlert > 0`), Field SOW size ("5 days · 4-man crew"). **Hidden vs Active/Billing card:** billing progress bar, $ totals, OVERDUE/UNBILLED/READY-TO-INVOICE flags (none relevant pre-kickoff). Includes "Schedule this job" deep-link button per §5. | 6, 7, 8 |
| 11 | `~/sch-command/src/components/OnHoldCardList.jsx` | NEW | On Hold list view. Reuses `JobCardList` rendering since the surfaced fields (billing progress, contract amount) ARE relevant for held jobs (they may have prior partial billing). Implementation: thin wrapper that passes `jobs.filter(j => getJobStatus(j) === 'On Hold')` to `JobCardList`, with an empty-state message "No jobs on hold." Adds a "Resume to Scheduled" action button per card (return-path requirement). | 6, 8 |
| 12 | `~/sch-command/src/components/JobCardList.jsx` | MOD | (a) Replace local `getJobStatus` (lines 18-27) with import from `src/lib/jobStatus.js`. Note: legacy `'parked' → 'Parked'` line is removed because `jobStatus.js` maps legacy Parked to Scheduled for grouping. (b) Update card title rendering (lines 174-179) to use `getCardTitle(j, j._wtcs)` from `jobCardLabel.js`. Render WTC chips below title when `j._wtcs?.length >= 1`. (c) Remove `status !== 'Parked'` conditional on Job Management button (line 270) — Parked is dead. (d) Status select (lines 235-240) drops "Scheduled" + "On Hold" entries no longer? **NO** — keep them, they're write-time values. Drop "Ongoing" from the dropdown (no longer assignable; only present as legacy data). | 6, 7 |
| 13 | `~/sch-command/src/components/tabs/PipelineTab.jsx` | DELETE | Pipeline tab is removed. Replace with `ScheduledTab.jsx` (next row) or delete entirely if `Jobs.jsx` inlines the Scheduled rendering. Recommend deletion + inline. | 9 |
| 14 | `~/sch-command/src/components/tabs/ActiveTab.jsx` | MOD | Replace local `getJobStatus` with import from `src/lib/jobStatus.js`. No other change. | 6 |
| 15 | `~/sch-command/src/views/Jobs.jsx` | MOD | (a) `VALID_TABS` changes from `['pipeline', 'active', 'all']` to `['scheduled', 'active', 'on-hold', 'all']`. (b) `TAB_REDIRECTS` — add `pipeline: '/jobs?tab=scheduled'` so old bookmarks land in the right place. (c) Drop the `pipeline` rendering branch (lines 373-383) and `<PipelineTab>` import. Replace with `<ScheduledCardList>` for `tab=scheduled`. (d) Add `<OnHoldCardList>` branch for `tab=on-hold`. (e) Scoreboard (lines 326-352) — drop `parkedCount`; rename `Active` to keep but pull "Scheduled" from the new normalized status. Add `onHoldCount` already present (kept). (f) `urgencyScore` (lines 75-100) — the `Parked → -5000` rule is removed; new Scheduled rows (formerly Parked) now sort by date instead of by hard-pinning to top. Discuss with Chris: do scheduled jobs need to sort UP to the top of All? Recommended: yes — set `score = -2500` for Scheduled-without-kickoff (no scheduled_start within 14 days) to preserve visual priority without the "Parked floats to top" semantic. (g) `getJobStatus` import from `jobStatus.js`. (h) Date filter — drop the "Parked always shown regardless of date" exception (line 207) since Parked is gone; legacy Parked rows now normalize to Scheduled and respect the date filter. | 6, 10, 11 |
| 16 | `~/sch-command/src/views/JobDetail.jsx` | MOD | (a) **Drop readiness checklist:** delete lines 133-139 (readiness computation), 233-310 (entire `{job.status === 'Parked' && mode !== 'management' && ...}` block), and 312-347 (the gate modal). Drop `showGateModal` state (line 59) and the `materials_needed` writers at 250/260/273. (b) **Drop embedded crew grid:** delete lines 501-506 (`{tab === 'schedule' && (<Schedule embedded />)}` branch). Remove `import Schedule from './Schedule'` (line 6). Drop `'schedule'` from PLANNING_TABS (line 170). (c) **Add "Schedule this job" deep-link button** in the JobDetail header row (near line 187-195): `<button className="jd-sched-link" onClick={() => navigate(\`/schedule?job=${job.job_id}&week=${weekOfStart}\`)}>Schedule this job</button>`. (d) Drop the `status === 'Parked'` conditional on management tabs (line 215). (e) Update the tab-default logic (line 86): change `jobRes.data.status === 'Parked' ? 'schedule' : 'overview'` to just `'overview'` since the schedule tab no longer exists. (f) Replace `getJobStatus` local copy if any, use `jobStatus.js`. (g) Status badge logic (line 191) — drop `'Parked' ? 'pk'` branch since Parked is dead UI-side; if a legacy Parked row arrives, normalize it via `getJobStatus` first. (h) Materials tab (per `materialsSummary` at line 153-159) — drop the `materials_needed === false` branch ("No materials needed"); migrate to read `job.material_status` instead. Display map: `not_ordered → "Not Ordered"`, `partially_ordered → "Partially Ordered"`, etc. Fall back to `materials_needed`-derived summary only when `material_status` is NULL. | 6, 17 |
| 17 | `~/sch-command/src/views/Schedule.jsx` | MOD | (a) Add multi-week pulse to the week navigation buttons (lines 936-939). Logic per §6: when the currently-viewed week's `weekJobs` includes any job that has zero assignments for any of its days IN THIS WEEK, OR when the adjacent (prev/next) week's would have that property for any job spanning into it, pulse the `Next`/`Prev` button. The criterion is per-job per-week: for each job in `weekJobs`, compute `daysOfJobInThisWeek = dates.filter(d => jobInRange(j, d))`; if NONE of those days has an assignment for ANY crew matched to this job's row, that's the per-job alert. Reuse the existing `assignments` state. (b) Add URL-param recognition: read `useSearchParams()` and check for `?job=<id>&week=<isoDate>`. On mount, if `week` is set, compute `weekOffset` to navigate to that week. If `job` is set, scroll the matching row into view (refs on `renderBoardRow` rows, `scrollIntoView({ behavior: 'smooth' })` in a `useEffect`). (c) The non-list-view ("Live Schedule") stays the only non-list surface reachable from the picker. | 8 |
| 18 | `~/sch-command/src/App.jsx` | MOD | (a) Drop the `status: 'Parked'` default in `doAddJob()` (line 156). Replace with `status: 'Scheduled'` to match the new vocab. (Office staff "Add Job" path now creates jobs in the Scheduled state, same as the wizard.) | — |
| 19 | `~/sch-command/supabase/migrations/20260512120200_jobs_drop_source_proposal_unique.sql` | NEW | M3 forward (§3.5). **Apply AFTER** sales edge function is deployed with the new `job_wtcs.proposal_wtc_id` guard. Coordinated in sales plan §10. | 4 (M2) + sales edge fn deployed |
| 20 | `~/sch-command/supabase/rollbacks/20260512120201_revert_jobs_drop_source_proposal_unique.sql` | NEW | M3 rollback. | — |
| 21 | `~/sch-command/SCH_HANDOFF_v9.md` | NEW | Session closeout following the SCH_HANDOFF_v8.md structure. | all |
| 22 | `~/sch-command/src/App.css` | MOD | Add `jh-tile-scheduled`, `jh-tile-on-hold` styles by copy-renaming existing `jh-tile-ready` / `jh-tile-parked` to keep the linen color palette intact. Remove `jh-parked-section`, `jh-parked-header`, `jh-parked-dates`, `jh-parked-actions`, `jh-card.parked` styles after `PipelineTab.jsx` deletion. Add `.jh-mw-badge` (orange pulse) for multi-week alert. Add `.sch-wknav-btn.pulse` for the week-nav pulse on `/schedule`. No new white backgrounds — use `var(--linen-card)` / `var(--linen-deep)` etc. | 13, 17 |

**Files that AREN'T in this list but DO exist and are intentionally untouched:**

- `~/sch-command/src/views/Daily.jsx`, `Calendar.jsx`, `Schedules.jsx` — no Parked/Pipeline refs found. Leave alone.
- `~/sch-command/src/views/Materials.jsx` (15595 lines) — uses materials table directly; doesn't filter by Parked status. Leave alone for v1. The `material_status` integration there is a follow-up.
- `~/sch-command/src/views/Billing.jsx` — has its own pipeline that's unrelated to jobs IA. Leave alone.
- `~/sch-command/src/components/FieldSowModal.jsx`, `FieldSowBuilder.jsx` — these write `jobs.field_sow` directly. Q6 hybrid is non-destructive — these continue working on the card-level `jobs.field_sow` value. Per-WTC editing is a follow-up.

---

## §5 "Schedule this job" deep-link

Per Q5: JobDetail loses the embedded crew grid. A new button replaces it.

### 5.1 URL pattern

```
/schedule?job=<jobId>&week=<YYYY-MM-DD>
```

- `job` (int8) — `jobs.job_id`. The Schedule view scrolls this row into view.
- `week` (string, ISO date YYYY-MM-DD) — the Monday of the week to navigate to. JobDetail computes this from `getMonday(effectiveStart(job))`.

### 5.2 JobDetail behavior

In `JobDetail.jsx`, just below the header (around line 195):

```jsx
{job.start_date && (
  <button
    className="jd-sched-link"
    onClick={() => {
      const startDate = effectiveStart(job)
      if (!startDate) {
        toast('No start date set on this job', 'err')
        return
      }
      const monday = getMonday(new Date(startDate + 'T00:00:00'))
      const mondayStr = fmtD(monday)
      navigate(`/schedule?job=${job.job_id}&week=${mondayStr}`)
    }}
  >
    Schedule this job →
  </button>
)}
```

If `job.start_date` is null (only possible for non-wizard legacy rows), the button is hidden — falling back to the user navigating to `/schedule` manually.

### 5.3 Schedule.jsx behavior

```jsx
const [searchParams] = useSearchParams()
const targetJobId = searchParams.get('job')
const targetWeek = searchParams.get('week')

// On mount: if targetWeek is set, compute weekOffset to navigate to it.
useEffect(() => {
  if (!targetWeek) return
  const targetMonday = new Date(targetWeek + 'T00:00:00')
  const todayMonday = getMonday(new Date())
  const diffMs = targetMonday.getTime() - todayMonday.getTime()
  const diffWeeks = Math.round(diffMs / (1000 * 60 * 60 * 24 * 7))
  setWeekOffset(diffWeeks)
}, [targetWeek])

// On render: scroll targetJob row into view after rendering.
const jobRowRefs = useRef({})
useEffect(() => {
  if (!targetJobId) return
  const id = parseInt(targetJobId)
  const ref = jobRowRefs.current[id]
  if (ref) ref.scrollIntoView({ behavior: 'smooth', block: 'center' })
}, [targetJobId, weekJobs])

// In renderBoardRow:
<div ref={el => { if (el) jobRowRefs.current[j.job_id] = el }} className="sch-brd-job-row">…
```

### 5.4 Edge case — job not in current week

If `targetJob` is outside the visible `weekJobs` (e.g. the start week and the user navigated to a different week via the buttons), the scroll-into-view silently no-ops. Per Q5 spec, no special handling needed — the user can navigate weeks manually from there.

---

## §6 Multi-week alert (M6 tightening)

### 6.1 Criterion

Per planning doc lines 48-52: "when a job's date range spans more than one week AND any week it spans has zero crew assignments for **that specific job**, the alert fires." NOT "any unassigned day" (which would pulse on every newly-arrived job for every week it spans before crew is assigned).

### 6.2 Helper: `getJobMultiWeekAlert(job, assignments, today)`

In `src/lib/queries.js` (added per §4 row 8):

```js
// Returns count of weeks (after the job's start week) that the job spans
// where THIS job has zero assignments. 0 = no alert.
export function getJobMultiWeekAlert(job, assignments, today) {
  const start = job.scheduled_start || job.start_date
  const end = job.scheduled_end || job.end_date
  if (!start || !end) return 0
  const startD = new Date(start + 'T00:00:00')
  const endD = new Date(end + 'T00:00:00')
  const startMonday = getMonday(startD)
  const endMonday = getMonday(endD)
  if (startMonday.getTime() === endMonday.getTime()) return 0  // single-week
  // Enumerate weeks the job spans.
  let alerts = 0
  let cursor = new Date(startMonday)
  cursor.setDate(cursor.getDate() + 7)  // skip start week
  while (cursor.getTime() <= endMonday.getTime()) {
    const wkStartStr = fmtD(cursor)
    const wkEndDate = new Date(cursor); wkEndDate.setDate(wkEndDate.getDate() + 5)
    const wkEndStr = fmtD(wkEndDate)
    // Job's days in this week:
    const daysInWeek = []
    for (let i = 0; i < 6; i++) {
      const d = new Date(cursor); d.setDate(d.getDate() + i)
      const ds = fmtD(d)
      if (ds >= start && ds <= end) daysInWeek.push(ds)
    }
    // Any assignment for this job in those days?
    const hasAsgn = assignments.some(a =>
      a.job_id === job.job_id && daysInWeek.includes(a.date)
    )
    if (!hasAsgn) alerts++
    cursor.setDate(cursor.getDate() + 7)
  }
  return alerts
}
```

### 6.3 Surface 1: picker count badge on Scheduled tile

```jsx
const multiWeekAlertCount = useMemo(() =>
  jobs.filter(j =>
    getJobStatus(j) === 'Scheduled' &&
    getJobMultiWeekAlert(j, assignments, today) > 0
  ).length
, [jobs, assignments, today])

// in the Scheduled tile:
<span className="jh-tile-attn">
  {multiWeekAlertCount > 0 ? `${multiWeekAlertCount} multi-week need crew` : `${counts.startingThisWeek} starting this week`}
</span>
```

**Note:** `JobsPicker` currently doesn't take `assignments` as a prop (line 32 only takes `jobs, today, onPick`). Add `assignments` to the prop list and pass it from `Jobs.jsx` (which already loads it at line 150).

### 6.4 Surface 2: Live Schedule week-nav pulse

Per planning doc line 50: "Live Schedule (week navigation arrows pulse on weeks containing days for **this job** where this job has no crew assigned)."

The criterion at the page-level (not per-job) — pulse Prev/Next if AT LEAST ONE job currently in view has no crew assigned in the adjacent week's days that the job spans:

```jsx
// Pulse Prev if any visible job has the alert in the previous week
const prevWeekAlert = useMemo(() => {
  const prevMonday = new Date(monday); prevMonday.setDate(prevMonday.getDate() - 7)
  return scheduled.some(j => weekHasUnassignedDaysFor(j, prevMonday, assignments))
}, [scheduled, monday, assignments])

const nextWeekAlert = useMemo(() => {
  const nextMonday = new Date(monday); nextMonday.setDate(nextMonday.getDate() + 7)
  return scheduled.some(j => weekHasUnassignedDaysFor(j, nextMonday, assignments))
}, [scheduled, monday, assignments])

// Helper (in lib/queries.js or Schedule.jsx local):
function weekHasUnassignedDaysFor(j, weekMonday, assignments) {
  const start = effStart(j), end = effEnd(j)
  if (!start || !end) return false
  const dates = wkDates(weekMonday)
  const jobDaysInWeek = dates.filter(d => d >= start && d <= end)
  if (jobDaysInWeek.length === 0) return false  // job doesn't span this week
  return !assignments.some(a => a.job_id === j.job_id && jobDaysInWeek.includes(a.date))
}

// In the JSX (around line 936):
<button className={`sch-btn${prevWeekAlert ? ' pulse' : ''}`} onClick={() => setWeekOffset(w => w - 1)}>Prev</button>
<button className={`sch-btn${nextWeekAlert ? ' pulse' : ''}`} onClick={() => setWeekOffset(w => w + 1)}>Next</button>
```

`.sch-btn.pulse` gets a CSS keyframe animation (orange shadow pulse) added in App.css.

### 6.5 N+1 hazard mitigation

`getJobMultiWeekAlert` is O(jobs × weeks × assignments). For ~50 active jobs × ~6 weeks × ~200 assignments = ~60k comparisons per render. Acceptable. If we ever scale past 500 jobs, memoize the `assignments` lookup into a `Map<jobId, Set<date>>` once per load.

---

## §7 Co-existence with old 1-click handler during transition

### 7.1 The problem

The wizard ships AFTER this refactor (or together). Until the wizard ships, `~/sales-command/src/components/ProposalDetail.jsx:488-596` writes:

- A single **merged** `jobs` row per proposal (one row, flat `field_sow` array from `flatMap`).
- `status = 'Parked'`.
- `call_log.stage = 'Parked'` (line 588).
- `materials_needed` boolean via the materials sync (`status: 'Not Ordered'` strings on per-material rows; no `material_status` enum).

### 7.2 Read-time behavior in this refactor

Every status normalizer in `src/lib/jobStatus.js` maps legacy `'Parked'` → `'Scheduled'` for grouping. The legacy merged row appears under the Scheduled tile + Scheduled tab. The `ScheduledCardList` reads:

- `getCardTitle(job, job._wtcs)` — `job._wtcs` is empty for legacy rows; falls back to `job.work_type` split by comma. Single-WTC legacy: shows full work type. Multi-WTC legacy: title shows `... - N work types` (count derived from comma-split length).
- `material_status` — NULL for legacy. Falls back to `materials_needed`-derived display: NULL = "Not decided", true = "Materials needed", false = "No materials needed".

### 7.3 Status-name normalization helper

`src/lib/jobStatus.js`:

```js
export function getJobStatus(j) {
  if (!j || !j.status) return 'Ongoing'
  const s = String(j.status).toLowerCase().trim()
  // Legacy Parked status from old 1-click handler normalizes to Scheduled.
  if (s === 'parked' || s === 'scheduled') return 'Scheduled'
  if (s === 'in progress') return 'In Progress'
  if (s === 'on hold' || s === 'hold') return 'On Hold'
  if (s === 'complete' || s === 'completed' || s === 'done') return 'Complete'
  return 'Ongoing'
}

export const STATUS_OPTIONS_PICKER = [
  'Scheduled',
  'In Progress',
  'On Hold',
  'Complete',
]

export const STATUS_BADGE_CLASS = {
  Scheduled: 'sd',      // new — orange/warning palette in linen scale
  'In Progress': 'og',  // existing
  'On Hold': 'oh',      // existing
  Complete: 'cp',       // existing
  Ongoing: 'og',        // legacy fallback
}
```

### 7.4 Write-time behavior

- Office-staff "Add Job" path in `App.jsx:140-164` was writing `status: 'Parked'`. Change to `status: 'Scheduled'` (§4 row 18).
- The status select dropdown in `JobCardList.jsx:235-240` drops `'Scheduled'` to lowercase consistency? **NO** — keep it. The dropdown writes the canonical case (Scheduled, In Progress, On Hold, Complete).
- During the overlap window (refactor shipped, wizard not yet shipped), the old 1-click button keeps writing `'Parked'` to new rows. Read normalization handles them. After the wizard ships, no new `'Parked'` rows are produced.

### 7.5 Optional post-stability cleanup

After the wizard ships and runs in production for 30+ days, a one-off cleanup:

```sql
-- Optional, deferred. Apply once Chris confirms all legacy Parked rows
-- have been operated on or aged out.
UPDATE public.jobs
   SET status = 'Scheduled'
 WHERE status = 'Parked';
```

Plus an audit-log entry per row in `job_changes`. Not in v1 scope.

**Recommendation: ship with read-normalization only. Defer write-side cleanup.**

---

## §8 Trigger interactions

Per sales plan §7 R8: `fn_auto_in_progress` trigger on `time_punches` does:

```sql
UPDATE jobs SET status='In Progress'
 WHERE call_log_id = NEW.job_id
   AND status IN ('Scheduled', 'Parked')
```

The `IN ('Scheduled', 'Parked')` clause is forward-tolerant: removing `Parked` from new writes doesn't change behavior, since the trigger just filters more narrowly when no Parked rows remain.

**Recommendation: defer trigger simplification.** Drop the `'Parked'` literal only when the §7.5 cleanup ships and `SELECT count(*) FROM jobs WHERE status='Parked'` returns 0. That migration would be:

```sql
-- Future, post-cleanup. Out of scope for v1.
CREATE OR REPLACE FUNCTION public.fn_auto_in_progress() … 
  -- replace IN ('Scheduled', 'Parked') with = 'Scheduled'
```

For v1, leave the trigger as-is.

---

## §9 Smoke / test plan

**Non-prod-mutating only.** Use Vercel preview branch + TEST customer/proposal on prod Supabase (Path A from sales plan §6).

### 9.1 Test matrix

| # | Test | Setup | Action | Expected | Verification query |
|---|---|---|---|---|---|
| T1 | Picker renders 7 tiles in new order | Load `/jobs` (picker default) | Visual inspect | Tiles in order: Scheduled, Active, On Hold, Billing, All Jobs, Live Schedule, Production Rate. NO Parked tile. | UI only. |
| T2 | Scheduled tile click → list view | Click Scheduled tile | `/jobs?tab=scheduled` renders `ScheduledCardList` | URL = `/jobs?tab=scheduled`. Cards render in the new purpose-built layout (start date, days-until-kickoff, crew coverage, NO billing progress bar). | UI only. |
| T3 | On Hold tab works + return path | Take a job in Scheduled, change status to "On Hold" via JobCardList expand. Click On Hold tile. | Job appears in On Hold tab. Click "Resume to Scheduled" button on card. | Job re-appears in Scheduled tab. `jobs.status` flips back. | `SELECT job_id, status FROM jobs WHERE job_id=<test>` |
| T4 | JobDetail readiness checklist removed | Open `/jobs/<id>?mode=planning` on any Scheduled-status job | Visual inspect | No readiness checklist block. No "Send Job Plan to Schedule" button. No materials Needed/Not Needed toggle. | UI only. |
| T5 | JobDetail embedded crew grid removed | Same job, click any Job Planning tab | Visual inspect | "Schedule" tab is gone from PLANNING_TABS. Tab list = Materials, Field SOW. | UI only. |
| T6 | "Schedule this job" deep-link | Open a Scheduled job with start_date set in `/jobs/<id>` | Click "Schedule this job →" button | Navigates to `/schedule?job=<id>&week=<Monday of start_date>`. `weekOffset` is set to that week. Job row scrolls into view. | URL inspection + visual. |
| T7 | Multi-week pulse on picker (positive) | Create test job spanning 2 weeks (start Mon, end +10 days). Assign crew to start-week days only. | Load `/jobs` picker | Scheduled tile shows count badge `1 multi-week need crew`. | `SELECT job_id, start_date, end_date FROM jobs WHERE job_id=<test>; SELECT count(*) FROM assignments WHERE job_id=<test>` |
| T8 | Multi-week pulse on Schedule (positive) | Same job. Open `/schedule` on the start week. | Visual inspect | "Next" button has the `pulse` class (orange shadow animation). | DOM inspect or screenshot. |
| T9 | Multi-week pulse (negative) | Same job. Assign crew to ALL days the job spans (across both weeks). | Reload `/jobs` and `/schedule` | Picker count = 0. Schedule Next/Prev buttons do NOT pulse. | UI only. |
| T10 | Legacy Parked-status row visible | Locate (or insert via test seed) a `jobs` row with `status='Parked'`. | Load `/jobs?tab=scheduled` | Legacy row appears in the Scheduled list (read-normalized). | `SELECT job_id, status FROM jobs WHERE status='Parked'` returns the row; UI shows it under Scheduled tab. |
| T11 | Legacy merged-row card label | Same legacy row (e.g. `work_type='Epoxy,Caulking'`, no `job_wtcs` children). | Visual inspect | Card title shows `<jobNum> - <jobName> - 2 work types`. No WTC chips below (since `_wtcs.length === 0`). | UI only. |
| T12 | New per-WTC card label | Send a single WTC via the wizard (after wizard ships). | Visual inspect Scheduled card | Title shows `<jobNum> - <jobName> - <work type name>` (single). Chip shows `WTC 1`. | UI + `SELECT count(*) FROM job_wtcs WHERE job_id=<id>` = 1. |
| T13 | New joined-card label | Send 2nd WTC via wizard with "Join" option. | Visual inspect Scheduled card | Title shows `<jobNum> - <jobName> - 2 work types`. Chips show `WTC 1, WTC 2`. | `SELECT count(*) FROM job_wtcs WHERE job_id=<id>` = 2. |
| T14 | queries.js read-path hydrates both shapes | Manually call `loadJobs({ withWTCs: true })` in console. | Returns mixed array | Legacy rows: `j._wtcs === []`. New rows: `j._wtcs.length >= 1` with `proposal_wtc_id`, `position`, `material_status` populated. | Console output. |
| T15 | RLS sanity check on `job_wtcs` | Login as test tenant A user. | `SELECT * FROM job_wtcs` via PostgREST | Only rows whose parent job is in tenant A's call_log are visible. | Compare counts: `\d job_wtcs` plus tenant-filtered count via call_log JOIN. |
| T16 | No white backgrounds | Visual inspect every new component | All cards/inputs/buttons use linen palette (`var(--linen-card)` etc.) | None visible. | Visual + computed-style inspect. |
| T17 | Office "Add Job" creates Scheduled | App.jsx → Add Job modal → submit. | Visual + DB | New row `status='Scheduled'`. Appears under Scheduled tab. | `SELECT job_id, status FROM jobs ORDER BY job_id DESC LIMIT 1` |
| T18 | TAB_REDIRECTS old bookmarks | Navigate to `/jobs?tab=pipeline` (legacy URL) | Redirects | URL becomes `/jobs?tab=scheduled` | URL inspection. |
| T19 | Rollback rehearsal | On scratch DB, apply M1+M2, then rollback M2+M1 in reverse | Both apply cleanly. No orphans. | Verify with §3.3, §3.4 verification queries. |
| T20 | No prod mutations | Vercel preview env points at TEST customer + TEST proposals | T1-T19 verified, no real customer data touched. | Audit `jobs WHERE created_at > <test_start> AND source_proposal_id NOT IN (TEST_IDS)` returns 0. |

### 9.2 Smoke order

1. Apply M1 + M2 to scratch. Run rollback rehearsal (T19). Re-apply M1 + M2 to scratch.
2. On a feature branch in sch-command, ship files §4 #6-#18, #22. Push to Vercel preview.
3. Run T1-T6, T16, T17, T18 on preview (UI-only tests don't need DB writes).
4. Apply M1 + M2 to PROD.
5. Run T10, T11, T14, T15 on prod against TEST customer's legacy rows.
6. After sales wizard ships: run T7, T8, T9, T12, T13 on prod against fresh wizard-sent rows.
7. Apply M3 (drop UNIQUE) to PROD after sales edge fn deploy verified.

### 9.3 Cross-repo grep checklist (run before each push)

Per §3.7. Plus, before merging the feature branch:

```bash
# Any other repo writing 'Parked' to jobs.status?
grep -rn "'Parked'\|\"Parked\"" ~/sales-command/src ~/field-command/src 2>/dev/null
# Expect: only ProposalDetail.jsx:541/588 (the old handler — will be removed when wizard ships).

# Any other repo reading materials_needed?
grep -rn "materials_needed" ~/sales-command/src ~/field-command/src 2>/dev/null
# Expect: zero hits (sch-command-internal).
```

---

## §10 Risk register

| # | Risk | Sev/Like | Mitigation |
|---|---|---|---|
| R1 | **Cross-repo shipping order.** If wizard ships before this refactor, new `'Scheduled'` rows land under the stale "Ready" tile with no list view. | 6 / 8 | Locked: wizard ships AFTER or TOGETHER with this refactor. Sales plan §5.3.1 + §10. **Action:** put this constraint in `SCH_HANDOFF_v9.md` next-session pointers. |
| R2 | **RLS policy correctness on `job_wtcs`.** Wrong policy = either no reads (sch-command breaks) or cross-tenant reads (T2-class incident). | 9 / 4 | Policy body in §3.4 uses the established `EXISTS(jobs JOIN call_log WHERE cl.tenant_id = get_user_tenant_id())` pattern (matches `materials`/`assignments` precedent). **NOT** the `signing_token IS NOT NULL` anti-pattern. T15 verifies. |
| R3 | **Read-path performance with `job_wtcs` left-join.** PostgREST `select=*,call_log(*),job_wtcs(*)` may slow `loadJobs()` for tenants with hundreds of jobs. | 4 / 5 | The left-join is one query, not N+1 (PostgREST embedding is internally a JOIN). Verified pattern — sales-command uses `select=*,proposal_wtc(*)` heavily. If perf regresses, add pagination via `.range()` per CLAUDE.md "PostgREST caps at 1000 rows." |
| R4 | ~~UI regression for users of the old Parked tile~~ | N/A | **CLOSED 2026-05-11 (Chris):** Office staff still operate out of the legacy Google Apps Script — they have not seen the new sch-command app. Chris is the only sch-command user today. No staff-training comms needed before this ships. Real cutover risk surfaces only at Apps Script → sch-command parity transition (a separate future event). `TAB_REDIRECTS.pipeline → /jobs?tab=scheduled` still handles any Chris-side bookmarks. |
| R5 | **Realtime subscription gap on `job_wtcs`.** `Jobs.jsx:165-173` subscribes to `jobs` table changes via Supabase realtime, but `job_wtcs` is a separate table. Per-WTC updates from another tab/user won't propagate to this client. | 4 / 4 | Acceptable in v1 (the wizard is one-shot send; per-WTC edits post-send are rare). **Mitigation:** add a second `.channel('job-wtcs-changes').on('postgres_changes', { table: 'job_wtcs' }, ...)` subscription in Jobs.jsx. Track as follow-up. |
| R6 | **`urgencyScore` sort behavior change.** Removing the `Parked → -5000` rule changes how the All Jobs tab sorts. Scheduled jobs no longer hard-pin to the top. | 3 / 6 | Per §4 row 15(f), set `score = -2500` for Scheduled-without-imminent-kickoff to preserve visual priority. **Action:** confirm with Chris during smoke. |
| R7 | **No tenant_id on jobs.** All reads/writes scope via `call_log.tenant_id`. Any bug in that chain leaks cross-tenant. | 8 / 3 | Existing pattern — sch-command's RLS on `jobs` is currently `(true)` per `rls_tighten.sql`, but the `job_wtcs` policies tighten via `call_log.tenant_id`. This refactor doesn't loosen anything. **Action:** flag for F7 follow-up: jobs/billing_log/materials/assignments all need tenant-scoped policies before multi-tenant onboarding. |
| R8 | **Trigger `fn_auto_in_progress` filters on Parked.** Removing Parked from new writes is silent — the trigger still works. | 2 / 2 | Forward-compatible (`IN` tolerates extra status names). No action in v1. Simplify post-§7.5 cleanup. |
| R9 | **Schedule.jsx is 1092 lines and pre-dates queries.js.** Adding URL-param recognition + multi-week pulse to it without refactoring risks regressions in week navigation, crew coloring, modal state. | 5 / 5 | Keep all new logic confined to the four ADDITIVE blocks specified in §4 row 17. Do NOT refactor existing logic in this PR. Smoke T6, T7, T8, T9 cover the new surface. |
| R10 | **`job_crew.job_id` gotcha resurface.** Anywhere new code touches crew, it must use `call_log_id`, not `jobs.job_id`. JobDetail already does this at line 96 (`.eq('job_id', clId)`). The "Schedule this job" deep-link does NOT touch crew — only navigation. | 4 / 2 | Audit checklist: no new query in this refactor writes to `job_crew`. Confirmed during the file-by-file review. |
| R11 | **JobCardList.jsx card label refactor leaks legacy assumptions.** If `getCardTitle(job, job._wtcs)` is called with `job._wtcs = undefined` (not `[]`), it could throw. | 3 / 4 | Defensive: `getCardTitle(job, wtcs)` first does `const list = wtcs || []`. `loadJobs({ withWTCs: false })` also explicitly attaches `j._wtcs = []` so the caller doesn't need to know. |
| R12 | **OnHoldCardList "Resume to Scheduled" return-path missing audit row.** If we write `status='Scheduled'` directly, `job_changes` audit log captures it via `updateJobField()` — but only if the action goes through that helper. | 2 / 2 | OnHoldCardList MUST use `updateJobField(jobId, 'status', 'Scheduled', changedBy)` from queries.js. Confirmed in §4 row 11 spec. |
| R13 | **`material_status` UI write surface missing in v1.** This refactor doesn't yet build the UI for editing `material_status` on an existing job (only the wizard writes it). If a user joins a multi-WTC card and the card now shows `mixed`, the UI has no way to dis-mix. | 4 / 3 | Acceptable in v1. The Materials view (`src/views/Materials.jsx`) is the natural home for an explicit material-status edit — track as follow-up. |
| R14 | ~~Office training implication~~ | N/A | **CLOSED 2026-05-11 (Chris):** Duplicate of R4. Office staff still on legacy Apps Script; no training comms required for this refactor. |
| R15 | ~~Field Command (mobile) impact~~ | N/A | **CLOSED 2026-05-11.** Grep run: `grep -rn "Parked\|parked\|status.*Ready\|status.*Scheduled" ~/field-command/src` returns **zero hits**. Field-command's only `.status` references are for DPR report state (approved/submitted/draft), not `jobs.status`. No coordination needed. |
| R16 | **No new T2-class security findings.** | 8 / 1 | Audit checklist: (a) No new anon RLS policies. (b) No new policy in `signing_token IS NOT NULL` shape. (c) `job_wtcs` reads/writes use authenticated role, scoped via tenant chain. (d) No body-trusted data on server (no new edge function in this repo's scope). (e) No new HTML escape surfaces. **Closed: no new T2.** |

---

## §11 Open question

**None.** R14 closed by Chris (2026-05-11): office staff still on legacy Apps Script, not the new sch-command app. No staff-training risk for this refactor. All other [OPEN] items resolved by this plan or the sales plan.

---

## §12 Implementation order (executor's checklist)

1. **Pre-flight cross-repo grep** (§3.7 + §9.3). Confirm clean.
2. **Create `~/sch-command/supabase/rollbacks/` directory.** Add `.gitkeep`.
3. **Apply M1 + M2 on scratch DB.** Verify §3.3 + §3.4 queries. Apply rollbacks, verify clean. Re-apply M1 + M2.
4. **Implement helpers** (§4 rows 6, 7, 8): `jobStatus.js`, `jobCardLabel.js`, `queries.js` mods. Unit-eyeball-test `getJobMultiWeekAlert` against a few hand-crafted job/assignment fixtures.
5. **Implement components** (§4 rows 9-17): JobsPicker, ScheduledCardList, OnHoldCardList, JobCardList mods, ActiveTab, Jobs, JobDetail, Schedule, App.jsx. Delete PipelineTab.jsx.
6. **Update App.css** (§4 row 22).
7. **Push feature branch to Vercel preview.**
8. **Run smoke T1-T6, T16-T18 on preview** (UI-only). Verify against TEST customer.
9. **Apply M1 + M2 to PROD.** Run §3.3 + §3.4 verification queries.
10. **Run T10, T11, T14, T15 on prod against TEST customer's legacy rows.** Verify legacy Parked-status rows are visible under Scheduled tab. Verify RLS tenant scoping.
11. **Merge PR to main.** Vercel auto-deploys.
12. **Train Joe/John/Denise** per R14 (or hand off to Chris).
13. **Wait for sales wizard to ship.** (Sales plan §10 steps 6-7.)
14. **After wizard ships: run T7-T9, T12, T13 on prod.** Verify new per-WTC + joined-card rendering and multi-week pulse.
15. **Apply M3 (drop UNIQUE) to PROD** (sales plan §10 step 8).
16. **Write `SCH_HANDOFF_v9.md`.** Standard closeout.
17. **(Deferred)** M4 lazy backfill (only if Chris explicitly approves).
18. **(Deferred, 30+ days post-stability)** §7.5 status cleanup + §8 trigger simplification.

---

## §13 Out of scope

- Sales-command wizard, edge function, `send_to_schedule` RPC — see sales plan.
- F7 multi-tenant onboarding work (tenant-scoping `jobs` directly; currently scoped via `call_log.tenant_id`).
- Materials view (`src/views/Materials.jsx`) integration with the new `material_status` column.
- Field SOW per-WTC editing (current `FieldSowModal` / `FieldSowBuilder` write `jobs.field_sow` directly; per-WTC editing on `job_wtcs.field_sow` is a follow-up).
- Card-merge / unjoin UI in sch-command (the planning doc mentions "optional card-merge action" — deferred).
- Realtime subscription on `job_wtcs` (R5) — track as follow-up.
- The missing `~/sales-command/docs/runbooks/rls-deploy-gates.md` (sales plan R9) — cleanup, not blocker.

---

## §14 Critical files for implementation

The top 5 by impact:

- `/Users/chrisberger/sch-command/supabase/migrations/20260512120100_job_wtcs_create.sql` (NEW table + RLS — the load-bearing migration)
- `/Users/chrisberger/sch-command/src/components/ScheduledCardList.jsx` (NEW — purpose-built card per Q2)
- `/Users/chrisberger/sch-command/src/views/JobDetail.jsx` (MODIFY — drop readiness checklist + embedded crew grid, add deep-link)
- `/Users/chrisberger/sch-command/src/lib/queries.js` (MODIFY — add `withWTCs` option + `getJobMultiWeekAlert`)
- `/Users/chrisberger/sch-command/src/components/JobsPicker.jsx` (MODIFY — 7 tiles new mix, multi-week badge)

Supporting:

- `/Users/chrisberger/sch-command/src/lib/jobStatus.js` (NEW — read-time Parked→Scheduled normalization, the linchpin of §7 transition behavior)
- `/Users/chrisberger/sch-command/src/views/Jobs.jsx` (MODIFY — new tab set, new redirects)
- `/Users/chrisberger/sch-command/src/views/Schedule.jsx` (MODIFY — URL-param recognition, multi-week pulse)
- `/Users/chrisberger/sch-command/supabase/migrations/20260512120000_jobs_material_status_additive.sql` (NEW — additive column)
- `/Users/chrisberger/sch-command/supabase/migrations/20260512120200_jobs_drop_source_proposal_unique.sql` (NEW — sequenced after sales edge fn)
````

---

## Reporting back (under 300 words)

**What's in the plan:** Full sch-command-side implementation plan at the rigor of the sales wizard plan (§1-§14). Covers schema migrations (M1 `jobs.material_status`, M2 `job_wtcs` + RLS, M3 drop blocker UNIQUE, M4 deferred lazy backfill); 22-row file-by-file plan with explicit dependency chain; "Schedule this job" deep-link URL spec + reception logic in Schedule.jsx; multi-week alert with M6-tightened per-job per-week criterion (computed in `queries.js`, surfaced as picker badge + Live Schedule week-nav pulse); ScheduledCardList vs JobCardList split with shared helpers in new `src/lib/jobStatus.js` + `src/lib/jobCardLabel.js`; co-existence strategy for legacy `Parked`-status rows (read-time normalization, no data migration); trigger interaction (no change in v1); 20-test smoke matrix; 16-row risk register.

**Key sch-command-specific decisions:**
1. **Read-time normalization over data migration** — legacy `Parked` jobs map to `Scheduled` for grouping via a single `getJobStatus()` helper. No `UPDATE jobs SET status...` migration. Cleaner audit trail; reversible by removing one line.
2. **`material_status` UI is read-only in v1** — only the wizard writes it. Materials-view edit UI is a follow-up. The card-level `'mixed'` value is set by the join RPC and rendered but not user-editable.
3. **Office "Add Job" path also moves to `Scheduled`** — `App.jsx:156` flip; same vocab everywhere.

**New risks not in prior docs:**
1. **Realtime subscription gap** (R5) — `Jobs.jsx` subscribes to `jobs` but not `job_wtcs`. Multi-tab edits to per-WTC fields won't propagate. Accepted for v1.
2. **`urgencyScore` sort regression** (R6) — removing `Parked → -5000` changes All Jobs sort order. Mitigated by `-2500` for Scheduled-without-imminent-kickoff.
3. **Field Command grep gap** (R15) — must grep `~/field-command/src` for `'Parked'` references before merge.
4. **`Schedule.jsx` is 1092 lines pre-queries.js** (R9) — adding multi-week pulse there is additive-only; refactor is explicitly out of scope.

### Critical files for implementation
- /Users/chrisberger/sch-command/supabase/migrations/20260512120100_job_wtcs_create.sql
- /Users/chrisberger/sch-command/src/components/ScheduledCardList.jsx
- /Users/chrisberger/sch-command/src/views/JobDetail.jsx
- /Users/chrisberger/sch-command/src/lib/queries.js
- /Users/chrisberger/sch-command/src/components/JobsPicker.jsx