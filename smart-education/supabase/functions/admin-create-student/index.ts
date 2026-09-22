// ============================================================
//  Edge function: admin-create-student
//  Called from the admin panel's "+ Add Student" form. Creates
//  the login account (Supabase auth user), the profiles row,
//  and the students row — all three, in one call, so the admin
//  never has to open the Supabase dashboard.
//
//  Only a signed-in admin can call this: the caller's access
//  token is checked, then their profiles.role must be 'admin'.
//
//  Deploy:  supabase functions deploy admin-create-student
//
//  Body:    { name, classId, roll, parentName, parentPhone,
//             admissionNo?, dob?, address?, bloodGroup?, house? }
//  Returns: { ok: true, id, password }   (password: show it to
//            the admin once — it is not stored anywhere in
//            plain text, and not shown again)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const LOGIN_EMAIL_DOMAIN = 'smarteducation.internal'; // must match config.js emailDomain

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

function randomPassword() {
  // 10 random chars from a safe alphabet, plus one digit and one
  // symbol so it always passes typical password rules.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint32Array(10));
  let pw = Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
  return pw + '#' + (crypto.getRandomValues(new Uint32Array(1))[0] % 10);
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.error('Missing Supabase env vars');
      return json({ error: 'Server is not configured correctly.' }, 500);
    }

    // ---- who is calling? ----
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'Sign in required' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: callerData, error: callerErr } = await admin.auth.getUser(token);
    if (callerErr || !callerData?.user) return json({ error: 'Sign in required' }, 401);

    const { data: callerProfile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', callerData.user.id)
      .maybeSingle();

    if (!callerProfile || callerProfile.role !== 'admin') {
      return json({ error: 'Only an admin can add students' }, 403);
    }

    // ---- validate the new student's details ----
    let body: any = {};
    try { body = await req.json(); } catch { return json({ error: 'Bad request body' }, 400); }

    const name = String(body.name || '').trim();
    const classId = String(body.classId || '').trim().toUpperCase();
    const roll = String(body.roll || '').trim();
    const parentName = String(body.parentName || '').trim();
    const parentPhone = String(body.parentPhone || '').trim();
    const admissionNo = String(body.admissionNo || '').trim() || null;
    const dob = String(body.dob || '').trim() || null;
    const address = String(body.address || '').trim() || null;
    const bloodGroup = String(body.bloodGroup || '').trim() || null;
    const house = String(body.house || '').trim() || null;

    if (!name) return json({ error: 'Enter the student\'s name' }, 400);
    if (!classId) return json({ error: 'Pick a class' }, 400);
    if (!roll) return json({ error: 'Enter a roll number' }, 400);
    if (!parentPhone) return json({ error: 'Enter a parent phone number' }, 400);

    const { data: cls } = await admin.from('classes').select('id').eq('id', classId).maybeSingle();
    if (!cls) return json({ error: 'That class does not exist yet — add it first' }, 400);

    const id = 'STU-' + classId + '-' + roll.padStart(2, '0');

    const { data: existingStudent } = await admin.from('students').select('id').eq('id', id).maybeSingle();
    if (existingStudent) return json({ error: 'A student with this class + roll number already exists' }, 409);

    // ---- 1. students row ----
    const { error: studentErr } = await admin.from('students').insert({
      id, name, roll, class_id: classId,
      admission_no: admissionNo, dob,
      parent_name: parentName || null, parent_phone: parentPhone,
      address, blood_group: bloodGroup, house
    });
    if (studentErr) {
      console.error('students insert failed:', studentErr);
      return json({ error: studentErr.message || 'Could not save the student record' }, 500);
    }

    // ---- 2. auth user (login account) ----
    const password = randomPassword();
    const loginEmail = id.toLowerCase() + '@' + LOGIN_EMAIL_DOMAIN;

    const { data: created, error: userErr } = await admin.auth.admin.createUser({
      email: loginEmail,
      password,
      email_confirm: true,
      user_metadata: { user_code: id, role: 'student', full_name: name }
    });

    if (userErr || !created?.user) {
      console.error('createUser failed:', userErr);
      await admin.from('students').delete().eq('id', id); // roll back the student row
      return json({ error: userErr?.message || 'Could not create the login account' }, 500);
    }

    // ---- 3. profiles row (links the login to this student record) ----
    const { error: profileErr } = await admin.from('profiles').insert({
      id: created.user.id, user_code: id, role: 'student',
      full_name: name, student_id: id
    });

    if (profileErr) {
      console.error('profiles insert failed:', profileErr);
      await admin.auth.admin.deleteUser(created.user.id); // roll back the auth user
      await admin.from('students').delete().eq('id', id);  // roll back the student row
      return json({ error: profileErr.message || 'Could not link the login to the student' }, 500);
    }

    return json({ ok: true, id, password });

  } catch (err) {
    console.error('admin-create-student crashed:', err);
    return json({ error: 'Something went wrong: ' + String((err as any)?.message ?? err) }, 500);
  }
});
