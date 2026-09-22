-- ============================================================
--  Smart Education — Notices + editable timetable
--
--  1. notices   Admin and teachers publish notices; students (and
--               teachers) see them in the portal header.
--  2. timetable Admin gets write access (everyone else stays
--               read-only, exactly as before).
--
--  Run this ONCE in the Supabase dashboard → SQL editor, after
--  schema.sql and seed.sql. Safe to re-run.
--  No new API key or Edge Function is needed.
-- ============================================================

-- ---------- helper: which class is the signed-in student in? ----------
create or replace function auth_student_class() returns text
language sql stable security definer set search_path = public as $$
  select class_id from students
  where id = (select student_id from profiles where id = auth.uid())
$$;

-- ---------- notices ----------
create table if not exists notices (
  id             bigserial primary key,
  title          text not null check (char_length(title) between 1 and 120),
  body           text not null default '' check (char_length(body) <= 2000),
  target_class   text references classes(id) on delete cascade,  -- null = whole school
  posted_by      uuid references profiles(id) on delete set null,
  posted_by_code text,                                            -- ADM-001 / TCH-01
  posted_by_name text not null default '',
  posted_by_role text not null default 'teacher' check (posted_by_role in ('admin','teacher')),
  expires_on     date,                                            -- null = until deleted
  created_at     timestamptz default now()
);
create index if not exists notices_created on notices (created_at desc);
create index if not exists notices_class   on notices (target_class);

-- The author is stamped by the DATABASE, not the browser, so a
-- teacher cannot post "as the Principal" by editing the request.
create or replace function notices_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
declare p profiles%rowtype;
begin
  if tg_op = 'UPDATE' then
    -- editing a notice never changes who wrote it
    new.posted_by      := old.posted_by;
    new.posted_by_code := old.posted_by_code;
    new.posted_by_name := old.posted_by_name;
    new.posted_by_role := old.posted_by_role;
    new.created_at     := old.created_at;
    return new;
  end if;

  select * into p from profiles where id = auth.uid();
  if found then
    new.posted_by      := p.id;
    new.posted_by_code := p.user_code;
    new.posted_by_name := p.full_name;
    new.posted_by_role := p.role;   -- students are rejected by the check constraint (and by RLS)
  end if;
  return new;
end $$;

drop trigger if exists notices_stamp_ins on notices;
create trigger notices_stamp_ins before insert on notices
  for each row execute function notices_stamp();
drop trigger if exists notices_stamp_upd on notices;
create trigger notices_stamp_upd before update on notices
  for each row execute function notices_stamp();

alter table notices enable row level security;

drop policy if exists notices_read   on notices;
drop policy if exists notices_insert on notices;
drop policy if exists notices_update on notices;
drop policy if exists notices_delete on notices;

-- admin: everything · teacher: whole-school notices, their own classes, and their own posts
-- student: whole-school + their own class, only while not expired
create policy notices_read on notices for select to authenticated using (
  auth_role() = 'admin'
  or posted_by = auth.uid()
  or (auth_role() = 'teacher'
      and (target_class is null or target_class in (select auth_teacher_classes())))
  or (auth_role() = 'student'
      and (target_class is null or target_class = auth_student_class())
      and (expires_on is null or expires_on >= (now() at time zone 'Asia/Kolkata')::date))
);

-- admin can post to anyone; a teacher only to a class they hold
-- (teachers cannot post school-wide — that stays with the office)
create policy notices_insert on notices for insert to authenticated with check (
  auth_role() = 'admin'
  or (auth_role() = 'teacher' and target_class in (select auth_teacher_classes()))
);

-- admin can edit/remove any notice; a teacher only their own
create policy notices_update on notices for update to authenticated
  using (auth_role() = 'admin' or (auth_role() = 'teacher' and posted_by = auth.uid()))
  with check (auth_role() = 'admin'
    or (auth_role() = 'teacher' and posted_by = auth.uid()
        and target_class in (select auth_teacher_classes())));

create policy notices_delete on notices for delete to authenticated
  using (auth_role() = 'admin' or (auth_role() = 'teacher' and posted_by = auth.uid()));

-- ---------- timetable: admin may edit ----------
-- Reading was already open to every signed-in user (schema.sql).
drop policy if exists write_tt on timetable;
create policy write_tt on timetable for all to authenticated
  using (auth_role() = 'admin') with check (auth_role() = 'admin');
