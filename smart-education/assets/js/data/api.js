/* ============================================================
   MODULE: data/api.js
   The bridge. It takes the rows Supabase returns and rebuilds
   the exact same SCHOOL object the demo data produced, so not
   one view module had to change when the backend arrived.

   Demo mode: Data.load() resolves straight away and the sample
   data in school-data.js stays in place.
   ============================================================ */

(function (global) {

  const EXAMS = ['Unit Test 1', 'Half Yearly', 'Unit Test 2'];

  async function load(user) {
    if (!SE_BACKEND()) return { source: 'demo' };

    const raw = await Backend.loadAll(user);

    /* ---- classes ---- */
    const classes = raw.classes.map(c => ({
      id: c.id, grade: c.grade, room: c.room,
      label: 'Class ' + c.grade + ' · ' + c.section,
      strength: raw.students.filter(s => s.class_id === c.id).length
    }));

    /* ---- teachers ---- */
    const teachers = raw.teachers.map(t => ({
      id: t.id, name: t.name, subject: t.subject, phone: t.phone,
      joined: t.joined_year, classTeacherOf: t.class_teacher_of, photo: t.photo_url,
      classes: raw.teacherClasses.filter(x => x.teacher_id === t.id).map(x => x.class_id)
    }));

    /* ---- index the child tables once ---- */
    const marksBy = {}, instBy = {}, feeBy = {}, attBy = {};
    raw.marks.forEach(m => {
      (marksBy[m.student_id] = marksBy[m.student_id] || {});
      (marksBy[m.student_id][m.subject] = marksBy[m.student_id][m.subject] || [])
        .push({ exam: m.exam, score: m.score, max: m.max_score });
    });
    raw.instalments.forEach(i => (instBy[i.student_id] = instBy[i.student_id] || []).push(i));
    raw.fees.forEach(f => feeBy[f.student_id] = Number(f.total));
    (raw.attSummary || []).forEach(a => attBy[a.student_id] = a);

    /* ---- students ---- */
    const students = raw.students.map(s => {
      const inst = (instBy[s.id] || []).sort((a, b) => a.seq - b.seq);
      const paid = inst.filter(i => i.paid_on).reduce((a, i) => a + Number(i.amount), 0);
      const total = feeBy[s.id] || inst.reduce((a, i) => a + Number(i.amount), 0);
      const att = attBy[s.id] || { present_days: 0, total_days: 0 };

      const marks = {};
      Object.keys(marksBy[s.id] || {}).forEach(sub => {
        marks[sub] = EXAMS.map(e =>
          (marksBy[s.id][sub].find(m => m.exam === e)) || { exam: e, score: 0, max: 100 });
      });

      return {
        id: s.id, name: s.name, roll: s.roll, classId: s.class_id,
        admissionNo: s.admission_no, dob: s.dob, photo: s.photo_url,
        parent: s.parent_name, phone: s.parent_phone,
        address: s.address, bloodGroup: s.blood_group, house: s.house,
        marks: marks,
        attendance: {
          totalDays: Number(att.total_days) || 0,
          presentDays: Number(att.present_days) || 0,
          rate: att.total_days ? Math.round(att.present_days / att.total_days * 100) : 0
        },
        fees: {
          total: total,
          paid: paid,
          due: total - paid,
          instalments: inst.map(i => ({
            n: i.seq, amount: Number(i.amount),
            dueDate: fmtDate(i.due_date), paidOn: i.paid_on ? fmtDate(i.paid_on) : null
          }))
        }
      };
    });

    /* ---- subjects, syllabus, timetable ---- */
    const subjectsByClass = {};
    raw.subjects.forEach(r => (subjectsByClass[r.class_id] = subjectsByClass[r.class_id] || []).push(r.subject));

    const syllabusIdx = {};
    raw.syllabus.forEach(r => {
      const k = r.class_id + '|' + r.subject;
      (syllabusIdx[k] = syllabusIdx[k] || []).push({ n: r.seq, title: r.title, status: r.status });
    });

    const ttIdx = {};
    raw.timetable.forEach(r => {
      const rows = ttIdx[r.class_id] = ttIdx[r.class_id] || {};
      const row = rows[r.period] = rows[r.period] || { period: r.period, slots: [] };
      const t = teachers.find(x => x.id === r.teacher_id);
      row.slots[r.weekday - 1] = { subject: r.subject, teacher: t ? t.name : '—', teacherId: r.teacher_id, room: r.room };
    });

    /* ---- rebuild the SCHOOL object the modules read ---- */
    const API = {
      school: SE_CONFIG.schoolName,
      classes: classes, teachers: teachers, students: students, exams: EXAMS,

      subjectsFor: grade => {
        const cls = classes.find(c => c.grade === grade);
        return (cls && subjectsByClass[cls.id]) || [];
      },
      classById: id => classes.find(c => c.id === id) || null,
      teacherById: id => teachers.find(t => t.id === id) || null,
      studentById: id => students.find(s => s.id === id) || null,
      studentsOf: classId => students.filter(s => s.classId === classId),
      classesOf: teacherId => {
        const t = API.teacherById(teacherId);
        return t ? t.classes.map(API.classById).filter(Boolean) : [];
      },
      classTeacherOf: classId => teachers.find(t => t.classTeacherOf === classId) || null,
      teachersOf: classId => teachers.filter(t => t.classes.indexOf(classId) > -1),
      syllabusFor: (classId, subject) => syllabusIdx[classId + '|' + subject] || [],
      timetableFor: classId => Object.values(ttIdx[classId] || {}).sort((a, b) => a.period - b.period),
      /* admin timetable edit — updates the in-memory copy after the database write succeeds.
         slot = { subject, teacher, teacherId, room }, or null to clear the period */
      setSlot: (classId, weekday, period, slot) => {
        const rows = ttIdx[classId] = ttIdx[classId] || {};
        const row = rows[period] = rows[period] || { period: period, slots: [] };
        if (slot) row.slots[weekday - 1] = slot; else delete row.slots[weekday - 1];
      },

      averageOf: global.SCHOOL.averageOf,
      gradeFor: global.SCHOOL.gradeFor,
      money: global.SCHOOL.money,
      rankOf: student => {
        const peers = API.studentsOf(student.classId)
          .map(s => ({ id: s.id, avg: API.averageOf(s) })).sort((a, b) => b.avg - a.avg);
        return peers.findIndex(p => p.id === student.id) + 1;
      }
    };

    global.SCHOOL = API;

    /* prime the caches the UI reads synchronously */
    Store.primeAttendance(raw.attendance);
    Store.primeSms(raw.sms);
    Store.primeLoginLogs(raw.loginLogs);

    return { source: 'supabase', students: students.length };
  }

  function fmtDate(iso) {
    if (!iso) return null;
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  global.Data = { load };

})(window);
