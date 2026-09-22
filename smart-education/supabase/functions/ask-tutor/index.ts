// ============================================================
//  Edge function: ask-tutor  (fixed)
//
//  Deploy:  supabase functions deploy ask-tutor
//  Secret:  supabase secrets set GEMINI_API_KEY=AIzaSy...
//           (free key from https://aistudio.google.com/apikey)
//           Optional: supabase secrets set GEMINI_MODEL=gemini-2.0-flash
//                     supabase secrets set SCHOOL_NAME="ST.Thomas Public School"
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
      return json({ error: 'Only a student can use the tutor' }, 403);
    }

    // ---- body ----
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Bad request body' }, 400);
    }
    const { subject, question, language, history } = body;
    const imageBase64 = body.imageBase64 ? String(body.imageBase64) : '';
    const mimeType = body.mimeType ? String(body.mimeType) : 'image/jpeg';

    const hasImage = !!imageBase64;
    if ((!question || !String(question).trim()) && !hasImage) return json({ error: 'Ask something first' }, 400);
    if (question && String(question).length > 800) return json({ error: 'That question is too long' }, 400);
    if (hasImage && !/^image\//.test(mimeType)) return json({ error: 'Only image files are supported' }, 400);
    if (hasImage && imageBase64.length > 8 * 1024 * 1024 * 1.4) return json({ error: 'That photo is too large — try a smaller image' }, 400);

    // ---- Gemini key sanity check ----
    // AI Studio now issues two key formats, both valid on the native
    // generateContent endpoint via the x-goog-api-key header:
    //   - "AIzaSy..." (legacy "Standard" key)
    //   - "AQ.Ab..."  (current "Auth" key — what new keys look like now)
    const key = (Deno.env.get('GEMINI_API_KEY') || '').trim();
    if (!key) {
      return json({ error: 'The AI tutor is not set up yet — GEMINI_API_KEY is missing.' }, 500);
    }
    if (!key.startsWith('AIza') && !key.startsWith('AQ.')) {
      console.error('GEMINI_API_KEY does not look like an AI Studio key (expected "AIzaSy..." or "AQ.Ab...")');
      return json({
        error: 'The AI tutor key does not look like a Gemini API key. Get one from https://aistudio.google.com/apikey'
      }, 500);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: student } = await admin
      .from('students').select('name, class_id').eq('id', profile.student_id).single();
    if (!student) return json({ error: 'Student record not found' }, 404);

    const { data: cls } = await admin
      .from('classes').select('grade').eq('id', student.class_id).single();
    const grade = cls ? cls.grade : '';

    let outline = '(no chapters listed for this subject yet)';
    if (subject) {
      const { data: rows } = await admin
        .from('syllabus').select('seq, title, status')
        .eq('class_id', student.class_id).eq('subject', subject).order('seq');
      if (rows && rows.length) {
        outline = rows.map((r: { seq: number; title: string; status: string }) =>
          r.seq + '. ' + r.title + ' — ' + r.status
        ).join('\n');
      }
    }

    // ---- adaptive signal: topics this student failed in Skilling ----
    // This is what makes the tutor "adaptive" rather than a plain Q&A bot:
    // it knows, from skill_attempts, which topics this student is currently
    // struggling with, and is told to go gentler and suggest practice there.
    let weakLine = '';
    try {
      const { data: fails } = await admin
        .from('skill_attempts')
        .select('skill_id, passed, attempted_at, skills(subject, title, level)')
        .eq('student_id', profile.student_id)
        .eq('passed', false)
        .order('attempted_at', { ascending: false })
        .limit(15);

      const seen = new Set<string>();
      const weak: string[] = [];
      (fails || []).forEach((f: any) => {
        const s = f.skills;
        if (!s) return;
        if (subject && s.subject !== subject) return;   // keep it relevant to the current chat
        const key = s.subject + '|' + s.title;
        if (seen.has(key)) return;
        seen.add(key);
        weak.push(s.subject + ' — ' + s.title + ' (' + s.level + ')');
      });

      if (weak.length) {
        weakLine =
          'This student recently failed a Skilling practice quiz on:\n' + weak.slice(0, 3).join('\n') + '\n' +
          'If the current question touches any of these, go extra slow, break it into smaller steps with ' +
          'one worked example, and end by gently suggesting they try that Skilling quiz again once it clicks. ' +
          'Do not mention this unless it is actually relevant to what they asked.\n';
      }
    } catch (e) {
      console.error('ask-tutor: weak-topic lookup failed (non-fatal)', e);
    }

    const langLine = language === 'hi'
      ? 'Reply in Hindi, written in Devanagari script.'
      : 'Reply in English.';
    const schoolName = Deno.env.get('SCHOOL_NAME') || 'their school';

    const systemPrompt =
      'You are a patient, encouraging school tutor helping a Grade ' + grade + ' student named ' +
      student.name + ' at ' + schoolName + '.\n' +
      'Subject: ' + (subject || 'general studies') + '.\n' +
      'Their class syllabus chapters for this subject:\n' + outline + '\n\n' +
      weakLine +
      'Rules:\n' +
      '- Only help with school subjects and homework-style doubts appropriate for this grade.\n' +
      '- The student may attach a photo of a textbook page or handwritten question instead of, or along with, typing it out — read the photo carefully and answer what it asks.\n' +
      '- Explain step by step like a good teacher, in simple language, with one short example.\n' +
      '- Keep the whole answer under 180 words.\n' +
      '- ' + langLine + '\n' +
      '- Plain text only: this chat cannot render Markdown or LaTeX. Never use **bold**, *italic*, bullet dashes, headings, or $ math delimiters. Write numbers and equations in plain text, like "10 + 2 = 12".\n' +
      '- If the question has nothing to do with schoolwork, gently steer the student back to their studies.\n' +
      '- Never discuss anything unsafe, violent, or inappropriate for a school-age student.';

    const contents: any[] = [];
    (Array.isArray(history) ? history : []).slice(-6).forEach((m: any) => {
      if (m && m.text) {
        contents.push({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: String(m.text).slice(0, 500) }]
        });
      }
    });
    contents.push({
      role: 'user',
      parts: hasImage
        ? [
            { text: String(question || "Look at the attached photo and help me with the question in it.") },
            { inlineData: { mimeType, data: imageBase64 } }
          ]
        : [{ text: String(question) }]
    });

    // Google's available model keeps shifting — 2.0-flash and then
    // 2.5-flash were both retired for new users. GEMINI_MODEL lets you
    // override without redeploying if this happens again.
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-2.0-flash';

    const payload = {
      contents,
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 1024,
        // Newer Gemini models "think" before answering, and that reasoning
        // draws from the SAME token budget as the visible reply — with a
        // low maxOutputTokens the thinking alone can eat the whole budget
        // and the student sees a reply cut off mid-sentence. This is a
        // short-answer school tutor, so thinking is switched off entirely.
        thinkingConfig: { thinkingBudget: 0 }
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
      ]
    };

    // 25s timeout so a hung upstream call can't kill the worker (a bit
    // longer than before since a photo takes Gemini longer to read)
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);

    async function callGemini(): Promise<Response> {
      return fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': key          // key in a header, never in the URL
          },
          body: JSON.stringify(payload),
          signal: ctrl.signal
        }
      );
    }

    // A stray 503/500 ("model overloaded") is usually gone a second later —
    // retry twice with a short backoff before telling the student it's busy.
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
      if (attempt < 2) await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
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
      try {
        detail = JSON.parse(raw)?.error?.message ?? detail;
      } catch { /* keep raw */ }

      let friendly = 'The tutor is busy right now — try again in a moment.';
      if (gRes.status === 401 && /ACCESS_TOKEN_TYPE_UNSUPPORTED/i.test(raw)) {
        friendly = 'Google is rejecting this key on their end (ACCESS_TOKEN_TYPE_UNSUPPORTED) — a known rollout issue on some accounts with the new "AQ." key format, not a mistake in your setup. Try regenerating the key in AI Studio, or report it at https://discuss.ai.google.dev.';
      } else if (gRes.status === 400 && /API key/i.test(detail)) {
        friendly = 'The Gemini API key is invalid. Generate a new one at aistudio.google.com/apikey.';
      } else if (gRes.status === 403) {
        friendly = 'The Gemini API key is not allowed to use this model (check key restrictions / enable the Generative Language API).';
      } else if (gRes.status === 404) {
        friendly = 'Model "' + model + '" was not found for this key. Try gemini-2.0-flash or gemini-2.5-flash.';
      } else if (gRes.status === 429) {
        friendly = 'Gemini free-tier quota is exhausted. Wait a minute and try again.';
      }

      // `detail` is for you while debugging; drop it once things work.
      return json({ error: friendly, status: gRes.status, detail }, 502);
    }

    const data = await gRes.json();

    const finishReason = data?.candidates?.[0]?.finishReason;
    const blocked = data?.promptFeedback?.blockReason || finishReason === 'SAFETY';
    if (blocked) {
      return json({ reply: "I can't answer that one — let's stick to your schoolwork." });
    }

    const reply = (data?.candidates?.[0]?.content?.parts || [])
      .map((p: any) => p.text || '')
      .join('')
      .trim();

    if (!reply && finishReason === 'MAX_TOKENS') {
      console.error('ask-tutor: reply truncated by MAX_TOKENS', JSON.stringify(data?.usageMetadata));
      return json({ reply: "That answer ran a bit long — try asking again, maybe in a shorter way." });
    }

    // Safety net: the chat UI renders plain text, so strip Markdown/LaTeX
    // marks even if the model slips one in despite the prompt instruction.
    const clean = (s: string) => s
      .replace(/\$\$?(.*?)\$\$?/g, '$1')   // $x$ / $$x$$ math delimiters
      .replace(/\*\*(.*?)\*\*/g, '$1')     // **bold**
      .replace(/\*(.*?)\*/g, '$1')         // *italic*
      .replace(/^#{1,6}\s+/gm, '')         // # headings
      .replace(/^[-*]\s+/gm, '• ');        // markdown bullets -> a plain bullet

    return json({ reply: reply ? clean(reply) : "Sorry, I couldn't work that out — try asking it a different way." });

  } catch (err) {
    console.error('ask-tutor crashed:', err);
    return json({ error: 'Tutor failed: ' + String((err as any)?.message ?? err) }, 500);
  }
});
