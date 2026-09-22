/* ============================================================
   MODULE: modules/syllabus.js
   Chapter-by-chapter progress. Teachers see it per class they
   hold; students see it for their own class.
   ============================================================ */

(function (global) {

  function card(classId, subject) {
    const chapters = SCHOOL.syllabusFor(classId, subject);
    const done = chapters.filter(c => c.status === 'done').length;
    const pct = Math.round(done / chapters.length * 100);

    const c = UI.el('div', 'card syllabus-card');
    c.innerHTML = '<div class="card-head"><h3>' + UI.esc(subject) + '</h3>' +
      '<span class="tag ' + (pct >= 66 ? 'green' : pct >= 33 ? 'amber' : 'grey') + '">' +
      UI.esc(I18N.t('syl.complete', { n: pct })) + '</span></div>' +
      '<div class="card-pad"><div class="progress"><div style="width:' + pct + '%"></div></div></div>';

    const list = UI.el('ul', 'list-simple');
    chapters.forEach(ch => {
      const tone = ch.status === 'done' ? 'green' : ch.status === 'ongoing' ? 'amber' : 'grey';
      list.innerHTML += '<li><span>' + UI.esc(I18N.t('g.chapter')) + ' ' + ch.n + ' — ' +
        UI.esc(ch.title) + '</span><span class="tag ' + tone + '">' +
        UI.esc(I18N.t('syl.' + ch.status)) + '</span></li>';
    });
    c.appendChild(list);
    return c;
  }

  function render(container, opts) {
    const allowed = opts.classes && opts.classes.length ? opts.classes : SCHOOL.classes;
    let classId = opts.classId || allowed[0].id;
    const lockClass = !!opts.lockClass;

    const head = UI.el('div', 'view-head');
    head.innerHTML = '<div><h2 class="view-title">' + UI.esc(I18N.t('nav.syllabus')) + '</h2>' +
      '<p class="view-sub">' + UI.esc(I18N.t('g.progress')) + ' · ' + UI.esc(UI.classLabel(classId)) + '</p></div>' +
      (lockClass ? '' : '<div class="view-controls"><select id="sylClass" class="class-select"></select></div>');
    container.appendChild(head);

    if (!lockClass) {
      const sel = head.querySelector('#sylClass');
      allowed.forEach(c => {
        const o = document.createElement('option');
        o.value = c.id; o.textContent = UI.classLabel(c);
        if (c.id === classId) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => { classId = sel.value; paint(); });
    }

    const host = UI.el('div', 'grid-2');
    container.appendChild(host);

    function paint() {
      host.innerHTML = '';
      const subs = opts.subject ? [opts.subject] : SCHOOL.subjectsFor(SCHOOL.classById(classId).grade);
      subs.forEach(s => host.appendChild(card(classId, s)));
    }
    paint();
  }

  global.Syllabus = { render, card };

})(window);
