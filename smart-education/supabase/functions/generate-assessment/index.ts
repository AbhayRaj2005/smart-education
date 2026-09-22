// ============================================================
//  Edge function: generate-assessment
//  Teacher-only. Given a class + subject + chapter, asks Gemini
//  for a mix of MCQ / short-answer / essay questions grounded in
//  the syllabus, then saves them as a draft assessment (question
//  paper). Reuses the SAME GEMINI_API_KEY secret as ask-tutor —
//  nothing new to configure. See AI-SETUP.md.
//
//  Deploy:  supabase functions deploy generate-assessment
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

const MAX_PER_TYPE = 15;

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
    if (!profile || profile.role !== 'teacher' || !profile.teacher_id) {
      return json({ error: 'Only a teacher can create an assessment' }, 403);
    }

    let body: any = {};
    try { body = await req.json(); } catch { return json({ error: 'Bad request body' }, 400); }

    const classId = String(body.classId || '').trim();
    const subject = String(body.subject || '').trim();
    const chapterTitle = body.chapterTitle ? String(body.chapterTitle).trim() : '';
    const counts = body.counts || {};
    const mcq = Math.max(0, Math.min(MAX_PER_TYPE, parseInt(counts.mcq) || 0));
    const short = Math.max(0, Math.min(MAX_PER_TYPE, parseInt(counts.short) || 0));
    const essay = Math.max(0, Math.min(MAX_PER_TYPE, parseInt(counts.essay) || 0));

    if (!classId || !subject) return json({ error: 'classId and subject are required' }, 400);
    if (mcq + short + essay === 0) return json({ error: 'Ask for at least one question' }, 400);
    if (mcq + short + essay > 25) return json({ error: 'Keep a single paper to 25 questions or fewer' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // teacher must actually teach this class
    const { data: link } = await admin
      .from('teacher_classes').select('class_id')
      .eq('teacher_id', profile.teacher_id).eq('class_id', classId).maybeSingle();
    const { data: teacherRow } = await admin
      .from('teachers').select('class_teacher_of').eq('id', profile.teacher_id).single();
    if (!link && teacherRow?.class_teacher_of !== classId) {
      return json({ error: "You don't teach this class" }, 403);
    }

    const { data: cls } = await admin.from('classes').select('grade').eq('id', classId).single();
    if (!cls) return json({ error: 'Class not found' }, 404);

    const { data: chapters } = await admin
      .from('syllabus').select('seq, title, status')
      .eq('class_id', classId).eq('subject', subject).order('seq');

    let focusLine: string;
    if (chapterTitle) {
      const match = (chapters || []).find((c: any) => c.title === chapterTitle);
      if (!match) return json({ error: 'That chapter is not on this class\u2019s syllabus' }, 400);
      focusLine = 'Base every question ONLY on this chapter: "' + chapterTitle + '".';
    } else if (chapters && chapters.length) {
      focusLine = 'Base the questions on this class\u2019s syllabus, spread across these chapters:\n' +
        chapters.map((c: any) => c.seq + '. ' + c.title).join('\n');
    } else {
      focusLine = 'No syllabus chapters are listed yet, so write general Grade ' + cls.grade + ' ' + subject + ' questions.';
    }

    const key = (Deno.env.get('GEMINI_API_KEY_TEACHER') || Deno.env.get('GEMINI_API_KEY') || '').trim();
    if (!key) return json({ error: 'The AI question generator is not set up yet \u2014 GEMINI_API_KEY is missing.' }, 500);
    if (!key.startsWith('AIza') && !key.startsWith('AQ.')) {
      return json({ error: 'The AI key does not look like a Gemini API key. Get one from https://aistudio.google.com/apikey' }, 500);
    }

    const schema =
      '{"questions": [' +
      '{"type": "mcq", "question": "...", "options": ["...","...","...","..."], "correctIndex": 0, "maxMarks": 1}, ' +
      '{"type": "short", "question": "...", "modelAnswer": "2-3 sentence ideal answer / key points a grader should look for", "maxMarks": 3}, ' +
      '{"type": "essay", "question": "...", "modelAnswer": "key points / rubric a grader should look for", "maxMarks": 5}' +
      ']}';

    const prompt =
      'You are setting an exam paper for a Grade ' + cls.grade + ' ' + subject + ' class at an Indian school.\n' +
      focusLine + '\n\n' +
      'Write exactly ' + mcq + ' multiple-choice questions, ' + short + ' short-answer questions, and ' +
      essay + ' essay/long-answer questions (skip a type entirely if its count is 0).\n' +
      'Questions must be age-appropriate for Grade ' + cls.grade + ', clearly worded, and cover different parts of the material \u2014 do not repeat the same idea.\n' +
      'For "mcq": exactly 4 options, correctIndex 0-3 pointing at the right one, maxMarks 1.\n' +
      'For "short": a 1-3 sentence expected answer, maxMarks 2 or 3.\n' +
      'For "essay": a multi-part or explain-in-depth question, with a modelAnswer that lists the key points a grader should check for, maxMarks 5 or more.\n' +
      'Respond with ONLY minified JSON matching this exact shape, nothing else, no markdown fences:\n' + schema;

    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.0-flash';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);

    async function callGemini(): Promise<Response> {
      return fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.6,
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

    // A stray 503/500 from Gemini ("model overloaded") is usually gone a
    // second later \u2014 retry twice with a short backoff before telling
    // the teacher it's busy, instead of failing on the first hiccup.
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
      let friendly = 'The question generator is busy right now \u2014 try again in a moment.';
      if (gRes.status === 400 && /API key/i.test(detail)) friendly = 'The Gemini API key is invalid.';
      else if (gRes.status === 403) friendly = 'The Gemini API key is not allowed to use this model.';
      else if (gRes.status === 404) friendly = 'Model "' + model + '" was not found for this key. Try gemini-2.0-flash.';
      else if (gRes.status === 429) friendly = 'Gemini free-tier quota is exhausted. Wait a minute and try again.';
      return json({ error: friendly, status: gRes.status, detail }, 502);
    }

    const data = await gRes.json();
    const finishReason = data?.candidates?.[0]?.finishReason;
    if (data?.promptFeedback?.blockReason || finishReason === 'SAFETY') {
      return json({ error: 'The AI declined to generate this paper. Try a different chapter.' }, 502);
    }

    const rawText = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('').trim();
    let parsed: any;
    try {
      parsed = JSON.parse(rawText.replace(/^```json\s*|\s*```$/g, ''));
    } catch (e) {
      console.error('Could not parse Gemini JSON:', rawText.slice(0, 500));
      return json({ error: 'The AI response was not valid JSON \u2014 try generating again.' }, 502);
    }

    const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
    if (!questions.length) return json({ error: 'The AI did not return any questions \u2014 try again.' }, 502);

    // ---- validate & normalise ----
    const clean: any[] = [];
    for (const q of questions) {
      const type = q.type;
      if (!['mcq', 'short', 'essay'].includes(type)) continue;
      if (!q.question || !String(q.question).trim()) continue;

      if (type === 'mcq') {
        const options = Array.isArray(q.options) ? q.options.map(String).slice(0, 6) : [];
        const correctIndex = Number.isInteger(q.correctIndex) ? q.correctIndex : -1;
        if (options.length < 2 || correctIndex < 0 || correctIndex >= options.length) continue;
        clean.push({ type, question: String(q.question), options, correct_index: correctIndex, model_answer: null, max_marks: 1 });
      } else {
        clean.push({
          type, question: String(q.question),
          options: null, correct_index: null,
          model_answer: q.modelAnswer ? String(q.modelAnswer) : null,
          max_marks: Math.max(1, Math.min(10, parseInt(q.maxMarks) || (type === 'essay' ? 5 : 3)))
        });
      }
    }
    if (!clean.length) return json({ error: 'The AI response did not contain any usable questions \u2014 try again.' }, 502);

    // ---- persist as a draft the teacher can review before publishing ----
    const title = (chapterTitle ? chapterTitle : subject) + ' \u2014 AI question paper';
    const { data: assessment, error: aErr } = await admin
      .from('assessments')
      .insert({
        class_id: classId, subject, chapter_title: chapterTitle || null,
        title, created_by: profile.teacher_id, status: 'draft', source: 'ai'
      })
      .select('id').single();
    if (aErr) { console.error(aErr); return json({ error: 'Could not save the assessment.' }, 500); }

    const rows = clean.map((q, i) => ({ assessment_id: assessment.id, seq: i + 1, ...q }));
    const { error: qErr } = await admin.from('assessment_questions').insert(rows);
    if (qErr) {
      console.error(qErr);
      await admin.from('assessments').delete().eq('id', assessment.id);
      return json({ error: 'Could not save the generated questions.' }, 500);
    }

    return json({ assessmentId: assessment.id, title, count: clean.length });

  } catch (err) {
    console.error('generate-assessment crashed:', err);
    return json({ error: 'Generation failed: ' + String((err as any)?.message ?? err) }, 500);
  }
});
