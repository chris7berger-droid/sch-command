# DMS-1 Phase 5 — Retire the legacy `materials` table (DB cleanup)

**Branch:** `feat/dms1-phase5` (plan doc lives in sch-command; work spans sales-command + command-suite-db)
**Wall-chart step:** 9 (Tier 4 — retire legacy)
**Status:** PLAN — revision pass 3 (2026-08-03). **Round 3 CLEARED** (0H/0C; gate SQL verified
correct + fail-closed + JS-faithful; trend 8→8→5). Ship-ready after these mechanical fixes → rehearse next. No round 4.

---

## What this is (plain)

Cleanup of **one** thing: the old **`materials`** table. It was already replaced by
`job_material_lines`, which is what the app actually uses now. The old table just sits there, still
getting a copy written to it at Send. This loop throws it out so the materials list lives in exactly
one place.

## Scope collapse (why this shrank — 2026-08-03)

The earlier draft bundled two unrelated jobs under "Phase 5": (a) this DB cleanup, and (b) retiring
the `jobs.field_sow` mirror + fixing the field crew **report screen**. Round-2 audit plateaued
(8 → 8 findings) — the whole low-priority tail came from (b).

**The real problem with (b): it isn't a task yet.** The report screen has **no live users** (Field
Command is prototype, on nobody's phone), so there is no user to define "done" — an audit will keep
finding low-priority issues in code nobody runs, forever. Deferring it to a "loop 5b" is added
mechanism that just reschedules the same churn (violates *collapse-to-simplest-model*).

So (b) is **removed from this plan entirely** and re-filed as a **user-triggered** backlog item, not
a phase number — see *Deferred (not-yet-a-task)* below. This loop is now only (a): retire `materials`.

**What that means concretely:** `jobs.field_sow` is **not touched** in this loop. Sales keeps writing
its flat mirror (`ProposalDetail.jsx:686`); the report screen keeps reading it. Untouched, coherent,
no half-retirement. Only the `materials` store is retired.

---

## §0 Baseline (observed current state — what this plan changes)

**Verification level: read-verified** (code + committed baseline schema + greps, 2026-08-03).
Not yet run-verified: job 6618's live row state and a live census of which jobs hold `materials`
rows — that is the smoke/verify step at build (step 4).

- **`materials` table** — defined `command-suite-db/supabase/baseline/prod_public_schema.sql:3037`.
  Sole remaining **writer** = Sales `ProposalDetail.jsx:788` (insert at Send-to-Schedule, rows
  default `status='Not Ordered'`; failure only fires a swallowed `alert()` at `:789`). **No app
  readers remain** — all moved to `job_material_lines` (sch `Materials.jsx`, `queries.js:85`
  `materialsDecided`). Sole remaining **reader** = the SQL `job_base_checklist_passes()` materials
  check. Attached: 3 recheck triggers (`:4327/:4331/:4335`) → `materials_recheck_parents()` (`:1279`),
  `idx_materials_tenant` (`:4123`), `materials_id_seq`, and **5** RLS policies (4 named +
  a legacy `"Authenticated users can do everything"` catch-all).
- **`job_material_lines` (the replacement)** — written/read by sch `queries.js:706`/`:692`; the app's
  live Ready gate `materialsDecided` (`queries.js:85`) already reads it, **fail-closed on empty**.
  Populated lazily (SOW-save / Logistics-tab open), NOT at Send. **Has no `tenant_id` column**
  (baseline `:2880`) — tenant-scoped only via `job_id → jobs → call_log`. Its `status`/CHECK were
  added in migration `20260731130000` (Phase 3), which **postdates the committed baseline snapshot** —
  source status semantics from that migration, not the baseline (see backlog: stale baseline).
- **The DB's duplicate Ready gate** — SQL `job_base_checklist_passes()` (`prod_public_schema.sql:925`)
  still reads the OLD `materials` table and is enforced by a jobs trigger (`:1032`) + ready-flag
  null-out queries (`:311/:324/:341/:1299/:1312/:1329`). The app's own code flags it Phase-5-owned
  (`queries.js:79`). Dropping the table without fixing this function breaks every one of those callers.

---

## The job (4 steps)

| # | Repo | What | Deploy gate |
|---|---|---|---|
| 1 | sales-command | **Stop the `materials` insert** at Send-to-Schedule: remove `ProposalDetail.jsx:788` insert + its `:789` alert. (Leave the `field_sow` mirror and `job_wtcs` write ALONE.) | deploy **before** step 3; a slip only fires a swallowed warning (`:789`), not a blocked send |
| 2 | command-suite-db | **Rewrite the ready-gate** `job_base_checklist_passes()` materials check to read `job_material_lines`, **fail-closed**, tenant-scoped via `job_id→jobs→call_log`. Explicit SQL below. | — |
| 3 | command-suite-db | **Drop** the `materials` table + 3 recheck triggers + `materials_recheck_parents()` + **5** RLS policies + `materials_id_seq` + `idx_materials_tenant`. One migration file with step 2; full-inverse rollback. | after steps 1 & 2 |
| 4 | all | **Verify vs job 6618**, then a **zero-hit re-grep** for `from('materials')` across all repos. | — |

Steps 2 + 3 are one migration file. Step 1 (Sales) deploys first. `MASTER_SCHEDULE.md` §4B step 9
already names only the `materials` table — no wording amendment needed now; mark it done after ship.

---

## Step 1 — sales-command stop-write (`ProposalDetail.jsx`, Send-to-Schedule)

- **Remove the whole `:773–790` block [C1]** — the 15-line `matRows` build + the
  `if (matRows.length > 0) { … }` guard + the `materials` insert (`:788`) + its `:789`
  `alert("Materials sync warning: …")`. Removing only `:788/:789` would leave an empty `if` and a
  dead `matRows` build (block-local, no downstream refs, but dead code). App readers already use
  `job_material_lines`.
- **Leave intact:** the `job_wtcs` write (`:743`) and the `call_log` stage update (`:793`).
- **Do NOT touch** `:686` (the `field_sow` mirror). `field_sow` retirement is out of scope this loop
  (see Deferred).

## Steps 2+3 — command-suite-db migration (one file + full-inverse rollback)

### Step 2 — gate rewrite (explicit SQL — [A2] fail-closed, not prose)

The naive `RETURN NOT EXISTS(... bad status ...)` **fails OPEN** on an empty tracker (no rows → no
bad rows → returns true). Must be two explicit parts, default-deny first. This mirrors the JS
`materialsDecided` (`queries.js:85-88`): empty tracker on a SOW job ⇒ NOT ready.

```sql
-- (replaces the materials block of job_base_checklist_passes; SOW-present/date/tenant/crew
--  checks above it are unchanged. By here the job HAS a SOW and v_tenant_id is set.)

-- (a) fail-closed: a SOW-bearing job with NO tracker rows is NOT ready.
IF NOT EXISTS (
  SELECT 1 FROM public.job_material_lines jml
    JOIN public.jobs j     ON j.job_id = jml.job_id
    JOIN public.call_log cl ON cl.id = j.call_log_id
  WHERE jml.job_id = p_job.job_id
    AND cl.tenant_id = v_tenant_id
) THEN
  RETURN false;
END IF;

-- (b) block if any line is undecided/unordered (status NULL counts as undecided).
RETURN NOT EXISTS (
  SELECT 1 FROM public.job_material_lines jml
    JOIN public.jobs j     ON j.job_id = jml.job_id
    JOIN public.call_log cl ON cl.id = j.call_log_id
  WHERE jml.job_id = p_job.job_id
    AND cl.tenant_id = v_tenant_id
    AND (jml.status IS NULL OR jml.status IN ('Not Ordered','Delayed'))
);
```

- **Tenant scoping preserved** — `job_material_lines` has no `tenant_id`, so scope via the
  `job_id→jobs→call_log` join (same tenant the old materials check used). Do not drop it.
- **Source the `status` values** (`'Not Ordered'`/`'Delayed'` + any CHECK) from migration
  `20260731130000`, not the stale baseline snapshot.
- Remove the `v_has_materials` local and the old `materials`-table SELECT.

### Step 3 — drops (order matters)

`DROP` 3 triggers (`materials_recheck_ready_{insert,update,delete}_trg`, `:4327/:4331/:4335`) →
`DROP FUNCTION materials_recheck_parents()` (`:1279`) → `DROP` **all 5** policies →
`DROP TABLE public.materials` (cascades the seq + index).

**All 5 policies** (miss the catch-all and the rollback restores an incomplete set):
`"Authenticated users can do everything"` (catch-all, `:5120`), `materials_delete` (`:5791`),
`materials_insert` (`:5795`), `materials_select` (`:5799`), `materials_update` (`:5803`).

### Rollback (`supabase/rollbacks/<ts>_revert_<name>.sql`) — [A1/A3] full literal inverse, one unit

Restore the exact prior state, copied **verbatim from the committed baseline** (`prod_public_schema.sql`),
not reconstructed from memory:
- `CREATE TABLE public.materials` — exact columns: `id integer NOT NULL` with
  **`DEFAULT nextval('materials_id_seq')`**, `job_id`, `ordinal`, `name`,
  `status text DEFAULT 'Not Ordered'`, `arrival_date`, `notes`,
  `tenant_id uuid DEFAULT get_user_tenant_id() NOT NULL`.
- **[A3] `materials_status_check` CHECK — recreate verbatim incl. `NOT VALID`** (baseline `:3744`):
  `CHECK (status = ANY (ARRAY['Not Ordered','Ordered','In Stock','Delayed'])) NOT VALID`. A
  *validating* recreate would scan/reject historical rows and diverge from prior state — the baseline
  constraint is `NOT VALID`, so the inverse must be too.
- `materials_id_seq` **+ its `OWNED BY public.materials.id`** ownership **+ the 3 sequence GRANTs**
  (`anon`/`authenticated`/`service_role`).
- PK, FKs: `materials_job_id_fkey → jobs(job_id)` and
  **`materials_tenant_id_fkey → tenant_config(id)`** (baseline `:4852` — name the target, don't guess
  `tenants`/`tenant_configs`), plus `idx_materials_tenant`.
- **[A1] The 3 TABLE-level GRANTs** — `GRANT ALL ON TABLE public.materials TO anon, authenticated,
  service_role;` (baseline `:7098-7100`). **This is the one omission that actually breaks the
  rollback:** a recreated table with RLS enabled but no role GRANT is unreachable by PostgREST
  (permission denied *before* RLS evaluates) — the rollback "succeeds" but leaves the table dead.
- `materials_recheck_parents()` + **[A2] its 3 EXECUTE GRANTs**
  (`GRANT ALL ON FUNCTION public.materials_recheck_parents() TO anon, authenticated, service_role;`,
  baseline `:6629-31`) + all **3** recheck triggers.
- All **5** RLS policies + `ALTER TABLE … ENABLE ROW LEVEL SECURITY`.
- **Revert `job_base_checklist_passes()` body** to the materials-table version (the forward migration
  changed it; the inverse ships in the SAME rollback file and must undo it).

### Rehearse before push — [A2] explicit SEED + assertion

`rehearse.sh` loads the baseline schema into a throwaway but has **no built-in data seeding** — an
empty DB never exercises the gate. Add `scripts/rehearse/seed_phase5.sql` (sourced before applying
the candidate) creating:
1. **job 6618** — its real WTC + material rows (the reference job).
2. a **zero-WTC / archive job** — has `jobs.field_sow`, no `job_wtcs` rows.
3. a **SOW-bearing job with ZERO `job_material_lines` rows** — has `job_wtcs.field_sow`,
   **a scheduled date, and ≥1 `assignments` row** so it passes SOW/date/crew and the **only** thing
   left to fail is the empty tracker (else the assertion passes for the wrong gate — round-2 finding).

Then assert (note: pass the row `j`, **NOT `j.*`** — the fn takes a `jobs` composite):
```sql
-- shape (3): must be FALSE, and false BECAUSE of the empty tracker (part a)
SELECT job_base_checklist_passes(j) FROM public.jobs j WHERE j.job_num = '<seed-3>';  -- expect: false
```
Also assert shape (2) still resolves SOW via the flat column, and shape (1) passes once its tracker
is satisfied. Then `npm run db:push` (runs safety + collision + anon-lock + from-scratch gates).
**The build terminal does NOT push this migration — deploy waits for the deploy gate.**

## Step 4 — verify + re-grep

- **[B1] Pre-drop cutover census (read-only, run before the drop).** The old gate reads `materials`
  (written at Send); the new gate reads `job_material_lines` (lazily populated → may be empty). Count
  the jobs the cutover could flip:
  ```sql
  -- stored-ready, SOW-present, but empty tracker → the new gate would compute not-ready
  SELECT count(*) FROM public.jobs j
    JOIN public.call_log cl ON cl.id = j.call_log_id
  WHERE j.ready_confirmed_at IS NOT NULL
    AND (EXISTS (SELECT 1 FROM public.job_wtcs w WHERE w.job_id = j.job_id
                   AND jsonb_typeof(w.field_sow)='array' AND jsonb_array_length(w.field_sow)>0)
         OR j.field_sow IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM public.job_material_lines jml WHERE jml.job_id = j.job_id);
  ```
  **Zero → note and proceed.** **Non-zero → still safe** (the live app already recomputes fail-closed
  in JS at `queries.js:88/:103`, so those jobs already display not-ready *today* — no new app-visible
  disruption, no raw stored-flag consumer) **but state the count explicitly** rather than lean on the
  wrong reassurance. (This replaces the old "6618 needs no materials rows" line, which missed the point.)
- Job **6618**: passes Ready via the rewritten gate post-cutover.
- **Zero-hit re-grep** across all repos: no `from('materials')` remains (the `materials_catalog` /
  `job_material_lines` tables are fine — exact-word `materials` table only).

---

## Deferred (not-yet-a-task — user-triggered, NOT a phase)

**Retire the `jobs.field_sow` mirror + point the field crew report screen at `job_wtcs`.**
Removed from Phase 5 because it has no user to define "done" (Field Command is prototype, no live
crew). **Trigger to revive:** when an actual crew is using the Field report screen in the field.
Until then, the round-2 findings on it (C1–C4: `ReportTab` `wtc_id` stamping, `isLoading` guard,
`job_wtcs`-primary read, zero-WTC fallback) are **noise, not backlog** — the code they cover is not
in service. Filed as one user-triggered line in `docs/BACKLOG.md`, not a 5b plan stub.

## Stays (do NOT touch)

- `jobs.field_sow` column + its writers/readers — entirely out of scope this loop.
- `job_material_lines`, `materials_catalog`, `job_wtcs` — the new/canonical stores.

## Out of scope

- Anything `field_sow` / report-screen / Field Command (see Deferred).
- Any new features. Retirement only.

## Verify (before done)

- Sales Send-to-Schedule: writes **no** `materials` rows; `job_wtcs` + `field_sow` writes unchanged.
- Migration rehearsed green with the seed; assertion on shape (3) returns `false`; `db:push` clean;
  full-inverse rollback present.
- Job 6618 passes Ready via the rewritten gate.
- Zero-hit re-grep for the `materials` table passes.

## Deploy

- Order: **Sales stop-insert (step 1) → DB migration (steps 2+3)**.
- **[B1] Verify gate before `db:push`:** confirm the Sales stop-insert is **actually live in prod** —
  verify via the **Vercel deploy-complete for the step-1 merge SHA** (host `www.scmybiz.com`,
  auto-deploys on push to main — `sales-command/CLAUDE.md:331-332`), **not** by inspecting a minified
  bundle. A merged-but-not-deployed
  Sales change still runs the old insert against a dropped table.
- **Corrected hazard:** a mis-ordered push does **not** block a job. The insert is wrapped — on
  failure it fires the swallowed `alert("Materials sync warning: …")` (`:789`); the send still
  completes. Cosmetic-warning risk, not data-loss. Order it right, but a slip is not an outage.
- Closes the SOW/Material-Flow master schedule Tier 4 (`materials` half).

## Backlog to file (adjacent findings, this session)

- **[Med] Stale baseline snapshot** — `prod_public_schema.sql` predates Phase-3's
  `job_material_lines.status/arrival_date/notes` (migration `20260731130000`). Source those from the
  migration; refresh the baseline snapshot so `rehearse.sh` fingerprints against current prod.
- **[trigger] Field report-screen / `field_sow` retirement** — see Deferred above.

---

## Audit manifest

_Regenerated 2026-08-03 (revision pass 2, scope collapsed). Consumed by `/runaudit` for round 3._

### Bottom line (plain English)
Now a single, focused job: permanently delete one old database table on the shared live database and
repoint the one leftover check that still reads it. The risky part is concentrated in the database
migration; nothing else of consequence changes. Two reviewers, one more pass on the exact SQL (it was
just newly specified and it's the one thing that can go wrong quietly).

### Round
- Plan type: feature (retirement/cleanup — no pre-existing defect)
- Current round: 3 (rounds 1 & 2 complete)
- Plan revision under audit: revision pass 2 (scope collapsed to `materials`-only)
- Findings trend: round 1 (8) → round 2 (8, PLATEAU → scope-cut) → round 3 (?). Scope collapse should
  drop the count sharply — the report-screen tail (C1–C4) left the plan.

### Prior rounds
- Round 1: `d588f8f` · 3H/3M/2L · pattern: deletion-rollback-completeness
- Round 2: `afaea5b` · 2H/1M/5L · pattern: gate-rewrite-underspecified (+ 1 regression, + scope-cut recommended)

**Briefing for agents**: attack ONLY the `materials`-retirement surface (steps 1–4 + the explicit
gate SQL + rollback + seed). The `field_sow`/report-screen half is OUT of the plan — do not raise
findings on it (C1–C4 are retired, not deferred). Do not re-find round-1/2 issues already addressed.

### Deployment context
- **Live tenants**: 1 — HDSP only
- **Prod / staging / dev**: the `materials` ready-gate + Sales Send-to-Schedule are LIVE in prod for HDSP
- **Blocking feature flags**: none
- **Concurrency profile**: ≤5 (small office)

Cross-tenant findings cap at Med (1 tenant); multi-user races cap at Low. Full severity only on the
destructive shared-DB drop + the gate rewrite (fail-open would silently let jobs through).

### Time budget + finding cap
- **Time budget**: 90 min
- **Finding cap**: 9 findings

### Surface
- Total lines: ~205
- [LOCKED] decisions: 0 tagged
- [OPEN] items: 0 (gate SQL now explicit; seed shape resolved)
- Plan-to-code ratio: ~205 : ~90 est ≈ 2.3:1 (retirement — plan carries the rollback + rehearsal spec)

### Layers touched
- State model / business logic (the "Ready" gate)
- Migrations / schema (destructive DROP + function rewrite + rollback)
- RLS / multi-tenancy (dropping 5 `materials` policies; preserving tenant scope in the rewrite)
- Data layer (Sales Send-to-Schedule stop-insert)
- Cross-repo (sales-command + command-suite-db — NOT field-command anymore)

### New mechanisms introduced
- None (pure retirement + one added rehearsal seed script). Net novelty: zero.

### Cross-system reach
- 2 repos: sales-command (stop-write), command-suite-db (migration)
- Service-role / bypass: `job_base_checklist_passes()` is `SECURITY DEFINER`; migration runs as superuser on shared prod

### Irreversibility
- **`DROP TABLE public.materials`** — destructive DDL on shared prod. Full-inverse rollback specified;
  any historical `materials` rows are still lost on drop (no reader depends on them — confirm at verify).
- Gate rewrite — reversible (function redefine), enforced live.

### Known weak points
- **Gate rewrite fail-open risk** — the two-part SQL must stay default-deny; a refactor back to a
  single `NOT EXISTS` reintroduces fail-open on empty trackers.
- **Rollback fidelity** — must be byte-faithful to baseline (CHECK, seq default, seq grants, ownership).
- **Deploy ordering** — Sales stop-insert must be prod-live (Vercel deploy-complete for the SHA)
  before the drop; verified by deploy state, not bundle inspection.
- **Stale baseline** — job_material_lines status sourced from migration `20260731130000`, not baseline.
- **All call sites** — `job_base_checklist_passes()` has 7 callers (trigger `:1032` + 6 null-out
  queries); the rewrite must keep every one correct.

### Suggested attack angles (2 total)
1. **Migration correctness + gate fail-open** — covers Migrations/schema, State model, RLS. Required
   reading: `prod_public_schema.sql` (`job_base_checklist_passes:925`, `materials_recheck_parents:1279`,
   trigger `:1032`, call sites `:311/:324/:341/:1299/:1312/:1329`, all 5 policies), migration
   `20260731130000`, `sch queries.js:60-104`. Pressure: does the two-part SQL truly fail closed on
   empty + status NULL? Tenant join correct? DROP order safe? Rollback byte-faithful (CHECK, seq
   default+grants+ownership, gate revert)? Does the seed+assertion actually prove the fail-closed path?
2. **Stop-write completeness + deploy ordering** — covers Data layer, Cross-repo. Required reading:
   grep census of `from('materials')` across all repos, `ProposalDetail.jsx` Send flow. Pressure: is
   `:788` truly the ONLY remaining `materials` writer (edge fn / cron / other repo)? Is the
   deploy-complete verify gate sound? Historical `materials` data loss acceptable (QB/reporting)?

### Suggested agent count: 2

Rationale: scope collapsed to 2 repos and one concentrated danger zone (the migration). A 3rd agent
would re-plow the migration angle; the report-screen angle that justified the 3rd is gone.
