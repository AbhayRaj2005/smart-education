/* ============================================================
   MODULE: modules/tutor.js
   AI study-partner panel in the student portal.
   Uses the Supabase ask-tutor Edge Function, plus a small
   Progress panel built from tutor_log (what's been asked) and
   the syllabus (what's still pending) — no extra AI call needed
   for the panel itself.
   ============================================================ */

(function (global) {

  function suggestedTopics(student, myClass, subs) {
    /* pending/ongoing chapters, weakest subject first */
    const withAvg = subs.map(sub => {
      const rows = (student.marks && student.marks[sub]) || [];
      const scored = rows.filter(r => r.max);
      const avg = scored.length ? scored.reduce((a, r) => a + (r.score / r.max * 100), 0) / scored.length : 100;
      return { subject: sub, avg: avg };
    }).sort((a, b) => a.avg - b.avg);

    const topics = [];
    withAvg.forEach(row => {
      const chapters = SCHOOL.syllabusFor(myClass.id, row.subject).filter(c => c.status !== 'done');
      if (chapters.length) topics.push({ subject: row.subject, chapter: chapters[0].title });
    });
    return topics.slice(0, 4);
  }

  function render(container, student) {

    const myClass = SCHOOL.classById(student.classId);
    const subs = SCHOOL.subjectsFor(myClass.grade);
    let currentSubject = '';

    const wrap = UI.el('div', 'grid-2');
    container.appendChild(wrap);

    const card = UI.el('div', 'card chat-card');

    card.innerHTML =
      '<div class="card-head">' +
        '<h3>' + UI.esc(I18N.t('s.askTutor')) + '</h3>' +
        '<span class="tag grey" id="tutorSubjectTag">' +
          UI.esc(UI.classLabel(student.classId)) +
        '</span>' +
      '</div>' +

      '<div class="chat-body" id="chatBody">' +
        '<div class="msg bot">' +
          UI.esc(I18N.t('s.askPlaceholder')) +
        '</div>' +
      '</div>' +

      '<form class="chat-form" id="tutorForm">' +
        '<input type="file" id="tutorPhotoInput" accept="image/*" capture="environment" hidden>' +
        '<button class="btn btn-outline btn-sm" type="button" id="tutorAttachBtn" title="Attach a photo of your question">\ud83d\udcf7</button>' +
        '<input id="tutorInput" autocomplete="off" placeholder="' +
          UI.esc(I18N.t('s.askPlaceholder')) +
        '">' +

        '<button class="btn btn-primary btn-sm" type="submit">' +
          UI.esc(I18N.t('s.send')) +
        '</button>' +
      '</form>' +
      '<div id="tutorPhotoPreview" class="chip-row chat-chips" hidden></div>';

    wrap.appendChild(card);

    /* ---------- subject chips ---------- */

    const chips = UI.el('div', 'chip-row chat-chips');
    const subjectTag = card.querySelector('#tutorSubjectTag');

    function setSubject(subject) {
      currentSubject = subject || '';
      Array.prototype.forEach.call(chips.children, c => c.classList.toggle('active', c.dataset.subject === currentSubject));
      subjectTag.textContent = currentSubject || UI.classLabel(student.classId);
    }

    subs.forEach(subject => {

      const c = UI.el('button', 'chip', UI.esc(subject));
      c.type = 'button';
      c.dataset.subject = subject;

      c.addEventListener('click', () => {
        setSubject(currentSubject === subject ? '' : subject);
      });

      chips.appendChild(c);
    });

    card.querySelector('.chat-body').after(chips);

    /* ---------- progress panel ---------- */

    const progress = UI.el('div', 'card');
    progress.innerHTML = '<div class="card-head"><h3>' + UI.esc(I18N.t('tp.title')) + '</h3></div>';
    const progressBody = UI.el('div', 'card-pad');
    progress.appendChild(progressBody);
    wrap.appendChild(progress);

    progressBody.innerHTML = '<p class="empty-note">' + UI.esc(I18N.t('g.saving')) + '</p>';

    Backend.tutorLog(student.id, 100).then(log => {
      const weekAgo = Date.now() - 7 * 86400000;
      const thisWeek = log.filter(l => new Date(l.asked_at).getTime() >= weekAgo);

      const counts = {};
      log.forEach(l => { if (l.subject) counts[l.subject] = (counts[l.subject] || 0) + 1; });
      const topSubject = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];

      const topics = suggestedTopics(student, myClass, subs);

      progressBody.innerHTML =
        '<div class="kpi-row" style="grid-template-columns:1fr 1fr;margin-bottom:16px;">' +
        UI.kpi(I18N.t('tp.thisWeek'), String(thisWeek.length), I18N.t('tp.questionsAsked')) +
        UI.kpi(I18N.t('tp.topSubject'), topSubject || '—', I18N.t('tp.mostAsked')) +
        '</div>' +
        '<p style="font-size:13px;font-weight:600;margin:0 0 8px;">' + UI.esc(I18N.t('tp.suggested')) + '</p>';

      if (!topics.length) {
        progressBody.appendChild(UI.el('p', 'empty-note', UI.esc(I18N.t('tp.allCaughtUp'))));
        return;
      }

      const list = UI.el('ul', 'list-simple');
      topics.forEach(t => {
        const li = UI.el('li');
        li.innerHTML = '<span>' + UI.esc(t.subject) + ' — ' + UI.esc(t.chapter) + '</span>';
        const btn = UI.el('button', 'btn btn-outline btn-sm', UI.esc(I18N.t('tp.practice')));
        btn.type = 'button';
        btn.addEventListener('click', () => {
          setSubject(t.subject);
          const input = card.querySelector('#tutorInput');
          input.value = I18N.t('tp.practicePrompt', { chapter: t.chapter });
          input.focus();
        });
        li.appendChild(btn);
        list.appendChild(li);
      });
      progressBody.appendChild(list);

    }).catch(() => {
      progressBody.innerHTML = '<p class="empty-note">' + UI.esc(I18N.t('tp.unavailable')) + '</p>';
    });

    /* ---------- chat ---------- */

    const body = card.querySelector('#chatBody');
    const form = card.querySelector('#tutorForm');
    const input = card.querySelector('#tutorInput');
    const button = form.querySelector('button[type="submit"]');
    const attachBtn = card.querySelector('#tutorAttachBtn');
    const photoInput = card.querySelector('#tutorPhotoInput');
    const photoPreview = card.querySelector('#tutorPhotoPreview');

    /* ---------- photo attach (manual typing still works exactly as before) ---------- */

    let attachedImage = null; // { base64, mimeType, name }

    function fileToBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    function clearAttachment() {
      attachedImage = null;
      photoInput.value = '';
      photoPreview.hidden = true;
      photoPreview.innerHTML = '';
    }

    attachBtn.addEventListener('click', () => photoInput.click());

    photoInput.addEventListener('change', async () => {
      const file = photoInput.files && photoInput.files[0];
      if (!file) return;
      if (!file.type || file.type.indexOf('image/') !== 0) {
        UI.toast('\u26a0\ufe0f', 'Not a photo', 'Choose an image file.');
        clearAttachment();
        return;
      }
      if (file.size > 6 * 1024 * 1024) {
        UI.toast('\u26a0\ufe0f', 'Too large', 'Photo must be 6 MB or smaller.');
        clearAttachment();
        return;
      }
      const base64 = await fileToBase64(file);
      attachedImage = { base64, mimeType: file.type, previewUrl: 'data:' + file.type + ';base64,' + base64 };

      photoPreview.hidden = false;
      photoPreview.innerHTML =
        '<span class="chip active" style="display:flex;align-items:center;gap:6px;">' +
          '<img src="' + attachedImage.previewUrl + '" alt="" style="width:20px;height:20px;object-fit:cover;border-radius:4px;">' +
          'Photo attached' +
          '<button type="button" id="tutorRemovePhoto" style="border:none;background:none;cursor:pointer;font-weight:700;">\u00d7</button>' +
        '</span>';
      photoPreview.querySelector('#tutorRemovePhoto').addEventListener('click', clearAttachment);
    });

    form.addEventListener('submit', async e => {

      e.preventDefault();

      const text = input.value.trim();
      const image = attachedImage;

      if (!text && !image) return;

      /* User message \u2014 shows the photo (if any) plus whatever was typed */

      const mine = UI.el('div', 'msg user');
      if (image) {
        const img = document.createElement('img');
        img.src = image.previewUrl;
        img.alt = 'Attached photo';
        img.style.cssText = 'max-width:180px;border-radius:8px;display:block;' + (text ? 'margin-bottom:6px;' : '');
        mine.appendChild(img);
      }
      if (text) {
        const span = document.createElement('span');
        span.textContent = text;
        mine.appendChild(span);
      }
      mine.dataset.text = text || (image ? '[Photo of a question]' : '');

      body.appendChild(mine);

      input.value = '';
      clearAttachment();

      body.scrollTop = body.scrollHeight;

      /* Disable while AI is answering */

      input.disabled = true;
      button.disabled = true;
      attachBtn.disabled = true;

      /* Temporary AI message */

      const bot = UI.el('div', 'msg bot');

      bot.textContent = image ? 'Looking at your photo\u2026' : 'Thinking...';

      body.appendChild(bot);

      body.scrollTop = body.scrollHeight;

      try {

        /* Collect recent conversation */

        const history = Array.from(
          body.querySelectorAll('.msg')
        )
          .slice(-7)
          .filter(el => el !== bot)
          .map(el => ({
            role: el.classList.contains('user')
              ? 'user'
              : 'model',
            text: el.dataset.text !== undefined ? el.dataset.text : el.textContent
          }));

        /*
         * Sending the selected subject lets the Edge Function pull
         * that subject's syllabus chapters into its prompt, so the
         * answer stays anchored to what this student is meant to be
         * studying right now — the chips above pick it.
         */

        const result = await Backend.askTutor(
          currentSubject,
          text,
          history,
          image
        );

        bot.textContent =
          result.reply ||
          'Sorry, I could not generate an answer.';

        /* Best-effort log for the Progress panel — never blocks the chat. */
        Backend.logTutorQuestion(student.id, currentSubject, text || '[Photo question]');

      } catch (error) {

        console.error('AI Tutor Error:', error);

        bot.textContent =
          error.message ||
          'Sorry, the AI tutor is temporarily unavailable.';

      } finally {

        input.disabled = false;
        button.disabled = false;
        attachBtn.disabled = false;

        input.focus();

        body.scrollTop = body.scrollHeight;
      }

    });
  }

  global.Tutor = {
    render
  };

})(window);
