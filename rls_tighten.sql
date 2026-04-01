-- Schedule Command: Replace anon_all policies with authenticated-only
-- Run in Supabase SQL Editor
-- Tables: jobs, crew, assignments, crew_status, work_types, materials, billing_log

-- ============================================================
-- 1. JOBS
-- ============================================================
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all_jobs ON jobs;
CREATE POLICY auth_select_jobs ON jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_insert_jobs ON jobs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY auth_update_jobs ON jobs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_delete_jobs ON jobs FOR DELETE TO authenticated USING (true);

-- ============================================================
-- 2. CREW
-- ============================================================
ALTER TABLE crew ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all_crew ON crew;
CREATE POLICY auth_select_crew ON crew FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_insert_crew ON crew FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY auth_update_crew ON crew FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_delete_crew ON crew FOR DELETE TO authenticated USING (true);

-- ============================================================
-- 3. ASSIGNMENTS
-- ============================================================
ALTER TABLE assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all_assignments ON assignments;
CREATE POLICY auth_select_assignments ON assignments FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_insert_assignments ON assignments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY auth_update_assignments ON assignments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_delete_assignments ON assignments FOR DELETE TO authenticated USING (true);

-- ============================================================
-- 4. CREW_STATUS
-- ============================================================
ALTER TABLE crew_status ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all_crew_status ON crew_status;
CREATE POLICY auth_select_crew_status ON crew_status FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_insert_crew_status ON crew_status FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY auth_update_crew_status ON crew_status FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_delete_crew_status ON crew_status FOR DELETE TO authenticated USING (true);

-- ============================================================
-- 5. WORK_TYPES
-- ============================================================
ALTER TABLE work_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all_work_types ON work_types;
CREATE POLICY auth_select_work_types ON work_types FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_insert_work_types ON work_types FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY auth_update_work_types ON work_types FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_delete_work_types ON work_types FOR DELETE TO authenticated USING (true);

-- ============================================================
-- 6. MATERIALS
-- ============================================================
ALTER TABLE materials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all_materials ON materials;
CREATE POLICY auth_select_materials ON materials FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_insert_materials ON materials FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY auth_update_materials ON materials FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_delete_materials ON materials FOR DELETE TO authenticated USING (true);

-- ============================================================
-- 7. BILLING_LOG
-- ============================================================
ALTER TABLE billing_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS anon_all_billing_log ON billing_log;
CREATE POLICY auth_select_billing_log ON billing_log FOR SELECT TO authenticated USING (true);
CREATE POLICY auth_insert_billing_log ON billing_log FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY auth_update_billing_log ON billing_log FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY auth_delete_billing_log ON billing_log FOR DELETE TO authenticated USING (true);
