# Hackathon ke liye exact steps (Windows PowerShell)

## ⚠️ Sabse pehle: apna secret key rotate karo
Tumhari purani `SUPABASE_SERVICE_ROLE_KEY` chat mein kayi baar likhi ja chuki
thi, isliye wo compromised maani jaani chahiye.

1. Supabase Dashboard → Project Settings → API → **Secret keys**
2. Purani `default` key ke ⋮ (three dots) → **Delete**
3. **New secret key** → naya key generate karo → copy karo
4. Is project ke andar `.env` file kholo aur `SUPABASE_SERVICE_ROLE_KEY=` ke
   aage naya key paste karo (already fix kiya hua `.env` file yahan maujood hai)

`.env` file **kabhi bhi terminal mein type nahi karni** — sirf VS Code editor
mein khol ke edit karo, phir save karo.

## Step 1 — Sahi folder mein jao
```powershell
cd smart-education
```
(Confirm karo `tools`, `supabase`, `package.json` yahin dikhein.)

## Step 2 — Dependencies install karo
```powershell
npm install
```
(Isse `@supabase/supabase-js` aur `dotenv` dono install ho jayenge — ab
`create-users.js` khud `.env` file padh lega, alag se env vars set karne ki
zaroorat nahi.)

## Step 3 — Users create karo
```powershell
npm run create-users
```
Agar ye fail ho, seedha bhi chala sakte ho:
```powershell
node tools/create-users.js
```

## Step 4 — Supabase CLI se login + link
```powershell
npm install -g supabase
supabase login
supabase link --project-ref tnzimqhdasatxbixkjzr
```

## Step 5 — Edge functions deploy karo (isi `smart-education` folder se)
```powershell
supabase functions deploy mark-attendance
supabase functions deploy request-otp
supabase functions deploy verify-otp
supabase functions deploy admin-create-student
supabase functions deploy admin-create-teacher
supabase functions deploy generate-assessment
supabase functions deploy generate-assessment-from-photo
supabase functions deploy grade-submission
supabase functions deploy generate-skill-quiz
supabase functions deploy ask-tutor
```

## Step 6 — Secrets set karo
```powershell
supabase secrets set SMS_MOCK=true SCHOOL_NAME="St Thomas Public School"
```

## Zaroori yaad rakhna
- `KEY=value` wali lines **kabhi terminal mein direct type mat karna** —
  ye sirf `.env` file ke andar jaati hain.
- `.env` file already `.gitignore` mein hai, isliye GitHub par push nahi hogi.
- Agar koi command "not recognized" ya "module not found" de, sabse pehle
  check karo ki tum sahi folder (`smart-education`) mein ho:
  ```powershell
  Get-ChildItem
  ```
