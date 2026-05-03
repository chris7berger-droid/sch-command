-- ============================================================================
-- Step 1 — Tighten RLS on daily_log_entries (record of changes, applied 2026-05-03)
-- ============================================================================
--
-- BEFORE: single policy "Allow all for now" — cmd=ALL, qual=true, with_check=true
--         (anti-pattern: anon + authenticated had unrestricted CRUD)
--
-- AFTER:  three scoped policies, "Allow all" dropped
--         - SELECT: any authenticated user (read-all)
--         - INSERT: only authenticated users writing their own employee_id
--         - UPDATE: only authenticated users updating their own employee_id
--         - DELETE: forbidden (no policy = no access; audit integrity)
--
-- Applied via Supabase dashboard SQL editor (cross-repo migration history
-- conflict prevented `supabase db push` from sch-command). 6-gate pattern
-- shortened: table was empty, no Field PowerSync stream yet, no Schedule
-- reader yet — overlap-window verification was moot (nothing live to break).
-- Verified post-drop: anon INSERT returns RLS error 42501 as expected.
-- ============================================================================

create policy "daily_log_select_authenticated"
on public.daily_log_entries
for select
to authenticated
using (true);

create policy "daily_log_insert_own"
on public.daily_log_entries
for insert
to authenticated
with check (
  employee_id = (select id::text from public.team_members where auth_id = auth.uid())
);

create policy "daily_log_update_own"
on public.daily_log_entries
for update
to authenticated
using (
  employee_id = (select id::text from public.team_members where auth_id = auth.uid())
)
with check (
  employee_id = (select id::text from public.team_members where auth_id = auth.uid())
);

drop policy "Allow all for now" on public.daily_log_entries;
