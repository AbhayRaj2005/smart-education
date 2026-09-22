-- ============================================================
--  Smart Education — Assessment schema addition
--  Adds AI-generated question papers, AI auto-grading of
--  short/essay answers, and (via the generate-skill-quiz
--  function, no new table needed) AI-generated Skilling practice.
--
--  Run this ONCE in the Supabase dashboard → SQL editor, after
--  schema.sql, seed.sql and schema-additions.sql have run.
--  No new API key is needed — this reuses the same GEMINI_API_KEY
--  secret already set for ask-tutor. See AI-SETUP.md.
-- ============================================================

-- ---------- Assessments (question papers) ----------

create table if not exists assessments (
  id            bigserial primary key,
  class_id      text references classes(id) on delete cascade,
  subject       text not null,
  chapter_title text,
  title         text not null,
  created_by    text references teachers(id),
  status        text not null default 'draft' check (status in ('draft','published','closed')),
  source        text not null default 'ai' check (source in ('ai','manual')),
  created_at    timestamptz default now()
);
create index if not exists assessments_class on assessments (class_id, status);

create table if not exists assessment_questions (
  id            bigserial primary key,
  assessment_id bigint references assessments(id) on delete cascade,
  seq           int  not null,
  type          text not null check (type in ('mcq','short','essay')),
  question      text not null,
  options       jsonb,              -- mcq only: ["opt A","opt B","opt C","opt D"]
  correct_index int,                -- mcq only
  model_answer  text,               -- short/essay grading key (ideal answer / key points)
  max_marks     int  not null default 1,
  unique (assessment_id, seq)
);

create table if not exists assessment_submissions (
  id            bigserial primary key,
  assessment_id bigint references assessments(id) on delete cascade,
  student_id    text references students(id) on delete cascade,
  status        text not null default 'grading' check (status in ('grading','graded')),
  total_score   numeric,
  max_score     numeric,
  submitted_at  timestamptz default now(),
  graded_at     timestamptz,
  unique (assessment_id, student_id)
);

create table if not exists assessment_answers (
  id             bigserial primary key,
  submission_id  bigint references assessment_submissions(id) on delete cascade,
  question_id    bigint references assessment_questions(id) on delete cascade,
  selected_index int,               -- mcq: student's pick
  answer_text    text,              -- short/essay: student's written answer
  score          numeric,           -- mcq: set by the browser at submit time (0/max, same
                                     -- trust model as Skilling's client-graded MCQs);
                                     -- short/essay: set by the grade-submission function
  feedback       text,              -- short/essay: one or two lines of AI feedback
  unique (submission_id, question_id)
);

-- ============================================================
--  Row level security — same helper functions as schema.sql
--  (auth_role, auth_student_id, auth_teacher_classes)
-- ============================================================

alter table assessments             enable row level security;
alter table assessment_questions    enable row level security;
alter table assessment_submissions  enable row level security;
alter table assessment_answers      enable row level security;

-- assessments: admin sees all; a teacher sees every assessment for their
-- own classes (draft or published, so they can review before publishing);
-- a student only sees PUBLISHED assessments for their own class.
create policy read_assessments on assessments for select to authenticated using (
  auth_role() = 'admin'
  or class_id in (select auth_teacher_classes())
  or (status = 'published' and class_id = (select class_id from students where id = auth_student_id()))
);
create policy write_assessments on assessments for insert to authenticated with check (
  auth_role() = 'admin' or class_id in (select auth_teacher_classes())
);
create policy update_assessments on assessments for update to authenticated using (
  auth_role() = 'admin' or class_id in (select auth_teacher_classes())
);

-- questions inherit their assessment's visibility. They are written only by
-- the generate-assessment Edge Function (service role) — never directly
-- from the browser — so there is no insert/update policy for authenticated
-- users here.
create policy read_assessment_questions on assessment_questions for select to authenticated using (
  assessment_id in (
    select id from assessments where
      auth_role() = 'admin'
      or class_id in (select auth_teacher_classes())
      or (status = 'published' and class_id = (select class_id from students where id = auth_student_id()))
  )
);

-- a student writes only their own submission; a teacher/admin can read
-- submissions for their own classes to see results.
create policy read_submissions on assessment_submissions for select to authenticated using (
  auth_role() = 'admin'
  or student_id = auth_student_id()
  or assessment_id in (select id from assessments where class_id in (select auth_teacher_classes()))
);
create policy write_submissions on assessment_submissions for insert to authenticated with check (
  student_id = auth_student_id()
);

-- answers: a student writes only into their own submission; the AI grading
-- update (score/feedback on short & essay rows) is done by the
-- grade-submission Edge Function using the service role, which bypasses
-- RLS, so no update policy is needed here either.
create policy read_answers on assessment_answers for select to authenticated using (
  auth_role() = 'admin'
  or submission_id in (select id from assessment_submissions where student_id = auth_student_id())
  or submission_id in (
    select s.id from assessment_submissions s
    join assessments a on a.id = s.assessment_id
    where a.class_id in (select auth_teacher_classes())
  )
);
create policy write_answers on assessment_answers for insert to authenticated with check (
  submission_id in (select id from assessment_submissions where student_id = auth_student_id())
);
