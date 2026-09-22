-- ============================================================
--  Smart Education — Supabase schema
--  Run this in the Supabase dashboard → SQL editor → New query.
--  Then run seed.sql to load the sample school.
-- ============================================================

-- ---------- reference tables ----------
create table if not exists classes (
  id          text primary key,             -- '8A'
  grade       int  not null,
  section     text not null,
  room        text,
  created_at  timestamptz default now()
);

create table if not exists teachers (
  id               text primary key,        -- 'TCH-01'
  name             text not null,
  subject          text not null,
  phone            text,
  joined_year      text,
  class_teacher_of text references classes(id),
  created_at       timestamptz default now()
);

create table if not exists teacher_classes (
  teacher_id text references teachers(id) on delete cascade,
  class_id   text references classes(id)   on delete cascade,
  primary key (teacher_id, class_id)
);

create table if not exists students (
  id            text primary key,           -- 'STU-8A-03'
  name          text not null,
  roll          text not null,
  class_id      text references classes(id) on delete restrict,
  admission_no  text,
  dob           text,
  parent_name   text,
  parent_phone  text not null,              -- absence SMS goes here
  address       text,
  blood_group   text,
  house         text,
  created_at    timestamptz default now(),
  unique (class_id, roll)
);

create table if not exists class_subjects (
  class_id text references classes(id) on delete cascade,
  subject  text not null,
  primary key (class_id, subject)
);

-- ---------- who can sign in ----------
-- One row per auth user. user_code is what the person types on the
-- login screen (ADM-001 / TCH-01 / STU-8A-03).
create table if not exists profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  user_code  text unique not null,
  role       text not null check (role in ('admin','teacher','student')),
  full_name  text not null,
  teacher_id text references teachers(id),
  student_id text references students(id),
  language   text default 'en' check (language in ('en','hi')),
  created_at timestamptz default now()
);

-- ---------- daily records ----------
create table if not exists attendance (
  id         bigserial primary key,
  student_id text references students(id) on delete cascade,
  class_id   text references classes(id),
  taken_on   date not null default current_date,
  status     text not null check (status in ('present','absent','late')),
  marked_by  text references teachers(id),
  marked_at  timestamptz default now(),
  unique (student_id, taken_on)
);
create index if not exists attendance_class_date on attendance (class_id, taken_on);

create table if not exists marks (
  id         bigserial primary key,
  student_id text references students(id) on delete cascade,
  subject    text not null,
  exam       text not null,
  score      int  not null check (score between 0 and 100),
  max_score  int  not null default 100,
  updated_by text references teachers(id),
  updated_at timestamptz default now(),
  unique (student_id, subject, exam)
);

create table if not exists fees (
  student_id text primary key references students(id) on delete cascade,
  total      numeric(10,2) not null
);

create table if not exists fee_instalments (
  id         bigserial primary key,
  student_id text references students(id) on delete cascade,
  seq        int not null,
  amount     numeric(10,2) not null,
  due_date   date,
  paid_on    date,
  receipt_no text,
  unique (student_id, seq)
);

create table if not exists syllabus (
  id       bigserial primary key,
  class_id text references classes(id) on delete cascade,
  subject  text not null,
  seq      int  not null,
  title    text not null,
  status   text not null default 'pending' check (status in ('done','ongoing','pending')),
  unique (class_id, subject, seq)
);

create table if not exists timetable (
  id         bigserial primary key,
  class_id   text references classes(id) on delete cascade,
  weekday    int  not null check (weekday between 1 and 5),
  period     int  not null,
  subject    text not null,
  teacher_id text references teachers(id),
  room       text,
  unique (class_id, weekday, period)
);

create table if not exists sms_log (
  id          bigserial primary key,
  student_id  text references students(id) on delete set null,
  class_id    text,
  parent_name text,
  phone       text not null,
  body        text not null,
  kind        text not null default 'absent',
  status      text not null default 'sent',     -- sent | failed
  provider_id text,
  sent_by     text,
  sent_at     timestamptz default now()
);
create index if not exists sms_log_sent_at on sms_log (sent_at desc);

-- ---------- attendance summary used by the portals ----------
-- security_invoker keeps row level security applied to the caller,
-- so a student still only sees their own row.
create or replace view student_attendance_summary
with (security_invoker = true) as
select student_id,
       count(*) filter (where status in ('present','late')) as present_days,
       count(*)                                             as total_days
from attendance
group by student_id;

-- ============================================================
--  Row level security
--  A student's token must never be able to read another student.
-- ============================================================

create or replace function auth_role() returns text
language sql stable as $$
  select role from profiles where id = auth.uid()
$$;

create or replace function auth_student_id() returns text
language sql stable as $$
  select student_id from profiles where id = auth.uid()
$$;

create or replace function auth_teacher_id() returns text
language sql stable as $$
  select teacher_id from profiles where id = auth.uid()
$$;

-- classes this signed-in teacher holds
create or replace function auth_teacher_classes() returns setof text
language sql stable as $$
  select class_id from teacher_classes where teacher_id = auth_teacher_id()
$$;

alter table classes         enable row level security;
alter table teachers        enable row level security;
alter table teacher_classes enable row level security;
alter table students        enable row level security;
alter table class_subjects  enable row level security;
alter table profiles        enable row level security;
alter table attendance      enable row level security;
alter table marks           enable row level security;
alter table fees            enable row level security;
alter table fee_instalments enable row level security;
alter table syllabus        enable row level security;
alter table timetable       enable row level security;
alter table sms_log         enable row level security;

-- everyone signed in may read the timetable, classes, subjects, staff list
create policy read_classes  on classes         for select to authenticated using (true);
create policy read_subjects on class_subjects  for select to authenticated using (true);
create policy read_syllabus on syllabus        for select to authenticated using (true);
create policy read_tt       on timetable       for select to authenticated using (true);
create policy read_teachers on teachers        for select to authenticated using (true);
create policy read_tc       on teacher_classes for select to authenticated using (true);

create policy own_profile on profiles for select to authenticated
  using (id = auth.uid() or auth_role() = 'admin');

-- students: admin sees all, teacher sees their classes, student sees self
create policy read_students on students for select to authenticated using (
  auth_role() = 'admin'
  or id = auth_student_id()
  or class_id in (select auth_teacher_classes())
);
create policy write_students on students for all to authenticated
  using (auth_role() = 'admin') with check (auth_role() = 'admin');

create policy read_attendance on attendance for select to authenticated using (
  auth_role() = 'admin'
  or student_id = auth_student_id()
  or class_id in (select auth_teacher_classes())
);
create policy write_attendance on attendance for all to authenticated
  using (auth_role() = 'admin' or class_id in (select auth_teacher_classes()))
  with check (auth_role() = 'admin' or class_id in (select auth_teacher_classes()));

create policy read_marks on marks for select to authenticated using (
  auth_role() = 'admin'
  or student_id = auth_student_id()
  or student_id in (select id from students where class_id in (select auth_teacher_classes()))
);
create policy write_marks on marks for all to authenticated
  using (auth_role() = 'admin'
    or student_id in (select id from students where class_id in (select auth_teacher_classes())))
  with check (auth_role() = 'admin'
    or student_id in (select id from students where class_id in (select auth_teacher_classes())));

create policy read_fees on fees for select to authenticated using (
  auth_role() in ('admin') or student_id = auth_student_id()
);
create policy read_fee_inst on fee_instalments for select to authenticated using (
  auth_role() in ('admin') or student_id = auth_student_id()
);
create policy write_fees on fees for all to authenticated
  using (auth_role() = 'admin') with check (auth_role() = 'admin');
create policy write_fee_inst on fee_instalments for all to authenticated
  using (auth_role() = 'admin') with check (auth_role() = 'admin');

-- SMS log: admins read it; nobody writes from the browser.
-- Inserts happen in the edge function with the service role key.
create policy read_sms on sms_log for select to authenticated
  using (auth_role() = 'admin' or sent_by = auth_teacher_id());
