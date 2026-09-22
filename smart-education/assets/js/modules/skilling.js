/* ============================================================
   MODULE: modules/skilling.js
   Skill tracks per subject (Beginner → Intermediate → Advanced),
   a short quiz to pass each level, and a printable certificate
   once a subject's three levels are all passed.

   Data comes from skills / skill_questions / skill_attempts /
   skill_certificates (see supabase/schema-additions.sql). No AI
   call is involved — this runs entirely off Supabase reads/writes.
   ============================================================ */

(function (global) {

  function levelTag(state) {
    if (state === 'passed')  return '<span class="tag green">' + UI.esc(I18N.t('sk.passed')) + '</span>';
    if (state === 'locked')  return '<span class="tag grey">' + UI.esc(I18N.t('sk.locked')) + '</span>';
    return '<span class="tag amber">' + UI.esc(I18N.t('sk.unlocked')) + '</span>';
  }

  function certificateHtml(student, subject, issuedAt) {
    const school = (typeof SCHOOL !== 'undefined' && SCHOOL.school) || '';
    const date = new Date(issuedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    return '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Certificate — ' + UI.esc(student.name) + '</title>' +
      '<style>' +
      'body{margin:0;font-family:Georgia,\'Times New Roman\',serif;background:#EFEAD9;display:flex;align-items:center;justify-content:center;min-height:100vh;}' +
      '.sheet{width:900px;max-width:94vw;background:#FBF9F3;border:10px solid #1B2A4A;padding:60px 70px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.2);}' +
      'h1{font-size:14px;letter-spacing:4px;text-transform:uppercase;color:#7A7360;margin:0 0 6px;}' +
      'h2{font-size:36px;margin:0 0 30px;color:#1B2A4A;}' +
      '.name{font-size:32px;margin:18px 0;color:#B45A2E;font-style:italic;}' +
      'p{font-size:16px;color:#333;line-height:1.6;}' +
      '.sub{font-weight:bold;color:#1B2A4A;}' +
      '.foot{margin-top:40px;display:flex;justify-content:space-between;font-size:13px;color:#7A7360;}' +
      '.btn{margin-top:30px;padding:10px 22px;border-radius:8px;border:1px solid #1B2A4A;background:#1B2A4A;color:#fff;font-size:14px;cursor:pointer;}' +
      '@media print{ .btn{ display:none; } body{background:#fff;} .sheet{box-shadow:none;border-color:#1B2A4A;} }' +
      '</style></head><body>' +
      '<div class="sheet">' +
      '<h1>' + UI.esc(school || 'Smart Education') + '</h1>' +
      '<h2>Certificate of Completion</h2>' +
      '<p>This certifies that</p>' +
      '<div class="name">' + UI.esc(student.name) + '</div>' +
      '<p>has successfully completed all skill levels in <span class="sub">' + UI.esc(subject) + '</span>' +
      ' — Beginner, Intermediate and Advanced.</p>' +
      '<div class="foot"><span>Roll ' + UI.esc(student.roll) + ' · ' + UI.esc(UI.classLabel(student.classId)) + '</span><span>' + UI.esc(date) + '</span></div>' +
      '<button class="btn" onclick="window.print()">Print / Save as PDF</button>' +
      '</div></body></html>';
  }

  function openCertificate(student, subject, issuedAt) {
    const html = certificateHtml(student, subject, issuedAt);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  }

  function render(container, student) {

    const myClass = SCHOOL.classById(student.classId);
    const mySubjects = SCHOOL.subjectsFor(myClass.grade);

    const head = UI.el('div', 'view-head');
    head.innerHTML = '<div><h2 class="view-title">' + UI.esc(I18N.t('nav.skilling')) +
      '</h2><p class="view-sub">' + UI.esc(I18N.t('sk.sub')) + '</p></div>';
    container.appendChild(head);

    const host = UI.el('div');
    container.appendChild(host);
    host.innerHTML = '<div class="card card-pad empty-note">' + UI.esc(I18N.t('g.saving')) + '</div>';

    Promise.all([
      Backend.skillsCatalog(),
      Backend.skillAttempts(student.id),
      Backend.skillCertificates(student.id)
    ]).then(([allSkills, attempts, certs]) => {

      const skills = allSkills.filter(s => mySubjects.indexOf(s.subject) > -1);
      const bySubject = {};
      skills.forEach(s => (bySubject[s.subject] = bySubject[s.subject] || []).push(s));
      Object.keys(bySubject).forEach(s => bySubject[s].sort((a, b) => a.seq - b.seq));

      function bestAttempt(skillId) {
        return attempts.filter(a => a.skill_id === skillId)
          .sort((a, b) => new Date(b.attempted_at) - new Date(a.attempted_at))[0] || null;
      }

      function passedSkill(skillId) {
        return attempts.some(a => a.skill_id === skillId && a.passed);
      }

      function certFor(subject) {
        return certs.find(c => c.subject === subject) || null;
      }

      paint();

      function paint() {
        host.innerHTML = '';

        /* ---- KPI row ---- */
        const totalSkills = skills.length;
        const passedCount = skills.filter(s => passedSkill(s.id)).length;
        const totalSubjects = Object.keys(bySubject).length;
        const certCount = certs.length;

        const kpis = UI.el('div', 'kpi-row');
        kpis.innerHTML =
          UI.kpi(I18N.t('sk.levelsPassed'), passedCount + ' / ' + totalSkills, I18N.t('sk.acrossSubjects')) +
          UI.kpi(I18N.t('sk.certificates'), certCount + ' / ' + totalSubjects, I18N.t('sk.subjectsMastered'));
        host.appendChild(kpis);

        if (!totalSubjects) {
          const empty = UI.el('div', 'card card-pad empty-note', UI.esc(I18N.t('sk.empty')));
          host.appendChild(empty);
          return;
        }

        const grid = UI.el('div', 'grid-2');
        host.appendChild(grid);

        Object.keys(bySubject).sort().forEach(subject => {
          const levels = bySubject[subject];
          const cert = certFor(subject);

          const card = UI.el('div', 'card skill-card');
          card.innerHTML = '<div class="card-head"><h3>' + UI.esc(subject) + '</h3>' +
            (cert
              ? '<span class="tag green">' + UI.esc(I18N.t('sk.certified')) + '</span>'
              : '<span class="tag grey">' + levels.filter(l => passedSkill(l.id)).length + ' / ' + levels.length + '</span>');

          const list = UI.el('ul', 'list-simple');

          levels.forEach((skill, idx) => {
            const passed = passedSkill(skill.id);
            const prevPassed = idx === 0 || passedSkill(levels[idx - 1].id);
            const state = passed ? 'passed' : (prevPassed ? 'unlocked' : 'locked');
            const last = bestAttempt(skill.id);

            const li = UI.el('li');
            const left = UI.el('span', '', UI.esc(skill.level) + ' — ' + UI.esc(skill.title) +
              (last ? '<div class="meta">' + UI.esc(I18N.t('sk.bestScore', { n: last.score_pct })) + '</div>' : ''));

            const right = UI.el('span');
            right.innerHTML = levelTag(state);

            if (state !== 'locked') {
              const btn = UI.el('button', 'btn btn-outline btn-sm', UI.esc(passed ? I18N.t('sk.retry') : I18N.t('sk.start')));
              btn.type = 'button';
              btn.style.marginLeft = '8px';
              btn.addEventListener('click', () => openQuiz(skill, subject, false));
              right.appendChild(btn);

              // AI-generated practice: fresh questions every time instead of the
              // same 4 seeded ones. Falls back silently to the seeded quiz above
              // if Gemini isn't reachable, so this never blocks practice.
              const aiBtn = UI.el('button', 'btn btn-marigold btn-sm', '\u2728 AI practice');
              aiBtn.type = 'button';
              aiBtn.style.marginLeft = '8px';
              aiBtn.addEventListener('click', () => openQuiz(skill, subject, true));
              right.appendChild(aiBtn);
            }

            li.appendChild(left);
            li.appendChild(right);
            list.appendChild(li);
          });

          card.appendChild(list);

          if (cert) {
            const foot = UI.el('div', 'card-pad');
            const cbtn = UI.el('button', 'btn btn-marigold btn-sm', UI.esc(I18N.t('sk.viewCert')));
            cbtn.type = 'button';
            cbtn.addEventListener('click', () => openCertificate(student, subject, cert.issued_at));
            foot.appendChild(cbtn);
            card.appendChild(foot);
          }

          grid.appendChild(card);
        });
      }

      function openQuiz(skill, subject, useAi) {
        const source = useAi
          ? Backend.generateSkillQuiz(skill.id)
              .then(r => r.questions)
              .catch(err => {
                console.error('AI practice quiz failed, falling back to seeded questions:', err);
                UI.toast('\u2139\ufe0f', 'Using standard quiz', 'Could not reach the AI \u2014 showing the regular quiz instead.');
                return Backend.skillQuestions(skill.id);
              })
          : Backend.skillQuestions(skill.id);

        source.then(questions => {
          if (!questions.length) return;

          const overlay = UI.el('div', 'card quiz-card stack-top');
          overlay.innerHTML = '<div class="card-head"><h3>' + UI.esc(skill.level) + ' — ' + UI.esc(skill.title) +
            '</h3><span class="tag grey">' + UI.esc(subject) + '</span>' +
            (useAi ? '<span class="tag amber">\u2728 AI-generated</span>' : '') + '</div>';

          const body = UI.el('div', 'card-pad');
          const form = UI.el('form');

          questions.forEach((q, qi) => {
            const block = UI.el('div', 'quiz-q');
            block.innerHTML = '<p class="quiz-q-text">' + (qi + 1) + '. ' + UI.esc(q.question) + '</p>';
            const opts = UI.el('div', 'quiz-opts');
            (q.options || []).forEach((opt, oi) => {
              const id = 'q' + q.id + '_' + oi;
              const row = UI.el('label', 'quiz-opt');
              row.setAttribute('for', id);
              row.innerHTML = '<input type="radio" id="' + id + '" name="q' + q.id + '" value="' + oi + '"> ' + UI.esc(opt);
              opts.appendChild(row);
            });
            block.appendChild(opts);
            form.appendChild(block);
          });

          const submitRow = UI.el('div', 'btn-row stack-top');
          const submitBtn = UI.el('button', 'btn btn-primary btn-sm', UI.esc(I18N.t('sk.submit')));
          submitBtn.type = 'submit';
          const cancelBtn = UI.el('button', 'btn btn-ghost btn-sm', UI.esc(I18N.t('g.cancel')));
          cancelBtn.type = 'button';
          cancelBtn.addEventListener('click', () => overlay.remove());
          submitRow.appendChild(submitBtn);
          submitRow.appendChild(cancelBtn);
          form.appendChild(submitRow);

          const resultBox = UI.el('div');
          body.appendChild(form);
          body.appendChild(resultBox);
          overlay.appendChild(body);

          host.parentNode.insertBefore(overlay, host.nextSibling);
          overlay.scrollIntoView({ behavior: 'smooth', block: 'start' });

          form.addEventListener('submit', e => {
            e.preventDefault();

            let correct = 0;
            questions.forEach(q => {
              const picked = form.querySelector('input[name="q' + q.id + '"]:checked');
              if (picked && Number(picked.value) === q.correct_index) correct++;
            });

            const scorePct = Math.round((correct / questions.length) * 100);
            const passed = scorePct >= skill.pass_pct;

            submitBtn.disabled = true;
            cancelBtn.disabled = true;

            Backend.submitSkillAttempt(student.id, skill.id, scorePct, passed).then(() => {
              attempts.unshift({ skill_id: skill.id, score_pct: scorePct, passed: passed, attempted_at: new Date().toISOString() });

              const isLast = skill.seq === Math.max.apply(null, bySubject[subject].map(s => s.seq));
              const alreadyCertified = !!certFor(subject);
              const allPassedNow = bySubject[subject].every(s => passedSkill(s.id) || s.id === skill.id && passed);

              let certPromise = Promise.resolve();
              if (passed && isLast && allPassedNow && !alreadyCertified) {
                certPromise = Backend.issueCertificate(student.id, subject).then(() => {
                  certs.push({ student_id: student.id, subject: subject, issued_at: new Date().toISOString() });
                });
              }

              certPromise.then(() => {
                resultBox.innerHTML = '<div class="card-pad" style="padding-left:0;padding-right:0;">' +
                  '<p><strong>' + UI.esc(I18N.t(passed ? 'sk.resultPass' : 'sk.resultFail', { n: scorePct })) + '</strong></p></div>';
                overlay.remove();
                paint();
                UI.toast(passed ? '✅' : '📘', I18N.t(passed ? 'sk.resultPass' : 'sk.resultFail', { n: scorePct }), subject + ' — ' + skill.title, passed ? 'success' : undefined);
              });
            }).catch(err => {
              submitBtn.disabled = false;
              cancelBtn.disabled = false;
              resultBox.innerHTML = '<p class="empty-note">' + UI.esc(err.message) + '</p>';
            });
          });
        });
      }

    }).catch(err => {
      host.innerHTML = '<div class="card card-pad empty-note">' + UI.esc(err.message) + '</div>';
    });
  }

  global.Skilling = { render };

})(window);
