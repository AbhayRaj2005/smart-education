# Connecting the backend (Supabase + cloud hosting)

The app still runs on sample data out of the box. Work through this once and the
same screens read and write your real school database instead — no view code changes.

## 1. Create the project

1. supabase.com → **New project**. Pick a region close to you (Mumbai / Singapore for India).
2. Save the database password it shows you.
3. **Project settings → API** gives you two keys:
   - `anon public` → goes in `assets/js/core/config.js` (safe in the browser)
   - `service_role` → **never** in any file under `assets/`. Only your machine and server secrets.

## 2. Create the tables

SQL editor → New query → paste **`supabase/schema.sql`** → Run.

That creates the tables, the attendance summary view, and the row-level-security
policies. The policies are the important part: they are what stops one student's
token from reading another student's marks, and stop a teacher from marking a class
they do not hold.

## 3. Load the sample school (optional)

SQL editor → paste **`supabase/seed.sql`** → Run. It fills 7 classes, 8 teachers and
101 students so you can test before entering your own data. Skip it if you are going
straight to real records.

## 4. Create the logins

Supabase auth needs an email, so each user ID becomes `tch-01@smarteducation.internal`.
Nobody has to own that address — the login screen builds it from the ID typed in.

```bash
npm install @supabase/supabase-js
SUPABASE_URL=https://xxxx.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=eyJ... \
ADMIN_PASSWORD='use-a-strong-password' \
TEACHER_PASSWORD='use-a-strong-password' \
STUDENT_PASSWORD='use-a-strong-password' \
node tools/create-users.js
```

This makes one auth user per admin, teacher and student, plus the `profiles` row that
links a login to a person and a role. The three passwords are required at runtime and
are never stored in the repository.

## 5. Deploy the attendance + SMS function

```bash
npm install -g supabase
supabase login
supabase link --project-ref xxxx
supabase functions deploy mark-attendance

supabase secrets set SMS_MOCK=true SCHOOL_NAME="Saraswati Vidya Mandir"
```

Start with `SMS_MOCK=true` — attendance saves properly and the message body is written
to the function logs and the `sms_log` table, but nothing is actually sent. When your
gateway (Fast2SMS) is ready:

```bash
supabase secrets set SMS_MOCK=false FAST2SMS_API_KEY=...
```

That's enough to go live on Fast2SMS's **Quick/Transactional route** (`FAST2SMS_ROUTE`
defaults to `q`) — free-form text, no DLT template required, good for getting started or
low volume. For production-scale sending, Indian telecom rules require a DLT-registered
sender ID + message template; once you have those from Fast2SMS's DLT panel, switch over:

```bash
supabase secrets set FAST2SMS_ROUTE=dlt \
  FAST2SMS_SENDER_ID=... FAST2SMS_MESSAGE_ID=...
```

(`FAST2SMS_MESSAGE_ID` is the *approved template ID*, not the message text — Fast2SMS
fills in your template with the variables you send.)

**Why the SMS lives here and not in the browser:** the gateway key would be visible in
View Source, anyone could send messages with your sender ID, and the message would not
go out if the teacher closed the tab mid-roll-call. The function also checks the teacher
actually holds that class, and skips a parent who was already told today.

Registration for the DLT route takes a few days, so start it early if you'll need it.

## 6. Point the app at your project

`assets/js/core/config.js`:

```js
window.SE_CONFIG = {
  demo: false,
  supabaseUrl: 'https://xxxx.supabase.co',
  supabaseAnonKey: 'eyJhbGciOi...',
  emailDomain: 'smarteducation.internal',
  schoolName: 'Your School Name'
};
```

Set `demo: true` any time to go back to offline sample data — useful for demos and
for working on the UI without touching real records.

## 7. Deploy the front end

It is a static site, so any of these work with no build step:

```bash
# Vercel
npm i -g vercel && vercel

# Render → New Static Site → publish directory: .
# Netlify → drag the folder onto the dashboard
```

`vercel.json` is already in the project. After deploying, add your live URL in
Supabase → Authentication → URL configuration, and in the function's CORS origin if
you tighten it from `*`.

## What runs where

| Piece | Where it runs | Why |
|---|---|---|
| Sign-in | Supabase Auth | passwords hashed, tokens expire |
| Reading classes, students, marks, fees | Browser → Supabase, RLS enforced | one round trip at sign-in |
| Saving attendance | Edge function | needs to send SMS and check class ownership |
| Parent SMS | Edge function | keeps the gateway key off the client |
| Saving marks | Browser → Supabase, RLS enforced | teacher may only touch their own classes |

## Front-end files that changed

```
core/config.js     demo toggle + your keys            (new)
core/backend.js    every Supabase call                (new)
data/api.js        maps rows into the SCHOOL shape    (new)
core/auth.js       sign-in now async, both modes
core/store.js      cached reads, writes routed by mode
modules/sms.js     server-sent in backend mode
modules/attendance.js, modules/gradebook.js, pages/*   awaits the writes
```

Nothing under `modules/` that draws a screen needed rewriting — `data/api.js` hands them
the same object shape the sample data did.

## 8. "Forgot password" (email OTP via EmailJS)

The login screen now has a **Forgot password?** link. It's a 3-step modal: enter
your ID + email → enter the 6-digit code that arrives by email → set a new password.

**Why EmailJS:** this project has no mail server of its own, and Supabase's built-in
auth emails are rate-limited to a handful per hour on the free plan — too few for a
whole school. EmailJS sends the email straight from the browser using your own free
EmailJS account, no backend mail setup needed.

1. **Run the SQL.** SQL editor → paste **`supabase/forgot-password.sql`** → Run. It adds
   a `recovery_email` column to `profiles` and a `password_resets` table.
2. **Deploy the two new functions:**
   ```bash
   supabase functions deploy request-otp
   supabase functions deploy verify-otp
   ```
   They use the same `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` secrets the other
   functions already have — nothing extra to set there.
3. **Create your EmailJS account** at [emailjs.com](https://www.emailjs.com) (free tier:
   200 emails/month) and get three IDs:
   - **Email Services** → Add service (Gmail, Outlook, etc.) → copy the **Service ID**
   - **Email Templates** → Create template → copy the **Template ID**. The template
     must use these three variables (add them anywhere in the subject/body):
     - `{{to_email}}` — set your template's "To email" field to this
     - `{{otp}}` — the 6-digit code, put it front and centre in the body
     - `{{user_name}}` — the ID that requested it, for context
   - **Account → General** → copy the **Public Key**
4. **Paste the three IDs into `assets/js/core/config.js`:**
   ```js
   emailjs: {
     publicKey: 'your public key',
     serviceId: 'your service id',
     templateId: 'your template id'
   }
   ```
   That's the only thing you need to add — everything else in the flow is already wired.

**How the first reset works for an existing account:** nobody has a `recovery_email`
yet (the column was just added), so the *first* time each person uses "Forgot
password?" the email they type is saved to their account. Every reset after that must
use that same email — so tell people to use an address only they can access.

## 8b. Admin panel → "+ Add Student" / "+ Add Teacher"

Lets a signed-in admin add a real student or teacher straight from the
website — no need to open the Supabase dashboard each time. It creates the
login account, the `profiles` row, and the `students`/`teachers` row
together, and shows a one-time temporary password to hand to them.

Deploy both functions once:
```bash
supabase functions deploy admin-create-student
supabase functions deploy admin-create-teacher
```
They reuse the same `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` secrets the
other functions already have — nothing extra to set. Both buttons only
appear for admins. For "Add Student" the class picked must already exist in
the `classes` table; for "Add Teacher" the teacher ID (`TCH-XX`) is assigned
automatically.

## 9. Student & teacher photos

The admin panel can now upload a photo for any teacher (Staff list) or student (open
their record from the class roster) — click the little camera badge on their avatar.

1. **Run the SQL.** SQL editor → paste **`supabase/photos.sql`** → Run. It adds a
   `photo_url` column to `teachers` and `students`, creates a public `avatars` storage
   bucket, and locks uploads to admins only (anyone signed in can view the photos).
2. That's it — no new function to deploy, no new keys. Refresh the admin panel and the
   camera badge appears on every avatar.

Where everyone sees a photo once it's set: the staff list, a student's own "My
details" card (visible to the student, their teacher, and admin), and anywhere else
that already showed the initials avatar.

## 10. Login activity (who signed in, and when)

Admin panel → new **"Login activity"** nav item — every teacher and student sign-in,
newest first, with name, ID, role and time.

1. **Run the SQL.** SQL editor → paste **`supabase/login-logs.sql`** → Run. It creates
   the `login_logs` table and locks it down: each signed-in person can write their own
   row (that's how a login gets recorded — see `Backend.signIn` in `core/backend.js`),
   but only an admin can read the list.
2. That's it — no new function to deploy. Sign in as anyone and the row appears; refresh
   the admin panel to see it in "Login activity".

If a login row ever fails to write (e.g. a flaky connection), sign-in itself is not
affected — the write is fire-and-forget on purpose so logging can never block a login.

## Before a real school uses this

- Force a password change on first sign-in (`profiles.must_change_password` + a redirect).
- Turn on Point-in-Time Recovery in Supabase so a wrong bulk edit is recoverable.
- Tighten the function's `Access-Control-Allow-Origin` from `*` to your domain.
- Parent phone numbers are personal data — keep the service role key out of shared repos
  and limit who has admin logins.
