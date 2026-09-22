/* ============================================================
   PAGE: login.html
   Role tabs (admin / teacher / student), ID + password, and the
   English / Hindi choice — set here before signing in, and kept
   for every portal afterwards.
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  const form = document.getElementById('loginForm');
  const idInput = document.getElementById('loginId');
  const pwInput = document.getElementById('loginPw');
  const errorBox = document.getElementById('loginError');
  const tabs = document.querySelectorAll('.role-tab');
  const demoBox = document.getElementById('demoBox');

  let role = (new URLSearchParams(location.search).get('next')) || 'teacher';
  if (['admin', 'teacher', 'student'].indexOf(role) === -1) role = 'teacher';

  /* language switch in the corner */
  document.getElementById('loginLang').appendChild(UI.languageSwitch());

  function paintRole() {
    tabs.forEach(t => t.classList.toggle('active', t.dataset.role === role));
    idInput.setAttribute('placeholder', I18N.t('login.id.ph.' + role));
    pwInput.setAttribute('placeholder', I18N.t('login.password.ph'));
    paintDemo();
  }

  function paintDemo() {
    /* Real backend configured? Then there are no demo accounts to show. */
    if (typeof SE_BACKEND === 'function' && SE_BACKEND()) { demoBox.hidden = true; return; }
    demoBox.hidden = false;

    const samples = {
      admin: Auth.ADMINS.map(a => ({ id: a.id, who: a.name + ' · ' + a.title })),
      teacher: SCHOOL.teachers.slice(0, 3).map(t => ({ id: t.id, who: t.name + ' · ' + t.subject })),
      student: SCHOOL.studentsOf('8A').slice(0, 3).map(s => ({ id: s.id, who: s.name + ' · ' + UI.classLabel(s.classId) }))
    }[role];

    demoBox.innerHTML = '<div class="demo-head">' + UI.esc(I18N.t('login.demo')) + '</div>' +
      '<p class="demo-hint">' + UI.esc(I18N.t('login.demo.hint')) + '</p>' +
      '<ul class="demo-list">' + samples.map(s =>
        '<li><button type="button" class="demo-fill" data-id="' + UI.esc(s.id) + '">' +
        UI.esc(s.id) + '</button><span>' + UI.esc(s.who) + '</span></li>').join('') +
      '</ul><div class="demo-pw">' + UI.esc(I18N.t('login.password')) + ': <code>' +
      UI.esc(Auth.PASSWORDS[role]) + '</code></div>';

    demoBox.querySelectorAll('.demo-fill').forEach(b => {
      b.addEventListener('click', () => {
        idInput.value = b.dataset.id;
        pwInput.value = Auth.PASSWORDS[role];
        pwInput.focus();
      });
    });
  }

  tabs.forEach(t => t.addEventListener('click', () => {
    role = t.dataset.role;
    errorBox.hidden = true;
    idInput.value = '';
    pwInput.value = '';
    paintRole();
  }));

  /* show / hide password */
  const peek = document.getElementById('pwPeek');
  peek.addEventListener('click', () => {
    const showing = pwInput.type === 'text';
    pwInput.type = showing ? 'password' : 'text';
    peek.textContent = I18N.t(showing ? 'login.show' : 'login.hide');
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    let result;
    try {
      result = await Auth.signIn(role, idInput.value, pwInput.value);
    } catch (err) {
      result = { ok: false, error: 'login.error.wrong' };
    }
    submit.disabled = false;
    if (!result.ok) {
      errorBox.textContent = I18N.t(result.error);
      errorBox.hidden = false;
      return;
    }
    location.href = result.redirect;
  });

  document.addEventListener('se:langchange', () => {
    paintRole();
    peek.textContent = I18N.t(pwInput.type === 'password' ? 'login.show' : 'login.hide');
    if (!errorBox.hidden) errorBox.textContent = I18N.t('login.error.wrong');
  });

  /* already signed in? go straight through */
  const existing = Auth.current();
  if (existing) {
    const banner = document.getElementById('resumeBanner');
    banner.hidden = false;
    banner.innerHTML = '<span>' + UI.esc(existing.name) + ' · ' +
      UI.esc(I18N.t('login.role.' + existing.role)) + '</span>';
    const go = UI.el('button', 'btn btn-primary btn-sm', UI.esc(I18N.t('nav.dashboard')));
    go.type = 'button';
    go.addEventListener('click', () => {
      location.href = { admin: 'admin.html', teacher: 'teacher.html', student: 'student.html' }[existing.role];
    });
    banner.appendChild(go);
    const out = UI.el('button', 'btn btn-ghost btn-sm', UI.esc(I18N.t('nav.logout')));
    out.type = 'button';
    out.addEventListener('click', () => {
      try { localStorage.removeItem('se.session'); } catch (e) {}
      banner.hidden = true;
    });
    banner.appendChild(out);
  }

  paintRole();
});
