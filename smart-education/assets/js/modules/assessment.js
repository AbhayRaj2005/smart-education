/* ============================================================
   MODULE: modules/assessment.js
   The "Assessment" pillar, now genuinely AI-powered:
     - Teacher: pick a class/subject/chapter + how many MCQ,
       short-answer and essay questions -> Gemini drafts a full
       question paper (generate-assessment Edge Function) ->
       teacher reviews it -> Publish makes it visible to the class.
     - Student: takes a published paper. MCQs are scored on
       submit like Skilling; short/essay answers are AI-graded
       with feedback by the grade-submission Edge Function.
   ============================================================ */

(function (global) {

  /* ---------------- shared bits ---------------- */

  function typeTag(type) {
    if (type === 'mcq') return '<span class="tag grey">MCQ</span>';
    if (type === 'short') return '<span class="tag amber">Short answer</span>';
    return '<span class="tag amber">Essay</span>';
  }

  function statusTag(status) {
    if (status === 'published') return '<span class="tag green">Published</span>';
    if (status === 'closed') return '<span class="tag grey">Closed</span>';
    return '<span class="tag grey">Draft</span>';
  }

  /* ================================================================
     TEACHER SIDE
     ================================================================ */

  function renderTeacher(host, ctx) {
    // ctx: { classes, subject }
    host.innerHTML = '';

    const head = UI.el('div', 'view-head');
    head.innerHTML = '<div><h2 class="view-title">Assessment</h2>' +
      '<p class="view-sub">AI-generated question papers \u2014 pick a chapter, get a draft paper in seconds.</p></div>';
    host.appendChild(head);

    /* ---- generator card (shared class/subject/chapter + AI / manual tabs) ---- */
    const gen = UI.el('div', 'card card-pad');
    const classOpts = ctx.classes.map(c => '<option value="' + UI.esc(c.id) + '">' + UI.esc(UI.classLabel(c)) + '</option>').join('');
    gen.innerHTML =
      '<h3 style="margin-top:0;">New question paper</h3>' +
      '<div class="form-grid">' +
        '<label>Class<select id="asClass">' + classOpts + '</select></label>' +
        '<label>Subject<input id="asSubject" value="' + UI.esc(ctx.subject || '') + '"></label>' +
        '<label>Chapter (optional \u2014 leave blank to cover the whole syllabus)<select id="asChapter"><option value="">Whole syllabus so far</option></select></label>' +
      '</div>' +
      '<div class="btn-row stack-top" role="tablist">' +
        '<button type="button" id="asTabAi" class="btn btn-primary btn-sm">\u2728 Generate with AI</button>' +
        '<button type="button" id="asTabManual" class="btn btn-outline btn-sm">\u270d\ufe0f Create manually</button>' +
        '<button type="button" id="asTabPhoto" class="btn btn-outline btn-sm">\ud83d\udcf7 Scan a photo</button>' +
      '</div>' +

      /* ---- AI panel ---- */
      '<div id="asPanelAi" class="stack-top">' +
        '<div class="form-grid">' +
          '<label>MCQ questions<input id="asMcq" type="number" min="0" max="15" value="5"></label>' +
          '<label>Short-answer questions<input id="asShort" type="number" min="0" max="15" value="3"></label>' +
          '<label>Essay questions<input id="asEssay" type="number" min="0" max="15" value="1"></label>' +
        '</div>' +
        '<p class="meta">Pulled straight from this class\u2019s syllabus \u2014 pick a chapter above, or leave it blank to cover everything taught so far.</p>' +
        '<div class="btn-row stack-top">' +
          '<button id="asGenerate" class="btn btn-primary btn-sm">Generate with AI</button>' +
        '</div>' +
        '<p id="asMsg" class="empty-note" style="margin-top:8px;display:none;"></p>' +
      '</div>' +

      /* ---- manual panel ---- */
      '<div id="asPanelManual" class="stack-top" hidden>' +
        '<div id="asManualList"></div>' +
        '<div class="btn-row stack-top">' +
          '<button type="button" id="asAddQ" class="btn btn-outline btn-sm">+ Add question</button>' +
        '</div>' +
        '<div class="btn-row stack-top">' +
          '<button type="button" id="asSaveManual" class="btn btn-primary btn-sm">Save as draft</button>' +
        '</div>' +
        '<p id="asManualMsg" class="empty-note" style="margin-top:8px;display:none;"></p>' +
      '</div>' +

      /* ---- photo panel ---- */
      '<div id="asPanelPhoto" class="stack-top" hidden>' +
        '<p class="meta">Upload a photo of an existing question paper \u2014 the AI reads it and builds a draft paper from what it finds.</p>' +
        '<input type="file" id="asPhotoFile" accept="image/*" capture="environment">' +
        '<div class="btn-row stack-top">' +
          '<button type="button" id="asScanPhoto" class="btn btn-primary btn-sm">Scan &amp; generate</button>' +
        '</div>' +
        '<p id="asPhotoMsg" class="empty-note" style="margin-top:8px;display:none;"></p>' +
      '</div>';
    host.appendChild(gen);

    const classSel = gen.querySelector('#asClass');
    const subjectInput = gen.querySelector('#asSubject');
    const chapterSel = gen.querySelector('#asChapter');
    const msg = gen.querySelector('#asMsg');
    const genBtn = gen.querySelector('#asGenerate');

    /* ---- tabs ---- */
    const tabs = {
      ai: { btn: gen.querySelector('#asTabAi'), panel: gen.querySelector('#asPanelAi') },
      manual: { btn: gen.querySelector('#asTabManual'), panel: gen.querySelector('#asPanelManual') },
      photo: { btn: gen.querySelector('#asTabPhoto'), panel: gen.querySelector('#asPanelPhoto') }
    };
    function showTab(name) {
      Object.keys(tabs).forEach(k => {
        tabs[k].panel.hidden = k !== name;
        tabs[k].btn.className = 'btn btn-sm ' + (k === name ? 'btn-primary' : 'btn-outline');
      });
      if (name === 'manual' && !manualList.children.length) addManualQuestion();
    }
    tabs.ai.btn.addEventListener('click', () => showTab('ai'));
    tabs.manual.btn.addEventListener('click', () => showTab('manual'));
    tabs.photo.btn.addEventListener('click', () => showTab('photo'));

    function refreshChapters() {
      const classId = classSel.value;
      const subject = subjectInput.value.trim();
      chapterSel.innerHTML = '<option value="">Whole syllabus so far</option>';
      if (!classId || !subject || typeof SCHOOL === 'undefined' || !SCHOOL.syllabusFor) return;
      SCHOOL.syllabusFor(classId, subject).forEach(c => {
        const o = document.createElement('option');
        o.value = c.title; o.textContent = c.seq + '. ' + c.title;
        chapterSel.appendChild(o);
      });
    }
    classSel.addEventListener('change', refreshChapters);
    subjectInput.addEventListener('change', refreshChapters);
    refreshChapters();

    function showMsg(text, isError) {
      msg.style.display = 'block';
      msg.textContent = text;
      msg.style.color = isError ? '#B3261E' : '';
    }

    genBtn.addEventListener('click', () => {
      const classId = classSel.value;
      const subject = subjectInput.value.trim();
      const chapterTitle = chapterSel.value;
      const counts = {
        mcq: parseInt(gen.querySelector('#asMcq').value) || 0,
        short: parseInt(gen.querySelector('#asShort').value) || 0,
        essay: parseInt(gen.querySelector('#asEssay').value) || 0
      };
      if (!subject) { showMsg('Enter a subject first.', true); return; }
      if (counts.mcq + counts.short + counts.essay === 0) { showMsg('Ask for at least one question.', true); return; }

      genBtn.disabled = true;
      showMsg('Your assessment is being prepared \u2014 this takes a few seconds\u2026', false);

      Backend.generateAssessment(classId, subject, chapterTitle, counts)
        .then(result => {
          showMsg('Draft paper ready: "' + result.title + '" (' + result.count + ' questions). Review it below before publishing.', false);
          UI.toast('\u2728', 'Paper generated', result.title, 'success');
          loadList();
        })
        .catch(err => showMsg(err.message, true))
        .finally(() => { genBtn.disabled = false; });
    });

    /* ================================================================
       MANUAL question builder \u2014 teacher writes their own paper,
       no AI involved. Saved straight to the same tables generate-
       assessment uses, so publish/close/results work identically.
       ================================================================ */
    const manualList = gen.querySelector('#asManualList');
    const manualMsg = gen.querySelector('#asManualMsg');
    let manualSeq = 0;

    function showManualMsg(text, isError) {
      manualMsg.style.display = 'block';
      manualMsg.textContent = text;
      manualMsg.style.color = isError ? '#B3261E' : '';
    }

    function addManualQuestion() {
      manualSeq++;
      const id = 'mq' + manualSeq;
      const row = UI.el('div', 'card card-pad stack-top');
      row.dataset.qid = id;
      row.innerHTML =
        '<div class="form-grid">' +
          '<label>Type<select class="mqType">' +
            '<option value="mcq">MCQ</option><option value="short">Short answer</option><option value="essay">Essay</option>' +
          '</select></label>' +
          '<label>Marks<input class="mqMarks" type="number" min="1" max="10" value="1"></label>' +
        '</div>' +
        '<label>Question<textarea class="mqText" rows="2" placeholder="Type the question here\u2026"></textarea></label>' +
        '<div class="mqMcqBox">' +
          '<label>Option A<input class="mqOpt" data-i="0"></label>' +
          '<label>Option B<input class="mqOpt" data-i="1"></label>' +
          '<label>Option C<input class="mqOpt" data-i="2"></label>' +
          '<label>Option D<input class="mqOpt" data-i="3"></label>' +
          '<label>Correct option<select class="mqCorrect">' +
            '<option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option>' +
          '</select></label>' +
        '</div>' +
        '<label class="mqAnswerBox" hidden>Model answer / grading notes (optional \u2014 helps AI grade student submissions)<textarea class="mqAnswer" rows="2"></textarea></label>' +
        '<div class="btn-row stack-top"><button type="button" class="btn btn-ghost btn-sm mqRemove">Remove question</button></div>';

      const typeSel = row.querySelector('.mqType');
      const mcqBox = row.querySelector('.mqMcqBox');
      const answerBox = row.querySelector('.mqAnswerBox');
      function syncType() {
        const isMcq = typeSel.value === 'mcq';
        mcqBox.hidden = !isMcq;
        answerBox.hidden = isMcq;
        row.querySelector('.mqMarks').value = isMcq ? 1 : (typeSel.value === 'essay' ? 5 : 3);
      }
      typeSel.addEventListener('change', syncType);
      syncType();
      row.querySelector('.mqRemove').addEventListener('click', () => row.remove());

      manualList.appendChild(row);
    }
    gen.querySelector('#asAddQ').addEventListener('click', addManualQuestion);

    gen.querySelector('#asSaveManual').addEventListener('click', () => {
      const classId = classSel.value;
      const subject = subjectInput.value.trim();
      const chapterTitle = chapterSel.value;
      if (!subject) { showManualMsg('Enter a subject first.', true); return; }

      const questions = [];
      const rows = Array.from(manualList.children);
      for (const row of rows) {
        const type = row.querySelector('.mqType').value;
        const question = row.querySelector('.mqText').value.trim();
        const maxMarks = parseInt(row.querySelector('.mqMarks').value) || 1;
        if (!question) { showManualMsg('Every question needs its question text filled in.', true); return; }
        if (type === 'mcq') {
          const options = Array.from(row.querySelectorAll('.mqOpt')).map(i => i.value.trim());
          if (options.some(o => !o)) { showManualMsg('Fill in all four options for every MCQ.', true); return; }
          questions.push({ type, question, options, correctIndex: parseInt(row.querySelector('.mqCorrect').value), maxMarks });
        } else {
          const modelAnswer = row.querySelector('.mqAnswer').value.trim();
          questions.push({ type, question, modelAnswer, maxMarks });
        }
      }
      if (!questions.length) { showManualMsg('Add at least one question.', true); return; }

      const btn = gen.querySelector('#asSaveManual');
      btn.disabled = true;
      showManualMsg('Saving\u2026', false);
      Backend.createManualAssessment(classId, subject, chapterTitle, ctx.teacherId, questions)
        .then(result => {
          showManualMsg('Draft paper saved: "' + result.title + '" (' + result.count + ' questions). Review it below before publishing.', false);
          UI.toast('\u2705', 'Paper saved', result.title, 'success');
          manualList.innerHTML = '';
          manualSeq = 0;
          addManualQuestion();
          loadList();
        })
        .catch(err => showManualMsg(err.message, true))
        .finally(() => { btn.disabled = false; });
    });

    /* ================================================================
       PHOTO scan \u2014 teacher uploads a photo of a paper question
       paper; the AI reads it (Gemini vision) and turns it into the
       same kind of draft, ready to review and publish.
       ================================================================ */
    const photoMsg = gen.querySelector('#asPhotoMsg');
    function showPhotoMsg(text, isError) {
      photoMsg.style.display = 'block';
      photoMsg.textContent = text;
      photoMsg.style.color = isError ? '#B3261E' : '';
    }
    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }
    gen.querySelector('#asScanPhoto').addEventListener('click', () => {
      const classId = classSel.value;
      const subject = subjectInput.value.trim();
      const chapterTitle = chapterSel.value;
      const fileInput = gen.querySelector('#asPhotoFile');
      const file = fileInput.files && fileInput.files[0];
      if (!subject) { showPhotoMsg('Enter a subject first.', true); return; }
      if (!file) { showPhotoMsg('Choose a photo of the question paper first.', true); return; }

      const btn = gen.querySelector('#asScanPhoto');
      btn.disabled = true;
      showPhotoMsg('Reading the photo \u2014 your assessment is being prepared\u2026', false);

      fileToBase64(file).then(base64 =>
        Backend.generateAssessmentFromPhoto(classId, subject, chapterTitle, base64, file.type || 'image/jpeg')
      ).then(result => {
        showPhotoMsg('Draft paper ready from the photo: "' + result.title + '" (' + result.count + ' questions). Review it below before publishing.', false);
        UI.toast('\u2728', 'Paper generated from photo', result.title, 'success');
        fileInput.value = '';
        loadList();
      }).catch(err => showPhotoMsg(err.message, true))
        .finally(() => { btn.disabled = false; });
    });

    /* ---- existing papers ---- */
    const listWrap = UI.el('div', 'stack-top');
    host.appendChild(listWrap);
    listWrap.innerHTML = '<div class="card card-pad empty-note">Loading\u2026</div>';

    function loadList() {
      const classIds = ctx.classes.map(c => c.id);
      Backend.teacherAssessments(classIds).then(list => paintList(list))
        .catch(err => { listWrap.innerHTML = '<div class="card card-pad empty-note">' + UI.esc(err.message) + '</div>'; });
    }

    function paintList(list) {
      listWrap.innerHTML = '';
      if (!list.length) {
        listWrap.innerHTML = '<div class="card card-pad empty-note">No papers yet \u2014 generate one above.</div>';
        return;
      }
      list.forEach(a => listWrap.appendChild(paperCard(a)));
    }

    function paperCard(a) {
      const card = UI.el('div', 'card card-pad');
      card.innerHTML =
        '<div class="card-head"><h3>' + UI.esc(a.title) + '</h3>' + statusTag(a.status) + '</div>' +
        '<p class="meta">' + UI.esc(UI.classLabel(a.class_id)) + ' \u00b7 ' + UI.esc(a.subject) +
        (a.chapter_title ? ' \u00b7 ' + UI.esc(a.chapter_title) : '') + '</p>';

      const body = UI.el('div');
      body.innerHTML = '<p class="empty-note">Loading questions\u2026</p>';
      card.appendChild(body);

      Backend.assessmentQuestions(a.id).then(qs => {
        const list = UI.el('ul', 'list-simple');
        qs.forEach((q, i) => {
          const li = UI.el('li');
          li.innerHTML = '<span>' + (i + 1) + '. ' + UI.esc(q.question) + ' ' + typeTag(q.type) +
            '<span class="meta">' + (q.max_marks) + ' mark' + (q.max_marks === 1 ? '' : 's') + '</span></span>';
          list.appendChild(li);
        });
        body.innerHTML = '';
        body.appendChild(list);

        const actions = UI.el('div', 'btn-row stack-top');
        if (a.status === 'draft') {
          const pub = UI.el('button', 'btn btn-primary btn-sm', 'Publish to class');
          pub.type = 'button';
          pub.addEventListener('click', () => {
            Backend.publishAssessment(a.id, 'published').then(() => {
              a.status = 'published';
              UI.toast('\u2705', 'Published', a.title, 'success');
              loadList();
            }).catch(err => UI.toast('\u26a0\ufe0f', 'Could not publish', err.message));
          });
          actions.appendChild(pub);
        }
        if (a.status === 'published') {
          const close = UI.el('button', 'btn btn-outline btn-sm', 'Close');
          close.type = 'button';
          close.addEventListener('click', () => {
            Backend.publishAssessment(a.id, 'closed').then(() => { a.status = 'closed'; loadList(); });
          });
          actions.appendChild(close);

          const results = UI.el('button', 'btn btn-outline btn-sm', 'View results');
          results.type = 'button';
          results.addEventListener('click', () => showResults(a));
          actions.appendChild(results);
        }
        const del = UI.el('button', 'btn btn-ghost btn-sm', 'Delete');
        del.type = 'button';
        del.addEventListener('click', () => {
          if (!confirm('Delete "' + a.title + '"? This cannot be undone.')) return;
          Backend.deleteAssessment(a.id).then(loadList);
        });
        actions.appendChild(del);
        body.appendChild(actions);
      }).catch(err => { body.innerHTML = '<p class="empty-note">' + UI.esc(err.message) + '</p>'; });

      return card;
    }

    function showResults(a) {
      Backend.assessmentResults(a.id).then(subs => {
        const overlay = UI.el('div', 'card quiz-card stack-top');
        overlay.innerHTML = '<div class="card-head"><h3>Results \u2014 ' + UI.esc(a.title) + '</h3></div>';
        const body = UI.el('div', 'card-pad');
        if (!subs.length) {
          body.innerHTML = '<p class="empty-note">No submissions yet.</p>';
        } else {
          const list = UI.el('ul', 'list-simple');
          subs.forEach(s => {
            const student = (typeof SCHOOL !== 'undefined' && SCHOOL.studentById) ? SCHOOL.studentById(s.student_id) : null;
            const name = student ? student.name : s.student_id;
            const li = UI.el('li');
            const scoreText = s.status === 'graded' ? (s.total_score + ' / ' + s.max_score) : 'Grading\u2026';
            li.innerHTML = '<span>' + UI.esc(name) + '</span><span class="meta">' + UI.esc(scoreText) + '</span>';
            list.appendChild(li);
          });
          body.appendChild(list);
        }
        const closeBtn = UI.el('button', 'btn btn-ghost btn-sm', 'Close');
        closeBtn.type = 'button';
        closeBtn.addEventListener('click', () => overlay.remove());
        body.appendChild(UI.el('div', 'btn-row stack-top')).appendChild(closeBtn);
        overlay.appendChild(body);
        host.parentNode.insertBefore(overlay, host.nextSibling);
        overlay.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }).catch(err => UI.toast('\u26a0\ufe0f', 'Could not load results', err.message));
    }

    loadList();
  }

  /* ================================================================
     STUDENT SIDE
     ================================================================ */

  function renderStudent(host, student) {
    host.innerHTML = '';

    const head = UI.el('div', 'view-head');
    head.innerHTML = '<div><h2 class="view-title">Assessment</h2>' +
      '<p class="view-sub">Papers your teacher has published, generated and graded with AI.</p></div>';
    host.appendChild(head);

    const listWrap = UI.el('div');
    host.appendChild(listWrap);
    listWrap.innerHTML = '<div class="card card-pad empty-note">Loading\u2026</div>';

    Backend.studentAssessments(student.classId).then(list => {
      listWrap.innerHTML = '';
      if (!list.length) {
        listWrap.innerHTML = '<div class="card card-pad empty-note">No assessments have been published for your class yet.</div>';
        return;
      }
      list.forEach(a => {
        const card = UI.el('div', 'card card-pad');
        card.innerHTML = '<div class="card-head"><h3>' + UI.esc(a.title) + '</h3><span class="tag grey">' + UI.esc(a.subject) + '</span></div>';
        const foot = UI.el('div', 'btn-row stack-top');
        card.appendChild(foot);
        listWrap.appendChild(card);

        Backend.mySubmission(a.id, student.id).then(sub => {
          if (sub && sub.status === 'graded') {
            const tag = UI.el('span', 'tag green', sub.total_score + ' / ' + sub.max_score);
            foot.appendChild(tag);
            const btn = UI.el('button', 'btn btn-outline btn-sm', 'View feedback');
            btn.type = 'button';
            btn.addEventListener('click', () => openReview(host, a, sub));
            foot.appendChild(btn);
          } else if (sub) {
            foot.appendChild(UI.el('span', 'tag amber', 'Submitted \u2014 grading\u2026'));
          } else {
            const btn = UI.el('button', 'btn btn-primary btn-sm', 'Take assessment');
            btn.type = 'button';
            btn.addEventListener('click', () => openAttempt(host, a, student));
            foot.appendChild(btn);
          }
        });
      });
    }).catch(err => { listWrap.innerHTML = '<div class="card card-pad empty-note">' + UI.esc(err.message) + '</div>'; });
  }

  function openAttempt(host, assessment, student) {
    Backend.assessmentQuestions(assessment.id).then(questions => {
      const overlay = UI.el('div', 'card quiz-card stack-top');
      overlay.innerHTML = '<div class="card-head"><h3>' + UI.esc(assessment.title) + '</h3></div>';
      const body = UI.el('div', 'card-pad');
      const form = UI.el('form');

      questions.forEach((q, qi) => {
        const block = UI.el('div', 'quiz-q');
        block.innerHTML = '<p class="quiz-q-text">' + (qi + 1) + '. ' + UI.esc(q.question) + ' ' + typeTag(q.type) + '</p>';

        if (q.type === 'mcq') {
          const opts = UI.el('div', 'quiz-opts');
          (q.options || []).forEach((opt, oi) => {
            const id = 'q' + q.id + '_' + oi;
            const row = UI.el('label', 'quiz-opt');
            row.setAttribute('for', id);
            row.innerHTML = '<input type="radio" id="' + id + '" name="q' + q.id + '" value="' + oi + '"> ' + UI.esc(opt);
            opts.appendChild(row);
          });
          block.appendChild(opts);
        } else {
          const ta = document.createElement('textarea');
          ta.name = 'q' + q.id;
          ta.rows = q.type === 'essay' ? 5 : 3;
          ta.placeholder = 'Write your answer here\u2026';
          ta.style.width = '100%';
          block.appendChild(ta);
        }
        form.appendChild(block);
      });

      const submitRow = UI.el('div', 'btn-row stack-top');
      const submitBtn = UI.el('button', 'btn btn-primary btn-sm', 'Submit for AI grading');
      submitBtn.type = 'submit';
      const cancelBtn = UI.el('button', 'btn btn-ghost btn-sm', 'Cancel');
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
        submitBtn.disabled = true;
        cancelBtn.disabled = true;
        resultBox.innerHTML = '<p class="empty-note">Submitting \u2014 AI is grading your written answers\u2026</p>';

        const answers = questions.map(q => {
          if (q.type === 'mcq') {
            const picked = form.querySelector('input[name="q' + q.id + '"]:checked');
            const selectedIndex = picked ? Number(picked.value) : null;
            const score = selectedIndex === q.correct_index ? q.max_marks : 0;
            return { questionId: q.id, selectedIndex, score };
          }
          const ta = form.querySelector('textarea[name="q' + q.id + '"]');
          return { questionId: q.id, answerText: ta ? ta.value.trim() : '' };
        });

        Backend.submitAssessment(assessment.id, student.id, answers)
          .then(result => {
            overlay.remove();
            UI.toast('\u2705', 'Graded', result.totalScore + ' / ' + result.maxScore, 'success');
            renderStudent(host, student);
          })
          .catch(err => {
            submitBtn.disabled = false;
            cancelBtn.disabled = false;
            resultBox.innerHTML = '<p class="empty-note">' + UI.esc(err.message) + '</p>';
          });
      });
    });
  }

  function openReview(host, assessment, submission) {
    Backend.assessmentQuestions(assessment.id).then(questions => {
      const overlay = UI.el('div', 'card quiz-card stack-top');
      overlay.innerHTML = '<div class="card-head"><h3>' + UI.esc(assessment.title) +
        '</h3><span class="tag green">' + submission.total_score + ' / ' + submission.max_score + '</span></div>';
      const body = UI.el('div', 'card-pad');
      const list = UI.el('ul', 'list-simple');

      const answersById = {};
      (submission.assessment_answers || []).forEach(a => { answersById[a.question_id] = a; });

      questions.forEach((q, qi) => {
        const ans = answersById[q.id] || {};
        const li = UI.el('li');
        let detail = '<strong>' + (qi + 1) + '. ' + UI.esc(q.question) + '</strong> ' + typeTag(q.type) +
          '<div class="meta">Score: ' + (ans.score != null ? ans.score : '\u2014') + ' / ' + q.max_marks + '</div>';
        if (q.type === 'mcq') {
          detail += '<div class="meta">Your answer: ' + UI.esc((q.options || [])[ans.selected_index] || '\u2014') + '</div>';
        } else {
          detail += '<div class="meta">Your answer: ' + UI.esc(ans.answer_text || '\u2014') + '</div>';
          if (ans.feedback) detail += '<div class="meta"><em>AI feedback: ' + UI.esc(ans.feedback) + '</em></div>';
        }
        li.innerHTML = detail;
        list.appendChild(li);
      });
      body.appendChild(list);

      const closeBtn = UI.el('button', 'btn btn-ghost btn-sm', 'Close');
      closeBtn.type = 'button';
      closeBtn.addEventListener('click', () => overlay.remove());
      const row = UI.el('div', 'btn-row stack-top');
      row.appendChild(closeBtn);
      body.appendChild(row);

      overlay.appendChild(body);
      host.parentNode.insertBefore(overlay, host.nextSibling);
      overlay.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  global.Assessment = { renderTeacher, renderStudent };

})(window);
