# AI features — setup

This project now uses Gemini in **four** places. All four share the exact
same secret — you do **not** need a second API key, a different key format,
or any extra billing setup beyond what `TUTOR-SETUP.md` already walked you
through for the tutor.

| Feature | Edge Function | Who calls it |
|---|---|---|
| AI tutor (existing) | `ask-tutor` | Student |
| **AI question-paper generator** (new) | `generate-assessment` | Teacher |
| **AI grading of short/essay answers** (new) | `grade-submission` | Student (auto, on submit) |
| **AI practice questions for Skilling** (new) | `generate-skill-quiz` | Student |

## 1. You already have the key

If the AI tutor works today, you're done — skip to step 2. If not, follow
`TUTOR-SETUP.md` first (get a key from https://aistudio.google.com/apikey,
`supabase secrets set GEMINI_API_KEY=...`).

### Optional: split load across two keys

One free-tier Gemini key has a shared per-minute request quota across
*everything* that uses it — teacher paper-generation and student tutor/
grading/practice included. If that quota is getting hit (errors like
`429` / "quota exceeded" / requests hanging), get a **second** free key
from https://aistudio.google.com/apikey and set both:

```bash
supabase secrets set GEMINI_API_KEY_TEACHER=AIzaSy...   # generate-assessment, generate-assessment-from-photo
supabase secrets set GEMINI_API_KEY_STUDENT=AIzaSy...   # ask-tutor, grade-submission, generate-skill-quiz
```

Each function checks its role-specific key first and falls back to the
plain `GEMINI_API_KEY` if the specific one isn't set — so this is
optional and backwards-compatible. You do NOT need to unset the old
`GEMINI_API_KEY`; keep it as the shared fallback and just add the two
above when you're ready to split the load. Redeploy after setting new
secrets:

```bash
supabase functions deploy ask-tutor
supabase functions deploy generate-assessment
supabase functions deploy generate-assessment-from-photo
supabase functions deploy generate-skill-quiz
supabase functions deploy grade-submission
```

## 2. Run the new schema

In the Supabase dashboard → SQL editor, run (in order, only the ones you
haven't already run):

```sql
-- schema.sql, seed.sql, schema-additions.sql  (existing — skip if already run)
-- then:
supabase/schema-assessment.sql   -- new: assessments, questions, submissions, answers + RLS
```

## 3. Deploy the three new functions

```bash
supabase functions deploy generate-assessment
supabase functions deploy grade-submission
supabase functions deploy generate-skill-quiz
```

No new secrets to set — they read `GEMINI_API_KEY`, `GEMINI_MODEL` (optional
override) and `SUPABASE_*` exactly like `ask-tutor` already does.

## 4. Try it

- **Teacher portal → Assessment tab**: pick a class, subject and (optionally)
  one syllabus chapter, set how many MCQ / short / essay questions you want,
  click **Generate with AI**. Review the draft, click **Publish to class**.
- **Student portal → Assessment tab**: the published paper appears. Answer
  it and submit — MCQs are scored immediately, short/essay answers come back
  graded with one-line AI feedback within a few seconds.
- **Student portal → Skilling tab**: next to the usual **Start/Retry**
  button there's now a **✨ AI practice** button — same skill, freshly
  generated questions each time instead of the same 4 seeded ones. If the
  AI call fails for any reason it falls back to the seeded quiz
  automatically (never blocks a student from practising).
- **Student portal → AI tutor tab**: unchanged UI, but the tutor now knows
  which Skilling quizzes this student has recently *failed* (from
  `skill_attempts`) and goes slower / suggests re-attempting that quiz when
  the conversation touches a weak topic. This is what makes it *adaptive*
  rather than a plain Q&A bot — see `supabase/functions/ask-tutor/index.ts`,
  the `weakLine` block.

## What's AI vs what's CRUD (say this out loud in the demo)

| Pillar | AI-powered part | Plain CRUD part |
|---|---|---|
| Tutor | Gemini answers, grounded in the student's syllabus + weak-topic awareness | Chat history, progress panel counts |
| **Assessment** | **Gemini writes the question paper from the syllabus chapter; Gemini grades every short/essay answer and writes feedback** | Publishing, listing, storing scores |
| Skilling | **Gemini generates fresh MCQ practice questions per attempt (✨ AI practice)** | Level unlock logic, certificates, seeded fallback quiz |
| Study plan | (unchanged — currently rule-based, not AI. Call this out as CRUD, don't oversell it) | Day-by-day scheduling from syllabus status |

## Error states worth testing before a live demo

- **Expired/invalid `GEMINI_API_KEY`** — `generate-assessment` and
  `grade-submission` return a clear `error` string the UI shows inline
  (see the red text under the Generate button, or the review screen for a
  submission). `generate-skill-quiz` falls back to the seeded quiz instead
  of showing an error, since practice shouldn't be blocked.
- **Network fail mid-generation** — same: a friendly error message, the
  Generate button re-enables so the teacher can retry.
- **Student closes the tab after submitting, before grading finishes** —
  safe: `grade-submission` is idempotent (checks `status = 'graded'` first),
  and reopening the assessment just re-shows the stored result once it's
  ready.
