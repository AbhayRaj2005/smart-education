/* ============================================================
   MODULE: modules/student-record.js
   One student's record: personal details and attendance.
   Shown to the student in their own portal, and to admins /
   class teachers when they open a student from a roster.
   ============================================================ */

(function (global) {

  function detailsCard(student) {
    const cls = SCHOOL.classById(student.classId);
    const ct = SCHOOL.classTeacherOf(student.classId);
    const canUpload = (typeof SE_BACKEND === 'function' && SE_BACKEND()) &&
      Auth.current() && Auth.current().role === 'admin';

    const rows = [
      [I18N.t('g.admissionNo'), student.admissionNo],
      [I18N.t('g.class'), UI.classLabel(cls) + ' · ' + I18N.t('g.roll') + ' ' + student.roll],
      [I18N.t('g.dob'), student.dob],
      [I18N.t('g.parent'), student.parent],
      [I18N.t('g.phone'), student.phone],
      [I18N.t('g.address'), student.address],
      [I18N.t('g.bloodGroup'), student.bloodGroup],
      [I18N.t('g.house'), student.house],
      [I18N.t('s.classTeacher'), ct ? ct.name + ' · ' + ct.subject : '—']
    ];

    const card = UI.el('div', 'card');
    card.innerHTML = '<div class="card-head"><h3>' + UI.esc(I18N.t('s.myDetails')) + '</h3>' +
      '<span class="tag grey">' + UI.esc(student.id) + '</span></div>' +
      '<div class="card-pad"><div class="id-head"><span class="avatar-wrap">' +
      UI.avatar(student.name, student.photo, 'avatar-lg') +
      (canUpload ? '<button type="button" class="avatar-edit avatar-edit-lg" id="stuAvatarEdit" title="' +
        UI.esc(I18N.t('g.uploadPhoto')) + '">📷</button>' : '') +
      '</span><div><h4 class="id-name">' + UI.esc(student.name) +
      '</h4><span class="cell-sub">' + UI.esc(UI.classLabel(cls)) + ' · ' + UI.esc(cls.room) + '</span></div></div>' +
      '<dl class="detail-list">' +
      rows.map(r => '<div><dt>' + UI.esc(r[0]) + '</dt><dd>' + UI.esc(r[1]) + '</dd></div>').join('') +
      '</dl></div>';

    if (canUpload) {
      card.querySelector('#stuAvatarEdit').addEventListener('click', () => {
        UI.pickImage(async file => {
          try {
            const url = await Backend.uploadAvatar('student', student.id, file);
            student.photo = url;
            UI.toast('✅', I18N.t('g.photoUpdated'), student.name, 'green');
            card.querySelector('.avatar-wrap .avatar').outerHTML =
              UI.avatar(student.name, URL.createObjectURL(file), 'avatar-lg');
          } catch (err) {
            UI.toast('⚠️', I18N.t('g.uploadFailed'), err.message, 'red');
          }
        });
      });
    }

    return card;
  }

  function attendanceCard(student) {
    const a = student.attendance;
    const todayMark = Store.getAttendance(student.classId)[student.id];
    const tone = a.rate >= 85 ? 'green' : a.rate >= 75 ? 'amber' : 'red';

    const card = UI.el('div', 'card');
    card.innerHTML = '<div class="card-head"><h3>' + UI.esc(I18N.t('s.myAttendance')) + '</h3>' +
      '<span class="tag ' + tone + '">' + a.rate + '%</span></div>' +
      '<div class="card-pad"><div class="fee-figures">' +
      '<div><span>' + UI.esc(I18N.t('att.daysPresent')) + '</span><strong>' + a.presentDays + '</strong></div>' +
      '<div><span>' + UI.esc(I18N.t('att.daysTotal')) + '</span><strong>' + a.totalDays + '</strong></div>' +
      '<div><span>' + UI.esc(I18N.t('g.today')) + '</span><strong>' +
      UI.esc(todayMark ? I18N.t('att.' + todayMark) : I18N.t('att.pending')) + '</strong></div>' +
      '</div><div class="progress" style="margin-top:14px"><div style="width:' + a.rate + '%"></div></div>' +
      '<p class="cell-sub" style="margin-top:12px">' + UI.esc(I18N.t('att.note')) + '</p></div>';
    return card;
  }

  /* ---- Add Student modal (admin only, live backend only) ---- */
  function openAddStudentModal(allowed, onCreated) {
    const backdrop = UI.el('div', 'se-modal-backdrop');
    backdrop.innerHTML =
      '<div class="se-modal" role="dialog" aria-modal="true">' +
        '<button type="button" class="se-modal-close" aria-label="Close">&times;</button>' +
        '<h2>' + UI.esc(I18N.t('g.addStudent')) + '</h2>' +
        '<div id="asError" hidden class="se-modal-error"></div>' +
        '<form id="asForm">' +
          '<div class="se-form-grid">' +
            '<div class="span-2"><label>' + UI.esc(I18N.t('g.name')) + ' *</label><input id="asName" required></div>' +
            '<div><label>' + UI.esc(I18N.t('g.class')) + ' *</label><select id="asClass" required></select></div>' +
            '<div><label>' + UI.esc(I18N.t('g.roll')) + ' *</label><input id="asRoll" required></div>' +
            '<div><label>' + UI.esc(I18N.t('g.parent')) + '</label><input id="asParentName"></div>' +
            '<div><label>' + UI.esc(I18N.t('g.phone')) + ' *</label><input id="asPhone" required></div>' +
            '<div><label>' + UI.esc(I18N.t('g.admissionNo')) + '</label><input id="asAdmission"></div>' +
            '<div><label>' + UI.esc(I18N.t('g.dob')) + '</label><input id="asDob" placeholder="YYYY-MM-DD"></div>' +
            '<div><label>' + UI.esc(I18N.t('g.bloodGroup')) + '</label><input id="asBlood"></div>' +
            '<div><label>' + UI.esc(I18N.t('g.house')) + '</label><input id="asHouse"></div>' +
            '<div class="span-2"><label>' + UI.esc(I18N.t('g.address')) + '</label><input id="asAddress"></div>' +
            '<div class="span-2"><label>' + UI.esc(I18N.t('g.uploadPhoto')) + '</label>' +
              '<input type="file" id="asPhoto" accept="image/*"></div>' +
          '</div>' +
          '<div class="se-modal-actions">' +
            '<button type="button" class="btn btn-ghost btn-sm" id="asCancel">' + UI.esc(I18N.t('g.cancel')) + '</button>' +
            '<button type="submit" class="btn btn-sm" id="asSubmit">' + UI.esc(I18N.t('g.addStudent')) + '</button>' +
          '</div>' +
        '</form>' +
      '</div>';
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('open'));

    const classSel = backdrop.querySelector('#asClass');
    allowed.forEach(c => {
      const o = document.createElement('option');
      o.value = c.id; o.textContent = UI.classLabel(c);
      classSel.appendChild(o);
    });

    function close() {
      backdrop.classList.remove('open');
      setTimeout(() => backdrop.remove(), 180);
    }
    backdrop.querySelector('.se-modal-close').addEventListener('click', close);
    backdrop.querySelector('#asCancel').addEventListener('click', close);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

    backdrop.querySelector('#asForm').addEventListener('submit', async e => {
      e.preventDefault();
      const errBox = backdrop.querySelector('#asError');
      errBox.hidden = true;

      const payload = {
        name: backdrop.querySelector('#asName').value.trim(),
        classId: classSel.value,
        roll: backdrop.querySelector('#asRoll').value.trim(),
        parentName: backdrop.querySelector('#asParentName').value.trim(),
        parentPhone: backdrop.querySelector('#asPhone').value.trim(),
        admissionNo: backdrop.querySelector('#asAdmission').value.trim(),
        dob: backdrop.querySelector('#asDob').value.trim(),
        bloodGroup: backdrop.querySelector('#asBlood').value.trim(),
        house: backdrop.querySelector('#asHouse').value.trim(),
        address: backdrop.querySelector('#asAddress').value.trim()
      };

      const btn = backdrop.querySelector('#asSubmit');
      btn.disabled = true;
      btn.textContent = I18N.t('g.saving');

      try {
        const res = await Backend.createStudent(payload);

        let photoNote = '';
        const photoFile = backdrop.querySelector('#asPhoto').files[0];
        if (photoFile) {
          try {
            await Backend.uploadAvatar('student', res.id, photoFile);
          } catch (photoErr) {
            photoNote = '<p class="se-modal-error" style="margin-top:8px">' +
              UI.esc(I18N.t('g.uploadFailed')) + ': ' + UI.esc(photoErr.message) + '</p>';
          }
        }

        backdrop.querySelector('.se-modal').innerHTML =
          '<button type="button" class="se-modal-close" aria-label="Close">&times;</button>' +
          '<div class="se-modal-success">' +
            '<h2>' + UI.esc(I18N.t('g.studentAdded')) + '</h2>' +
            '<p>' + UI.esc(I18N.t('g.studentId')) + ': <strong>' + UI.esc(res.id) + '</strong></p>' +
            '<p>' + UI.esc(I18N.t('g.tempPassword')) + '</p>' +
            '<span class="se-pw">' + UI.esc(res.password) + '</span>' +
            '<p class="cell-sub">' + UI.esc(I18N.t('g.tempPasswordNote')) + '</p>' +
            photoNote +
            '<div class="se-modal-actions"><button type="button" class="btn btn-sm" id="asDone">' +
              UI.esc(I18N.t('g.done')) + '</button></div>' +
          '</div>';
        backdrop.querySelector('.se-modal-close').addEventListener('click', () => { close(); onCreated(); });
        backdrop.querySelector('#asDone').addEventListener('click', () => { close(); onCreated(); });
      } catch (err) {
        errBox.textContent = err.message || I18N.t('fp.err.generic');
        errBox.hidden = false;
        btn.disabled = false;
        btn.textContent = I18N.t('g.addStudent');
      }
    });
  }

  /* Roster with a click-through to any student's record. */
  function renderRoster(container, opts) {
    const allowed = opts.classes && opts.classes.length ? opts.classes : SCHOOL.classes;
    let classId = allowed[0].id;
    let query = '';
    const isAdmin = Auth.current() && Auth.current().role === 'admin';
    const isLive = typeof SE_BACKEND === 'function' && SE_BACKEND();

    const head = UI.el('div', 'view-head');
    head.innerHTML = '<div><h2 class="view-title">' + UI.esc(I18N.t('a.classRoster')) + '</h2>' +
      '<p class="view-sub">' + UI.esc(I18N.t('g.selectClass.hint')) + '</p></div>' +
      '<div class="view-controls"><select id="rosClass" class="class-select"></select>' +
      '<input id="rosSearch" class="class-select" type="search" placeholder="' +
      UI.esc(I18N.t('g.searchStudent')) + '">' +
      (isAdmin && isLive ? '<button type="button" class="btn btn-sm" id="rosAddStudent">+ ' +
        UI.esc(I18N.t('g.addStudent')) + '</button>' : '') +
      '</div>';
    container.appendChild(head);

    if (isAdmin && isLive) {
      head.querySelector('#rosAddStudent').addEventListener('click', () => {
        openAddStudentModal(SCHOOL.classes, () => {
          /* simplest reliable way to pick up the new student everywhere
             (roster, class counts, KPIs) without re-plumbing the cache */
          location.reload();
        });
      });
    }

    const sel = head.querySelector('#rosClass');
    allowed.forEach(c => {
      const o = document.createElement('option');
      o.value = c.id; o.textContent = UI.classLabel(c);
      sel.appendChild(o);
    });
    sel.addEventListener('change', () => { classId = sel.value; paint(); });
    head.querySelector('#rosSearch').addEventListener('input', e => { query = e.target.value.toLowerCase(); paint(); });

    const host = UI.el('div');
    container.appendChild(host);

    function paint() {
      host.innerHTML = '';
      const cls = SCHOOL.classById(classId);
      const ct = SCHOOL.classTeacherOf(classId);
      let roster = SCHOOL.studentsOf(classId);
      if (query) roster = roster.filter(s => (s.name + ' ' + s.roll).toLowerCase().indexOf(query) > -1);

      const card = UI.el('div', 'card');
      card.innerHTML = '<div class="card-head"><h3>' + UI.esc(UI.classLabel(cls)) + '</h3>' +
        '<span class="tag grey">' + roster.length + ' ' + UI.esc(I18N.t('g.students')) + '</span></div>' +
        '<div class="roster-meta"><span>' + UI.esc(I18N.t('g.teacher')) + ': <strong>' +
        UI.esc(ct ? ct.name : '—') + '</strong></span><span>' + UI.esc(cls.room) + '</span></div>';

      if (!roster.length) {
        card.appendChild(UI.el('div', 'card-pad empty-note', UI.esc(I18N.t('g.none'))));
        host.appendChild(card);
        return;
      }

      let rows = '';
      roster.forEach(s => {
        const avg = SCHOOL.averageOf(s);
        rows += '<tr data-student="' + s.id + '"><td>' + UI.esc(s.roll) + '</td>' +
          '<td><strong>' + UI.esc(s.name) + '</strong><div class="cell-sub">' + UI.esc(s.id) + '</div></td>' +
          '<td>' + UI.esc(s.parent) + '<div class="cell-sub">' + UI.esc(s.phone) + '</div></td>' +
          '<td>' + s.attendance.rate + '%</td><td>' + avg + '%</td>' +
          '<td>' + (s.fees.due ? '<span class="tag amber">' + SCHOOL.money(s.fees.due) + '</span>'
            : '<span class="tag green">' + UI.esc(I18N.t('s.cleared')) + '</span>') + '</td>' +
          '<td><button class="btn btn-ghost btn-sm row-open" type="button">' + UI.esc(I18N.t('g.view')) + '</button></td></tr>';
      });

      card.innerHTML += '<table><thead><tr><th>' + UI.esc(I18N.t('g.roll')) + '</th><th>' +
        UI.esc(I18N.t('g.name')) + '</th><th>' + UI.esc(I18N.t('g.parent')) + '</th><th>' +
        UI.esc(I18N.t('att.rate')) + '</th><th>' + UI.esc(I18N.t('g.marks')) + '</th><th>' +
        UI.esc(I18N.t('g.due')) + '</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
      host.appendChild(card);

      card.querySelectorAll('tr[data-student]').forEach(tr => {
        tr.querySelector('.row-open').addEventListener('click', () => openRecord(tr.dataset.student));
      });
    }

    function openRecord(studentId) {
      const student = SCHOOL.studentById(studentId);
      const back = UI.el('button', 'btn btn-ghost btn-sm back-btn', '← ' + UI.esc(I18N.t('a.classRoster')));
      back.type = 'button';
      container.innerHTML = '';
      container.appendChild(back);
      back.addEventListener('click', () => { container.innerHTML = ''; renderRoster(container, opts); });

      const grid = UI.el('div', 'grid-2');
      grid.appendChild(detailsCard(student));
      grid.appendChild(attendanceCard(student));
      container.appendChild(grid);

      const marks = UI.el('div', 'stack-top');
      Gradebook.renderStudentMarks(marks, student);
      container.appendChild(marks);

      const fees = UI.el('div', 'stack-top');
      Fees.renderStudentFees(fees, student);
      container.appendChild(fees);
    }

    paint();
  }

  global.StudentRecord = { detailsCard, attendanceCard, renderRoster };

})(window);
