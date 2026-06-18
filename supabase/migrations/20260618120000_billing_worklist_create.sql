-- ============================================================
-- billing-forecast §6.1: create billing_worklist table.
-- Per-job operational state for the billing triage worklist — the
-- MANUAL overrides only (auto-derivable status/amounts/dates are read
-- read-only from canonical Sales tables; we store nothing of those).
--
-- One sparse row per job that needs a manual flag (absence = "no override").
-- Keyed on job_id (matches billing_log/materials and the job_changes audit
-- chain). Writes route through queries.setBillingWorklistFlag (audit-logged).
--
-- RLS: jobs has no tenant_id column; scope via the
-- jobs.call_log_id -> call_log.tenant_id chain, exactly like job_wtcs
-- (plan §6.3). updated_at uses sch-command's OWN tg_set_updated_at()
-- (already defined at 20260528120000) — do NOT CREATE OR REPLACE the
-- sales-owned set_updated_at() (plan N4/E1, clobber risk).
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS public.billing_worklist (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          int8 NOT NULL REFERENCES public.jobs(job_id) ON DELETE CASCADE,
  hold_sales      boolean NOT NULL DEFAULT false,
  hold_reason     text,
  nothing_to_bill boolean NOT NULL DEFAULT false,
  terms_override  int,           -- per-invoice/job terms override (15/30/45/60/75/90); NULL = use customers.billing_terms (§4.2)
  chris_notes     text,          -- the Excel "Chris Notes" column
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One row per job (sparse). Unique so setBillingWorklistFlag can upsert ON CONFLICT (job_id).
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_worklist_job_id_uniq
  ON public.billing_worklist(job_id);

-- Constrain terms_override to the allowed set, or NULL (plan §6.1).
ALTER TABLE public.billing_worklist
  DROP CONSTRAINT IF EXISTS billing_worklist_terms_override_chk;
ALTER TABLE public.billing_worklist
  ADD CONSTRAINT billing_worklist_terms_override_chk CHECK (
    terms_override IS NULL OR terms_override IN (15, 30, 45, 60, 75, 90)
  );

COMMENT ON TABLE public.billing_worklist IS
  'Per-job manual overrides for the billing triage worklist (hold_sales, '
  'nothing_to_bill, terms_override, chris_notes). Sparse: absence = no override. '
  'Auto-derived status/amounts/dates are read read-only from canonical Sales tables.';

-- ── §6.3 updated_at touch trigger (references existing tg_set_updated_at) ──
DROP TRIGGER IF EXISTS billing_worklist_set_updated_at_trg ON public.billing_worklist;
CREATE TRIGGER billing_worklist_set_updated_at_trg
BEFORE UPDATE ON public.billing_worklist
FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ── RLS: scope via jobs.call_log_id -> call_log.tenant_id chain ──
ALTER TABLE public.billing_worklist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_worklist_select_authenticated ON public.billing_worklist;
CREATE POLICY billing_worklist_select_authenticated
  ON public.billing_worklist
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.jobs j
        JOIN public.call_log cl ON cl.id = j.call_log_id
       WHERE j.job_id = billing_worklist.job_id
         AND cl.tenant_id = public.get_user_tenant_id()
    )
  );

DROP POLICY IF EXISTS billing_worklist_insert_authenticated ON public.billing_worklist;
CREATE POLICY billing_worklist_insert_authenticated
  ON public.billing_worklist
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.jobs j
        JOIN public.call_log cl ON cl.id = j.call_log_id
       WHERE j.job_id = billing_worklist.job_id
         AND cl.tenant_id = public.get_user_tenant_id()
    )
  );

DROP POLICY IF EXISTS billing_worklist_update_authenticated ON public.billing_worklist;
CREATE POLICY billing_worklist_update_authenticated
  ON public.billing_worklist
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.jobs j
        JOIN public.call_log cl ON cl.id = j.call_log_id
       WHERE j.job_id = billing_worklist.job_id
         AND cl.tenant_id = public.get_user_tenant_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.jobs j
        JOIN public.call_log cl ON cl.id = j.call_log_id
       WHERE j.job_id = billing_worklist.job_id
         AND cl.tenant_id = public.get_user_tenant_id()
    )
  );

DROP POLICY IF EXISTS billing_worklist_delete_authenticated ON public.billing_worklist;
CREATE POLICY billing_worklist_delete_authenticated
  ON public.billing_worklist
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.jobs j
        JOIN public.call_log cl ON cl.id = j.call_log_id
       WHERE j.job_id = billing_worklist.job_id
         AND cl.tenant_id = public.get_user_tenant_id()
    )
  );

COMMIT;
