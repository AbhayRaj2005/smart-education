# Demo script (3–4 minutes)

Say the bracketed lines out loud — judges should never have to guess where
the AI is. Have the AI Tutor tab and Assessment tab pre-loaded in two
browser windows so nothing waits on a network call live.

## 0. One-liner (10s)
"Smart Education is a full school OS — attendance, fees, gradebook, timetable
— with four places where Gemini actually does the thinking, not just the CRUD."

## 1. Admin → Teacher → Student setup (30s)
- Admin login: show a class, a teacher, a student exist. **"This part is
  plain CRUD — Supabase tables, row-level security. No AI here."**
- Log out, log in as the teacher for that class.

## 2. AI Tutor (45s) — *"AI used here: answering + adaptive difficulty"*
- Student portal → **AI tutor**. Ask a question in the student's weakest
  subject (pick one where `skill_attempts` has a failed row beforehand, so
  this pays off).
- **"Watch — this isn't a canned FAQ bot. It's grounded in this student's
  actual syllabus, and it already knows this student failed the
  {topic} Skilling quiz recently, so it explains slower and suggests
  retrying that quiz."** Point at the answer doing exactly that.

## 3. Skilling — AI practice (30s) — *"AI used here: fresh questions every attempt"*
- Student portal → **Skilling**. Click **✨ AI practice** on an unlocked
  level. **"These four questions were written by Gemini just now — not the
  same fixed 4 questions every student sees. If Gemini's unreachable it
  falls back to the seeded quiz automatically, so practice never breaks."**

## 4. Assessment — the new AI pillar (90s) — *"AI used here: writing the paper AND grading it"*
- Switch to teacher window → **Assessment** tab.
- Pick the class, subject, and a syllabus chapter. Set 3 MCQ / 2 short / 1
  essay. Click **Generate with AI**.
- **"Gemini just read this class's syllabus chapter and wrote a full paper
  — multiple choice, short answer, essay — in about {N} seconds. A teacher
  used to spend 20–30 minutes doing this by hand."**
- Scroll the draft, **Publish to class**.
- Switch to student window → **Assessment** tab → take the paper. Answer
  the MCQs, write a real short/essay answer, submit.
- **"MCQs score instantly. The short and essay answers just went to Gemini
  for grading — it compares them against the model answer, gives a score
  out of the marks, and one line of specific feedback."** Open **View
  feedback** and read one line out loud.
- **"That's the biggest gap closed — Assessment was the only pillar that
  wasn't AI-powered before. Now the teacher never writes the paper by hand
  and never manually grades a written answer."**

## 5. Wrap (15s)
"Four AI touchpoints: tutoring, adaptive difficulty, dynamic practice, and
now full assessment generation + grading — all on the same Gemini key,
all with graceful fallback if the key or network fails."

---

### If live demo fails
Keep a 60–90s screen recording of steps 3–4 (Skilling AI practice +
Assessment generate → publish → take → AI feedback) as backup, plus 3–4
screenshots: the Generate button + draft paper, the published paper on the
student side, and the AI feedback screen. These are the shots that prove
"AI wrote this" fastest to a judge skimming quickly.
