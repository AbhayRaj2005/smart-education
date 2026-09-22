/* ============================================================
   PAGE: teacher.html
   Wires the shared modules into the staff-room views.
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {

  const user = Auth.requireRole('teacher');
  if (!user) return;

  /* In demo mode this resolves at once. With Supabase configured it
     pulls this person's data — row level security decides what comes back. */
  try {
    await Data.load(user);
  } catch (err) {
    document.getElementById('content').innerHTML =
      '<div class="card card-pad empty-note">Could not reach the server: ' +
      UI.esc(err.message) + '</div>';
    return;
  }

  const teacher = SCHOOL.teacherById(user.id);
  const myClasses = SCHOOL.classesOf(user.id);
  const myStudents = myClasses.reduce((a, c) => a.concat(SCHOOL.studentsOf(c.id)), []);

  UI.buildPortal({
    user: user,
    nav: [
      { view: 'dashboard', key: 'nav.dashboard' },
      { view: 'attendance', key: 'nav.attendance' },
      { view: 'gradebook', key: 'nav.gradebook' },
      { view: 'assessment', key: 'nav.assessment' },
      { view: 'students', key: 'nav.students' },
      { view: 'syllabus', key: 'nav.syllabus' },
      { view: 'timetable', key: 'nav.timetable' },
      { view: 'notices', key: 'nav.notices' }
    ],
    onView: (view, host) => {
      if (view === 'dashboard') return dashboard(host);
      if (view === 'attendance') return Attendance.renderRollCall(host, { classes: myClasses });
      if (view === 'gradebook') return Gradebook.renderEntry(host, { classes: myClasses, subject: teacher.subject });
      if (view === 'assessment') return Assessment.renderTeacher(host, { classes: myClasses, subject: teacher.subject, teacherId: teacher.id });
      if (view === 'students') return StudentRecord.renderRoster(host, { classes: myClasses });
      if (view === 'syllabus') return Syllabus.render(host, { classes: myClasses, subject: teacher.subject, canUpload: true });
      if (view === 'timetable') return Timetable.render(host, { classes: myClasses, teacherId: teacher.id, modes: ['teacher', 'class'] });
      if (view === 'notices') return Notices.renderManager(host, { user: user, classes: myClasses, schoolWide: false });
    }
  });

  /* notices from the office / other teachers for my classes, pinned under the header */
  Notices.mountBar({ id: user.id, role: 'teacher', classIds: myClasses.map(c => c.id) });

  function dashboard(host) {
    const marked = Store.markedClassesToday();
    const markedMine = myClasses.filter(c => marked.indexOf(c.id) > -1).length;
    const avg = myStudents.length
      ? Math.round(myStudents.reduce((a, s) => a + SCHOOL.averageOf(s), 0) / myStudents.length) : 0;

    const head = UI.el('div', 'view-head');
    head.innerHTML = '<div><h2 class="view-title">' + UI.esc(I18N.t('t.greeting', { name: user.name.split(' ')[0] })) +
      '</h2><p class="view-sub">' + UI.esc(teacher.subject) + ' · ' + UI.esc(I18N.today()) + '</p></div>';
    host.appendChild(head);

    const kpis = UI.el('div', 'kpi-row');
    kpis.innerHTML =
      UI.kpi(I18N.t('t.classesToday'), myClasses.length, myClasses.map(c => c.id).join(' · ')) +
      UI.kpi(I18N.t('g.students'), myStudents.length, myClasses.length + ' ' + I18N.t('nav.classes')) +
      UI.kpi(I18N.t('t.attMarked'), markedMine + ' / ' + myClasses.length,
        markedMine === myClasses.length ? I18N.t('a.done') : I18N.t('a.notDone'),
        markedMine === myClasses.length ? 'up' : 'down') +
      UI.kpi(I18N.t('t.avgScore'), avg + '%', teacher.subject);
    host.appendChild(kpis);

    /* class cards — open a class straight into its roll call */
    const grid = UI.el('div', 'class-grid');
    myClasses.forEach(c => {
      const roster = SCHOOL.studentsOf(c.id);
      const s = Store.attendanceSummary(c.id);
      const done = s.present + s.absent + s.late;
      const card = UI.el('button', 'class-card');
      card.type = 'button';
      card.innerHTML = '<span class="class-card-name">' + UI.esc(UI.classLabel(c)) + '</span>' +
        '<span class="class-card-meta">' + roster.length + ' ' + UI.esc(I18N.t('g.students')) + ' · ' + UI.esc(c.room) + '</span>' +
        '<span class="tag ' + (done ? 'green' : 'grey') + '">' +
        UI.esc(done ? I18N.t('att.summary', s) : I18N.t('att.pending')) + '</span>';
      card.addEventListener('click', () => {
        host.innerHTML = '';
        Attendance.renderRollCall(host, { classes: myClasses, classId: c.id });
      });
      grid.appendChild(card);
    });
    host.appendChild(grid);

    /* recent parent messages this teacher triggered */
    const log = UI.el('div', 'stack-top');
    SMS.renderLog(log);
    host.appendChild(log);
  }
});
