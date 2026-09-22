# Pre-demo polish checklist

Run through this after deploying `schema-assessment.sql` and the three new
Edge Functions (see `AI-SETUP.md`). Nothing here can be verified from inside
this chat — it needs your actual Supabase project and a Gemini key, so treat
this as your own pass, not something already done for you.

## End-to-end per role

- [ ] **Admin**: create a class/teacher/student if you don't have test data;
      confirm they show up correctly across portals.
- [ ] **Teacher**: Assessment tab → generate a paper (try 0 MCQ / some short
      / some essay too, not just the default mix) → review the draft →
      Publish → confirm it disappears from "draft" and shows under
      "published" → View results before any student has submitted (should
      say "No submissions yet", not error).
- [ ] **Student**: Assessment tab → take the published paper → submit →
      confirm MCQ score is instant and short/essay feedback appears within
      a few seconds → refresh the page → confirm the graded result is still
      there (doesn't re-submit or re-grade).
- [ ] **Skilling**: both **Start/Retry** (seeded) and **✨ AI practice**
      (Gemini) buttons work on at least one Beginner and one locked→unlocked
      level.
- [ ] **AI tutor**: ask a question in a subject where the student has a
      *failed* `skill_attempts` row, and confirm the tone/content changes
      (slower explanation, mentions practising again) vs. a subject with no
      failed attempts.

## Error states to actually trigger, not just read about

- [ ] Temporarily set a bad `GEMINI_API_KEY` (`supabase secrets set
      GEMINI_API_KEY=invalid`, redeploy) and confirm:
  - Tutor shows a friendly error, not a raw stack trace.
  - Assessment **Generate with AI** shows a red inline error, button
    re-enables.
  - Skilling **✨ AI practice** silently falls back to the seeded quiz
    (toast, not a dead end).
  - Restore the real key afterward and redeploy.
- [ ] Turn off wifi / block `generativelanguage.googleapis.com` briefly and
      repeat the above — these are the "network fail" cases judges may ask
      about.
- [ ] Submit an assessment with a blank short/essay answer — confirm it
      still grades (low score + feedback like "no answer given"), rather
      than hanging.

## Docs

- [ ] `README.md` — add a short "What's AI vs what's CRUD" section (or link
      to the table in `AI-SETUP.md`) so a reader doesn't have to dig through
      code to find out.
- [ ] Keep `AI-SETUP.md` and `DEMO-SCRIPT.md` in the repo root — judges
      reading the repo (not just watching the demo) will find them.
- [ ] Screenshot/record the flow in `DEMO-SCRIPT.md`'s "if live demo fails"
      section *after* the above checks pass, so the backup isn't showing a
      bug.
