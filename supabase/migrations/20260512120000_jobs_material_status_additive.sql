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
