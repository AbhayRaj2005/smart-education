-- ============================================================
-- One-time speed fix for an ALREADY-RUNNING Smart Education
-- Supabase project. Paste this whole file into the SQL editor
-- and run it once — it only replaces functions and adds indexes,
-- it does not touch existing tables, data, or policies.
--
-- What was slow: auth_role()/auth_student_id()/auth_teacher_id()/
-- auth_teacher_classes() read the `profiles` table, but `profiles`
-- itself has row-level security that calls auth_role() — so every
-- policy check on every table was re-triggering profiles' RLS.
-- Marking these SECURITY DEFINER makes them read profiles directly,
-- without re-entering RLS, which is the standard Supabase pattern
-- for this exact situation.
-- ============================================================

create or replace function auth_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function auth_student_id() returns text
language sql stable security definer set search_path = public as $$
  select student_id from profiles where id = auth.uid()
$$;

create or replace function auth_teacher_id() returns text
language sql stable security definer set search_path = public as $$
  select teacher_id from profiles where id = auth.uid()
$$;

create or replace function auth_teacher_classes() returns setof text
language sql stable security definer set search_path = public as $$
  select class_id from teacher_classes where teacher_id = auth_teacher_id()
$$;

-- indexes the RLS policies filter on for almost every read
create index if not exists students_class_id      on students (class_id);
create index if not exists marks_student_id        on marks (student_id);
create index if not exists fee_instalments_student on fee_instalments (student_id);
