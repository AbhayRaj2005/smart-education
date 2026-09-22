/* ============================================================
   MODULE: modules/study-plan.js
   Turns "what's pending in the syllabus" into a structured,
   day-by-day plan: what to learn, what to revise, and a periodic
   practice day for the student's weakest subject.

   Pure client-side algorithm over data already loaded (SCHOOL.
   syllabusFor + the student's marks) — no AI call. The generated
   plan is saved to study_plans / study_plan_items so it persists
   and the checkboxes stick across visits.
   ============================================================ */

(function (global) {

  function toISODate(d) {
    return d.toISOString().slice(0, 10);
  }

  function addDays(base, n) {
    const d = new Date(base.getTime());
    d.setDate(d.getDate() + n);
    return d;
  }

  function weakestSubject(student, subjects) {
    let worst = null, worstAvg = 101;
    subjects.forEach(sub => {
      const rows = (student.marks && student.marks[sub]) || [];
      const scored = rows.filter(r => r.max);
      if (!scored.length) return;
      const avg = scored.reduce((a, r) => a + (r.score / r.max * 100), 0) / scored.length;
      if (avg < worstAvg) { worstAvg = avg; worst = sub; }
    });
    return worst;
  }

  function buildTaskQueue(classId, subjects) {
    const bySubject = {};
    subjects.forEach(sub => {
      const chapters = SCHOOL.syllabusFor(classId, sub).filter(c => c.status !== 'done');
      bySubject[sub] = chapters.map(c => ({
        subject: sub,
        chapter: c.title,
        type: c.status === 'ongoing' ? 'revise' : 'learn'
      }));
    });

    /* round-robin across subjects so the plan doesn't do all of
       one subject before touching the next */
    const queue = [];
    let more = true;
    while (more) {
      more = false;
      subjects.forEach(sub => {
        if (bySubject[sub].length) {
          queue.push(bySubject[sub].shift());
          more = true;
        }
      });
    }
    return queue;
  }

  function generateItems(classId, subjects, student, targetDateStr) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const target = targetDateStr ? new Date(targetDateStr + 'T00:00:00') : addDays(today, 13);
    const totalDays = Math.max(1, Math.round((target - today) / 86400000) + 1);

    const queue = buildTaskQueue(classId, subjects);
    const weak = weakestSubject(student, subjects);

    const perDay = Math.max(1, Math.ceil(queue.length / totalDays) || 1);
    const items = [];
    let qi = 0;

    for (let d = 0; d < totalDays; d++) {
      const date = toISODate(addDays(today, d));

      if (weak && d > 0 && d % 5 === 0) {
        items.push({ date: date, subject: weak, chapter: I18N.t('plan.revisionTask'), type: 'practice' });
      }
      for (let k = 0; k < perDay && qi < queue.length; k++) {
        const t = queue[qi++];
        items.push({ date: date, subject: t.subject, chapter: t.chapter, type: t.type });
      }
    }

    /* anything left over (rounding) piles onto the last day */
    const lastDate = toISODate(addDays(today, totalDays - 1));
    while (qi < queue.length) {
      const t = queue[qi++];
      items.push({ date: lastDate, subject: t.subject, chapter: t.chapter, type: t.type });
    }

    return items;
  }

  function taskTag(type) {
    if (type === 'revise')   return '<span class="tag amber">' + UI.esc(I18N.t('plan.revise')) + '</span>';
    if (type === 'practice') return '<span class="tag red">' + UI.esc(I18N.t('plan.practice')) + '</span>';
    return '<span class="tag green">' + UI.esc(I18N.t('plan.learn')) + '</span>';
  }

  function render(container, student) {

    const myClass = SCHOOL.classById(student.classId);
    const subjects = SCHOOL.subjectsFor(myClass.grade);

    const head = UI.el('div', 'view-head');
    head.innerHTML = '<div><h2 class="view-title">' + UI.esc(I18N.t('nav.studyplan')) +
      '</h2><p class="view-sub">' + UI.esc(I18N.t('plan.sub')) + '</p></div>' +
      '<div class="view-controls"><input type="date" id="planTarget" class="class-select"> ' +
      '<button class="btn btn-primary btn-sm" id="planRegen" type="button">' + UI.esc(I18N.t('plan.generate')) + '</button></div>';
    container.appendChild(head);

    const dateInput = head.querySelector('#planTarget');
    const defaultTarget = addDays(new Date(), 13);
    dateInput.value = toISODate(defaultTarget);
    dateInput.min = toISODate(new Date());

    const host = UI.el('div');
    container.appendChild(host);
    host.innerHTML = '<div class="card card-pad empty-note">' + UI.esc(I18N.t('g.saving')) + '</div>';

    function paintPlan(planData) {
      host.innerHTML = '';

      if (!planData || !planData.items.length) {
        host.appendChild(UI.el('div', 'card card-pad empty-note', UI.esc(I18N.t('plan.empty'))));
        return;
      }

      const items = planData.items;
      const done = items.filter(i => i.done).length;
      const pct = Math.round((done / items.length) * 100);

      const progressCard = UI.el('div', 'card card-pad');
      progressCard.innerHTML =
        '<div style="display:flex;justify-content:space-between;margin-bottom:8px;">' +
        '<strong>' + UI.esc(I18N.t('plan.overall')) + '</strong><span>' + done + ' / ' + items.length + '</span></div>' +
        '<div class="progress"><div style="width:' + pct + '%"></div></div>';
      host.appendChild(progressCard);

      const byDate = {};
      items.forEach(it => (byDate[it.item_date] = byDate[it.item_date] || []).push(it));
      const dates = Object.keys(byDate).sort();
      const todayISO = toISODate(new Date());

      dates.forEach(date => {
        const dayItems = byDate[date];
        const isToday = date === todayISO;
        const label = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

        const card = UI.el('div', 'card stack-top');
        card.innerHTML = '<div class="card-head"><h3>' + UI.esc(label) + '</h3>' +
          (isToday ? '<span class="tag amber">' + UI.esc(I18N.t('g.today')) + '</span>' : '');

        const list = UI.el('ul', 'list-simple');
        dayItems.forEach(it => {
          const li = UI.el('li');
          const left = UI.el('label', 'plan-item');
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = !!it.done;
          cb.addEventListener('change', () => {
            const nowDone = cb.checked;
            it.done = nowDone;
            Backend.toggleStudyItem(it.id, nowDone).catch(() => { it.done = !nowDone; cb.checked = !nowDone; });
            const doneNow = items.filter(i => i.done).length;
            progressCard.querySelector('span').textContent = doneNow + ' / ' + items.length;
            progressCard.querySelector('.progress > div').style.width = Math.round((doneNow / items.length) * 100) + '%';
          });
          left.appendChild(cb);
          left.appendChild(document.createTextNode(' ' + it.subject + ' — ' + it.chapter_title));

          const right = UI.el('span');
          right.innerHTML = taskTag(it.task_type);

          li.appendChild(left);
          li.appendChild(right);
          list.appendChild(li);
        });
        card.appendChild(list);
        host.appendChild(card);
      });
    }

    function load() {
      Backend.latestStudyPlan(student.id).then(paintPlan).catch(err => {
        host.innerHTML = '<div class="card card-pad empty-note">' + UI.esc(err.message) + '</div>';
      });
    }

    load();

    head.querySelector('#planRegen').addEventListener('click', () => {
      const btn = head.querySelector('#planRegen');
      btn.disabled = true;
      host.innerHTML = '<div class="card card-pad empty-note">' + UI.esc(I18N.t('g.saving')) + '</div>';

      const items = generateItems(myClass.id, subjects, student, dateInput.value);

      Backend.replaceStudyPlan(student.id, dateInput.value, items)
        .then(() => Backend.latestStudyPlan(student.id))
        .then(paintPlan)
        .catch(err => {
          host.innerHTML = '<div class="card card-pad empty-note">' + UI.esc(err.message) + '</div>';
        })
        .finally(() => { btn.disabled = false; });
    });
  }

  global.StudyPlan = { render, generateItems };

})(window);
