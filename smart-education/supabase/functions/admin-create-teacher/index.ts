// ============================================================
//  Edge function: admin-create-teacher
//  Called from the admin panel's "+ Add Teacher" form. Creates
//  the login account, the profiles row, the teachers row, and
//  the teacher_classes links — all in one call.
//
//  Only a signed-in admin can call this: the caller's access
//  token is checked, then their profiles.role must be 'admin'.
//
//  Deploy:  supabase functions deploy admin-create-teacher
//
//  Body:    { name, subject, phone?, joinedYear?, classTeacherOf?,
//             classes?: string[] }   (classes = ids they teach)
//  Returns: { ok: true, id, password }
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
      return json({ error: 'Only an admin can add teachers' }, 403);
    }

    // ---- validate the new teacher's details ----
    let body: any = {};
    try { body = await req.json(); } catch { return json({ error: 'Bad request body' }, 400); }

    const name = String(body.name || '').trim();
    const subject = String(body.subject || '').trim();
    const phone = String(body.phone || '').trim() || null;
    const joinedYear = String(body.joinedYear || '').trim() || null;
    const classTeacherOf = String(body.classTeacherOf || '').trim().toUpperCase() || null;
    const classes: string[] = Array.isArray(body.classes)
      ? body.classes.map((c: unknown) => String(c).trim().toUpperCase()).filter(Boolean)
      : [];

    if (!name) return json({ error: "Enter the teacher's name" }, 400);
    if (!subject) return json({ error: 'Enter the subject they teach' }, 400);

    if (classTeacherOf) {
      const { data: cls } = await admin.from('classes').select('id').eq('id', classTeacherOf).maybeSingle();
      if (!cls) return json({ error: 'That class-teacher-of class does not exist' }, 400);
    }
    for (const c of classes) {
      const { data: cls } = await admin.from('classes').select('id').eq('id', c).maybeSingle();
      if (!cls) return json({ error: `Class "${c}" does not exist` }, 400);
    }

    // ---- generate next TCH-XX id ----
    const { data: existingTeachers } = await admin.from('teachers').select('id');
    let maxNum = 0;
    (existingTeachers || []).forEach((t: any) => {
      const m = /^TCH-(\d+)$/.exec(t.id || '');
      if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
    });
    const id = 'TCH-' + String(maxNum + 1).padStart(2, '0');

    // ---- 1. teachers row ----
    const { error: teacherErr } = await admin.from('teachers').insert({
      id, name, subject, phone, joined_year: joinedYear, class_teacher_of: classTeacherOf
    });
    if (teacherErr) {
      console.error('teachers insert failed:', teacherErr);
      return json({ error: teacherErr.message || 'Could not save the teacher record' }, 500);
    }

    // ---- 2. teacher_classes links ----
    if (classes.length) {
      const links = classes.map(c => ({ teacher_id: id, class_id: c }));
      const { error: linkErr } = await admin.from('teacher_classes').insert(links);
      if (linkErr) {
        console.error('teacher_classes insert failed:', linkErr);
        await admin.from('teachers').delete().eq('id', id);
        return json({ error: linkErr.message || 'Could not link the classes' }, 500);
      }
    }

    // ---- 3. auth user (login account) ----
    const password = randomPassword();
    const loginEmail = id.toLowerCase() + '@' + LOGIN_EMAIL_DOMAIN;

    const { data: created, error: userErr } = await admin.auth.admin.createUser({
      email: loginEmail,
      password,
      email_confirm: true,
      user_metadata: { user_code: id, role: 'teacher', full_name: name }
    });

    if (userErr || !created?.user) {
      console.error('createUser failed:', userErr);
      await admin.from('teacher_classes').delete().eq('teacher_id', id);
      await admin.from('teachers').delete().eq('id', id);
      return json({ error: userErr?.message || 'Could not create the login account' }, 500);
    }

    // ---- 4. profiles row ----
    const { error: profileErr } = await admin.from('profiles').insert({
      id: created.user.id, user_code: id, role: 'teacher',
      full_name: name, teacher_id: id
    });

    if (profileErr) {
      console.error('profiles insert failed:', profileErr);
      await admin.auth.admin.deleteUser(created.user.id);
      await admin.from('teacher_classes').delete().eq('teacher_id', id);
      await admin.from('teachers').delete().eq('id', id);
      return json({ error: profileErr.message || 'Could not link the login to the teacher' }, 500);
    }

    return json({ ok: true, id, password });

  } catch (err) {
    console.error('admin-create-teacher crashed:', err);
    return json({ error: 'Something went wrong: ' + String((err as any)?.message ?? err) }, 500);
  }
});
