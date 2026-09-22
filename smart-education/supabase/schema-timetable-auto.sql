-- ============================================================
--  Auto-timetable generator \u2014 run this once in the SQL editor.
--  Adds:
--    1. school_resources \u2014 single-row config the admin sets
--       (buildings, labs, classrooms, periods/day, shifts)
--    2. timetable.shift, timetable.room_type \u2014 so the generator
--       can tell classroom periods from lab periods and which
--       shift a class runs in
--  Safe to re-run: every statement is "if not exists" / idempotent.
-- ============================================================

create table if not exists school_resources (
  id              int primary key default 1,
  buildings       int not null default 1,
  labs            int not null default 1,
  classrooms      int not null default 10,
  periods_per_day int not null default 7,
  shifts          int not null default 1,
  updated_at      timestamptz default now(),
  check (id = 1)
);
insert into school_resources (id) values (1) on conflict (id) do nothing;

alter table timetable add column if not exists shift int not null default 1;
alter table timetable add column if not exists room_type text not null default 'classroom'
  check (room_type in ('classroom', 'lab'));

alter table school_resources enable row level security;

drop policy if exists read_resources on school_resources;
create policy read_resources on school_resources for select to authenticated using (true);

drop policy if exists write_resources on school_resources;
create policy write_resources on school_resources for all to authenticated using (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
) with check (
  exists (select 1 from profiles where id = auth.uid() and role = 'admin')
);
