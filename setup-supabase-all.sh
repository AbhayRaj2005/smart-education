#!/usr/bin/env bash
# ============================================================
#  ONE-SHOT Supabase setup — VS Code ke integrated terminal mein
#  ye poori file paste/run karo (ya "bash setup-supabase-all.sh").
#
#  NEECHE ke saare <...PLACEHOLDER...> apni asli values se badlo
#  pehle, phir run karo. Password/keys kisi ko mat dikhana.
# ============================================================
set -e   # koi command fail ho to yahin ruk jayega, aage nahi badhega

PROJECT_REF="<SUPABASE_PROJECT_REF>"
SERVICE_ROLE_KEY="<SUPABASE_SERVICE_ROLE_KEY>"

GEMINI_API_KEY="<GEMINI_API_KEY>"
GEMINI_MODEL="gemini-3.5-flash-lite"

FAST2SMS_API_KEY="<FAST2SMS_API_KEY>"
FAST2SMS_ROUTE="q"
SMS_MOCK="false"

ADMIN_PASSWORD="Kumar@123"
TEACHER_PASSWORD="Kumar@123"
STUDENT_PASSWORD="Kumar@123"

# ------------------------------------------------------------
# STEP 0 — SQL files (ye script inhe run NAHI kar sakta — Supabase
# SQL Editor hi sahi jagah hai). Dashboard -> apna project
# ($PROJECT_REF, i.e. kyfnfapfaeazivlvtmhl) -> left sidebar "SQL Editor" -> "New query"
# -> har file ka poora content copy-paste -> Run.
# EXACT ORDER (agar "already exists" error aaye to ignore, safe hai):
#   1. supabase/schema.sql
#   2. supabase/seed.sql                      (optional — demo data)
#   3. supabase/schema-additions.sql
#   4. supabase/schema-assessment.sql
#   5. supabase/schema-manual-assessment.sql
#   6. supabase/schema-notices-timetable.sql
#   7. supabase/forgot-password.sql
#   8. supabase/login-logs.sql
#   9. supabase/photos.sql
#  10. supabase/schema-timetable-auto.sql        (NEW — auto-timetable resources)
# ------------------------------------------------------------

echo "==> Supabase CLI login (browser khulega, login karo)"
supabase login

echo "==> Project link ho raha hai"
supabase link --project-ref "$PROJECT_REF"

echo "==> Saare secrets set ho rahe hain"
supabase secrets set \
  GEMINI_API_KEY="$GEMINI_API_KEY" \
  GEMINI_MODEL="$GEMINI_MODEL" \
  FAST2SMS_API_KEY="$FAST2SMS_API_KEY" \
  FAST2SMS_ROUTE="$FAST2SMS_ROUTE" \
  SMS_MOCK="$SMS_MOCK" \
  SCHOOL_NAME="ST.Thomas Public School"

echo "==> Saare Edge Functions deploy ho rahe hain"
for fn in admin-create-student admin-create-teacher ask-tutor \
          generate-assessment generate-assessment-from-photo \
          generate-skill-quiz grade-submission mark-attendance \
          request-otp verify-otp generate-syllabus-from-photo \
          generate-timetable; do
  echo "  -> deploying $fn"
  supabase functions deploy "$fn"
done

echo "==> Admin/Teacher/Student login users bana rahe hain"
npm install @supabase/supabase-js --no-save
SUPABASE_URL="https://$PROJECT_REF.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="$SERVICE_ROLE_KEY" \
ADMIN_PASSWORD="$ADMIN_PASSWORD" \
TEACHER_PASSWORD="$TEACHER_PASSWORD" \
STUDENT_PASSWORD="$STUDENT_PASSWORD" \
node tools/create-users.js

echo "==> DONE. Ab STEP 0 (SQL files) manually SQL Editor mein chala do agar abhi tak nahi kiya."
