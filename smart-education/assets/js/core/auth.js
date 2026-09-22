/* ============================================================
   MODULE: core/auth.js
   ID + password sign-in for the three roles, session handling,
   and the guard every portal page runs before it renders.

   Demo passwords (replace with a real auth service later):
     admin    ADM-001            admin123
     teacher  TCH-01 … TCH-08    teach123
     student  STU-<class>-<roll> student123
   ============================================================ */

(function (global) {

  const SESSION_KEY = 'se.session';

  const ADMINS = [
    { id: 'ADM-001', name: 'Priya Raghavan', title: 'Principal' },
    { id: 'ADM-002', name: 'Sanjay Mitra', title: 'Office administrator' }
  ];

  const PASSWORDS = { admin: 'admin123', teacher: 'teach123', student: 'student123' };

  const HOME = { admin: 'admin.html', teacher: 'teacher.html', student: 'student.html' };

  function normalise(id) { return String(id || '').trim().toUpperCase(); }

  /* Async in both modes so the login page has one code path. */
  async function signIn(role, id, password) {
    const uid = normalise(id);
    if (!uid || !password) return { ok: false, error: 'login.error.empty' };

    /* ---- real backend ---- */
    if (typeof SE_BACKEND === 'function' && SE_BACKEND()) {
      const res = await Backend.signIn(role, uid, password);
      if (!res.ok) return res;
      try { localStorage.setItem(SESSION_KEY, JSON.stringify(res.user)); } catch (e) {}
      return { ok: true, user: res.user, redirect: HOME[role] };
    }

    /* ---- demo data ---- */
    if (password !== PASSWORDS[role]) return { ok: false, error: 'login.error.wrong' };

    let user = null;
    if (role === 'admin') {
      const a = ADMINS.find(x => x.id === uid);
      if (a) user = { id: a.id, name: a.name, role: 'admin', title: a.title };
    } else if (role === 'teacher') {
      const t = SCHOOL.teacherById(uid);
      if (t) user = { id: t.id, name: t.name, role: 'teacher', title: t.subject };
    } else if (role === 'student') {
      const s = SCHOOL.studentById(uid);
      if (s) user = { id: s.id, name: s.name, role: 'student', title: s.classId };
    }

    if (!user) return { ok: false, error: 'login.error.wrong' };

    try { localStorage.setItem(SESSION_KEY, JSON.stringify(user)); } catch (e) {}
    return { ok: true, user: user, redirect: HOME[role] };
  }

  function current() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function signOut() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    if (typeof SE_BACKEND === 'function' && SE_BACKEND()) {
      Backend.signOut().finally(() => location.href = 'login.html');
      return;
    }
    location.href = 'login.html';
  }

  /* Portal pages call this first. If nobody is signed in — or the
     wrong role is — send them to the login screen. */
  function requireRole(role) {
    const user = current();
    if (!user) { location.replace('login.html?next=' + role); return null; }
    if (user.role !== role) { location.replace(HOME[user.role] || 'login.html'); return null; }
    return user;
  }

  function initials(name) {
    return String(name || '').split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  }

  global.Auth = { signIn, signOut, current, requireRole, initials, ADMINS, PASSWORDS };

})(window);
