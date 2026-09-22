/* ============================================================
   MODULE: data/school-data.js
   The single source of truth for the demo school. Every portal
   reads from here, so a class opened in the teacher portal and
   the same class opened in the admin portal show the same roll.

   Swap this file for real API calls when you move to a backend;
   nothing else needs to change.
   ============================================================ */

(function (global) {

  /* Deterministic pseudo-random so every reload shows the same
     marks, attendance and fee figures. */
  function seeded(seed) {
    let s = seed % 2147483647;
    if (s <= 0) s += 2147483646;
    return function () { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  }
  function hash(str) {
    let h = 7;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 2147483647;
    return h;
  }
  function pick(rand, arr) { return arr[Math.floor(rand() * arr.length)]; }
  function between(rand, a, b) { return a + Math.floor(rand() * (b - a + 1)); }

  /* ---------------- teachers ---------------- */
  const TEACHERS = [
    { id: 'TCH-01', name: 'Kabir Anand',      subject: 'Mathematics', classes: ['8A', '8B', '10A'], joined: '2016', phone: '+91 98301 40011', classTeacherOf: '8A' },
    { id: 'TCH-02', name: 'Sunita Rao',       subject: 'Science',     classes: ['8A', '9A', '10A'], joined: '2014', phone: '+91 98301 40012', classTeacherOf: '9A' },
    { id: 'TCH-03', name: 'Imran Qureshi',    subject: 'English',     classes: ['6A', '7A', '8B'],  joined: '2019', phone: '+91 98301 40013', classTeacherOf: '6A' },
    { id: 'TCH-04', name: 'Meera Nair',       subject: 'Hindi',       classes: ['6A', '8A', '9A'],  joined: '2012', phone: '+91 98301 40014', classTeacherOf: '7A' },
    { id: 'TCH-05', name: 'Rajat Bose',       subject: 'Social Science', classes: ['7A', '9A', '10B'], joined: '2018', phone: '+91 98301 40015', classTeacherOf: '10A' },
    { id: 'TCH-06', name: 'Fatima Sheikh',    subject: 'Computer Science', classes: ['8B', '10A', '10B'], joined: '2021', phone: '+91 98301 40016', classTeacherOf: '8B' },
    { id: 'TCH-07', name: 'Devendra Pratap',  subject: 'Physical Education', classes: ['6A', '7A', '8A', '9A'], joined: '2017', phone: '+91 98301 40017', classTeacherOf: '10B' },
    { id: 'TCH-08', name: 'Anjali Dutta',     subject: 'Mathematics', classes: ['6A', '7A', '9A'],  joined: '2020', phone: '+91 98301 40018', classTeacherOf: null }
  ];

  /* ---------------- classes ---------------- */
  const CLASSES = [
    { id: '6A',  label: 'Class 6 · A',  grade: 6,  room: 'Room 3',  strength: 14 },
    { id: '7A',  label: 'Class 7 · A',  grade: 7,  room: 'Room 5',  strength: 14 },
    { id: '8A',  label: 'Class 8 · A',  grade: 8,  room: 'Room 12', strength: 16 },
    { id: '8B',  label: 'Class 8 · B',  grade: 8,  room: 'Room 13', strength: 14 },
    { id: '9A',  label: 'Class 9 · A',  grade: 9,  room: 'Room 7',  strength: 15 },
    { id: '10A', label: 'Class 10 · A', grade: 10, room: 'Room 4',  strength: 15 },
    { id: '10B', label: 'Class 10 · B', grade: 10, room: 'Room 6',  strength: 13 }
  ];

  const SUBJECTS = {
    6:  ['English', 'Hindi', 'Mathematics', 'Science', 'Social Science'],
    7:  ['English', 'Hindi', 'Mathematics', 'Science', 'Social Science'],
    8:  ['English', 'Hindi', 'Mathematics', 'Science', 'Social Science', 'Computer Science'],
    9:  ['English', 'Hindi', 'Mathematics', 'Science', 'Social Science', 'Computer Science'],
    10: ['English', 'Hindi', 'Mathematics', 'Science', 'Social Science', 'Computer Science']
  };

  const EXAMS = ['Unit Test 1', 'Half Yearly', 'Unit Test 2'];

  /* ---------------- name pools ---------------- */
  const FIRST = ['Aarav', 'Diya', 'Ishaan', 'Myra', 'Kabir', 'Anaya', 'Vihaan', 'Saanvi', 'Arjun', 'Riya',
    'Advait', 'Tanya', 'Rehan', 'Nitya', 'Aditya', 'Pari', 'Kunal', 'Ira', 'Rudra', 'Aisha',
    'Sameer', 'Naina', 'Dev', 'Mahira', 'Yash', 'Trisha', 'Ayan', 'Kavya', 'Neel', 'Zoya',
    'Harsh', 'Sara', 'Om', 'Ridhi', 'Veer', 'Anvi'];
  const LAST = ['Joshi', 'Sharma', 'Verma', 'Kapoor', 'Banerjee', 'Ghosh', 'Iyer', 'Khan', 'Das', 'Mehta',
    'Chatterjee', 'Sen', 'Roy', 'Mishra', 'Gupta', 'Pandey', 'Nandi', 'Saha'];
  const PARENT_FIRST = ['Rakesh', 'Meena', 'Sunil', 'Anjali', 'Prakash', 'Rina', 'Debashis', 'Farida',
    'Mohan', 'Shalini', 'Ashok', 'Lata', 'Imtiaz', 'Ruma', 'Vikram', 'Sarita'];
  const HOUSES = ['Ganga', 'Yamuna', 'Kaveri', 'Narmada'];
  const BLOOD = ['A+', 'B+', 'O+', 'AB+', 'O-', 'A-'];
  const AREAS = ['Salt Lake, Sector 2', 'Behala, Diamond Park', 'Garia, Naskarpara', 'Howrah, Shibpur',
    'Dum Dum, Nagerbazar', 'Tollygunge, Prince Anwar Shah Rd', 'Kasba, Rajdanga'];

  /* ---------------- build students ---------------- */
  const STUDENTS = [];

  CLASSES.forEach(cls => {
    const rand = seeded(hash(cls.id) + 1000);
    const used = {};
    for (let i = 1; i <= cls.strength; i++) {
      let first, last, full, guard = 0;
      do {
        first = pick(rand, FIRST);
        last = pick(rand, LAST);
        full = first + ' ' + last;
        guard++;
      } while (used[full] && guard < 40);
      used[full] = true;

      const roll = String(i).padStart(2, '0');
      const id = 'STU-' + cls.id + '-' + roll;
      const srand = seeded(hash(id));

      /* marks: subject -> exam -> score out of 100 */
      const marks = {};
      SUBJECTS[cls.grade].forEach(sub => {
        const base = between(srand, 44, 94);
        marks[sub] = EXAMS.map((e, idx) => ({
          exam: e,
          max: 100,
          score: Math.max(32, Math.min(99, base + between(srand, -7, 7) + idx))
        }));
      });

      const totalDays = 96;
      const presentDays = between(srand, 76, 95);

      const feeTotal = cls.grade >= 9 ? 42000 : cls.grade >= 8 ? 36000 : 30000;
      const instalmentsPaid = between(srand, 1, 3);
      const perInstalment = feeTotal / 3;

      STUDENTS.push({
        id: id,
        name: full,
        roll: roll,
        classId: cls.id,
        admissionNo: 'SVM/' + (2000 + hash(id) % 900) + '/' + cls.grade,
        dob: between(srand, 1, 28) + ' ' + pick(srand, ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']) + ' ' + (2026 - cls.grade - 5),
        parent: pick(srand, PARENT_FIRST) + ' ' + last,
        phone: '+91 9' + between(srand, 1000, 9999) + ' ' + between(srand, 10000, 99999),
        address: pick(srand, AREAS) + ', Kolkata',
        bloodGroup: pick(srand, BLOOD),
        house: pick(srand, HOUSES),
        marks: marks,
        attendance: {
          totalDays: totalDays,
          presentDays: presentDays,
          rate: Math.round(presentDays / totalDays * 100)
        },
        fees: {
          total: feeTotal,
          instalments: [1, 2, 3].map(n => ({
            n: n,
            amount: perInstalment,
            dueDate: ['15 Apr 2026', '15 Aug 2026', '15 Dec 2026'][n - 1],
            paidOn: n <= instalmentsPaid ? ['12 Apr 2026', '09 Aug 2026', '02 Dec 2026'][n - 1] : null
          })),
          paid: perInstalment * instalmentsPaid,
          due: feeTotal - perInstalment * instalmentsPaid
        }
      });
    }
  });

  /* ---------------- syllabus ---------------- */
  const CHAPTER_BANK = {
    'Mathematics': ['Rational numbers', 'Linear equations', 'Quadrilaterals', 'Data handling', 'Squares and square roots', 'Mensuration'],
    'Science': ['Crop production', 'Microorganisms', 'Force and pressure', 'Friction', 'Sound', 'Light'],
    'English': ['The Best Christmas Present', 'Prose: The Tsunami', 'Poetry: Geography Lesson', 'Grammar: Tenses', 'Writing: Notice and report'],
    'Hindi': ['ध्वनि', 'लाख की चूड़ियाँ', 'बस की यात्रा', 'दीवानों की हस्ती', 'व्याकरण: संधि'],
    'Social Science': ['Resources', 'Land, soil and water', 'The Indian Constitution', 'Agriculture', 'Industries'],
    'Computer Science': ['Number systems', 'Spreadsheet basics', 'Introduction to Python', 'Loops and conditions', 'Internet safety']
  };

  function syllabusFor(classId, subject) {
    const list = CHAPTER_BANK[subject] || CHAPTER_BANK['Mathematics'];
    const rand = seeded(hash(classId + subject));
    const cut = between(rand, 2, list.length - 1);
    return list.map((ch, i) => ({
      n: i + 1,
      title: ch,
      status: i < cut ? 'done' : (i === cut ? 'ongoing' : 'pending')
    }));
  }

  /* ---------------- timetable ---------------- */
  function baseTimetableFor(classId) {
    const cls = CLASSES.find(c => c.id === classId) || CLASSES[0];
    const subs = SUBJECTS[cls.grade];
    const rand = seeded(hash('tt' + classId));
    const rows = [];
    for (let p = 1; p <= 6; p++) {
      const day = [];
      for (let d = 0; d < 5; d++) {
        const sub = pick(rand, subs);
        const teacher = TEACHERS.find(t => t.subject === sub && t.classes.indexOf(classId) > -1)
          || TEACHERS.find(t => t.subject === sub) || TEACHERS[0];
        day.push({ subject: sub, teacher: teacher.name, teacherId: teacher.id, room: cls.room });
      }
      rows.push({ period: p, slots: day });
    }
    return rows;
  }

  /* Demo-mode timetable edits live in localStorage on top of the generated grid.
     (With Supabase on, api.js replaces timetableFor/setSlot and edits go to the database.) */
  const TT_KEY = 'se.tt.overrides';
  function readOverrides() {
    try { return JSON.parse(localStorage.getItem(TT_KEY) || '{}'); } catch (e) { return {}; }
  }
  function timetableFor(classId) {
    const rows = baseTimetableFor(classId);
    const ov = readOverrides()[classId] || {};
    Object.keys(ov).forEach(k => {
      const parts = k.split('-'), d = Number(parts[0]), p = Number(parts[1]);
      let row = rows.find(r => r.period === p);
      if (!row) { row = { period: p, slots: [] }; rows.push(row); }
      if (ov[k]) row.slots[d - 1] = ov[k]; else delete row.slots[d - 1];
    });
    return rows.sort((a, b) => a.period - b.period);
  }
  function setSlot(classId, weekday, period, slot) {
    const all = readOverrides();
    (all[classId] = all[classId] || {})[weekday + '-' + period] = slot || null;
    try { localStorage.setItem(TT_KEY, JSON.stringify(all)); } catch (e) {}
  }

  /* ---------------- lookups ---------------- */
  const API = {
    school: 'Saraswati Vidya Mandir, Kolkata',
    classes: CLASSES,
    teachers: TEACHERS,
    students: STUDENTS,
    exams: EXAMS,

    subjectsFor: grade => SUBJECTS[grade] || SUBJECTS[8],
    classById: id => CLASSES.find(c => c.id === id) || null,
    teacherById: id => TEACHERS.find(t => t.id === id) || null,
    studentById: id => STUDENTS.find(s => s.id === id) || null,
    studentsOf: classId => STUDENTS.filter(s => s.classId === classId),
    classesOf: teacherId => {
      const t = API.teacherById(teacherId);
      return t ? t.classes.map(API.classById).filter(Boolean) : [];
    },
    classTeacherOf: classId => TEACHERS.find(t => t.classTeacherOf === classId) || null,
    teachersOf: classId => TEACHERS.filter(t => t.classes.indexOf(classId) > -1),

    syllabusFor: syllabusFor,
    timetableFor: timetableFor,
    setSlot: setSlot,

    averageOf: student => {
      let sum = 0, n = 0;
      Object.keys(student.marks).forEach(sub => {
        student.marks[sub].forEach(m => { sum += m.score; n++; });
      });
      return n ? Math.round(sum / n) : 0;
    },
    gradeFor: score => score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B+'
      : score >= 60 ? 'B' : score >= 50 ? 'C' : score >= 40 ? 'D' : 'E',
    rankOf: student => {
      const peers = API.studentsOf(student.classId)
        .map(s => ({ id: s.id, avg: API.averageOf(s) }))
        .sort((a, b) => b.avg - a.avg);
      return peers.findIndex(p => p.id === student.id) + 1;
    },
    money: n => '₹' + Number(n).toLocaleString('en-IN')
  };

  global.SCHOOL = API;

})(window);
