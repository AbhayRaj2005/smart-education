-- ============================================================
--  Smart Education — Manual assessment creation
--  Lets a teacher (or admin) build a question paper BY HAND,
--  without the AI, from assessment.js's "Create manually" form.
--
--  Run this ONCE in the Supabase dashboard → SQL editor, after
--  schema-assessment.sql has already run.
--
--  Previously assessment_questions had no insert/update/delete
--  policy for logged-in users because only the generate-assessment
--  Edge Function (service role) wrote to it. This adds the missing
--  policies, scoped the same way assessments itself already is:
--  a teacher may only write questions into an assessment that
--  belongs to one of their own classes; admin can write into any.
-- ============================================================

drop policy if exists write_assessment_questions on assessment_questions;
create policy write_assessment_questions on assessment_questions for insert to authenticated with check (
  assessment_id in (
    select id from assessments where
      auth_role() = 'admin' or class_id in (select auth_teacher_classes())
  )
);

drop policy if exists update_assessment_questions on assessment_questions;
create policy update_assessment_questions on assessment_questions for update to authenticated using (
  assessment_id in (
    select id from assessments where
      auth_role() = 'admin' or class_id in (select auth_teacher_classes())
  )
);

drop policy if exists delete_assessment_questions on assessment_questions;
create policy delete_assessment_questions on assessment_questions for delete to authenticated using (
  assessment_id in (
    select id from assessments where
      auth_role() = 'admin' or class_id in (select auth_teacher_classes())
  )
);
