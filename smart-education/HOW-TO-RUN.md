# Kaise run karein — Study plan, Skilling, Tutor progress

Koi nayi API key nahi chahiye. Jo Supabase key aur GEMINI_API_KEY pehle se
`assets/js/core/config.js` / Supabase secrets mein set hai, wahi kaam
karega. Koi naya Edge Function deploy nahi karna.

## Step 1 — Supabase SQL editor kholo
supabase.com pe apne project (uqredhidiywdgenkgdnu) mein login karo →
left sidebar mein **SQL Editor** → **New query**.

## Step 2 — schema-additions.sql paste karke run karo
Is zip ke andar `supabase/schema-additions.sql` file kholo, poora content
copy karo, SQL editor mein paste karke **Run** dabao.

Ye naye tables banayega: `skills`, `skill_questions`, `skill_attempts`,
`skill_certificates`, `study_plans`, `study_plan_items`, `tutor_log` —
sabke saath row-level security (baaki app jaisi hi), aur 12 skills +
48 quiz questions seed ho jayenge.

Agar "already exists" jaisa error aaye to safe hai — matlab wo hissa
pehle se ban chuka hai, ignore kar dena.

## Step 3 — Project files replace karo
Is zip mein ye **NAYI** files hain:
- `assets/js/modules/skilling.js`
- `assets/js/modules/study-plan.js`
- `assets/css/learning.css`
- `supabase/schema-additions.sql`

Aur ye **EXISTING** files update hui hain:
- `student.html`
- `assets/js/pages/student.js`
- `assets/js/core/backend.js`
- `assets/js/core/i18n.js`
- `assets/js/modules/tutor.js`

Apne asal project (jahan tumhara `.git` aur `.vercel` hai) mein in sabko
copy-paste karke overwrite kar do.

## Step 4 — Vercel pe deploy karo
Jaise normally karte ho waise hi — `git add`, `commit`, `push` (agar
Vercel GitHub se connected hai to auto-deploy ho jayega), ya phir
`vercel --prod` chala do. Koi naya environment variable ya secret nahi
chahiye.

## Step 5 — Student login karke test karo
Deploy hone ke baad student portal open karo, kisi bhi `STU-xx-xx` ID se
login karo. Sidebar mein ab do naye items dikhenge: **Study plan** aur
**Skilling**.
- Study plan → target date daalo → **Generate plan** dabao.
- Skilling → kisi subject ka Beginner level **Start** karke quiz do.
- AI tutor page pe ab ek **Progress** panel bhi dikhega.

---

## Kya-kya add hua (short summary)

- **Skilling** (bilkul naya) — Math, Science, English, Computer Science
  mein 3-3 level (Beginner → Intermediate → Advanced), har level ek quiz,
  pass karne pe next unlock, sab 3 pass hone pe printable certificate.
- **Study plan** (naya, structured) — syllabus ke pending/ongoing
  chapters se khud-ba-khud din-wise checklist (Learn/Revise/Practice),
  target date choose kar sakte ho.
- **AI tutor** (adaptive) — subject chip select karne par ab wo subject
  backend ko bhejta hai (pehle hamesha khaali bhejta tha, isliye
  syllabus-wala hissa kabhi use hi nahi hota tha) + naya Progress panel
  (is week kitne sawaal poochhe, sabse zyada kaunsa subject, weak
  chapters ke practice suggestions).

## Jo abhi nahi kiya
Gradebook ka auto-grading / AI se quiz banana — ye tumhare screenshot
mein "Covered" bucket mein tha, "Partial"/"Missing" mein nahi, isliye
chheda nahi. Teacher/admin portal abhi students ki skill/study-plan
progress nahi dikhate — agla step ho sakta hai agar chahiye ho.
