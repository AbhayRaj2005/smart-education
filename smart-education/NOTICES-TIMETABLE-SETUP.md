# Notices + Timetable edit — setup

Do cheezein nayi hain:

1. **Notices** — admin aur teacher notice likh ke publish karte hain
   ("aaj Maths ki class Science lab mein hogi"). Student jab portal kholta
   hai to **header ke neeche ek bar** dikhta hai jisme likha hota hai kis
   ne post kiya (naam + Admin/Teacher) aur kya likha hai. Bar har page pe
   rehta hai, scroll karne pe bhi upar chipka rehta hai. Student ke sidebar
   mein **Notices** page bhi hai jahan saari notices padh sakta hai.
2. **Timetable edit** — admin kisi bhi class ka koi bhi period click karke
   subject / teacher / room badal sakta hai. Teacher ko ab **My schedule**
   milta hai (uske saare periods ek jagah, saari classes mein).

Koi nayi API key ya Edge Function nahi chahiye.

## Step 1 — SQL run karo (sabse zaroori)
Supabase → **SQL Editor** → **New query** → `supabase/schema-notices-timetable.sql`
ka poora content paste karo → **Run**. Dobara run karna safe hai.

Ye karta hai:
- `notices` table banata hai (RLS ke saath)
- **admin ko timetable likhne ki permission** deta hai (pehle koi nahi de sakta tha)

Ye step chhoda to notices "load nahi hui" dikhayega aur timetable save
karne pe error aayega.

## Step 2 — Files copy karo
**NAYI files**
- `assets/js/modules/notices.js`
- `assets/css/notices.css`
- `supabase/schema-notices-timetable.sql`

**UPDATE hui files**
- `admin.html`, `teacher.html`, `student.html`
- `assets/js/pages/admin.js`, `teacher.js`, `student.js`
- `assets/js/modules/timetable.js`
- `assets/js/core/backend.js`, `assets/js/core/i18n.js`
- `assets/js/data/api.js`, `assets/js/data/school-data.js`

## Step 3 — Deploy (git push / vercel --prod)

## Step 4 — Test karo
1. **Teacher** (`TCH-01`) → **Notices** → headline likho, audience mein apni
   class chuno → **Publish notice**.
2. **Student** (us class ka, jaise `STU-8A-03`) → header ke neeche bar
   dikhna chahiye. 60 second ke andar bina refresh ke bhi aa jata hai.
3. **Admin** (`ADM-001`) → **Notices** → "Whole school" chuno → publish.
   Har class ke student ko dikhega.
4. **Admin** → **Timetable** → koi period click karo → subject/teacher
   badlo → **Save**.

## Kaun kya kar sakta hai

| | Admin | Teacher | Student |
|---|---|---|---|
| Notice likhna | poore school ya kisi bhi class ko | sirf apni classes ko | — |
| Notice delete karna | kisi ki bhi | sirf apni | — |
| Notice dekhna | sab | apni classes + poore school | apni class + poore school |
| Timetable edit | haan | nahi | nahi |
| Timetable dekhna | sab classes + teacher-wise | My schedule + apni classes | apni class |

Ye rules sirf screen pe nahi, **database (RLS) mein** lage hain — koi
browser se chhed-chhad karke bhi kisi aur ke naam se notice nahi daal
sakta; author ka naam/role database khud lagata hai.

## Dhyan dene wali baatein
- **Teacher poore school ko notice nahi bhej sakta** — sirf admin. Agar
  teachers ko bhi allow karna hai to `notices_insert` policy mein badlav
  karna hoga.
- **Timetable mein clash**: agar ek teacher ek hi period mein do classes mein
  hai to wo cell laal dikhta hai. Naya clash banane se editor rokta hai
  (busy teacher disabled dikhta hai). Seed data mein pehle se kai clashes
  hain — wo admin ko laal dikhenge, unhe ek-ek karke theek kar sakte ho.
- Timetable edit student/teacher ko **agli baar portal kholne pe** dikhta
  hai (notices ki tarah live nahi).
- Agar editor mein "X abhi is class ko assign nahi hai" dikhe, to us teacher
  ko `teacher_classes` mein us class se jodna hoga, warna wo us class ki
  attendance/notice nahi kar payega.
- Demo mode (`demo: true` in config.js) mein sab kuch browser ke
  localStorage mein chalta hai — sirf dikhane ke liye.
