// ============================================================
//  Edge function: generate-assessment-from-photo
//  Teacher-only. Same job as generate-assessment, but instead of
//  asking Gemini to invent questions from the syllabus, the
//  teacher sends a photo of an actual paper question paper and
//  Gemini's vision reads it, extracts the questions (fixing up
//  formatting, filling in MCQ options/correct answers, marks)
//  and saves it as a draft the same way generate-assessment does.
//  Reuses the same GEMINI_API_KEY secret. See AI-SETUP.md.
//
//  Deploy:  supabase functions deploy generate-assessment-from-photo
//
//  Body:    { classId, subject, chapterTitle, imageBase64, mimeType }
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

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // ~8MB of base64-decoded image

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
    const imageBase64 = String(body.imageBase64 || '');
    const mimeType = String(body.mimeType || 'image/jpeg');

    if (!classId || !subject) return json({ error: 'classId and subject are required' }, 400);
    if (!imageBase64) return json({ error: 'No photo was received' }, 400);
    if (imageBase64.length > MAX_IMAGE_BYTES * 1.4) return json({ error: 'That photo is too large \u2014 try a smaller image' }, 400);
    if (!/^image\//.test(mimeType)) return json({ error: 'Only image files are supported' }, 400);

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

    const key = (Deno.env.get('GEMINI_API_KEY') || '').trim();
    if (!key) return json({ error: 'The AI question generator is not set up yet \\u2014 GEMINI_API_KEY is missing.' }, 500);

    const schema =
      '{\"questions\": [' +
      '{\"type\": \"mcq\", \"question\": \"...\", \"options\": [\"...\",\"...\",\"...\",\"...\"], \"correctIndex\": 0, \"maxMarks\": 1}, ' +
      '{\"type\": \"short\", \"question\": \"...\", \"modelAnswer\": \"2-3 sentence ideal answer / key points a grader should look for\", \"maxMarks\": 3}, ' +
      '{\"type\": \"essay\", \"question\": \"...\", \"modelAnswer\": \"key points / rubric a grader should look for\", \"maxMarks\": 5}' +
      ']}';

    const prompt =
      'This photo shows a handwritten or printed question paper for a Grade ' + cls.grade + ' ' + subject + ' class' +
      (chapterTitle ? (' on the chapter \"' + chapterTitle + '\"') : '') + '.\\n' +
      'Read every question in the photo and turn EACH ONE into an entry in the JSON shape below \\u2014 keep the same ' +
      'meaning and, where legible, the same wording. Classify each as \"mcq\" only if it already has multiple-choice ' +
      'options in the photo; otherwise use \"short\" for a one-line-answer question or \"essay\" for a longer one.\\n' +
      'If an MCQ\'s correct answer is not marked in the photo, use your own subject knowledge to pick the right option.\\n' +
      'If a question\'s marks are not printed, judge a sensible mark value from its difficulty (mcq 1, short 2-3, essay 5+).\\n' +
      'If the photo is blurry, sideways or a question is unreadable, do your best rather than skipping it; only skip ' +
      'content that truly is not a question (headers, instructions, roll-number boxes, etc).\\n' +
      'Respond with ONLY minified JSON matching this exact shape, nothing else, no markdown fences:\\n' + schema;

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
                { inlineData: { mimeType, data: imageBase64 } }
              ]
            }],
            generationConfig: {
              temperature: 0.3,
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

    // Vision calls are slower and the free tier is more prone to a
    // transient 503 "model overloaded" \u2014 retry twice with a short
    // backoff before telling the teacher it's busy.
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
      else if (gRes.status === 404) friendly = 'Model \"' + model + '\" was not found for this key. Try gemini-2.0-flash.';
      else if (gRes.status === 429) friendly = 'Gemini free-tier quota is exhausted. Wait a minute and try again.';
      return json({ error: friendly, status: gRes.status, detail }, 502);
    }

    const data = await gRes.json();
    const finishReason = data?.candidates?.[0]?.finishReason;
    if (data?.promptFeedback?.blockReason || finishReason === 'SAFETY') {
      return json({ error: 'The AI declined to read this photo. Try a clearer photo.' }, 502);
    }

    const rawText = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('').trim();
    let parsed: any;
    try {
      parsed = JSON.parse(rawText.replace(/^```json\s*|\s*```$/g, ''));
    } catch (e) {
      console.error('Could not parse Gemini JSON:', rawText.slice(0, 500));
      return json({ error: 'Could not read that photo clearly \u2014 try a clearer, well-lit photo.' }, 502);
    }

    const questions = Array.isArray(parsed?.questions) ? parsed.questions : [];
    if (!questions.length) return json({ error: 'No questions were found in that photo \u2014 try a clearer photo.' }, 502);

    // ---- validate & normalise (same rules as generate-assessment) ----
    const clean: any[] = [];
    for (const q of questions.slice(0, 30)) {
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
    if (!clean.length) return json({ error: 'Could not make usable questions out of that photo \u2014 try again.' }, 502);

    const title = (chapterTitle ? chapterTitle : subject) + ' \u2014 scanned paper';
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
      return json({ error: 'Could not save the scanned questions.' }, 500);
    }

    return json({ assessmentId: assessment.id, title, count: clean.length });

  } catch (err) {
    console.error('generate-assessment-from-photo crashed:', err);
    return json({ error: 'Generation failed: ' + String((err as any)?.message ?? err) }, 500);
  }
});
