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
