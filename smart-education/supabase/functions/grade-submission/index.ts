// ============================================================
//  Edge function: grade-submission
//  Student-only (called right after they submit an assessment).
//  Sends every short/essay answer to Gemini in one call, asking
//  for a score out of each question's max_marks plus one or two
//  lines of feedback, then writes the results with the service
//  role (bypassing RLS) and totals the submission.
//  MCQ answers are already scored client-side before this runs
//  (same trust model as Skilling's client-graded MCQs) \u2014 this
//  function only ever grades the written answers.
//
//  Deploy:  supabase functions deploy grade-submission
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
      console.error('Missing Supabase env vars');
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
      return json({ error: 'Only a student can submit for grading' }, 403);
    }

    let body: any = {};
    try { body = await req.json(); } catch { return json({ error: 'Bad request body' }, 400); }
    const submissionId = parseInt(body.submissionId);
    if (!submissionId) return json({ error: 'submissionId is required' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: submission } = await admin
      .from('assessment_submissions').select('*').eq('id', submissionId).single();
    if (!submission || submission.student_id !== profile.student_id) {
      return json({ error: 'Submission not found' }, 404);
    }

    // already graded (e.g. the student refreshed) \u2014 just return the stored result
    if (submission.status === 'graded') {
      const { data: answers } = await admin
        .from('assessment_answers').select('*').eq('submission_id', submissionId);
      return json({ totalScore: submission.total_score, maxScore: submission.max_score, answers: answers || [] });
    }

    const { data: answers } = await admin
      .from('assessment_answers').select('*, assessment_questions(*)').eq('submission_id', submissionId);
    if (!answers || !answers.length) return json({ error: 'No answers found for this submission' }, 404);

    const toGrade = answers.filter((a: any) =>
      a.assessment_questions && (a.assessment_questions.type === 'short' || a.assessment_questions.type === 'essay'));

    let aiResults: Record<number, { score: number; feedback: string }> = {};

    if (toGrade.length) {
      const key = (Deno.env.get('GEMINI_API_KEY_STUDENT') || Deno.env.get('GEMINI_API_KEY') || '').trim();
      if (!key) {
        // no key configured \u2014 fail written answers open with a neutral note rather
        // than blocking the whole submission
        toGrade.forEach((a: any) => { aiResults[a.question_id] = { score: 0, feedback: 'Auto-grading is not set up yet \u2014 a teacher will grade this by hand.' }; });
      } else {
        const items = toGrade.map((a: any, i: number) => ({
          idx: i,
          questionId: a.question_id,
          question: a.assessment_questions.question,
          modelAnswer: a.assessment_questions.model_answer || '(no model answer given \u2014 use general subject knowledge)',
          maxMarks: a.assessment_questions.max_marks,
          studentAnswer: (a.answer_text || '').slice(0, 2000)
        }));

        const prompt =
          'You are grading a school student\u2019s written exam answers. For each item below, compare the ' +
          'student\u2019s answer to the model answer / key points, and judge it fairly \u2014 full marks for a ' +
          'correct answer in the student\u2019s own words, partial marks for a partially correct or incomplete ' +
          'answer, and low marks for a wrong or blank answer. Give one short sentence of encouraging, specific ' +
          'feedback (what was right, what was missing) for each.\n\n' +
          'Return ONLY minified JSON, no markdown: {"results": [{"idx": 0, "score": 2, "feedback": "..."}]}\n' +
          'score must be an integer from 0 to maxMarks for that item.\n\n' +
          'Items:\n' + JSON.stringify(items.map(({ idx, question, modelAnswer, maxMarks, studentAnswer }) =>
            ({ idx, question, modelAnswer, maxMarks, studentAnswer })));

        const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.0-flash';
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 30000);
        try {
          const gRes = await fetch(
            'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                  temperature: 0.2, maxOutputTokens: 4096,
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
          clearTimeout(timer);

          if (gRes.ok) {
            const data = await gRes.json();
            const rawText = (data?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || '').join('').trim();
            const parsed = JSON.parse(rawText.replace(/^```json\s*|\s*```$/g, ''));
            const results = Array.isArray(parsed?.results) ? parsed.results : [];
            results.forEach((r: any) => {
              const item = items[r.idx];
              if (!item) return;
              const score = Math.max(0, Math.min(item.maxMarks, Math.round(Number(r.score) || 0)));
              aiResults[item.questionId] = { score, feedback: String(r.feedback || '').slice(0, 400) };
            });
          } else {
            console.error('grade-submission: Gemini error', gRes.status, await gRes.text());
          }
        } catch (e) {
          clearTimeout(timer);
          console.error('grade-submission: Gemini call failed', e);
        }

        // anything the model skipped (parse hiccup, timeout) gets a safe fallback
        // rather than being left ungraded forever
        items.forEach(item => {
          if (!aiResults[item.questionId]) {
            aiResults[item.questionId] = { score: 0, feedback: 'Could not auto-grade this answer \u2014 a teacher will review it.' };
          }
        });
      }
    }

    // ---- write results + totals ----
    let totalScore = 0, maxScore = 0;
    for (const a of answers) {
      const q = a.assessment_questions;
      maxScore += q.max_marks;
      if (q.type === 'mcq') {
        totalScore += Number(a.score) || 0;
      } else {
        const r = aiResults[a.question_id];
        if (r) {
          await admin.from('assessment_answers').update({ score: r.score, feedback: r.feedback }).eq('id', a.id);
          totalScore += r.score;
        }
      }
    }

    await admin.from('assessment_submissions')
      .update({ status: 'graded', total_score: totalScore, max_score: maxScore, graded_at: new Date().toISOString() })
      .eq('id', submissionId);

    const { data: finalAnswers } = await admin
      .from('assessment_answers').select('*').eq('submission_id', submissionId);

    return json({ totalScore, maxScore, answers: finalAnswers || [] });

  } catch (err) {
    console.error('grade-submission crashed:', err);
    return json({ error: 'Grading failed: ' + String((err as any)?.message ?? err) }, 500);
  }
});
