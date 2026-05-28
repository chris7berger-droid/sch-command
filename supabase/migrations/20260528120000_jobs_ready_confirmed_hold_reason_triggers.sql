-- ============================================================
-- Staged/Ready card redesign — jobs schema + hybrid readiness enforcement.
-- Transcribes plan docs/plans/staged_ready_card_design.md §3.11 + §3.12.
--
-- Adds the columns the app already writes/reads (ready_confirmed_at,
-- hold_reason, updated_at) — confirmed ABSENT in prod 2026-05-28, which is
-- why Promote-to-Ready silently failed and the Ready tile never populated.
--
-- SCOPE NOTE: §11 (round-4 D3) also calls for ENABLE RLS + a SELECT policy on
-- job_changes. That is DELIBERATELY NOT in this migration:
--   - job_changes is inserted CLIENT-SIDE by updateJobField/updateJobFields
--     (queries.js:176,229,407); a SELECT-only RLS enable would default-deny
--     those inserts and break all audit logging.
--   - Per CLAUDE_RLS.md, any RLS change must follow the 10-step additive→drop
--     deploy gate (test on prod between stages) + cross-repo sibling check.
-- It ships as its own RLS-deploy task, not bundled here.
--
-- DEPENDS ON (assumed established; verify before push):
--   public.get_user_tenant_id()   — canonical tenant helper (CLAUDE_RLS.md)
--   public.call_log.tenant_id     — used by existing RLS / job_wtcs migration
--
-- PUSH PRECONDITION (CLAUDE.md RESUME ALERT): repair the reverted ledger first
--   supabase migration repair --status applied 20260512120000 20260512120100
-- then push via:  npm run db:push   (collision-check wrapper, NOT raw push)
-- ============================================================
BEGIN;

-- ── §3.11 / §3.12: new columns (idempotent) ──────────────────
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS updated_at        timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS hold_reason       text;
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS ready_confirmed_at timestamptz;

-- ── §3.11: updated_at touch trigger ──────────────────────────
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS jobs_set_updated_at_trg ON public.jobs;
CREATE TRIGGER jobs_set_updated_at_trg
BEFORE UPDATE ON public.jobs
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ── §3.12.2 step 1: base-checklist helper (SECURITY DEFINER) ──
CREATE OR REPLACE FUNCTION public.job_base_checklist_passes(p_job public.jobs)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id     uuid;
  v_has_crew      boolean;
  v_has_materials boolean;
BEGIN
  IF p_job.field_sow IS NULL THEN RETURN false; END IF;
  IF COALESCE(p_job.scheduled_start, p_job.start_date) IS NULL THEN RETURN false; END IF;

  SELECT cl.tenant_id INTO v_tenant_id
    FROM public.call_log cl
   WHERE cl.id = p_job.call_log_id;
  IF v_tenant_id IS NULL THEN RETURN false; END IF;  -- orphan job → never Ready

  SELECT EXISTS (
    SELECT 1 FROM public.job_crew jc
     JOIN public.call_log cl ON cl.id = jc.job_id     -- job_crew.job_id FKs to call_log.id
    WHERE jc.job_id = p_job.call_log_id
      AND cl.tenant_id = v_tenant_id
  ) INTO v_has_crew;
  IF NOT v_has_crew THEN RETURN false; END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM public.materials m
     JOIN public.jobs j ON j.job_id = m.job_id
     JOIN public.call_log cl ON cl.id = j.call_log_id
    WHERE m.job_id = p_job.job_id
      AND cl.tenant_id = v_tenant_id
      AND m.status IN ('Not Ordered', 'Delayed')
  ) INTO v_has_materials;
  RETURN v_has_materials;
END;
$$;

-- ── §3.12.2 step 2: BEFORE clear trigger (WHEN-gated) ─────────
CREATE OR REPLACE FUNCTION public.jobs_clear_ready_confirmed_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.job_base_checklist_passes(NEW) THEN
    PERFORM set_config('my.auto_demote', 'true', true);  -- round-4 B2 flag, txn-scoped
    NEW.ready_confirmed_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS jobs_clear_ready_confirmed_at_trg ON public.jobs;
CREATE TRIGGER jobs_clear_ready_confirmed_at_trg
BEFORE UPDATE ON public.jobs
FOR EACH ROW
WHEN (
  OLD.ready_confirmed_at IS NOT NULL
  AND NEW.ready_confirmed_at IS NOT NULL
  AND NEW.ready_confirmed_at IS NOT DISTINCT FROM OLD.ready_confirmed_at   -- round-4 B1
)
EXECUTE FUNCTION public.jobs_clear_ready_confirmed_at();

-- ── §3.12.2 step 3: AFTER audit trigger ──────────────────────
CREATE OR REPLACE FUNCTION public.jobs_log_ready_demote()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor       uuid;
  v_actor_role  text;
  v_source      text;
  v_auto_demote boolean;
BEGIN
  BEGIN
    v_actor      := (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')::uuid;
    v_actor_role := current_setting('request.jwt.claims', true)::jsonb ->> 'role';
  EXCEPTION WHEN OTHERS THEN
    v_actor      := NULL;
    v_actor_role := NULL;
  END;

  BEGIN
    v_auto_demote := current_setting('my.auto_demote', true)::boolean;
  EXCEPTION WHEN OTHERS THEN
    v_auto_demote := false;
  END;

  IF NEW.ready_confirmed_at IS NULL
     AND OLD.ready_confirmed_at IS NOT NULL THEN
    v_source := CASE
      WHEN v_auto_demote THEN 'trigger_auto_demote'
      WHEN NEW.status <> OLD.status AND OLD.status = 'On Hold' THEN 'on_hold_resume'
      ELSE 'manual_clear'
    END;
    INSERT INTO public.job_changes (job_id, call_log_id, field, old_value, new_value, changed_by, source)
    VALUES (
      NEW.job_id, NEW.call_log_id, 'ready_confirmed_at',
      OLD.ready_confirmed_at::text, NULL,
      COALESCE(v_actor::text, 'system'),
      v_source || ':' || COALESCE(v_actor_role, 'service_role')   -- round-4 D1
    );

  ELSIF NEW.ready_confirmed_at IS NOT NULL
        AND OLD.ready_confirmed_at IS NULL THEN
    INSERT INTO public.job_changes (job_id, call_log_id, field, old_value, new_value, changed_by, source)
    VALUES (
      NEW.job_id, NEW.call_log_id, 'ready_confirmed_at',
      NULL, NEW.ready_confirmed_at::text,
      COALESCE(v_actor::text, 'system'),
      'trigger_set:' || COALESCE(v_actor_role, 'service_role')    -- round-4 D2
    );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS jobs_log_ready_demote_trg ON public.jobs;
CREATE TRIGGER jobs_log_ready_demote_trg
AFTER UPDATE OF ready_confirmed_at ON public.jobs
FOR EACH ROW
WHEN (OLD.ready_confirmed_at IS DISTINCT FROM NEW.ready_confirmed_at)
EXECUTE FUNCTION public.jobs_log_ready_demote();

-- ── §3.12.2 step 4: child-table recheck (FOR EACH STATEMENT) ──
CREATE OR REPLACE FUNCTION public.job_crew_recheck_parents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_tenant uuid;
BEGIN
  v_caller_tenant := public.get_user_tenant_id();   -- NULL for service-role

  IF TG_OP = 'INSERT' THEN
    WITH affected AS (SELECT DISTINCT job_id AS call_log_id FROM new_rows),
    parents AS (
      SELECT j.* FROM public.jobs j
       JOIN affected a ON a.call_log_id = j.call_log_id
       JOIN public.call_log cl ON cl.id = j.call_log_id
      WHERE j.ready_confirmed_at IS NOT NULL
        AND (v_caller_tenant IS NULL OR cl.tenant_id = v_caller_tenant)
    )
    UPDATE public.jobs j SET ready_confirmed_at = NULL
      FROM parents p
     WHERE j.job_id = p.job_id AND NOT public.job_base_checklist_passes(p);

  ELSIF TG_OP = 'DELETE' THEN
    WITH affected AS (SELECT DISTINCT job_id AS call_log_id FROM old_rows),
    parents AS (
      SELECT j.* FROM public.jobs j
       JOIN affected a ON a.call_log_id = j.call_log_id
       JOIN public.call_log cl ON cl.id = j.call_log_id
      WHERE j.ready_confirmed_at IS NOT NULL
        AND (v_caller_tenant IS NULL OR cl.tenant_id = v_caller_tenant)
    )
    UPDATE public.jobs j SET ready_confirmed_at = NULL
      FROM parents p
     WHERE j.job_id = p.job_id AND NOT public.job_base_checklist_passes(p);

  ELSE   -- UPDATE: both transition tables available
    WITH affected AS (
      SELECT DISTINCT job_id AS call_log_id FROM new_rows
      UNION
      SELECT DISTINCT job_id AS call_log_id FROM old_rows
    ),
    parents AS (
      SELECT j.* FROM public.jobs j
       JOIN affected a ON a.call_log_id = j.call_log_id
       JOIN public.call_log cl ON cl.id = j.call_log_id
      WHERE j.ready_confirmed_at IS NOT NULL
        AND (v_caller_tenant IS NULL OR cl.tenant_id = v_caller_tenant)
    )
    UPDATE public.jobs j SET ready_confirmed_at = NULL
      FROM parents p
     WHERE j.job_id = p.job_id AND NOT public.job_base_checklist_passes(p);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS job_crew_recheck_ready_insert_trg ON public.job_crew;
CREATE TRIGGER job_crew_recheck_ready_insert_trg
AFTER INSERT ON public.job_crew
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.job_crew_recheck_parents();

DROP TRIGGER IF EXISTS job_crew_recheck_ready_update_trg ON public.job_crew;
CREATE TRIGGER job_crew_recheck_ready_update_trg
AFTER UPDATE ON public.job_crew
REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.job_crew_recheck_parents();

DROP TRIGGER IF EXISTS job_crew_recheck_ready_delete_trg ON public.job_crew;
CREATE TRIGGER job_crew_recheck_ready_delete_trg
AFTER DELETE ON public.job_crew
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.job_crew_recheck_parents();

CREATE OR REPLACE FUNCTION public.materials_recheck_parents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_tenant uuid;
BEGIN
  v_caller_tenant := public.get_user_tenant_id();   -- NULL for service-role

  IF TG_OP = 'INSERT' THEN
    WITH affected AS (SELECT DISTINCT job_id FROM new_rows),
    parents AS (
      SELECT j.* FROM public.jobs j
       JOIN affected a ON a.job_id = j.job_id
       JOIN public.call_log cl ON cl.id = j.call_log_id
      WHERE j.ready_confirmed_at IS NOT NULL
        AND (v_caller_tenant IS NULL OR cl.tenant_id = v_caller_tenant)
    )
    UPDATE public.jobs j SET ready_confirmed_at = NULL
      FROM parents p
     WHERE j.job_id = p.job_id AND NOT public.job_base_checklist_passes(p);

  ELSIF TG_OP = 'DELETE' THEN
    WITH affected AS (SELECT DISTINCT job_id FROM old_rows),
    parents AS (
      SELECT j.* FROM public.jobs j
       JOIN affected a ON a.job_id = j.job_id
       JOIN public.call_log cl ON cl.id = j.call_log_id
      WHERE j.ready_confirmed_at IS NOT NULL
        AND (v_caller_tenant IS NULL OR cl.tenant_id = v_caller_tenant)
    )
    UPDATE public.jobs j SET ready_confirmed_at = NULL
      FROM parents p
     WHERE j.job_id = p.job_id AND NOT public.job_base_checklist_passes(p);

  ELSE   -- UPDATE
    WITH affected AS (
      SELECT DISTINCT job_id FROM new_rows
      UNION
      SELECT DISTINCT job_id FROM old_rows
    ),
    parents AS (
      SELECT j.* FROM public.jobs j
       JOIN affected a ON a.job_id = j.job_id
       JOIN public.call_log cl ON cl.id = j.call_log_id
      WHERE j.ready_confirmed_at IS NOT NULL
        AND (v_caller_tenant IS NULL OR cl.tenant_id = v_caller_tenant)
    )
    UPDATE public.jobs j SET ready_confirmed_at = NULL
      FROM parents p
     WHERE j.job_id = p.job_id AND NOT public.job_base_checklist_passes(p);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS materials_recheck_ready_insert_trg ON public.materials;
CREATE TRIGGER materials_recheck_ready_insert_trg
AFTER INSERT ON public.materials
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.materials_recheck_parents();

DROP TRIGGER IF EXISTS materials_recheck_ready_update_trg ON public.materials;
CREATE TRIGGER materials_recheck_ready_update_trg
AFTER UPDATE ON public.materials
REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.materials_recheck_parents();

DROP TRIGGER IF EXISTS materials_recheck_ready_delete_trg ON public.materials;
CREATE TRIGGER materials_recheck_ready_delete_trg
AFTER DELETE ON public.materials
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.materials_recheck_parents();

-- ── round-4 G1: materials.status CHECK (NOT VALID — enforces new/updated
-- rows immediately, skips full-table validation so dirty legacy data can't
-- roll back this whole migration). VALIDATE CONSTRAINT separately later.
ALTER TABLE public.materials
  DROP CONSTRAINT IF EXISTS materials_status_check;
ALTER TABLE public.materials
  ADD CONSTRAINT materials_status_check
  CHECK (status IN ('Not Ordered', 'Ordered', 'In Stock', 'Delayed'))
  NOT VALID;

-- Trigger fire order (round-4 H1): on jobs UPDATE, BEFORE fires
-- jobs_clear_ready_confirmed_at_trg ('c') before jobs_set_updated_at_trg ('s')
-- alphabetically; AFTER fires jobs_log_ready_demote_trg. Intentional.

COMMIT;
