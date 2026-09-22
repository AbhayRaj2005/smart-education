/* ============================================================
   MODULE: core/ui.js
   Shared portal furniture: sidebar, view switching, the
   English/Hindi switch in the top bar, and toast notifications.
   ============================================================ */

(function (global) {

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* ---------------- toasts ---------------- */
  function toastStack() {
    let stack = document.getElementById('toastStack');
    if (!stack) {
      stack = el('div', 'toast-stack');
      stack.id = 'toastStack';
      document.body.appendChild(stack);
    }
    return stack;
  }

  function toast(icon, title, body, tone) {
    const t = el('div', 'toast' + (tone ? ' toast-' + tone : ''));
    t.innerHTML = '<span class="toast-icon">' + icon + '</span><div><div class="toast-title">' +
      esc(title) + '</div><div class="toast-body">' + esc(body) + '</div></div>';
    toastStack().appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity .3s ease';
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 320);
    }, 5200);
  }

  /* ---------------- language switch ---------------- */
  function languageSwitch() {
    const wrap = el('div', 'lang-switch');
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', I18N.t('lang.label'));
    ['en', 'hi'].forEach(code => {
      const b = el('button', 'lang-opt' + (I18N.lang() === code ? ' active' : ''), I18N.t('lang.' + code));
      b.type = 'button';
      b.addEventListener('click', () => {
        if (I18N.lang() === code) return;
        I18N.setLang(code);
      });
      wrap.appendChild(b);
    });
    document.addEventListener('se:langchange', () => {
      Array.prototype.forEach.call(wrap.children, (b, i) => {
        const code = i === 0 ? 'en' : 'hi';
        b.textContent = I18N.t('lang.' + code);
        b.classList.toggle('active', I18N.lang() === code);
      });
    });
    return wrap;
  }

  /* ---------------- portal shell ----------------
     nav: [{ view:'attendance', key:'nav.attendance' }, …]
     onView(viewName, containerEl) renders that view.
  ------------------------------------------------- */
  function buildPortal(opts) {
    const user = opts.user;
    const side = document.getElementById('side');
    const nav = document.getElementById('sideNav');
    const content = document.getElementById('content');
    const title = document.getElementById('pageTitle');

    /* sidebar links */
    function paintNav() {
      nav.innerHTML = '';
      opts.nav.forEach((item, i) => {
        const b = el('button', 'side-link', '<span class="dot"></span> ' + esc(I18N.t(item.key)));
        b.type = 'button';
        b.dataset.view = item.view;
        b.addEventListener('click', () => go(item.view));
        nav.appendChild(b);
      });
      highlight();
    }

    function highlight() {
      nav.querySelectorAll('.side-link').forEach(b => {
        b.classList.toggle('active', b.dataset.view === state.view);
      });
    }

    const state = { view: opts.nav[0].view };

    function go(view) {
      state.view = view;
      highlight();
      const item = opts.nav.find(n => n.view === view) || opts.nav[0];
      title.textContent = I18N.t(item.titleKey || item.key);
      content.innerHTML = '';
      opts.onView(view, content, user);
      content.scrollIntoView({ block: 'start' });
      if (side) side.classList.remove('open');
      try { history.replaceState(null, '', '#' + view); } catch (e) {}
    }

    /* identity block */
    const foot = document.getElementById('sideFoot');
    foot.innerHTML =
      '<div class="side-user"><div class="avatar avatar-sm">' + esc(Auth.initials(user.name)) + '</div>' +
      '<div><div class="side-user-name">' + esc(user.name) + '</div>' +
      '<span class="role-pill ' + user.role + '">' + esc(I18N.t('login.role.' + user.role)) + (user.title ? ' · ' + esc(user.title) : '') + '</span>' +
      '</div></div>' +
      '<button class="side-out" type="button" id="signOutBtn">' + esc(I18N.t('nav.logout')) + '</button>';
    document.getElementById('signOutBtn').addEventListener('click', Auth.signOut);

    /* top bar: language switch + avatar */
    const topRight = document.getElementById('topRight');
    topRight.innerHTML = '';
    topRight.appendChild(languageSwitch());
    const av = el('div', 'avatar', esc(Auth.initials(user.name)));
    topRight.appendChild(av);

    /* mobile drawer */
    const toggle = document.getElementById('portalToggle');
    if (toggle && side) toggle.addEventListener('click', () => side.classList.toggle('open'));

    /* re-render everything on language change */
    document.addEventListener('se:langchange', () => {
      paintNav();
      const brandSub = document.querySelector('.brand-name small');
      if (brandSub) brandSub.textContent = I18N.t('app.tagline');
      const su = foot.querySelector('.role-pill');
      if (su) su.textContent = I18N.t('login.role.' + user.role) + (user.title ? ' · ' + user.title : '');
      const out = document.getElementById('signOutBtn');
      if (out) out.textContent = I18N.t('nav.logout');
      go(state.view);
    });

    paintNav();
    const start = (location.hash || '').replace('#', '');
    go(opts.nav.some(n => n.view === start) ? start : opts.nav[0].view);

    return { go: go, state: state };
  }

  /* ---------------- small builders ---------------- */
  function kpi(label, value, note, tone) {
    return '<div class="card kpi"><span class="label">' + esc(label) + '</span><strong>' + esc(value) +
      '</strong>' + (note ? '<span class="delta ' + (tone || 'up') + '">' + esc(note) + '</span>' : '') + '</div>';
  }

  function classSelect(id, selected, includeAll) {
    let html = '<select id="' + id + '" class="class-select">';
    if (includeAll) html += '<option value="">' + esc(I18N.t('g.selectClass')) + '</option>';
    SCHOOL.classes.forEach(c => {
      html += '<option value="' + c.id + '"' + (c.id === selected ? ' selected' : '') + '>' +
        esc(classLabel(c)) + '</option>';
    });
    return html + '</select>';
  }

  /* Class labels read as "Class 8 · A" in English, "कक्षा 8 · A" in Hindi. */
  function classLabel(cls) {
    const c = typeof cls === 'string' ? SCHOOL.classById(cls) : cls;
    if (!c) return '';
    return I18N.t('g.class') + ' ' + c.grade + ' · ' + c.id.replace(/^\d+/, '');
  }

  /* ---------------- avatar (photo if we have one, initials otherwise) ---------------- */
  function avatar(name, photoUrl, sizeClass) {
    const cls = 'avatar' + (sizeClass ? ' ' + sizeClass : '');
    if (photoUrl) {
      return '<span class="' + cls + ' avatar-img"><img src="' + esc(photoUrl) + '" alt="" loading="lazy"></span>';
    }
    return '<span class="' + cls + '">' + esc(Auth.initials(name)) + '</span>';
  }

  /* ---------------- one-shot file picker (for photo uploads) ---------------- */
  function pickImage(onPicked) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      if (input.files && input.files[0]) onPicked(input.files[0]);
      input.remove();
    });
    document.body.appendChild(input);
    input.click();
  }

  global.UI = { el, esc, toast, buildPortal, languageSwitch, kpi, classSelect, classLabel, avatar, pickImage };

})(window);
