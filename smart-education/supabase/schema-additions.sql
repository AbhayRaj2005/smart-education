-- ============================================================
--  Smart Education — schema additions
--  Adds: Skilling (skill tracks + quizzes + certificates),
--        Study Plan (auto-generated day-by-day study workflow),
--        Tutor progress log (for the tutor's progress panel).
--
--  Run this ONCE in the Supabase dashboard → SQL editor, after
--  schema.sql and seed.sql have already been run.
--  No new API key is needed — everything here uses the same
--  Supabase anon key already in assets/js/core/config.js, and
--  the AI tutor keeps using the GEMINI_API_KEY you already set.
-- ============================================================

-- ---------- Skilling ----------

create table if not exists skills (
  id          text primary key,             -- 'MATHEMATICS-1'
  subject     text not null,
  level       text not null check (level in ('Beginner','Intermediate','Advanced')),
  seq         int  not null,                 -- 1 = Beginner, 2 = Intermediate, 3 = Advanced
  title       text not null,
  description text,
  pass_pct    int  not null default 70,
  unique (subject, seq)
);

create table if not exists skill_questions (
  id            bigserial primary key,
  skill_id      text references skills(id) on delete cascade,
  seq           int  not null,
  question      text not null,
  options       jsonb not null,              -- ["opt A","opt B","opt C","opt D"]
  correct_index int  not null,
  unique (skill_id, seq)
);

create table if not exists skill_attempts (
  id           bigserial primary key,
  student_id   text references students(id) on delete cascade,
  skill_id     text references skills(id) on delete cascade,
  score_pct    int  not null,
  passed       boolean not null,
  attempted_at timestamptz default now()
);
create index if not exists skill_attempts_student on skill_attempts (student_id, skill_id, attempted_at desc);

create table if not exists skill_certificates (
  id         bigserial primary key,
  student_id text references students(id) on delete cascade,
  subject    text not null,
  issued_at  timestamptz default now(),
  unique (student_id, subject)
);

-- ---------- Study plan ----------

create table if not exists study_plans (
  id          bigserial primary key,
  student_id  text references students(id) on delete cascade,
  target_date date,
  created_at  timestamptz default now()
);
create index if not exists study_plans_student on study_plans (student_id, created_at desc);

create table if not exists study_plan_items (
  id            bigserial primary key,
  plan_id       bigint references study_plans(id) on delete cascade,
  item_date     date not null,
  subject       text not null,
  chapter_title text not null,
  task_type     text not null default 'learn' check (task_type in ('learn','revise','practice')),
  done          boolean not null default false,
  seq           int not null default 1
);
create index if not exists study_plan_items_plan on study_plan_items (plan_id, item_date, seq);

-- ---------- Tutor progress log ----------
-- One row per question asked. Powers the "Progress" panel on the
-- tutor page — no AI call, just a log of what the student asked.

create table if not exists tutor_log (
  id         bigserial primary key,
  student_id text references students(id) on delete cascade,
  subject    text,
  question   text not null,
  asked_at   timestamptz default now()
);
create index if not exists tutor_log_student on tutor_log (student_id, asked_at desc);

-- ============================================================
--  Row level security — same pattern as schema.sql
-- ============================================================

alter table skills             enable row level security;
alter table skill_questions    enable row level security;
alter table skill_attempts     enable row level security;
alter table skill_certificates enable row level security;
alter table study_plans        enable row level security;
alter table study_plan_items   enable row level security;
alter table tutor_log          enable row level security;

-- catalog: everyone signed in may read it (like syllabus / timetable)
create policy read_skills on skills for select to authenticated using (true);
create policy read_skill_questions on skill_questions for select to authenticated using (true);

-- a student's own attempts; admin sees all; a teacher sees their own classes
create policy read_skill_attempts on skill_attempts for select to authenticated using (
  auth_role() = 'admin' or student_id = auth_student_id()
  or student_id in (select id from students where class_id in (select auth_teacher_classes()))
);
create policy write_skill_attempts on skill_attempts for insert to authenticated with check (
  student_id = auth_student_id()
);

create policy read_skill_certs on skill_certificates for select to authenticated using (
  auth_role() = 'admin' or student_id = auth_student_id()
  or student_id in (select id from students where class_id in (select auth_teacher_classes()))
);
create policy write_skill_certs on skill_certificates for insert to authenticated with check (
  student_id = auth_student_id()
);

-- a student manages only their own plan
create policy read_study_plans on study_plans for select to authenticated using (
  auth_role() = 'admin' or student_id = auth_student_id()
);
create policy write_study_plans on study_plans for all to authenticated
  using (student_id = auth_student_id()) with check (student_id = auth_student_id());

create policy read_plan_items on study_plan_items for select to authenticated using (
  plan_id in (select id from study_plans where student_id = auth_student_id())
  or auth_role() = 'admin'
);
create policy write_plan_items on study_plan_items for all to authenticated using (
  plan_id in (select id from study_plans where student_id = auth_student_id())
) with check (
  plan_id in (select id from study_plans where student_id = auth_student_id())
);

create policy read_tutor_log on tutor_log for select to authenticated using (
  auth_role() = 'admin' or student_id = auth_student_id()
  or student_id in (select id from students where class_id in (select auth_teacher_classes()))
);
create policy write_tutor_log on tutor_log for insert to authenticated with check (
  student_id = auth_student_id()
);

-- ============================================================
--  Seed: 3 levels × 4 questions for four core subjects.
--  Edit / add more rows any time from the Supabase table editor —
--  the app reads whatever is in these tables, nothing is hard-coded.
-- ============================================================

insert into skills (id, subject, level, seq, title, description) values
  ('MATHEMATICS-1', 'Mathematics', 'Beginner',     1, 'Number sense',        'Place value, the four operations, and basic word problems.'),
  ('MATHEMATICS-2', 'Mathematics', 'Intermediate', 2, 'Fractions & ratios',  'Working confidently with fractions, decimals and simple ratios.'),
  ('MATHEMATICS-3', 'Mathematics', 'Advanced',     3, 'Algebra basics',      'Simple equations and using variables to solve problems.'),
  ('SCIENCE-1',     'Science',     'Beginner',     1, 'Scientific method',   'Observation, hypothesis, and fair testing.'),
  ('SCIENCE-2',     'Science',     'Intermediate', 2, 'Matter & materials',  'States of matter and everyday physical changes.'),
  ('SCIENCE-3',     'Science',     'Advanced',     3, 'Life processes',      'How living things grow, respire and respond.'),
  ('ENGLISH-1',     'English',     'Beginner',     1, 'Grammar basics',      'Parts of speech, tenses and sentence structure.'),
  ('ENGLISH-2',     'English',     'Intermediate', 2, 'Reading comprehension', 'Understanding and interpreting a short passage.'),
  ('ENGLISH-3',     'English',     'Advanced',     3, 'Writing & vocabulary', 'Choosing precise words and writing clear sentences.'),
  ('COMPUTER SCIENCE-1', 'Computer Science', 'Beginner',     1, 'Computer basics', 'Hardware, software and how a computer stores data.'),
  ('COMPUTER SCIENCE-2', 'Computer Science', 'Intermediate', 2, 'Logical thinking', 'Sequences, loops and simple algorithms.'),
  ('COMPUTER SCIENCE-3', 'Computer Science', 'Advanced',     3, 'Problem solving',  'Breaking a problem down into steps a computer can follow.')
on conflict (id) do nothing;

insert into skill_questions (skill_id, seq, question, options, correct_index) values
  ('MATHEMATICS-1', 1, 'What is the value of the digit 7 in 4,725?', '["7","70","700","7000"]', 2),
  ('MATHEMATICS-1', 2, '128 + 256 = ?', '["374","384","394","404"]', 1),
  ('MATHEMATICS-1', 3, '9 × 8 = ?', '["63","72","81","64"]', 1),
  ('MATHEMATICS-1', 4, 'A shop had 240 pencils and sold 96. How many are left?', '["134","144","154","164"]', 1),
  ('MATHEMATICS-2', 1, 'Which fraction is the same as 0.5?', '["1/5","1/4","1/2","2/5"]', 2),
  ('MATHEMATICS-2', 2, '3/4 + 1/4 = ?', '["1/2","1","4/8","3/8"]', 1),
  ('MATHEMATICS-2', 3, 'A class has 12 boys and 18 girls. What is the ratio of boys to girls in simplest form?', '["2:3","3:2","1:2","12:18"]', 0),
  ('MATHEMATICS-2', 4, 'What is 25% of 200?', '["25","50","75","100"]', 1),
  ('MATHEMATICS-3', 1, 'Solve for x: x + 7 = 15', '["6","7","8","9"]', 2),
  ('MATHEMATICS-3', 2, 'Solve for x: 3x = 21', '["6","7","8","9"]', 1),
  ('MATHEMATICS-3', 3, 'Simplify: 2x + 3x', '["5x","6x","2x3x","x5"]', 0),
  ('MATHEMATICS-3', 4, 'If y = 2x + 1 and x = 4, what is y?', '["7","8","9","10"]', 2),
  ('SCIENCE-1', 1, 'What is a testable guess called in science?', '["A theory","A hypothesis","A law","A fact"]', 1),
  ('SCIENCE-1', 2, 'What should you change only one of in a fair test?', '["Variable","Result","Observer","Equipment brand"]', 0),
  ('SCIENCE-1', 3, 'Which is a scientific tool for measuring temperature?', '["Thermometer","Barometer","Ammeter","Ruler"]', 0),
  ('SCIENCE-1', 4, 'Recording what you see during an experiment is called?', '["Prediction","Observation","Conclusion","Hypothesis"]', 1),
  ('SCIENCE-2', 1, 'Ice changing to water is an example of?', '["Melting","Freezing","Evaporation","Condensation"]', 0),
  ('SCIENCE-2', 2, 'Which state of matter has a fixed shape and volume?', '["Gas","Liquid","Solid","Plasma"]', 2),
  ('SCIENCE-2', 3, 'Water turning into steam is called?', '["Condensation","Evaporation","Sublimation","Freezing"]', 1),
  ('SCIENCE-2', 4, 'Mixing sugar in water is an example of?', '["A chemical reaction","A solution","A compound","An element"]', 1),
  ('SCIENCE-3', 1, 'Which organ pumps blood around the human body?', '["Lungs","Kidney","Heart","Liver"]', 2),
  ('SCIENCE-3', 2, 'Plants make their food through a process called?', '["Respiration","Photosynthesis","Digestion","Excretion"]', 1),
  ('SCIENCE-3', 3, 'Which gas do we breathe in that our cells need?', '["Carbon dioxide","Nitrogen","Oxygen","Hydrogen"]', 2),
  ('SCIENCE-3', 4, 'The process of removing waste from the body is called?', '["Respiration","Excretion","Nutrition","Growth"]', 1),
  ('ENGLISH-1', 1, 'Which word is a verb in: "She quickly ran home."?', '["She","Quickly","Ran","Home"]', 2),
  ('ENGLISH-1', 2, 'Choose the correct past tense of "go".', '["Goed","Gone","Went","Going"]', 2),
  ('ENGLISH-1', 3, 'Which sentence is correctly punctuated?', '["where are you going","Where are you going?","where are you going?","Where are you going"]', 1),
  ('ENGLISH-1', 4, 'Which word is an adjective in: "The tall boy smiled."?', '["The","Tall","Boy","Smiled"]', 1),
  ('ENGLISH-2', 1, 'The main idea of a passage is usually called the?', '["Theme","Title","Summary","Topic sentence"]', 0),
  ('ENGLISH-2', 2, 'Guessing a word''s meaning from nearby words is called?', '["Skimming","Context clues","Scanning","Proofreading"]', 1),
  ('ENGLISH-2', 3, 'Reading quickly to get the general idea is called?', '["Skimming","Scanning","Editing","Drafting"]', 0),
  ('ENGLISH-2', 4, 'A story told from the "I" point of view is in which person?', '["First person","Second person","Third person","Narrator''s person"]', 0),
  ('ENGLISH-3', 1, 'Which word means the opposite of "generous"?', '["Kind","Stingy","Wealthy","Polite"]', 1),
  ('ENGLISH-3', 2, 'Choose the better word for "very big":', '["Large","Enormous","Nice","Okay"]', 1),
  ('ENGLISH-3', 3, 'Which sentence uses the strongest verb?', '["He went fast.","He walked fast.","He sprinted.","He moved fast."]', 2),
  ('ENGLISH-3', 4, 'A word that joins two clauses, like "because" or "although", is a?', '["Noun","Preposition","Conjunction","Pronoun"]', 2),
  ('COMPUTER SCIENCE-1', 1, 'Which of these is an input device?', '["Monitor","Printer","Keyboard","Speaker"]', 2),
  ('COMPUTER SCIENCE-1', 2, 'The part of a computer that stores data permanently is?', '["RAM","CPU","Hard disk","Monitor"]', 2),
  ('COMPUTER SCIENCE-1', 3, 'Software that runs the computer itself is called?', '["An app","An operating system","A browser","A driver"]', 1),
  ('COMPUTER SCIENCE-1', 4, 'Which unit is used to measure file size?', '["Watt","Byte","Hertz","Volt"]', 1),
  ('COMPUTER SCIENCE-2', 1, 'A set of step-by-step instructions to solve a problem is called?', '["A variable","An algorithm","A loop","A file"]', 1),
  ('COMPUTER SCIENCE-2', 2, 'Repeating a set of steps is called a?', '["Condition","Loop","Function","Variable"]', 1),
  ('COMPUTER SCIENCE-2', 3, 'A yes/no decision in a program is usually written as?', '["A loop","An if statement","A variable","A comment"]', 1),
  ('COMPUTER SCIENCE-2', 4, 'What do you call a named box that stores a value in a program?', '["A loop","A variable","A function","A comment"]', 1),
  ('COMPUTER SCIENCE-3', 1, 'Breaking a big problem into smaller ones is called?', '["Debugging","Decomposition","Compiling","Formatting"]', 1),
  ('COMPUTER SCIENCE-3', 2, 'Finding and fixing an error in a program is called?', '["Debugging","Decomposition","Encryption","Rendering"]', 0),
  ('COMPUTER SCIENCE-3', 3, 'A general pattern for solving a type of problem is called a?', '["File","Algorithm","Password","Folder"]', 1),
  ('COMPUTER SCIENCE-3', 4, 'Testing a program with sample inputs to check it works is called?', '["Debugging","Test cases","Formatting","Uploading"]', 1)
on conflict (skill_id, seq) do nothing;
