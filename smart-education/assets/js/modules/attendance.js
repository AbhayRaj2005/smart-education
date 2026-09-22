/* ============================================================
   MODULE: modules/attendance.js
   Open a class → the whole roll appears. Used by the teacher
   portal (editable roll call) and the admin portal (read-only
   register across every class).
   ============================================================ */

(function (global) {

  function statusChip(status, active) {
    return '<button type="button" class="chip att-chip att-' + status + (active ? ' active' : '') +
      '" data-status="' + status + '">' + UI.esc(I18N.t('att.' + status)) + '</button>';
  }

  /* ---------- teacher: editable roll call ---------- */
  function renderRollCall(container, opts) {
    const allowed = opts.classes && opts.classes.length ? opts.classes : SCHOOL.classes;
    let classId = opts.classId || allowed[0].id;

    const head = UI.el('div', 'view-head');
    head.innerHTML =
      '<div><h2 class="view-title">' + UI.esc(I18N.t('att.title')) + '</h2>' +
      '<p class="view-sub">' + UI.esc(I18N.t('g.selectClass.hint')) + ' · ' + UI.esc(I18N.today()) + '</p></div>' +
      '<div class="view-controls"><label for="attClass">' + UI.esc(I18N.t('g.class')) + '</label>' +
      '<select id="attClass" class="class-select"></select></div>';
    container.appendChild(head);

    const sel = head.querySelector('#attClass');
    allowed.forEach(c => {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = UI.classLabel(c) + ' · ' + c.room;
      if (c.id === classId) o.selected = true;
      sel.appendChild(o);
    });

    const host = UI.el('div');
    container.appendChild(host);

    sel.addEventListener('change', () => { classId = sel.value; paint(); });

    function paint() {
      host.innerHTML = '';
      const cls = SCHOOL.classById(classId);
      const roster = SCHOOL.studentsOf(classId);
      const saved = Store.getAttendance(classId);
      const ct = SCHOOL.classTeacherOf(classId);

      const card = UI.el('div', 'card');
      card.innerHTML = '<div class="card-head"><h3>' + UI.esc(UI.classLabel(cls)) + ' · ' +
        UI.esc(cls.room) + '</h3><span class="tag grey" id="attCount"></span></div>';

      const meta = UI.el('div', 'roster-meta');
      meta.innerHTML = '<span>' + UI.esc(I18N.t('g.students')) + ': <strong>' + roster.length + '</strong></span>' +
        (ct ? '<span>' + UI.esc(I18N.t('g.teacher')) + ': <strong>' + UI.esc(ct.name) + '</strong></span>' : '') +
        '<span>' + UI.esc(I18N.t('g.today')) + ': <strong>' + UI.esc(I18N.today()) + '</strong></span>';
      card.appendChild(meta);

      const list = UI.el('ul', 'list-simple roll-list');
      roster.forEach(st => {
        const status = saved[st.id] || '';
        const li = UI.el('li', 'roll-row');
        li.dataset.student = st.id;
        li.innerHTML =
          '<span class="roll-id"><span class="roll-no">' + UI.esc(st.roll) + '</span>' +
          '<span class="roll-name">' + UI.esc(st.name) + '<span class="meta">' + UI.esc(st.parent) + ' · ' + UI.esc(st.phone) + '</span></span></span>' +
          '<span class="att-chips">' + statusChip('present', status === 'present') +
          statusChip('absent', status === 'absent') + statusChip('late', status === 'late') + '</span>';
        list.appendChild(li);
      });
      card.appendChild(list);

      const note = UI.el('div', 'card-pad');
      note.innerHTML = '<div class="modal-note">' + UI.esc(I18N.t('att.note')) + '</div>' +
        '<div class="btn-row"><button class="btn btn-primary btn-sm" type="button" id="attSave">' +
        UI.esc(I18N.t('att.save')) + '</button>' +
        '<button class="btn btn-ghost btn-sm" type="button" id="attAll">' +
        UI.esc(I18N.t('att.markAll')) + '</button></div>';
      card.appendChild(note);

      host.appendChild(card);

      /* interactions */
      list.querySelectorAll('.roll-row').forEach(row => {
        const student = SCHOOL.studentById(row.dataset.student);
        row.querySelectorAll('.att-chip').forEach(chip => {
          chip.addEventListener('click', () => {
            const status = chip.dataset.status;
            const already = chip.classList.contains('active');
            row.querySelectorAll('.att-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            Store.setAttendance(classId, student.id, status).then(res => {
              if (status === 'absent' && !already) SMS.notifyAbsent(student, res);
              count();
            });
            count();
          });
        });
      });

      card.querySelector('#attAll').addEventListener('click', () => {
        Store.setAttendanceBulk(classId, roster.map(st => ({ studentId: st.id, status: 'present' })))
          .then(paint);
      });

      card.querySelector('#attSave').addEventListener('click', () => {
        const s = Store.attendanceSummary(classId);
        UI.toast('✓', I18N.t('att.saved'), I18N.t('att.savedBody', {
          class: UI.classLabel(cls), date: I18N.today()
        }) + ' ' + I18N.t('att.summary', s));
      });

      function count() {
        const s = Store.attendanceSummary(classId);
        const marked = s.present + s.absent + s.late;
        card.querySelector('#attCount').textContent = marked + ' / ' + roster.length;
      }
      count();
    }

    paint();
  }

  /* ---------- admin: read-only register for any class ---------- */
  function renderRegister(container) {
    let classId = SCHOOL.classes[0].id;

    const head = UI.el('div', 'view-head');
    head.innerHTML =
      '<div><h2 class="view-title">' + UI.esc(I18N.t('att.titleAdmin')) + '</h2>' +
      '<p class="view-sub">' + UI.esc(I18N.t('g.selectClass.hint')) + '</p></div>' +
      '<div class="view-controls"><label for="regClass">' + UI.esc(I18N.t('g.class')) + '</label>' +
      '<select id="regClass" class="class-select"></select></div>';
    container.appendChild(head);

    const sel = head.querySelector('#regClass');
    SCHOOL.classes.forEach(c => {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = UI.classLabel(c);
      sel.appendChild(o);
    });

    const host = UI.el('div');
    container.appendChild(host);
    sel.addEventListener('change', () => { classId = sel.value; paint(); });

    function paint() {
      host.innerHTML = '';
      const cls = SCHOOL.classById(classId);
      const roster = SCHOOL.studentsOf(classId);
      const saved = Store.getAttendance(classId);
      const ct = SCHOOL.classTeacherOf(classId);
      const s = Store.attendanceSummary(classId);

      const card = UI.el('div', 'card');
      card.innerHTML = '<div class="card-head"><h3>' + UI.esc(UI.classLabel(cls)) + '</h3>' +
        '<span class="tag ' + (s.present + s.absent + s.late ? 'green' : 'grey') + '">' +
        UI.esc(I18N.t('att.summary', s)) + '</span></div>' +
        '<div class="roster-meta"><span>' + UI.esc(I18N.t('g.teacher')) + ': <strong>' +
        UI.esc(ct ? ct.name : '—') + '</strong></span><span>' + UI.esc(I18N.t('g.students')) +
        ': <strong>' + roster.length + '</strong></span><span>' + UI.esc(I18N.today()) + '</span></div>';

      let rows = '';
      roster.forEach(st => {
        const status = saved[st.id];
        const tone = status === 'present' ? 'green' : status === 'absent' ? 'red' : status === 'late' ? 'amber' : 'grey';
        const label = status ? I18N.t('att.' + status) : I18N.t('att.pending');
        rows += '<tr><td>' + UI.esc(st.roll) + '</td><td>' + UI.esc(st.name) +
          '</td><td>' + UI.esc(st.parent) + '<div class="cell-sub">' + UI.esc(st.phone) + '</div></td>' +
          '<td><span class="tag ' + tone + '">' + UI.esc(label) + '</span></td>' +
          '<td>' + st.attendance.rate + '%</td></tr>';
      });

      card.innerHTML += '<table><thead><tr><th>' + UI.esc(I18N.t('g.roll')) + '</th><th>' +
        UI.esc(I18N.t('g.name')) + '</th><th>' + UI.esc(I18N.t('g.parent')) + '</th><th>' +
        UI.esc(I18N.t('g.today')) + '</th><th>' + UI.esc(I18N.t('att.rate')) + '</th></tr></thead><tbody>' +
        rows + '</tbody></table>';
      host.appendChild(card);
    }

    paint();
  }

  global.Attendance = { renderRollCall, renderRegister };

})(window);
