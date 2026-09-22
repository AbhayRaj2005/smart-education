-- ============================================================
--  Login activity — who signed in, and when (teachers + students,
--  and admins too, though only admins can read the list).
--  Run this once in the Supabase SQL editor. Safe to re-run.
-- ============================================================

create table if not exists login_logs (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references profiles(id) on delete cascade,
  user_code     text not null,
  role          text not null,
  full_name     text not null,
  logged_in_at  timestamptz not null default now()
);

create index if not exists login_logs_logged_in_at on login_logs (logged_in_at desc);

alter table login_logs enable row level security;

-- Each signed-in user may write their OWN row the moment they sign in
-- (see Backend.signIn in assets/js/core/backend.js) — this just records
-- that a login happened, nothing they couldn't already prove by being
-- signed in.
drop policy if exists write_own_login on login_logs;
create policy write_own_login on login_logs for insert to authenticated
  with check (profile_id = auth.uid());

-- Only an admin can see the list.
drop policy if exists read_login_logs on login_logs;
create policy read_login_logs on login_logs for select to authenticated
  using (auth_role() = 'admin');
