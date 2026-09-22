/* ============================================================
   MODULE: modules/gradebook.js
   Marks entry (teacher) and the marks a student sees in their
   own portal. Edits are kept per student/subject/exam so the
   student portal picks them up immediately.
   ============================================================ */

(function (global) {

  function scoreOf(student, subject, exam) {
    const override = Store.getMarkOverride(student.id, subject, exam);
    if (override !== undefined && override !== null && override !== '') return Number(override);
    const row = (student.marks[subject] || []).find(m => m.exam === exam);
    return row ? row.score : 0;
  }

  /* ---------- teacher: enter marks ---------- */
  function renderEntry(container, opts) {
    const allowed = opts.classes && opts.classes.length ? opts.classes : SCHOOL.classes;
    let classId = allowed[0].id;
    let subject = opts.subject || SCHOOL.subjectsFor(SCHOOL.classById(classId).grade)[0];
    let exam = SCHOOL.exams[SCHOOL.exams.length - 1];

    const head = UI.el('div', 'view-head');
    head.innerHTML =
      '<div><h2 class="view-title">' + UI.esc(I18N.t('nav.gradebook')) + '</h2>' +
      '<p class="view-sub">' + UI.esc(I18N.t('t.enterMarks')) + '</p></div>' +
      '<div class="view-controls">' +
      '<select id="gbClass" class="class-select"></select>' +
      '<select id="gbSubject" class="class-select"></select>' +
      '<select id="gbExam" class="class-select"></select></div>';
    container.appendChild(head);

    const clsSel = head.querySelector('#gbClass');
    const subSel = head.querySelector('#gbSubject');
    const examSel = head.querySelector('#gbExam');

    allowed.forEach(c => {
      const o = document.createElement('option');
      o.value = c.id; o.textContent = UI.classLabel(c);
      clsSel.appendChild(o);
    });
    SCHOOL.exams.forEach(e => {
      const o = document.createElement('option');
      o.value = e; o.textContent = e;
      if (e === exam) o.selected = true;
      examSel.appendChild(o);
    });

    function fillSubjects() {
      subSel.innerHTML = '';
      const subs = SCHOOL.subjectsFor(SCHOOL.classById(classId).grade);
      if (subs.indexOf(subject) === -1) subject = subs[0];
      subs.forEach(s => {
        const o = document.createElement('option');
        o.value = s; o.textContent = s;
        if (s === subject) o.selected = true;
        subSel.appendChild(o);
      });
    }
    fillSubjects();

    const host = UI.el('div');
    container.appendChild(host);

    clsSel.addEventListener('change', () => { classId = clsSel.value; fillSubjects(); paint(); });
    subSel.addEventListener('change', () => { subject = subSel.value; paint(); });
    examSel.addEventListener('change', () => { exam = examSel.value; paint(); });

    function paint() {
      host.innerHTML = '';
      const roster = SCHOOL.studentsOf(classId);
      const card = UI.el('div', 'card');
      card.innerHTML = '<div class="card-head"><h3>' + UI.esc(subject) + ' · ' + UI.esc(exam) +
        '</h3><span class="tag grey">' + UI.esc(UI.classLabel(classId)) + '</span></div>';

      let rows = '';
      roster.forEach(st => {
        const sc = scoreOf(st, subject, exam);
        rows += '<tr data-student="' + st.id + '"><td>' + UI.esc(st.roll) + '</td><td>' + UI.esc(st.name) +
          '</td><td><input class="mark-input" type="number" min="0" max="100" value="' + sc + '"></td>' +
          '<td class="grade-cell"><span class="tag ' + toneFor(sc) + '">' + SCHOOL.gradeFor(sc) + '</span></td></tr>';
      });

      card.innerHTML += '<table><thead><tr><th>' + UI.esc(I18N.t('g.roll')) + '</th><th>' +
        UI.esc(I18N.t('g.name')) + '</th><th>' + UI.esc(I18N.t('g.marks')) + ' (/100)</th><th>' +
        UI.esc(I18N.t('g.grade')) + '</th></tr></thead><tbody>' + rows + '</tbody></table>' +
        '<div class="card-pad btn-row"><button class="btn btn-primary btn-sm" id="gbSave" type="button">' +
        UI.esc(I18N.t('g.save')) + '</button>' +
        '<button class="btn btn-outline btn-sm" id="gbSend" type="button">' +
        UI.esc(I18N.t('t.sendMarks')) + '</button></div>';

      host.appendChild(card);

      card.querySelectorAll('tr[data-student]').forEach(tr => {
        const input = tr.querySelector('.mark-input');
        input.addEventListener('input', () => {
          const v = Math.max(0, Math.min(100, Number(input.value) || 0));
          tr.querySelector('.grade-cell').innerHTML =
            '<span class="tag ' + toneFor(v) + '">' + SCHOOL.gradeFor(v) + '</span>';
        });
      });

      card.querySelector('#gbSave').addEventListener('click', () => {
        const writes = [];
        card.querySelectorAll('tr[data-student]').forEach(tr => {
          const v = Math.max(0, Math.min(100, Number(tr.querySelector('.mark-input').value) || 0));
          writes.push(Store.setMarkOverride(tr.dataset.student, subject, exam, v));
        });
        Promise.all(writes).then(() =>
          UI.toast('✓', I18N.t('g.save'), subject + ' · ' + exam + ' · ' + UI.classLabel(classId)));
      });

      card.querySelector('#gbSend').addEventListener('click', () => {
        UI.toast('✉️', I18N.t('t.sendMarks'), UI.classLabel(classId) + ' · ' + roster.length + ' ' + I18N.t('g.students'));
      });
    }

    function toneFor(v) { return v >= 70 ? 'green' : v >= 50 ? 'amber' : 'red'; }

    paint();
  }

  /* ---------- student: my marks ---------- */
  function renderStudentMarks(container, student) {
    const subs = SCHOOL.subjectsFor(SCHOOL.classById(student.classId).grade);

    const card = UI.el('div', 'card');
    card.innerHTML = '<div class="card-head"><h3>' + UI.esc(I18N.t('s.myMarks')) + '</h3>' +
      '<span class="tag green">' + UI.esc(I18N.t('g.rank')) + ' ' + SCHOOL.rankOf(student) + ' / ' +
      SCHOOL.studentsOf(student.classId).length + '</span></div>';

    let head = '<tr><th>' + UI.esc(I18N.t('g.subject')) + '</th>';
    SCHOOL.exams.forEach(e => { head += '<th>' + UI.esc(e) + '</th>'; });
    head += '<th>' + UI.esc(I18N.t('g.overall')) + '</th><th>' + UI.esc(I18N.t('g.grade')) + '</th></tr>';

    let rows = '';
    subs.forEach(sub => {
      let sum = 0;
      rows += '<tr><td><strong>' + UI.esc(sub) + '</strong></td>';
      SCHOOL.exams.forEach(e => {
        const sc = scoreOf(student, sub, e);
        sum += sc;
        rows += '<td>' + sc + '</td>';
      });
      const avg = Math.round(sum / SCHOOL.exams.length);
      rows += '<td><strong>' + avg + '%</strong></td><td><span class="tag ' +
        (avg >= 70 ? 'green' : avg >= 50 ? 'amber' : 'red') + '">' + SCHOOL.gradeFor(avg) + '</span></td></tr>';
    });

    card.innerHTML += '<table><thead>' + head + '</thead><tbody>' + rows + '</tbody></table>';
    container.appendChild(card);
  }

  global.Gradebook = { renderEntry, renderStudentMarks, scoreOf };

})(window);
