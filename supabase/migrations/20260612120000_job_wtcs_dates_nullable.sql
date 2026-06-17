-- §6.6 (SOW vertical) — DROP NOT NULL on job_wtcs.start_date AND end_date
--
-- Why: the locked "dates TBD" toggle (plan L1/§S2) lets a job_wtcs row be sent
-- to Schedule with no calendar dates yet. The create migration
-- 20260512120100_job_wtcs_create.sql declared both columns NOT NULL, so a TBD
-- send would fail to insert. Relax both to nullable. job_wtcs.field_sow stays
-- NOT NULL (§S3 always writes [] when empty).
--
-- Safety: pure constraint relaxation — additive, every existing row already
-- satisfies a nullable column. DROP NOT NULL is a no-op on an already-nullable
-- column, so re-running is idempotent in effect; no IF guard needed.
--
-- Deploy procedure (this repo CANNOT `supabase db push` — shared ledger holds
-- ~60 sibling migrations with no local file):
--   1. node scripts/check-migration-collision.mjs
--   2. paste this BEGIN/COMMIT block into the Supabase dashboard SQL editor
--   3. supabase migration repair --status applied 20260612120000
-- Per sch-command/CLAUDE.md "Pushing Migrations". Apply is gated on /buildvsplan.

BEGIN;
ALTER TABLE public.job_wtcs ALTER COLUMN start_date DROP NOT NULL;
ALTER TABLE public.job_wtcs ALTER COLUMN end_date   DROP NOT NULL;
COMMIT;
