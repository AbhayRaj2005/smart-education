// ============================================================
//  Edge function: generate-syllabus-from-photo
//  Teacher or admin uploads a photo OR a PDF of a syllabus /
//  chapter list; Gemini's vision reads it, extracts the ordered
//  chapter titles, and REPLACES that class+subject's syllabus
//  rows with the new list (all starting at status 'pending').
//  Reuses the same GEMINI_API_KEY_TEACHER (falls back to
//  GEMINI_API_KEY) secret as the other teacher-side AI features.
//
//  Deploy:  supabase functions deploy generate-syllabus-from-photo
//
//  Body:    { classId, subject, fileBase64, mimeType }
//  Returns: { ok: true, count, subject }
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

const MAX_FILE_BYTES = 10 * 1024 * 1024; // ~10MB decoded (PDFs run bigger than photos)

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'Not signed in' }, 401);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
      console.error('Missing Supabase env vars');
      return json({ error: 'Server is not configured correctly.' }, 500);
    }

    const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: auth, error: authErr } = await asCaller.auth.getUser();
    if (authErr || !auth?.user) return json({ error: 'Not signed in' }, 401);

    const { data: profile } = await asCaller
      .from('profiles').select('role, teacher_id').eq('id', auth.user.id).single();
    if (!profile || (profile.role !== 'teacher' && profile.role !== 'admin')) {
      return json({ error: 'Only a teacher or admin can upload a syllabus' }, 403);
    }

    let body: any = {};
    try { body = await req.json(); } catch { return json({ error: 'Bad request body' }, 400); }

    const classId = String(body.classId || '').trim();
    const subject = String(body.subject || '').trim();
    const fileBase64 = String(body.fileBase64 || '');
    const mimeType = String(body.mimeType || 'image/jpeg');

    if (!classId || !subject) return json({ error: 'classId and subject are required' }, 400);
    if (!fileBase64) return json({ error: 'No file was received' }, 400);
    if (fileBase64.length > MAX_FILE_BYTES * 1.4) return json({ error: 'That file is too large \u2014 try a smaller photo or a shorter PDF' }, 400);
    if (!/^image\//.test(mimeType) && mimeType !== 'application/pdf') {
      return json({ error: 'Only image files or a PDF are supported' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // teachers may only touch a class they actually teach; admins can touch any class
    if (profile.role === 'teacher') {
      if (!profile.teacher_id) return json({ error: 'Teacher profile is incomplete' }, 403);
      const { data: link } = await admin
        .from('teacher_classes').select('class_id')
        .eq('teacher_id', profile.teacher_id).eq('class_id', classId).maybeSingle();
      const { data: teacherRow } = await admin
        .from('teachers').select('class_teacher_of').eq('id', profile.teacher_id).single();
      if (!link && teacherRow?.class_teacher_of !== classId) {
        return json({ error: "You don't teach this class" }, 403);
      }
    }

    const { data: cls } = await admin.from('classes').select('grade').eq('id', classId).single();
    if (!cls) return json({ error: 'Class not found' }, 404);

    const key = (Deno.env.get('GEMINI_API_KEY_TEACHER') || Deno.env.get('GEMINI_API_KEY') || '').trim();
    if (!key) return json({ error: 'The AI syllabus reader is not set up yet \u2014 GEMINI_API_KEY is missing.' }, 500);

    const prompt =
      'This file shows a syllabus or chapter list for a Grade ' + cls.grade + ' ' + subject + ' class.\n' +
      'Read it and list every chapter/unit/topic title, IN THE ORDER they appear \u2014 keep the ' +
      'same wording, just clean up obvious OCR noise (stray numbers, page headers, "Chapter" ' +
      'prefixes can stay or go, be consistent). Skip anything that is not actually a chapter ' +
      '(cover pages, index headers, marking-scheme notes, blank lines).\n' +
      'Respond with ONLY minified JSON, nothing else, no markdown fences: ' +
      '{"chapters": ["...", "...", "..."]}';

    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.0-flash';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 45000);

    async function callGemini(): Promise<Response> {
      return fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [
                { text: prompt },
                { inlineData: { mimeType, data: fileBase64 } }
              ]
            }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 4096,
              thinkingConfig: { thinkingBudget: 0 },
              responseMimeType: 'application/json'
            },
            safetySettings: [
              { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
              { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
              { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
              { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
            ]
          }),
          signal: ctrl.signal
        }
      );
    }

    let gRes: Response | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        gRes = await callGemini();
        if (gRes.ok || (gRes.status !== 503 && gRes.status !== 500)) break;
      } catch (e) {
        lastErr = e;
        gRes = null;
      }
      if (attempt < 2) await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
    }
    clearTimeout(timer);

    if (!gRes) {
      console.error('Gemini fetch failed:', lastErr);
      return json({ error: 'Could not reach the AI service. Try again in a moment.' }, 502);
    }

    if (!gRes.ok) {
      const raw = await gRes.text();
      console.error('Gemini error', gRes.status, raw);
      let detail = raw.slice(0, 300);
      try { detail = JSON.parse(raw)?.error?.message ?? detail; } catch { /* keep raw */ }
      let friendly = 'The syllabus reader is busy right now \u2014 try again in a moment.';
      if (gRes.status === 400 && /API key/i.test(detail)) friendly = 'The Gemini API key is invalid.';
      else if (gRes.status === 403) friendly = 'The Gemini API key is not allowed to use this model.';
      else if (gRes.status === 404) friendly = 'Model "' + model + '" was not found for this key. Try gemini-2.0-flash.';
      else if (gRes.status === 429) friendly = 'Gemini free-tier quota is exhausted. Wait a minute and try again.';
      return json({ error: friendly, status: gRes.status, detail }, 502);
    }

    const data = await gRes.json();
    const finishReason = data?.candidates?.[0]?.finishReason;
    if (data?.promptFeedback?.blockReason || finishReason === 'SAFETY') {
      return json({ error: 'The AI declined to read this file. Try a clearer photo or a text-based PDF.' }, 502);
    }

    const rawText = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('').trim();
    let parsed: any;
    try {
      parsed = JSON.parse(rawText.replace(/^```json\s*|\s*```$/g, ''));
    } catch (e) {
      console.error('Could not parse Gemini JSON:', rawText.slice(0, 500));
      return json({ error: 'Could not read that file clearly \u2014 try a clearer photo or a text-based PDF.' }, 502);
    }

    const chapters: string[] = Array.isArray(parsed?.chapters)
      ? parsed.chapters.map((c: unknown) => String(c).trim()).filter(Boolean).slice(0, 60)
      : [];
    if (!chapters.length) return json({ error: 'No chapters were found in that file \u2014 try a clearer photo or PDF.' }, 502);

    // Replace this class+subject's syllabus entirely with the freshly-read list.
    const { error: delErr } = await admin.from('syllabus').delete().eq('class_id', classId).eq('subject', subject);
    if (delErr) return json({ error: 'Could not save the syllabus: ' + delErr.message }, 500);

    const rows = chapters.map((title, i) => ({
      class_id: classId, subject, seq: i + 1, title, status: 'pending'
    }));
    const { error: insErr } = await admin.from('syllabus').insert(rows);
    if (insErr) return json({ error: 'Could not save the syllabus: ' + insErr.message }, 500);

    return json({ ok: true, count: rows.length, subject });

  } catch (err) {
    console.error('generate-syllabus-from-photo crashed:', err);
    return json({ error: 'Something went wrong: ' + String((err as any)?.message ?? err) }, 500);
  }
});
