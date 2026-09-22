-- ============================================================
--  Forgot-password support.
--  Run this once in the Supabase SQL editor (Project → SQL editor
--  → New query → paste → Run). Safe to re-run.
-- ============================================================

-- Every account gets one personal recovery email, set the first
-- time they use "Forgot password?". Nobody has one yet, so it
-- starts empty.
alter table profiles
  add column if not exists recovery_email text;

-- One-time codes. A row is created when someone asks for an OTP
-- and consumed (or it just expires) when they use it.
create table if not exists password_resets (
  id          bigserial primary key,
  profile_id  uuid not null references profiles(id) on delete cascade,
  email       text not null,
  otp_hash    text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz default now()
);

create index if not exists password_resets_profile_idx
  on password_resets(profile_id);

-- Only the edge functions (service role) ever touch this table —
-- no anon/authenticated policy is needed, so RLS stays on with no
-- policies, which blocks the browser from reading or writing it.
alter table password_resets enable row level security;
