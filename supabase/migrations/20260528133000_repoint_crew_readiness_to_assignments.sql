-- ============================================================
-- Repoint the readiness "crew" signal from job_crew → assignments.
--
-- WHY: job_crew is Field Command's clock-in roster (populated post-kickoff via
-- PowerSync); nothing in sch-command writes it. The office assigns crew via the
-- Schedule, which writes `assignments` (crew_name + date). Gating "Ready to
-- kick off" on job_crew is unsatisfiable pre-kickoff — the original plan §2.2
-- flaw. Crew-assigned = at least one `assignments` row for the job.
--
-- Pairs with the frontend change (Jobs.jsx crewByCallLog now derives from
-- assignments). Same deploy path as 20260528120000 — run in the Supabase SQL
-- editor (db push doesn't work from sch-command), then:
--   supabase migration repair --status applied 20260528133000
-- ============================================================
BEGIN;

-- ── 1. Readiness helper: crew check now reads assignments ─────
-- assignments.job_id = jobs.job_id; p_job is already the tenant anchor, so a
-- direct existence check on this job's assignments is sufficient and safe.
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

  -- crew assigned = at least one assignment for this job (office signal)
  SELECT EXISTS (
    SELECT 1 FROM public.assignments a
    WHERE a.job_id = p_job.job_id
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

-- ── 2. Auto-demote recheck now watches assignments, not job_crew ──
-- Drop the job_crew recheck triggers + function (crew no longer lives there).
DROP TRIGGER IF EXISTS job_crew_recheck_ready_insert_trg ON public.job_crew;
DROP TRIGGER IF EXISTS job_crew_recheck_ready_update_trg ON public.job_crew;
DROP TRIGGER IF EXISTS job_crew_recheck_ready_delete_trg ON public.job_crew;
DROP FUNCTION IF EXISTS public.job_crew_recheck_parents();

-- assignments.job_id = jobs.job_id (direct), so affected parents key on job_id.
CREATE OR REPLACE FUNCTION public.assignments_recheck_parents()
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

DROP TRIGGER IF EXISTS assignments_recheck_ready_insert_trg ON public.assignments;
CREATE TRIGGER assignments_recheck_ready_insert_trg
AFTER INSERT ON public.assignments
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.assignments_recheck_parents();

DROP TRIGGER IF EXISTS assignments_recheck_ready_update_trg ON public.assignments;
CREATE TRIGGER assignments_recheck_ready_update_trg
AFTER UPDATE ON public.assignments
REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.assignments_recheck_parents();

DROP TRIGGER IF EXISTS assignments_recheck_ready_delete_trg ON public.assignments;
CREATE TRIGGER assignments_recheck_ready_delete_trg
AFTER DELETE ON public.assignments
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT EXECUTE FUNCTION public.assignments_recheck_parents();

COMMIT;
