-- ============================================================================
-- Migration: Sales → Schedule → Field Workflow Refactor
-- Run against Supabase project: pbgvgjjuhnpsumnowuym
-- Date: 2026-04-14
-- ============================================================================

-- ============================================================================
-- 1a. Add call_log_id, scheduled_start, scheduled_end to jobs
-- ============================================================================

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS call_log_id INTEGER REFERENCES call_log(id);
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scheduled_start DATE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scheduled_end DATE;

CREATE INDEX IF NOT EXISTS idx_jobs_call_log_id ON jobs(call_log_id) WHERE call_log_id IS NOT NULL;

-- ============================================================================
-- 1b. Create job_changes audit table
-- ============================================================================

CREATE TABLE IF NOT EXISTS job_changes (
  id          BIGSERIAL PRIMARY KEY,
  job_id      INTEGER,
  call_log_id INTEGER,
  field       TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT,
  changed_by  TEXT NOT NULL DEFAULT 'system',
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source      TEXT NOT NULL DEFAULT 'schedule_command'
);

CREATE INDEX IF NOT EXISTS idx_job_changes_job_id ON job_changes(job_id);
CREATE INDEX IF NOT EXISTS idx_job_changes_call_log_id ON job_changes(call_log_id) WHERE call_log_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_changes_changed_at ON job_changes(changed_at DESC);

-- ============================================================================
-- 1c. Backfill existing data
-- ============================================================================

-- Populate call_log_id from the existing source_call_log_id column
UPDATE jobs
SET call_log_id = source_call_log_id::integer
WHERE source_call_log_id IS NOT NULL
  AND call_log_id IS NULL;

-- Copy existing dates into the new scheduled columns
UPDATE jobs
SET scheduled_start = start_date,
    scheduled_end   = end_date
WHERE scheduled_start IS NULL
  AND start_date IS NOT NULL;

-- ============================================================================
-- 1d. Auto "In Progress" trigger on time_punches INSERT
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_auto_in_progress()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire on clock_in punches
  IF NEW.punch_type = 'clock_in' THEN

    -- Update jobs.status via call_log_id link
    UPDATE jobs
    SET status = 'In Progress'
    WHERE call_log_id = NEW.job_id
      AND status IN ('Scheduled', 'Parked');

    -- Update call_log.stage
    UPDATE call_log
    SET stage = 'In Progress'
    WHERE id = NEW.job_id
      AND stage = 'Scheduled';

  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop if exists to allow re-running
DROP TRIGGER IF EXISTS trg_auto_in_progress ON time_punches;

CREATE TRIGGER trg_auto_in_progress
  AFTER INSERT ON time_punches
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_in_progress();
