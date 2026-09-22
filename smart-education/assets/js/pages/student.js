/* ============================================================
   PAGE: student.html
   A student sees only their own record: details, marks,
   attendance, syllabus, timetable and tuition fee.
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {

  const user = Auth.requireRole('student');
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

  const student = SCHOOL.studentById(user.id);
  if (!student) { Auth.signOut(); return; }
  const myClass = SCHOOL.classById(student.classId);

  /* who is looking — decides which notices reach this student */
  const viewer = { id: user.id, role: 'student', classIds: [student.classId] };

  UI.buildPortal({
    user: user,
    nav: [
      { view: 'dashboard', key: 'nav.dashboard' },
      { view: 'notices', key: 'nav.notices' },
      { view: 'profile', key: 'nav.profile' },
      { view: 'marks', key: 'nav.marks' },
      { view: 'attendance', key: 'nav.attendance' },
      { view: 'syllabus', key: 'nav.syllabus' },
      { view: 'fees', key: 'nav.fees' },
      { view: 'timetable', key: 'nav.timetable' },
      { view: 'tutor', key: 'nav.tutor' },
      { view: 'studyplan', key: 'nav.studyplan' },
      { view: 'skilling', key: 'nav.skilling' },
      { view: 'assessment', key: 'nav.assessment' }
    ],
    onView: (view, host) => {
      if (view === 'dashboard') return dashboard(host);
      if (view === 'notices') return Notices.renderFeed(host, viewer);
      if (view === 'profile') return host.appendChild(StudentRecord.detailsCard(student));
      if (view === 'marks') return Gradebook.renderStudentMarks(host, student);
      if (view === 'attendance') return host.appendChild(StudentRecord.attendanceCard(student));
      if (view === 'syllabus') return Syllabus.render(host, { classes: [myClass], classId: myClass.id, lockClass: true });
      if (view === 'fees') return Fees.renderStudentFees(host, student);
      if (view === 'timetable') return Timetable.render(host, { classes: [myClass], classId: myClass.id, lockClass: true });
      if (view === 'tutor') return Tutor.render(host, student);
      if (view === 'studyplan') return StudyPlan.render(host, student);
      if (view === 'skilling') return Skilling.render(host, student);
      if (view === 'assessment') return Assessment.renderStudent(host, student);
    }
  });

  /* every notice for this class (or the whole school), pinned under the header on every page */
  Notices.mountBar(viewer);

  function dashboard(host) {
    const avg = SCHOOL.averageOf(student);

    const head = UI.el('div', 'view-head');
    head.innerHTML = '<div><h2 class="view-title">' + UI.esc(I18N.t('s.greeting', { name: student.name.split(' ')[0] })) +
      '</h2><p class="view-sub">' + UI.esc(UI.classLabel(myClass)) + ' · ' + UI.esc(I18N.t('g.roll')) + ' ' +
      UI.esc(student.roll) + ' · ' + UI.esc(I18N.today()) + '</p></div>';
    host.appendChild(head);

    const kpis = UI.el('div', 'kpi-row');
    kpis.innerHTML =
      UI.kpi(I18N.t('att.rate'), student.attendance.rate + '%',
        student.attendance.presentDays + ' / ' + student.attendance.totalDays + ' ' + I18N.t('att.daysPresent'),
        student.attendance.rate >= 80 ? 'up' : 'down') +
      UI.kpi(I18N.t('g.overall'), avg + '%', SCHOOL.gradeFor(avg)) +
      UI.kpi(I18N.t('g.rank'), SCHOOL.rankOf(student) + ' / ' + SCHOOL.studentsOf(student.classId).length, UI.classLabel(myClass)) +
      UI.kpi(I18N.t('s.myFees'), SCHOOL.money(student.fees.due),
        student.fees.due ? I18N.t('s.pending') : I18N.t('s.cleared'),
        student.fees.due ? 'down' : 'up');
    host.appendChild(kpis);

    const grid = UI.el('div', 'grid-2');
    grid.appendChild(StudentRecord.detailsCard(student));
    grid.appendChild(StudentRecord.attendanceCard(student));
    host.appendChild(grid);

    const marks = UI.el('div', 'stack-top');
    Gradebook.renderStudentMarks(marks, student);
    host.appendChild(marks);

    const fees = UI.el('div', 'stack-top');
    Fees.renderStudentFees(fees, student);
    host.appendChild(fees);
  }
});
