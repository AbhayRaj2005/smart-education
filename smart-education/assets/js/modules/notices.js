/* ============================================================
   MODULE: modules/notices.js
   School notices — "today's Maths class is in the Science lab".

     · admin & teachers write and publish (renderManager)
     · students see them in a bar under the portal header on
       every page, plus a Notices page (mountBar / renderFeed)

   Who may post to whom is enforced by the database (RLS in
   supabase/schema-notices-timetable.sql); this file only keeps
   the screens honest. Admin → whole school or any class.
   Teacher → only classes they hold.

   Demo mode keeps notices in localStorage.
   ============================================================ */

(function (global) {

  const DEMO_KEY = 'se.notices';
  const SEEN_KEY = 'se.notices.seen.';
  const POLL_MS = 60000;
  const ROTATE_MS = 7000;

  let cache = [];

  function backend() { return typeof SE_BACKEND === 'function' && SE_BACKEND(); }
  function pad(n) { return String(n).padStart(2, '0'); }

  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* ---------------- data ---------------- */

  function fromRow(r) {
    return {
      id: r.id, title: r.title || '', body: r.body || '',
      targetClass: r.target_class || null,
      byName: r.posted_by_name || '', byRole: r.posted_by_role || 'teacher', byCode: r.posted_by_code || '',
      createdAt: r.created_at, expiresOn: r.expires_on || null
    };
  }

  function readDemo() {
    try { return JSON.parse(localStorage.getItem(DEMO_KEY) || '[]'); } catch (e) { return []; }
  }
  function writeDemo(list) {
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(list)); } catch (e) {}
  }

  async function fetchAll() {
    if (backend()) return (await Backend.listNotices()).map(fromRow);
    return readDemo();
  }

  /* pull the latest from the server, then tell the header bar */
  async function refresh() {
    cache = await fetchAll();
    document.dispatchEvent(new CustomEvent('se:noticechange'));
    return cache;
  }

  async function publish(user, n) {
    if (backend()) return Backend.postNotice(n);
    const list = readDemo();
    list.unshift({
      id: Date.now(), title: n.title, body: n.body || '', targetClass: n.targetClass || null,
      byName: user.name, byRole: user.role, byCode: user.id,
      createdAt: new Date().toISOString(), expiresOn: n.expiresOn || null
    });
    writeDemo(list);
  }

  async function remove(id) {
    if (backend()) return Backend.deleteNotice(id);
    writeDemo(readDemo().filter(n => String(n.id) !== String(id)));
  }

  /* ---------------- who sees what ---------------- */

  function isActive(n) { return !n.expiresOn || n.expiresOn >= todayISO(); }

  function audienceOK(n, viewer) {
    if (viewer.role === 'admin') return true;
    return !n.targetClass || (viewer.classIds || []).indexOf(n.targetClass) > -1;
  }

  function visibleTo(viewer) {
    return cache.filter(n => isActive(n) && audienceOK(n, viewer));
  }

  function audienceLabel(n) {
    return n.targetClass ? UI.classLabel(n.targetClass) : I18N.t('nt.wholeSchool');
  }

  function when(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString(I18N.lang() === 'hi' ? 'hi-IN' : 'en-IN',
      { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }

  /* ---------------- one notice, as a card ---------------- */

  function item(n, opts) {
    opts = opts || {};
    const a = UI.el('article', 'nt-item');
    const until = n.expiresOn
      ? (isActive(n) ? I18N.t('nt.until', { date: n.expiresOn }) : I18N.t('nt.expired')) : '';

    a.innerHTML =
      '<div class="nt-item-head"><strong class="nt-title">' + UI.esc(n.title) + '</strong>' +
        '<span class="tag grey">' + UI.esc(audienceLabel(n)) + '</span></div>' +
      (n.body ? '<p class="nt-body">' + UI.esc(n.body) + '</p>' : '') +
      '<div class="nt-meta">' +
        '<span class="role-pill ' + UI.esc(n.byRole) + '">' + UI.esc(I18N.t('login.role.' + n.byRole)) + '</span>' +
        '<span>' + UI.esc(I18N.t('nt.postedBy', { name: n.byName })) + '</span>' +
        '<span>· ' + UI.esc(when(n.createdAt)) + '</span>' +
        (until ? '<span class="tag ' + (isActive(n) ? 'amber' : 'red') + '">' + UI.esc(until) + '</span>' : '') +
      '</div>';

    if (opts.onDelete) {
      const del = UI.el('button', 'btn btn-ghost btn-sm nt-del', UI.esc(I18N.t('nt.delete')));
      del.type = 'button';
      del.addEventListener('click', () => opts.onDelete(n, del));
      a.appendChild(del);
    }
    return a;
  }

  /* ---------------- header bar (student + teacher) ---------------- */

  function seenSet(viewer) {
    try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY + viewer.id) || '[]')); }
    catch (e) { return new Set(); }
  }
  function markSeen(viewer, list) {
    const s = seenSet(viewer);
    list.forEach(n => s.add(String(n.id)));
    try { localStorage.setItem(SEEN_KEY + viewer.id, JSON.stringify(Array.from(s).slice(-200))); } catch (e) {}
  }

  /* viewer = { id, role, classIds } */
  function mountBar(viewer) {
    const top = document.querySelector('.topbar-portal');
    if (!top || document.getElementById('noticeBar')) return;

    const bar = UI.el('div', 'notice-bar');
    bar.id = 'noticeBar';
    bar.hidden = true;
    bar.setAttribute('role', 'button');
    bar.tabIndex = 0;
    top.insertAdjacentElement('afterend', bar);

    let idx = 0, paused = false;

    function paint() {
      const list = visibleTo(viewer);
      if (!list.length) { bar.hidden = true; return; }
      bar.hidden = false;
      idx = idx % list.length;
      const n = list[idx];
      const seen = seenSet(viewer);
      const unseen = list.some(x => !seen.has(String(x.id)));

      bar.setAttribute('aria-label', I18N.t('nt.openAll'));
      bar.innerHTML =
        '<span class="nb-icon" aria-hidden="true">📢</span>' +
        (unseen ? '<span class="nb-new">' + UI.esc(I18N.t('nt.newTag')) + '</span>' : '') +
        '<span class="nb-by"><span class="role-pill ' + UI.esc(n.byRole) + '">' + UI.esc(I18N.t('login.role.' + n.byRole)) +
          '</span> ' + UI.esc(n.byName) + '</span>' +
        '<span class="nb-text"><strong>' + UI.esc(n.title) + '</strong>' + (n.body ? ' — ' + UI.esc(n.body) : '') + '</span>' +
        (list.length > 1 ? '<span class="nb-count">' + (idx + 1) + ' / ' + list.length + '</span>' : '');
    }

    function open() {
      const list = visibleTo(viewer);
      if (!list.length) return;
      openModal(list);
      markSeen(viewer, list);
      paint();
    }

    bar.addEventListener('click', open);
    bar.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    bar.addEventListener('mouseenter', () => { paused = true; });
    bar.addEventListener('mouseleave', () => { paused = false; });

    setInterval(() => {
      if (paused || document.hidden || bar.hidden) return;
      idx++; paint();
    }, ROTATE_MS);

    document.addEventListener('se:noticechange', paint);
    document.addEventListener('se:langchange', paint);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refresh().catch(() => {});
    });
    setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, POLL_MS);

    refresh().catch(err => console.warn('notices:', err.message));
  }

  function openModal(list) {
    const backdrop = UI.el('div', 'se-modal-backdrop');
    backdrop.innerHTML =
      '<div class="se-modal nt-modal" role="dialog" aria-modal="true">' +
        '<button type="button" class="se-modal-close" aria-label="' + UI.esc(I18N.t('nt.close')) + '">&times;</button>' +
        '<h2>' + UI.esc(I18N.t('nt.bar')) + '</h2><div class="nt-list"></div></div>';
    const host = backdrop.querySelector('.nt-list');
    list.forEach(n => host.appendChild(item(n)));
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('open'));

    function close() {
      backdrop.classList.remove('open');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => backdrop.remove(), 200);
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    backdrop.querySelector('.se-modal-close').addEventListener('click', close);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  }

  /* ---------------- student: Notices page ---------------- */

  async function renderFeed(container, viewer) {
    const head = UI.el('div', 'view-head');
    head.innerHTML = '<div><h2 class="view-title">' + UI.esc(I18N.t('nav.notices')) + '</h2>' +
      '<p class="view-sub">' + UI.esc(I18N.t('nt.feedSub')) + '</p></div>';
    container.appendChild(head);

    const host = UI.el('div', 'nt-list');
    container.appendChild(host);

    try { await refresh(); } catch (err) {
      host.innerHTML = '<div class="card card-pad empty-note">' + UI.esc(I18N.t('nt.loadFail')) + '</div>';
      return;
    }
    const list = visibleTo(viewer);
    if (!list.length) {
      host.innerHTML = '<div class="card card-pad empty-note">' + UI.esc(I18N.t('nt.empty')) + '</div>';
      return;
    }
    list.forEach(n => host.appendChild(item(n)));
    markSeen(viewer, list);
    document.dispatchEvent(new CustomEvent('se:noticechange'));
  }

  /* ---------------- admin + teacher: write and manage ----------------
     opts = { user, classes, schoolWide }                                */

  function renderManager(container, opts) {
    const user = opts.user;
    const classes = opts.classes || [];
    const me = user.code || user.id;

    const head = UI.el('div', 'view-head');
    head.innerHTML = '<div><h2 class="view-title">' + UI.esc(I18N.t('nt.title')) + '</h2>' +
      '<p class="view-sub">' + UI.esc(I18N.t('nt.manageSub')) + '</p></div>';
    container.appendChild(head);

    /* ---- the form ---- */
    const form = UI.el('div', 'card card-pad nt-form');
    let audienceOpts = '';
    if (opts.schoolWide) audienceOpts += '<option value="">' + UI.esc(I18N.t('nt.wholeSchool')) + '</option>';
    classes.forEach(c => { audienceOpts += '<option value="' + UI.esc(c.id) + '">' + UI.esc(UI.classLabel(c)) + '</option>'; });

    form.innerHTML =
      '<h3>' + UI.esc(I18N.t('nt.new')) + '</h3>' +
      '<div class="se-modal-error" id="ntErr" hidden></div>' +
      '<div class="field"><label for="ntTitle">' + UI.esc(I18N.t('nt.fTitle')) + '</label>' +
        '<input id="ntTitle" type="text" maxlength="120" placeholder="' + UI.esc(I18N.t('nt.fTitlePh')) + '"></div>' +
      '<div class="field"><label for="ntBody">' + UI.esc(I18N.t('nt.fBody')) + '</label>' +
        '<textarea id="ntBody" rows="3" maxlength="2000" placeholder="' + UI.esc(I18N.t('nt.fBodyPh')) + '"></textarea></div>' +
      '<div class="form-grid">' +
        '<div class="field"><label for="ntAud">' + UI.esc(I18N.t('nt.fAudience')) + '</label>' +
          '<select id="ntAud">' + audienceOpts + '</select></div>' +
        '<div class="field"><label for="ntExp">' + UI.esc(I18N.t('nt.fExpires')) + '</label>' +
          '<input id="ntExp" type="date" min="' + todayISO() + '"></div>' +
      '</div>' +
      '<button type="button" class="btn btn-marigold" id="ntPublish">' + UI.esc(I18N.t('nt.publish')) + '</button>';
    container.appendChild(form);

    if (!classes.length && !opts.schoolWide) {
      form.querySelector('#ntPublish').disabled = true;
      form.querySelector('#ntErr').textContent = I18N.t('nt.noClasses');
      form.querySelector('#ntErr').hidden = false;
    }

    /* ---- the list ---- */
    const listCard = UI.el('div', 'stack-top');
    listCard.innerHTML = '<h3 class="nt-h3">' + UI.esc(I18N.t('nt.posted')) + '</h3>';
    const list = UI.el('div', 'nt-list');
    listCard.appendChild(list);
    container.appendChild(listCard);

    function paintList() {
      list.innerHTML = '';
      const mine = user.role === 'admin' ? cache : cache.filter(n => audienceOK(n, { role: 'teacher', classIds: classes.map(c => c.id) }) || n.byCode === me);
      if (!mine.length) {
        list.innerHTML = '<div class="card card-pad empty-note">' + UI.esc(I18N.t('nt.emptyManage')) + '</div>';
        return;
      }
      mine.forEach(n => {
        const canDelete = user.role === 'admin' || n.byCode === me;
        list.appendChild(item(n, canDelete ? { onDelete: onDelete } : {}));
      });
    }

    async function load() {
      try { await refresh(); paintList(); } catch (err) {
        list.innerHTML = '<div class="card card-pad empty-note">' + UI.esc(I18N.t('nt.loadFail')) +
          '<br><small>' + UI.esc(err.message) + '</small></div>';
      }
    }

    async function onDelete(n, btn) {
      if (!confirm(I18N.t('nt.deleteConfirm'))) return;
      btn.disabled = true;
      try {
        await remove(n.id);
        UI.toast('🗑️', I18N.t('nt.deleted'), n.title);
        await load();
      } catch (err) {
        btn.disabled = false;
        UI.toast('⚠️', I18N.t('nt.deleteFail'), err.message, 'error');
      }
    }

    const $ = id => form.querySelector('#' + id);
    $('ntPublish').addEventListener('click', async () => {
      const err = $('ntErr'), btn = $('ntPublish');
      err.hidden = true;

      const title = $('ntTitle').value.trim();
      if (!title) { err.textContent = I18N.t('nt.needTitle'); err.hidden = false; return; }

      btn.disabled = true;
      btn.textContent = I18N.t('nt.publishing');
      try {
        await publish(user, {
          title: title,
          body: $('ntBody').value.trim(),
          targetClass: $('ntAud').value || null,
          expiresOn: $('ntExp').value || null
        });
        UI.toast('📢', I18N.t('nt.published'), I18N.t('nt.publishedBody'));
        $('ntTitle').value = ''; $('ntBody').value = ''; $('ntExp').value = '';
        await load();
      } catch (e) {
        err.textContent = e.message || I18N.t('nt.publishFail');
        err.hidden = false;
      } finally {
        btn.disabled = false;
        btn.textContent = I18N.t('nt.publish');
      }
    });

    load();
  }

  global.Notices = { mountBar, renderFeed, renderManager, refresh };

})(window);
