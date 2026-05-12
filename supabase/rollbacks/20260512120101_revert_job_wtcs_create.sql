-- Rollback for M2: drop the job_wtcs table.
-- All RLS policies, indexes, and the CHECK constraint are removed with the table.
BEGIN;
DROP TABLE IF EXISTS public.job_wtcs;
COMMIT;
