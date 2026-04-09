-- Add source tracking columns to jobs table
-- Links Schedule Command jobs back to Sales Command proposals
-- Run in Supabase SQL Editor

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_proposal_id int8;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS source_call_log_id int8;

-- Prevent duplicate sends
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_source_proposal_id
  ON jobs (source_proposal_id) WHERE source_proposal_id IS NOT NULL;
