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

  function fileToBase64Compressed(file) {
    // Images: shrink to keep uploads fast & within the Edge Function's
    // size limit (same approach as the assessment photo-scan feature).
    // PDFs: sent as-is, base64-encoded — can't compress those client-side.
    if (file.type === 'application/pdf') {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ base64: String(reader.result).split(',')[1] || '', mimeType: 'application/pdf' });
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }
    const MAX_DIM = 1280, JPEG_QUALITY = 0.75;
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > MAX_DIM || height > MAX_DIM) {
            const scale = MAX_DIM / Math.max(width, height);
            width = Math.round(width * scale); height = Math.round(height * scale);
          }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          canvas.getContext('2d').drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
          URL.revokeObjectURL(url);
          resolve({ base64: dataUrl.split(',')[1] || '', mimeType: 'image/jpeg' });
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that file — try another photo or PDF.')); };
      img.src = url;
    });
  }

  function openUploadModal(allowed, opts, onDone) {
    const backdrop = UI.el('div', 'se-modal-backdrop');
    backdrop.innerHTML =
      '<div class="se-modal" role="dialog" aria-modal="true">' +
        '<button type="button" class="se-modal-close" aria-label="Close">&times;</button>' +
        '<h2>Upload syllabus (AI)</h2>' +
        '<p class="tt-edit-sub">Upload a photo or PDF of the chapter list — AI reads it and replaces this subject’s syllabus below.</p>' +
        '<div class="se-modal-error" id="sylUpErr" hidden></div>' +
        '<div class="se-form-grid">' +
          '<div class="span-2"><label for="sylUpClass">Class</label><select id="sylUpClass"></select></div>' +
          '<div class="span-2"><label for="sylUpSubject">Subject</label><select id="sylUpSubject"></select></div>' +
          '<div class="span-2"><label for="sylUpFile">Photo or PDF</label><input id="sylUpFile" type="file" accept="image/*,application/pdf"></div>' +
        '</div>' +
        '<div class="se-modal-actions">' +
          '<button type="button" class="btn btn-ghost btn-sm" id="sylUpCancel">Cancel</button>' +
          '<button type="button" class="btn btn-marigold btn-sm" id="sylUpSave">Scan &amp; save</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('open'));

    const $ = id => backdrop.querySelector('#' + id);
    const classSel = $('sylUpClass'), subjSel = $('sylUpSubject'), fileIn = $('sylUpFile'), err = $('sylUpErr');

    allowed.forEach(c => {
      const o = document.createElement('option'); o.value = c.id; o.textContent = UI.classLabel(c);
      classSel.appendChild(o);
    });
    function fillSubjects() {
      subjSel.innerHTML = '';
      const cls = SCHOOL.classById(classSel.value);
      const subs = opts.subject ? [opts.subject] : (cls ? SCHOOL.subjectsFor(cls.grade) : []);
      subs.forEach(s => { const o = document.createElement('option'); o.value = s; o.textContent = s; subjSel.appendChild(o); });
    }
    classSel.addEventListener('change', fillSubjects);
    fillSubjects();

    function close() { backdrop.classList.remove('open'); setTimeout(() => backdrop.remove(), 180); }
    $('sylUpCancel').addEventListener('click', close);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

    $('sylUpSave').addEventListener('click', () => {
      err.hidden = true;
      const file = fileIn.files && fileIn.files[0];
      if (!file) { err.textContent = 'Choose a photo or PDF first.'; err.hidden = false; return; }
      const btn = $('sylUpSave');
      btn.disabled = true; btn.textContent = 'Reading… usually 10–20 seconds';
      fileToBase64Compressed(file)
        .then(({ base64, mimeType }) => Backend.generateSyllabusFromPhoto(classSel.value, subjSel.value, base64, mimeType))
        .then(result => {
          UI.toast('✨', 'Syllabus updated', result.subject + ' — ' + result.count + ' chapters', 'success');
          close();
          onDone();
        })
        .catch(e => { err.textContent = e.message || 'Could not read that file.'; err.hidden = false; })
        .finally(() => { btn.disabled = false; btn.textContent = 'Scan & save'; });
    });
  }

  function render(container, opts) {
    const allowed = opts.classes && opts.classes.length ? opts.classes : SCHOOL.classes;
    let classId = opts.classId || allowed[0].id;
    const lockClass = !!opts.lockClass;

    const head = UI.el('div', 'view-head');
    head.innerHTML = '<div><h2 class="view-title">' + UI.esc(I18N.t('nav.syllabus')) + '</h2>' +
      '<p class="view-sub">' + UI.esc(I18N.t('g.progress')) + ' · ' + UI.esc(UI.classLabel(classId)) + '</p></div>' +
      '<div class="view-controls">' +
      (lockClass ? '' : '<select id="sylClass" class="class-select"></select>') +
      (opts.canUpload ? '<button type="button" id="sylUploadBtn" class="btn btn-outline btn-sm">⬆ Upload syllabus (AI)</button>' : '') +
      '</div>';
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

    if (opts.canUpload) {
      head.querySelector('#sylUploadBtn').addEventListener('click', () => {
        openUploadModal(allowed, opts, () => {
          return (typeof Data !== 'undefined' && Data.load ? Data.load(Auth.current()) : Promise.resolve()).then(paint).catch(paint);
        });
      });
    }
  }

  global.Syllabus = { render, card };

})(window);
