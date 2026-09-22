/* ============================================================
   MODULE: modules/teachers.js
   The staff list in the admin portal: every teacher by name,
   the classes they hold, and whether they have taken today's
   roll call yet.
   ============================================================ */

(function (global) {

  /* ---- Add Teacher modal (admin only, live backend only) ---- */
  function openAddTeacherModal(allClasses, onCreated) {
    const backdrop = UI.el('div', 'se-modal-backdrop');
    backdrop.innerHTML =
      '<div class="se-modal" role="dialog" aria-modal="true">' +
        '<button type="button" class="se-modal-close" aria-label="Close">&times;</button>' +
        '<h2>' + UI.esc(I18N.t('g.addTeacher')) + '</h2>' +
        '<div id="atError" hidden class="se-modal-error"></div>' +
        '<form id="atForm">' +
          '<div class="se-form-grid">' +
            '<div class="span-2"><label>' + UI.esc(I18N.t('g.name')) + ' *</label><input id="atName" required></div>' +
            '<div><label>' + UI.esc(I18N.t('g.subject')) + ' *</label><input id="atSubject" required></div>' +
            '<div><label>' + UI.esc(I18N.t('g.phone')) + '</label><input id="atPhone"></div>' +
            '<div><label>' + UI.esc(I18N.t('a.joined')) + '</label><input id="atJoined" placeholder="2023"></div>' +
            '<div><label>' + UI.esc(I18N.t('g.classTeacherOf')) + '</label><select id="atCTO"><option value="">' +
              UI.esc(I18N.t('g.noneOption')) + '</option></select></div>' +
            '<div class="span-2"><label>' + UI.esc(I18N.t('a.classesHeld')) + '</label>' +
              '<select id="atClasses" multiple size="5"></select></div>' +
            '<div class="span-2"><label>' + UI.esc(I18N.t('g.uploadPhoto')) + '</label>' +
              '<input type="file" id="atPhoto" accept="image/*"></div>' +
          '</div>' +
          '<div class="se-modal-actions">' +
            '<button type="button" class="btn btn-ghost btn-sm" id="atCancel">' + UI.esc(I18N.t('g.cancel')) + '</button>' +
            '<button type="submit" class="btn btn-sm" id="atSubmit">' + UI.esc(I18N.t('g.addTeacher')) + '</button>' +
          '</div>' +
        '</form>' +
      '</div>';
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('open'));

    const ctoSel = backdrop.querySelector('#atCTO');
    const classesSel = backdrop.querySelector('#atClasses');
    allClasses.forEach(c => {
      const o1 = document.createElement('option'); o1.value = c.id; o1.textContent = UI.classLabel(c);
      ctoSel.appendChild(o1);
      const o2 = document.createElement('option'); o2.value = c.id; o2.textContent = UI.classLabel(c);
      classesSel.appendChild(o2);
    });

    function close() {
      backdrop.classList.remove('open');
      setTimeout(() => backdrop.remove(), 180);
    }
    backdrop.querySelector('.se-modal-close').addEventListener('click', close);
    backdrop.querySelector('#atCancel').addEventListener('click', close);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

    backdrop.querySelector('#atForm').addEventListener('submit', async e => {
      e.preventDefault();
      const errBox = backdrop.querySelector('#atError');
      errBox.hidden = true;

      const payload = {
        name: backdrop.querySelector('#atName').value.trim(),
        subject: backdrop.querySelector('#atSubject').value.trim(),
        phone: backdrop.querySelector('#atPhone').value.trim(),
        joinedYear: backdrop.querySelector('#atJoined').value.trim(),
        classTeacherOf: ctoSel.value,
        classes: Array.from(classesSel.selectedOptions).map(o => o.value)
      };

      const btn = backdrop.querySelector('#atSubmit');
      btn.disabled = true;
      btn.textContent = I18N.t('g.saving');

      try {
        const res = await Backend.createTeacher(payload);

        let photoNote = '';
        const photoFile = backdrop.querySelector('#atPhoto').files[0];
        if (photoFile) {
          try {
            await Backend.uploadAvatar('teacher', res.id, photoFile);
          } catch (photoErr) {
            photoNote = '<p class="se-modal-error" style="margin-top:8px">' +
              UI.esc(I18N.t('g.uploadFailed')) + ': ' + UI.esc(photoErr.message) + '</p>';
          }
        }

        backdrop.querySelector('.se-modal').innerHTML =
          '<button type="button" class="se-modal-close" aria-label="Close">&times;</button>' +
          '<div class="se-modal-success">' +
            '<h2>' + UI.esc(I18N.t('g.teacherAdded')) + '</h2>' +
            '<p>' + UI.esc(I18N.t('g.teacherId')) + ': <strong>' + UI.esc(res.id) + '</strong></p>' +
            '<p>' + UI.esc(I18N.t('g.tempPassword')) + '</p>' +
            '<span class="se-pw">' + UI.esc(res.password) + '</span>' +
            '<p class="cell-sub">' + UI.esc(I18N.t('g.tempPasswordNote')) + '</p>' +
            photoNote +
            '<div class="se-modal-actions"><button type="button" class="btn btn-sm" id="atDone">' +
              UI.esc(I18N.t('g.done')) + '</button></div>' +
          '</div>';
        backdrop.querySelector('.se-modal-close').addEventListener('click', () => { close(); onCreated(); });
        backdrop.querySelector('#atDone').addEventListener('click', () => { close(); onCreated(); });
      } catch (err) {
        errBox.textContent = err.message || I18N.t('fp.err.generic');
        errBox.hidden = false;
        btn.disabled = false;
        btn.textContent = I18N.t('g.addTeacher');
      }
    });
  }

  function renderDirectory(container) {
    let query = '';
    const isLive = typeof SE_BACKEND === 'function' && SE_BACKEND();
    const isAdmin = Auth.current() && Auth.current().role === 'admin';
    const canUpload = isLive && isAdmin;

    const head = UI.el('div', 'view-head');
    head.innerHTML = '<div><h2 class="view-title">' + UI.esc(I18N.t('a.staffList')) + '</h2>' +
      '<p class="view-sub">' + UI.esc(I18N.t('a.staffNote')) + '</p></div>' +
      '<div class="view-controls"><input id="tSearch" class="class-select" type="search" placeholder="' +
      UI.esc(I18N.t('g.searchTeacher')) + '">' +
      (isAdmin && isLive ? '<button type="button" class="btn btn-sm" id="dirAddTeacher">+ ' +
        UI.esc(I18N.t('g.addTeacher')) + '</button>' : '') +
      '</div>';
    container.appendChild(head);

    if (isAdmin && isLive) {
      head.querySelector('#dirAddTeacher').addEventListener('click', () => {
        openAddTeacherModal(SCHOOL.classes, () => location.reload());
      });
    }

    const host = UI.el('div');
    container.appendChild(host);
    head.querySelector('#tSearch').addEventListener('input', e => { query = e.target.value.toLowerCase(); paint(); });

    function paint() {
      host.innerHTML = '';
      const marked = Store.markedClassesToday();
      let list = SCHOOL.teachers;
      if (query) list = list.filter(t => (t.name + ' ' + t.subject + ' ' + t.id).toLowerCase().indexOf(query) > -1);

      const card = UI.el('div', 'card');
      card.innerHTML = '<div class="card-head"><h3>' + UI.esc(I18N.t('nav.teachers')) + '</h3>' +
        '<span class="tag grey">' + list.length + '</span></div>';

      if (!list.length) {
        card.appendChild(UI.el('div', 'card-pad empty-note', UI.esc(I18N.t('g.none'))));
        host.appendChild(card);
        return;
      }

      let rows = '';
      list.forEach(t => {
        const duty = t.classTeacherOf;
        const done = duty && marked.indexOf(duty) > -1;
        rows += '<tr><td><div class="cell-person"><span class="avatar-wrap">' +
          UI.avatar(t.name, t.photo, 'avatar-sm') +
          (canUpload ? '<button type="button" class="avatar-edit" data-teacher="' + UI.esc(t.id) + '" title="' +
            UI.esc(I18N.t('g.uploadPhoto')) + '">📷</button>' : '') +
          '</span><span><strong>' + UI.esc(t.name) +
          '</strong><div class="cell-sub">' + UI.esc(t.id) + ' · ' + UI.esc(t.phone) + '</div></span></div></td>' +
          '<td>' + UI.esc(t.subject) + '</td>' +
          '<td>' + t.classes.map(c => '<span class="pill-mini">' + UI.esc(UI.classLabel(c)) + '</span>').join('') + '</td>' +
          '<td>' + (duty ? UI.esc(UI.classLabel(duty)) : '—') + '</td>' +
          '<td>' + (duty
            ? '<span class="tag ' + (done ? 'green' : 'amber') + '">' +
              UI.esc(done ? I18N.t('a.done') : I18N.t('a.notDone')) + '</span>'
            : '<span class="tag grey">—</span>') + '</td>' +
          '<td>' + UI.esc(t.joined) + '</td></tr>';
      });

      card.innerHTML += '<table><thead><tr><th>' + UI.esc(I18N.t('g.name')) + '</th><th>' +
        UI.esc(I18N.t('g.subject')) + '</th><th>' + UI.esc(I18N.t('a.classesHeld')) + '</th><th>' +
        UI.esc(I18N.t('g.teacher')) + '</th><th>' + UI.esc(I18N.t('a.attendanceDuty')) + '</th><th>' +
        UI.esc(I18N.t('a.joined')) + '</th></tr></thead><tbody>' + rows + '</tbody></table>';
      host.appendChild(card);

      if (canUpload) {
        card.querySelectorAll('.avatar-edit').forEach(btn => {
          btn.addEventListener('click', () => {
            UI.pickImage(async file => {
              btn.disabled = true;
              try {
                await Backend.uploadAvatar('teacher', btn.dataset.teacher, file);
                const t = SCHOOL.teacherById(btn.dataset.teacher);
                if (t) t.photo = URL.createObjectURL(file); /* instant preview */
                paint();
              } catch (err) {
                UI.toast('⚠️', I18N.t('g.uploadFailed'), err.message, 'red');
              }
            });
          });
        });
      }
    }

    paint();
  }

  global.Teachers = { renderDirectory };

})(window);
