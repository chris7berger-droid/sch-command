-- §6.1 step 0 (SOW vertical Schedule remediation) — make job_base_checklist_passes
-- WTC-aware for the SOW-present test, mirroring the JS hasFieldSow predicate (§4.1).
--
-- Finding A: the SOW test now passes if a job_wtcs row has a NON-EMPTY ARRAY
-- field_sow OR the legacy parent jobs.field_sow IS NOT NULL. The jsonb_typeof
-- guard is MANDATORY — job_wtcs.field_sow is `jsonb NOT NULL` with no array
-- CHECK, so an unguarded jsonb_array_length would RAISE on a malformed (non-array)
-- row and abort this fn (and any assignments/materials recheck that calls it).
--
-- CREATE OR REPLACE (NOT DROP): assignments_recheck_parents + the assignment
-- recheck triggers depend on this fn; a DROP would cascade them. Body is based on
-- 20260528133000 (latest — assignments-based crew signal), changing ONLY the SOW
-- test; everything else (especially the assignments crew EXISTS block) is byte-for-byte.
--
-- Deploy: dashboard-apply + `supabase migration repair --status applied 20260616120000`
-- (CLAUDE.md "Pushing Migrations"; db push does not work from this repo). Apply is
-- GATED for /buildvsplan. The JS hasFieldSow edit and this migration are one coupled
-- change — neither is correct without the other.

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
  -- [Finding A / round-3 H1] SOW-present test: WTC (array + non-empty) OR legacy parent (nullable).
  -- jsonb_typeof guard is MANDATORY: job_wtcs.field_sow is `jsonb NOT NULL` with NO array CHECK, so a
  -- malformed (non-array) row would make jsonb_array_length RAISE and abort this fn (+ any recheck calling it).
  IF NOT (
    EXISTS (SELECT 1 FROM public.job_wtcs w
             WHERE w.job_id = p_job.job_id
               AND jsonb_typeof(w.field_sow) = 'array'
               AND jsonb_array_length(w.field_sow) > 0)
    OR p_job.field_sow IS NOT NULL
  ) THEN RETURN false; END IF;

  IF COALESCE(p_job.scheduled_start, p_job.start_date) IS NULL THEN RETURN false; END IF;

  SELECT cl.tenant_id INTO v_tenant_id
    FROM public.call_log cl
   WHERE cl.id = p_job.call_log_id;
  IF v_tenant_id IS NULL THEN RETURN false; END IF;  -- orphan job → never Ready

  -- crew assigned = at least one assignment for this job (office signal)
  -- [Fold O4] THIS is the ...133000 assignments block — NOT the ...120000 job_crew one.
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
