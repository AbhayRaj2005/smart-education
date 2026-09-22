/* ============================================================
   MODULE: modules/timetable.js
   Weekly grid.
     · student  → own class, read-only (locked)
     · teacher  → "My schedule" (all their periods across classes)
                  plus read-only class grids
     · admin    → editable class grids (click a period) and a
                  teacher-wise view with clash highlighting

   Options for render():
     classes      classes the class picker offers (default: all)
     classId      class to open first
     lockClass    hide the class picker (student)
     editable     admin only — periods open an editor
     modes        ['class'] | ['teacher','class'] | ['class','teacher']
     mode         which mode opens first (default: modes[0])
     teacherId    teacher shown first in teacher mode
     pickTeacher  show a teacher picker (admin); otherwise fixed to teacherId
   ============================================================ */

(function (global) {

  const DAYS = ['day.mon', 'day.tue', 'day.wed', 'day.thu', 'day.fri'];
  const MIN_PERIODS = 6;

  function backend() { return typeof SE_BACKEND === 'function' && SE_BACKEND(); }

  /* ---------------- data helpers ---------------- */

  /* period rows 1..N for a class, each with exactly 5 slots (null = free) */
  function periodRows(classId) {
    const rows = SCHOOL.timetableFor(classId) || [];
    const byP = {};
    rows.forEach(r => { byP[r.period] = r; });
    const max = Math.max(MIN_PERIODS, rows.reduce((m, r) => Math.max(m, r.period), 0));
    const out = [];
    for (let p = 1; p <= max; p++) {
      const slots = [];
      for (let d = 0; d < 5; d++) slots.push((byP[p] && byP[p].slots[d]) || null);
      out.push({ period: p, slots: slots });
    }
    return out;
  }

  /* teacherId|dayIndex|period → [{ classId, subject, room }] across the whole school */
  function bookings() {
    const map = {};
    SCHOOL.classes.forEach(c => {
      periodRows(c.id).forEach(r => {
        r.slots.forEach((s, d) => {
          if (!s || !s.teacherId) return;
          const k = s.teacherId + '|' + d + '|' + r.period;
          (map[k] = map[k] || []).push({ classId: c.id, subject: s.subject, room: s.room });
        });
      });
    });
    return map;
  }

  function clashCount(map) {
    return Object.keys(map).filter(k => map[k].length > 1).length;
  }

  function otherClasses(map, teacherId, d, p, exceptClassId) {
    return (map[teacherId + '|' + d + '|' + p] || [])
      .filter(b => b.classId !== exceptClassId).map(b => b.classId);
  }

  function maxPeriod() {
    let m = MIN_PERIODS;
    SCHOOL.classes.forEach(c => { m = Math.max(m, periodRows(c.id).length); });
    return m;
  }

  /* ---------------- grids ---------------- */

  function headRow() {
    let html = '<div class="head"></div>';
    DAYS.forEach(d => { html += '<div class="head">' + UI.esc(I18N.t(d)) + '</div>'; });
    return html;
  }

  /* one class, Mon–Fri × periods. Clickable when opts.editable. */
  function grid(classId, opts) {
    opts = opts || {};
    const map = bookings();
    let html = '<div class="timetable">' + headRow();

    periodRows(classId).forEach(r => {
      html += '<div class="time">P' + r.period + '</div>';
      r.slots.forEach((s, d) => {
        const attrs = opts.editable
          ? ' data-d="' + (d + 1) + '" data-p="' + r.period + '" role="button" tabindex="0"' : '';
        const edit = opts.editable ? ' slot-edit' : '';

        if (!s) {
          html += '<div class="slot slot-empty' + edit + '"' + attrs + '>' +
            (opts.editable
              ? '<span class="slot-add">+ ' + UI.esc(I18N.t('tt.add')) + '</span>'
              : '<span class="slot-free">—</span>') + '</div>';
          return;
        }

        const others = s.teacherId ? otherClasses(map, s.teacherId, d, r.period, classId) : [];
        html += '<div class="slot' + edit + (others.length ? ' slot-clash' : '') + '"' + attrs + '>' +
          '<span class="subj">' + UI.esc(s.subject) + '</span>' +
          '<span class="room">' + UI.esc(s.teacher) + ' · ' + UI.esc(s.room || '') + '</span>' +
          (others.length && opts.editable
            ? '<span class="clash-note">⚠ ' + UI.esc(I18N.t('tt.alsoIn', { cls: others.join(', ') })) + '</span>' : '') +
          '</div>';
      });
    });
    return html + '</div>';
  }

  /* one teacher across every class they teach in — derived, so it can never disagree with the class grids */
  function teacherGrid(teacherId) {
    const map = bookings();
    const total = maxPeriod();
    let html = '<div class="timetable">' + headRow();

    for (let p = 1; p <= total; p++) {
      html += '<div class="time">P' + p + '</div>';
      for (let d = 0; d < 5; d++) {
        const here = map[teacherId + '|' + d + '|' + p] || [];
        if (!here.length) {
          html += '<div class="slot slot-empty"><span class="slot-free">' + UI.esc(I18N.t('tt.free')) + '</span></div>';
          continue;
        }
        html += '<div class="slot' + (here.length > 1 ? ' slot-clash' : '') + '">';
        here.forEach(b => {
          html += '<span class="subj">' + UI.esc(b.subject) + '</span>' +
            '<span class="room">' + UI.esc(UI.classLabel(b.classId)) + ' · ' + UI.esc(b.room || '') + '</span>';
        });
        if (here.length > 1) {
          html += '<span class="clash-note">⚠ ' + UI.esc(I18N.t('tt.clashCell')) + '</span>';
        }
        html += '</div>';
      }
    }
    return html + '</div>';
  }

  /* ---------------- period editor (admin) ---------------- */

  function openEditor(classId, weekday, period, onDone) {
    const cls = SCHOOL.classById(classId);
    const rows = periodRows(classId);
    const current = (rows[period - 1] && rows[period - 1].slots[weekday - 1]) || null;
    const map = bookings();
    const d0 = weekday - 1;

    const subjects = [];
    SCHOOL.subjectsFor(cls.grade).concat(
      SCHOOL.teachers.map(t => t.subject), current ? [current.subject] : []
    ).forEach(s => { if (s && subjects.indexOf(s) < 0) subjects.push(s); });

    function busyIds(teacherId) { return otherClasses(map, teacherId, d0, period, classId); }

    /* best default teacher for a subject: free, holds this class, teaches the subject */
    function suggest(subject) {
      const same = SCHOOL.teachers.filter(t => t.subject === subject && busyIds(t.id).length === 0);
      return (same.find(t => t.classes.indexOf(classId) > -1) || same[0] || {}).id || '';
    }

    const backdrop = UI.el('div', 'se-modal-backdrop');
    backdrop.innerHTML =
      '<div class="se-modal" role="dialog" aria-modal="true">' +
        '<button type="button" class="se-modal-close" aria-label="' + UI.esc(I18N.t('nt.close')) + '">&times;</button>' +
        '<h2>' + UI.esc(I18N.t('tt.editTitle')) + '</h2>' +
        '<p class="tt-edit-sub">' + UI.esc(UI.classLabel(classId)) + ' · ' + UI.esc(I18N.t(DAYS[d0])) + ' · P' + period + '</p>' +
        '<div class="se-modal-error" id="ttErr" hidden></div>' +
        '<div class="se-form-grid">' +
          '<div class="span-2"><label for="ttSub">' + UI.esc(I18N.t('tt.subject')) + '</label><select id="ttSub"></select></div>' +
          '<div class="span-2"><label for="ttTeacher">' + UI.esc(I18N.t('tt.teacher')) + '</label><select id="ttTeacher"></select>' +
            '<div class="tt-hint" id="ttHint" hidden></div></div>' +
          '<div class="span-2"><label for="ttRoom">' + UI.esc(I18N.t('tt.room')) + '</label><input id="ttRoom" type="text" maxlength="40"></div>' +
        '</div>' +
        '<div class="se-modal-actions">' +
          (current ? '<button type="button" class="btn btn-ghost btn-sm" id="ttClear" style="margin-right:auto">' + UI.esc(I18N.t('tt.clear')) + '</button>' : '') +
          '<button type="button" class="btn btn-ghost btn-sm" id="ttCancel">' + UI.esc(I18N.t('nt.cancel')) + '</button>' +
          '<button type="button" class="btn btn-marigold btn-sm" id="ttSave">' + UI.esc(I18N.t('tt.save')) + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('open'));

    const $ = id => backdrop.querySelector('#' + id);
    const subSel = $('ttSub'), tSel = $('ttTeacher'), roomIn = $('ttRoom'), errBox = $('ttErr'), hint = $('ttHint');
    const saveBtn = $('ttSave');

    subjects.forEach(s => {
      const o = document.createElement('option');
      o.value = s; o.textContent = s;
      if (current && current.subject === s) o.selected = true;
      subSel.appendChild(o);
    });
    roomIn.value = (current && current.room) || cls.room || '';

    function fillTeachers(selectedId) {
      const subject = subSel.value;
      const list = SCHOOL.teachers.slice().sort((a, b) =>
        (b.subject === subject) - (a.subject === subject) || a.name.localeCompare(b.name));
      tSel.innerHTML = '';
      list.forEach(t => {
        const busy = busyIds(t.id);
        const o = document.createElement('option');
        o.value = t.id;
        o.textContent = t.name + ' · ' + t.subject +
          (busy.length ? ' — ' + I18N.t('tt.busyIn', { cls: busy.join(', ') }) : '');
        /* a teacher who is busy elsewhere cannot be newly picked; the one already on this
           period stays selectable so an existing clash can still be looked at and cleared */
        if (busy.length && !(current && current.teacherId === t.id)) o.disabled = true;
        if (t.id === selectedId) o.selected = true;
        tSel.appendChild(o);
      });
      showHint();
    }

    function showHint() {
      const t = SCHOOL.teacherById(tSel.value);
      const notHeld = t && t.classes.indexOf(classId) < 0;
      hint.hidden = !notHeld;
      if (notHeld) hint.textContent = I18N.t('tt.notAssigned', { name: t.name, cls: UI.classLabel(classId) });
    }

    fillTeachers(current && current.teacherId ? current.teacherId : suggest(subSel.value));
    subSel.addEventListener('change', () => fillTeachers(suggest(subSel.value)));
    tSel.addEventListener('change', showHint);

    function close() {
      backdrop.classList.remove('open');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => backdrop.remove(), 200);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    backdrop.querySelector('.se-modal-close').addEventListener('click', close);
    $('ttCancel').addEventListener('click', close);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

    function fail(msg) { errBox.textContent = msg; errBox.hidden = false; }

    saveBtn.addEventListener('click', async () => {
      errBox.hidden = true;
      const subject = subSel.value;
      const teacher = SCHOOL.teacherById(tSel.value);
      const room = roomIn.value.trim() || cls.room || '';
      if (!subject || !teacher) { fail(I18N.t('tt.needTeacher')); return; }

      const busy = busyIds(teacher.id);
      if (busy.length && !(current && current.teacherId === teacher.id)) {
        fail(I18N.t('tt.clash', { name: teacher.name, cls: busy.join(', ') }));
        return;
      }

      saveBtn.disabled = true;
      try {
        if (backend()) await Backend.saveTimetableSlot(classId, weekday, period, subject, teacher.id, room);
        SCHOOL.setSlot(classId, weekday, period,
          { subject: subject, teacher: teacher.name, teacherId: teacher.id, room: room });
        UI.toast('🗓️', I18N.t('tt.saved'), UI.classLabel(classId) + ' · ' + I18N.t(DAYS[d0]) + ' · P' + period);
        close(); onDone();
      } catch (err) {
        fail(err.message || I18N.t('tt.saveFail'));
        saveBtn.disabled = false;
      }
    });

    const clearBtn = $('ttClear');
    if (clearBtn) clearBtn.addEventListener('click', async () => {
      errBox.hidden = true;
      clearBtn.disabled = true;
      try {
        if (backend()) await Backend.clearTimetableSlot(classId, weekday, period);
        SCHOOL.setSlot(classId, weekday, period, null);
        UI.toast('🗓️', I18N.t('tt.cleared'), UI.classLabel(classId) + ' · ' + I18N.t(DAYS[d0]) + ' · P' + period);
        close(); onDone();
      } catch (err) {
        fail(err.message || I18N.t('tt.saveFail'));
        clearBtn.disabled = false;
      }
    });
  }

  /* ---------------- view ---------------- */

  function render(container, opts) {
    opts = opts || {};
    const allowed = opts.classes && opts.classes.length ? opts.classes : SCHOOL.classes;
    const modes = opts.modes && opts.modes.length ? opts.modes : ['class'];
    const state = {
      mode: opts.mode && modes.indexOf(opts.mode) > -1 ? opts.mode : modes[0],
      classId: opts.classId || allowed[0].id,
      teacherId: opts.teacherId || (SCHOOL.teachers[0] && SCHOOL.teachers[0].id)
    };

    const head = UI.el('div', 'view-head');
    const notes = UI.el('div');
    const body = UI.el('div', 'card card-pad');
    container.appendChild(head);
    container.appendChild(notes);
    container.appendChild(body);

    function paintHead() {
      const t = SCHOOL.teacherById(state.teacherId);
      const sub = state.mode === 'teacher'
        ? (t ? t.name + ' · ' + t.subject : '')
        : UI.classLabel(state.classId);

      head.innerHTML = '<div><h2 class="view-title">' + UI.esc(I18N.t('nav.timetable')) + '</h2>' +
        '<p class="view-sub">' + UI.esc(sub) + '</p></div><div class="view-controls"></div>';
      const ctl = head.querySelector('.view-controls');

      if (modes.length > 1) {
        const row = UI.el('div', 'chip-row');
        modes.forEach(m => {
          const label = m === 'teacher'
            ? (opts.pickTeacher ? I18N.t('tt.byTeacher') : I18N.t('tt.mySchedule'))
            : (opts.pickTeacher || opts.editable ? I18N.t('tt.byClass') : I18N.t('tt.classGrids'));
          const b = UI.el('button', 'chip' + (state.mode === m ? ' active' : ''), UI.esc(label));
          b.type = 'button';
          b.addEventListener('click', () => { state.mode = m; paint(); });
          row.appendChild(b);
        });
        ctl.appendChild(row);
      }

      if (state.mode === 'class' && !opts.lockClass) {
        const sel = UI.el('select', 'class-select');
        allowed.forEach(c => {
          const o = document.createElement('option');
          o.value = c.id; o.textContent = UI.classLabel(c);
          if (c.id === state.classId) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', () => { state.classId = sel.value; paint(); });
        ctl.appendChild(sel);
      }

      if (state.mode === 'teacher' && opts.pickTeacher) {
        const sel = UI.el('select', 'class-select');
        SCHOOL.teachers.forEach(tc => {
          const o = document.createElement('option');
          o.value = tc.id; o.textContent = tc.name + ' · ' + tc.subject;
          if (tc.id === state.teacherId) o.selected = true;
          sel.appendChild(o);
        });
        sel.addEventListener('change', () => { state.teacherId = sel.value; paint(); });
        ctl.appendChild(sel);
      }
    }

    function paintNotes() {
      notes.innerHTML = '';
      if (!opts.editable) return;
      if (state.mode === 'class') {
        notes.appendChild(UI.el('div', 'modal-note', UI.esc(I18N.t('tt.editHint'))));
      }
      const n = clashCount(bookings());
      if (n > 0) {
        notes.appendChild(UI.el('div', 'modal-note tt-warn',
          '⚠ ' + UI.esc(I18N.t('tt.clashSummary', { n: n }))));
      }
    }

    function paintBody() {
      if (state.mode === 'teacher') {
        body.innerHTML = teacherGrid(state.teacherId);
      } else {
        body.innerHTML = grid(state.classId, { editable: !!opts.editable });
      }
    }

    function paint() { paintHead(); paintNotes(); paintBody(); }

    if (opts.editable) {
      const open = el => {
        const cell = el.closest('.slot-edit');
        if (!cell || state.mode !== 'class') return;
        openEditor(state.classId, Number(cell.dataset.d), Number(cell.dataset.p), paint);
      };
      body.addEventListener('click', e => open(e.target));
      body.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e.target); }
      });
    }

    paint();
  }

  global.Timetable = { render, grid, teacherGrid };

})(window);
