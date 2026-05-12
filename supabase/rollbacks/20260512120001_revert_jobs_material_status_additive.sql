-- Rollback for M1: drop jobs.material_status column and its CHECK constraint.
BEGIN;
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_material_status_chk;
ALTER TABLE public.jobs DROP COLUMN IF EXISTS material_status;
COMMIT;
