/* ============================================================
   PAGE: admin.html
   School-wide view: staff, classes, attendance register, fees,
   and the parent SMS log.
   ============================================================ */

document.addEventListener('DOMContentLoaded', async () => {

  const user = Auth.requireRole('admin');
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

  UI.buildPortal({
    user: user,
    nav: [
      { view: 'dashboard', key: 'nav.dashboard' },
      { view: 'teachers', key: 'nav.teachers' },
      { view: 'students', key: 'nav.students' },
      { view: 'attendance', key: 'nav.attendance' },
      { view: 'fees', key: 'nav.fees' },
      { view: 'syllabus', key: 'nav.syllabus' },
      { view: 'timetable', key: 'nav.timetable' },
      { view: 'notices', key: 'nav.notices' },
      { view: 'sms', key: 'nav.smslog' },
      { view: 'loginlog', key: 'nav.loginlog' }
    ],
    onView: (view, host) => {
      if (view === 'dashboard') return dashboard(host);
      if (view === 'teachers') return Teachers.renderDirectory(host);
      if (view === 'students') return StudentRecord.renderRoster(host, {});
      if (view === 'attendance') return Attendance.renderRegister(host);
      if (view === 'fees') return Fees.renderLedger(host);
      if (view === 'syllabus') return Syllabus.render(host, { classes: SCHOOL.classes, canUpload: true, isAdmin: true });
      if (view === 'timetable') return Timetable.render(host, { editable: true, pickTeacher: true, modes: ['class', 'teacher'], autoGenerate: true });
      if (view === 'notices') return Notices.renderManager(host, { user: user, classes: SCHOOL.classes, schoolWide: true });
      if (view === 'sms') return SMS.renderLog(host);
      if (view === 'loginlog') return LoginLog.renderLog(host);
    }
  });

  function dashboard(host) {
    const totalStudents = SCHOOL.students.length;
    const marked = Store.markedClassesToday();
    let present = 0, absent = 0, late = 0;
    SCHOOL.classes.forEach(c => {
      const s = Store.attendanceSummary(c.id);
      present += s.present; absent += s.absent; late += s.late;
    });
    const feeTotal = SCHOOL.students.reduce((a, s) => a + s.fees.total, 0);
    const feePaid = SCHOOL.students.reduce((a, s) => a + s.fees.paid, 0);

    const head = UI.el('div', 'view-head');
    head.innerHTML = '<div><h2 class="view-title">' + UI.esc(I18N.t('a.greeting', { name: user.name.split(' ')[0] })) +
      '</h2><p class="view-sub">' + UI.esc(SCHOOL.school) + ' · ' + UI.esc(I18N.today()) + '</p></div>';
    host.appendChild(head);

    const kpis = UI.el('div', 'kpi-row');
    kpis.innerHTML =
      UI.kpi(I18N.t('a.totalStudents'), totalStudents, SCHOOL.classes.length + ' ' + I18N.t('nav.classes')) +
      UI.kpi(I18N.t('a.totalTeachers'), SCHOOL.teachers.length, I18N.t('a.staffList')) +
      UI.kpi(I18N.t('a.attToday'), (present + absent + late) ? I18N.t('att.summary', { present, absent, late }) : I18N.t('att.pending'),
        marked.length + ' / ' + SCHOOL.classes.length + ' ' + I18N.t('nav.classes'),
        marked.length === SCHOOL.classes.length ? 'up' : 'down') +
      UI.kpi(I18N.t('a.feesCollected'), SCHOOL.money(feePaid), Math.round(feePaid / feeTotal * 100) + '% ' + I18N.t('a.collected'));
    host.appendChild(kpis);

    /* every class, with its teacher and today's roll-call state */
    const grid = UI.el('div', 'class-grid');
    SCHOOL.classes.forEach(c => {
      const ct = SCHOOL.classTeacherOf(c.id);
      const s = Store.attendanceSummary(c.id);
      const done = s.present + s.absent + s.late;
      const card = UI.el('button', 'class-card');
      card.type = 'button';
      card.innerHTML = '<span class="class-card-name">' + UI.esc(UI.classLabel(c)) + '</span>' +
        '<span class="class-card-meta">' + SCHOOL.studentsOf(c.id).length + ' ' + UI.esc(I18N.t('g.students')) +
        ' · ' + UI.esc(ct ? ct.name : '—') + '</span>' +
        '<span class="tag ' + (done ? 'green' : 'grey') + '">' +
        UI.esc(done ? I18N.t('att.summary', s) : I18N.t('att.pending')) + '</span>';
      card.addEventListener('click', () => { host.innerHTML = ''; Attendance.renderRegister(host); });
      grid.appendChild(card);
    });
    host.appendChild(grid);

    /* staff at a glance */
    const staff = UI.el('div', 'stack-top');
    Teachers.renderDirectory(staff);
    host.appendChild(staff);
  }
});
