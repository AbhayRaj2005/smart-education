// ============================================================
//  Edge function: generate-skill-quiz
//  Student-only. Generates a fresh set of MCQ practice questions
//  for one Skilling level, on the fly, so the same level doesn't
//  give the same 4 fixed questions every retry. Nothing is saved
//  here \u2014 skilling.js uses the questions for one attempt and
//  still calls the existing submitSkillAttempt() to log the
//  result against skill_attempts, exactly like the static quiz.
//
//  If this call fails for any reason, skilling.js falls back to
//  the seeded questions in skill_questions \u2014 that table is kept
//  as the offline/no-key fallback, not replaced.
//
//  Deploy:  supabase functions deploy generate-skill-quiz
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
      return json({ error: 'Server is not configured correctly.' }, 500);
    }

    const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: auth, error: authErr } = await asCaller.auth.getUser();
    if (authErr || !auth?.user) return json({ error: 'Not signed in' }, 401);

    const { data: profile } = await asCaller
      .from('profiles').select('role, student_id').eq('id', auth.user.id).single();
    if (!profile || profile.role !== 'student' || !profile.student_id) {
      return json({ error: 'Only a student can request practice questions' }, 403);
    }

    let body: any = {};
    try { body = await req.json(); } catch { return json({ error: 'Bad request body' }, 400); }
    const skillId = String(body.skillId || '').trim();
    if (!skillId) return json({ error: 'skillId is required' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: skill } = await admin.from('skills').select('*').eq('id', skillId).single();
    if (!skill) return json({ error: 'Skill not found' }, 404);

    const { data: student } = await admin.from('students').select('class_id').eq('id', profile.student_id).single();
    const { data: cls } = await admin.from('classes').select('grade').eq('id', student?.class_id).single();
    const grade = cls?.grade || '';

    const key = (Deno.env.get('GEMINI_API_KEY') || '').trim();
    if (!key || (!key.startsWith('AIza') && !key.startsWith('AQ.'))) {
      return json({ error: 'AI practice questions are not set up yet' }, 500);
    }

    const count = 4;
    const prompt =
      'Write exactly ' + count + ' multiple-choice practice questions for a Grade ' + grade + ' student, ' +
      'subject "' + skill.subject + '", ' + skill.level + ' level, topic: "' + skill.title + '" \u2014 ' +
      (skill.description || '') + '.\n' +
      'Each question needs exactly 4 options and one correct answer. Vary the questions so they are not ' +
      'the same as a typical textbook example. Keep wording simple and age-appropriate.\n' +
      'Respond with ONLY minified JSON, no markdown: ' +
      '{"questions": [{"question": "...", "options": ["...","...","...","..."], "correctIndex": 0}]}';

    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.0-flash';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);

    let gRes: Response;
    try {
      gRes = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.8, maxOutputTokens: 2048,
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
    } catch (e) {
      clearTimeout(timer);
      return json({ error: 'Could not reach the AI service.' }, 502);
    }
    clearTimeout(timer);

    if (!gRes.ok) {
      console.error('generate-skill-quiz: Gemini error', gRes.status, await gRes.text());
      return json({ error: 'The AI service is busy right now.' }, 502);
    }

    const data = await gRes.json();
    const rawText = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('').trim();
    let parsed: any;
    try { parsed = JSON.parse(rawText.replace(/^```json\s*|\s*```$/g, '')); }
    catch { return json({ error: 'The AI response was not valid JSON.' }, 502); }

    const questions = (Array.isArray(parsed?.questions) ? parsed.questions : [])
      .filter((q: any) => q.question && Array.isArray(q.options) && q.options.length >= 2 &&
        Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < q.options.length)
      .map((q: any, i: number) => ({
        id: 'ai-' + skillId + '-' + i,          // string id, distinct from real bigint skill_questions ids
        question: String(q.question),
        options: q.options.map(String),
        correct_index: q.correctIndex
      }));

    if (!questions.length) return json({ error: 'The AI did not return any usable questions.' }, 502);

    return json({ questions });

  } catch (err) {
    console.error('generate-skill-quiz crashed:', err);
    return json({ error: 'Generation failed: ' + String((err as any)?.message ?? err) }, 500);
  }
});
