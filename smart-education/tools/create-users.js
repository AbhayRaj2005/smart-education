/* ============================================================
   tools/create-users.js
   Creates one Supabase auth user per admin, teacher and student,
   and the matching profiles row that links a login to a person.

   Supabase auth needs an email, so each user code becomes
   TCH-01@yourschool.internal. Nobody has to own that address —
   the login screen builds it from the ID the person types.

   Run once, after schema.sql and seed.sql:

     npm install @supabase/supabase-js
     SUPABASE_URL=https://xxxx.supabase.co \
     SUPABASE_SERVICE_ROLE_KEY=eyJ... \
     node tools/create-users.js

   The service role key bypasses row level security. Keep it on
   your machine or in Render/Vercel env vars — never in the browser.
   ============================================================ */

const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DOMAIN = process.env.LOGIN_EMAIL_DOMAIN || 'smarteducation.internal';

if (!URL || !SERVICE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.');
  process.exit(1);
}

const db = createClient(URL, SERVICE_KEY, { auth: { persistSession: false } });

/* Passwords must be supplied at runtime and never live in the repository. */
const DEFAULT_PASSWORD = {
  admin: process.env.ADMIN_PASSWORD,
  teacher: process.env.TEACHER_PASSWORD,
  student: process.env.STUDENT_PASSWORD
};

if (Object.values(DEFAULT_PASSWORD).some(password => !password)) {
  console.error('Set ADMIN_PASSWORD, TEACHER_PASSWORD and STUDENT_PASSWORD first.');
  process.exit(1);
}

const ADMINS = [
  { code: 'ADM-001', name: 'Priya Raghavan' },
  { code: 'ADM-002', name: 'Sanjay Mitra' }
];

async function createUser(code, role, fullName, links) {
  const email = code.toLowerCase() + '@' + DOMAIN;

  const { data: created, error } = await db.auth.admin.createUser({
    email,
    password: DEFAULT_PASSWORD[role],
    email_confirm: true,
    user_metadata: { user_code: code, role, full_name: fullName }
  });

  let userId = created?.user?.id;

  if (error) {
    if (!/already/i.test(error.message)) {
      console.error('✗', code, error.message);
      return;
    }
    const { data: list } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const found = (list?.users || []).find(u => u.email === email);
    if (!found) { console.error('✗', code, 'exists but not found'); return; }
    userId = found.id;
  }

  const { error: pErr } = await db.from('profiles').upsert({
    id: userId,
    user_code: code,
    role,
    full_name: fullName,
    teacher_id: links.teacherId || null,
    student_id: links.studentId || null
  }, { onConflict: 'id' });

  if (pErr) console.error('✗ profile', code, pErr.message);
  else console.log('✓', code, '·', fullName, '·', role);
}

(async () => {
  for (const a of ADMINS) {
    await createUser(a.code, 'admin', a.name, {});
  }

  const { data: teachers } = await db.from('teachers').select('id, name');
  for (const t of teachers || []) {
    await createUser(t.id, 'teacher', t.name, { teacherId: t.id });
  }

  const { data: students } = await db.from('students').select('id, name');
  for (const s of students || []) {
    await createUser(s.id, 'student', s.name, { studentId: s.id });
  }

  console.log('\nDone. Sign in with the user ID (e.g. TCH-01) and the role password.');
})();
