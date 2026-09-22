# Smart Education — module map

Everything is in English by default, with a Hindi switch on the login screen and in
every portal top bar. Nothing is hard-coded in one language any more — all interface
text comes from `assets/js/core/i18n.js`.

## Sign in

Open `index.html` → **Sign in**, or go straight to `login.html`.

| Role | User ID | Password |
|---|---|---|
| Admin | `ADM-001`, `ADM-002` | `admin123` |
| Teacher | `TCH-01` … `TCH-08` | `teach123` |
| Student | `STU-<class>-<roll>`, e.g. `STU-8A-03` | `student123` |

The login screen lists sample IDs for the selected role — click one to fill the form.
Student IDs for every class are visible in the admin portal under **Students**.

## Files

```
index.html           Landing page
login.html           Role tabs + ID/password + language choice
admin.html           Portal shell (views are rendered by JS)
teacher.html         Portal shell
student.html         Portal shell

assets/css/
  base.css           Variables, type, buttons
  components.css     Cards, tables, tags, forms, toasts
  portal.css         Sidebar + top bar shell
  app.css            View headers, roll call, rosters, records, class cards
  auth.css           Login screen
  landing.css        Landing page
  chat.css           AI tutor panel
  notices.css        Header notice bar, notice cards, editable timetable cells

assets/js/core/
  i18n.js            English + Hindi dictionary, t(), setLang()
  auth.js            Sign-in, session, per-page role guard
  store.js           Attendance, SMS log and mark edits (localStorage)
  ui.js              Portal shell, sidebar routing, language switch, toasts

assets/js/data/
  school-data.js     Classes, teachers, students, marks, fees, syllabus, timetable

assets/js/modules/
  attendance.js      Class picker → full roll call (teacher) + register (admin)
  sms.js             Parent SMS on absence + the school's SMS log
  gradebook.js       Marks entry (teacher) + marks table (student)
  student-record.js  Student details, attendance card, roster with drill-down
  fees.js            Student fee statement + admin class-wise ledger
  syllabus.js        Chapter-wise progress
  timetable.js       Weekly grid — admin edits periods, teachers get "My schedule", clash warnings
  notices.js         Notice board: admin/teacher publish, students see it under the header
  teachers.js        Staff directory with today's roll-call duty
  tutor.js           AI study partner panel

assets/js/pages/
  login.js  admin.js  teacher.js  student.js
```

## How the pieces connect

- **Open a class, get the whole roll.** Teacher portal → Attendance → pick a class.
  Every student in that class loads with roll number, parent name and phone. The admin
  portal shows the same roster read-only under Attendance, and the full record under Students.
- **Absent → SMS to the parent.** The moment a teacher taps *Absent*, `modules/sms.js`
  sends the parent message and files a copy. Admins see every message under **SMS log**.
- **Admin sees all teachers.** Staff directory lists each teacher, their subject, the
  classes they hold, and whether today's roll call is done.
- **Students see only their own record** — details, marks, attendance, syllabus,
  timetable, tuition fee — and can switch the whole portal to Hindi.

## Going live

Two files are the only things tied to demo data:

1. `assets/js/data/school-data.js` — replace the generated arrays with API calls.
2. `assets/js/modules/sms.js` — the `deliver()` function has a commented-out
   `fetch('/api/sms', …)`; point it at MSG91, Gupshup or Twilio and the rest works unchanged.

Passwords live in `assets/js/core/auth.js` for the demo only. Move that check to a
server before any real school uses this.
