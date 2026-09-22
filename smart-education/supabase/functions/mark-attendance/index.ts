// ============================================================
//  Edge function: mark-attendance
//  Saves a whole class roll call and sends the parent SMS for
//  every student marked absent — server-side, so the SMS key
//  never reaches the browser and the message still goes out if
//  the teacher closes the tab.
//
//  Deploy:  supabase functions deploy mark-attendance
//  Secrets (Fast2SMS): supabase secrets set FAST2SMS_API_KEY=...
//    Optional, only needed once you switch to the DLT route (see
//    sendSms below): FAST2SMS_ROUTE=dlt FAST2SMS_SENDER_ID=... FAST2SMS_MESSAGE_ID=...
//    To test without sending real SMS: supabase secrets set SMS_MOCK=true
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader) return json({ error: 'Not signed in' }, 401);

  // 1. Who is calling? Use the caller's own token so RLS applies.
  const asCaller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: auth } = await asCaller.auth.getUser();
  if (!auth?.user) return json({ error: 'Not signed in' }, 401);

  const { data: profile } = await asCaller
    .from('profiles').select('role, teacher_id, full_name').eq('id', auth.user.id).single();

  if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
    return json({ error: 'Only teachers and admins can mark attendance' }, 403);
  }

  const { classId, date, marks, language } = await req.json();
  if (!classId || !Array.isArray(marks) || !marks.length) {
    return json({ error: 'classId and marks are required' }, 400);
  }
  const takenOn = date || new Date().toISOString().slice(0, 10);

  // 2. A teacher may only mark a class they actually hold.
  if (profile.role === 'teacher') {
    const { data: holds } = await asCaller
      .from('teacher_classes').select('class_id')
      .eq('teacher_id', profile.teacher_id).eq('class_id', classId).maybeSingle();
    if (!holds) return json({ error: 'You do not hold this class' }, 403);
  }

  // 3. Save the roll call.
  const rows = marks.map((m: { studentId: string; status: string }) => ({
    student_id: m.studentId,
    class_id: classId,
    taken_on: takenOn,
    status: m.status,
    marked_by: profile.teacher_id
  }));

  const { error: saveError } = await asCaller
    .from('attendance').upsert(rows, { onConflict: 'student_id,taken_on' });
  if (saveError) return json({ error: saveError.message }, 400);

  // 4. Parent SMS for every absentee. Service role: the browser
  //    must never be able to write to sms_log directly.
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const absentIds = marks.filter((m: any) => m.status === 'absent').map((m: any) => m.studentId);
  const sent: string[] = [];

  if (absentIds.length) {
    const { data: students } = await admin
      .from('students').select('id, name, roll, class_id, parent_name, parent_phone')
      .in('id', absentIds);

    for (const s of students ?? []) {
      // Skip if this parent was already told today.
      const { data: already } = await admin
        .from('sms_log').select('id')
        .eq('student_id', s.id).eq('kind', 'absent')
        .gte('sent_at', takenOn + 'T00:00:00Z').maybeSingle();
      if (already) continue;

      const body = language === 'hi'
        ? `आपका बच्चा ${s.name} (${s.class_id}) आज ${takenOn} को विद्यालय से अनुपस्थित रहा। — ${Deno.env.get('SCHOOL_NAME') ?? 'School'}`
        : `Your child ${s.name} (${s.class_id}) was marked absent today, ${takenOn}. — ${Deno.env.get('SCHOOL_NAME') ?? 'School'}`;

      const result = await sendSms(s.parent_phone, body);

      await admin.from('sms_log').insert({
        student_id: s.id,
        class_id: s.class_id,
        parent_name: s.parent_name,
        phone: s.parent_phone,
        body,
        kind: 'absent',
        status: result.ok ? 'sent' : 'failed',
        provider_id: result.id ?? null,
        sent_by: profile.teacher_id
      });

      if (result.ok) sent.push(s.id);
    }
  }

  return json({ saved: rows.length, smsSent: sent.length, absentees: absentIds.length });
});

// ---------- SMS gateway: Fast2SMS ----------
// https://www.fast2sms.com/dev/bulkV2
//
// Two routes, switchable with FAST2SMS_ROUTE (defaults to 'q'):
//   'q'   Quick/Transactional route — send free-form text straight away,
//         no DLT template needed. Good to get started / low volume.
//   'dlt' DLT-registered route — required by Indian telecom rules for
//         production-scale transactional SMS. Needs a DLT-approved
//         sender ID + message template registered with Fast2SMS first;
//         set FAST2SMS_SENDER_ID and FAST2SMS_MESSAGE_ID (the approved
//         template ID, not the raw text) once you have them.
async function sendSms(phone: string, body: string): Promise<{ ok: boolean; id?: string }> {
  if (Deno.env.get('SMS_MOCK') === 'true') {
    console.log('[SMS mock]', phone, body);
    return { ok: true, id: 'mock' };
  }

  const to = phone.replace(/[^\d]/g, '').slice(-10);
  const route = Deno.env.get('FAST2SMS_ROUTE') || 'q';

  const payload: Record<string, unknown> = { route, numbers: to, flash: 0 };
  if (route === 'dlt') {
    payload.sender_id = Deno.env.get('FAST2SMS_SENDER_ID');
    payload.message = Deno.env.get('FAST2SMS_MESSAGE_ID');
    payload.variables_values = body;
  } else {
    payload.message = body;
    payload.language = 'english';
  }

  const res = await fetch('https://www.fast2sms.com/dev/bulkV2', {
    method: 'POST',
    headers: {
      'authorization': Deno.env.get('FAST2SMS_API_KEY')!,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  const out = await res.json().catch(() => ({}));
  if (!res.ok || out?.return === false) {
    console.error('SMS failed', res.status, JSON.stringify(out));
    return { ok: false };
  }
  return { ok: true, id: out?.request_id ?? undefined };
}
