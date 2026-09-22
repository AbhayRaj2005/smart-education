/* ============================================================
   MODULE: core/store.js
   The cache every view reads from, and the one place that
   decides where a write goes.

   demo mode     → localStorage, so the app works with no server
   backend mode  → Supabase (attendance through the edge function,
                   so the parent SMS is sent server-side)

   Reads stay synchronous on purpose: the data is already in
   memory after sign-in, so no view module had to become async.
   Writes return a promise.
   ============================================================ */

(function (global) {

  const PREFIX = 'se.';

  /* in-memory cache: attendance[date][classId][studentId] = status */
  const cache = { attendance: {}, sms: [], marks: {}, loginLogs: [] };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function write(key, value) {
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (e) {}
  }

  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  }

  function backend() { return typeof SE_BACKEND === 'function' && SE_BACKEND(); }

  function bucket(date) {
    const d = date || todayKey();
    if (backend()) {
      cache.attendance[d] = cache.attendance[d] || {};
      return cache.attendance[d];
    }
    const all = read('attendance', {});
    all[d] = all[d] || {};
    return all[d];
  }

  const Store = {

    /* ---------- filled once at sign-in, from Supabase ---------- */
    primeAttendance(rows) {
      cache.attendance = {};
      (rows || []).forEach(r => {
        const d = r.taken_on;
        cache.attendance[d] = cache.attendance[d] || {};
        cache.attendance[d][r.class_id] = cache.attendance[d][r.class_id] || {};
        cache.attendance[d][r.class_id][r.student_id] = r.status;
      });
    },

    primeSms(rows) {
      cache.sms = (rows || []).map(r => ({
        at: r.sent_at, studentId: r.student_id, classId: r.class_id,
        parent: r.parent_name, phone: r.phone, text: r.body,
        type: r.kind, status: r.status
      }));
    },

    /* ---------- login activity (admin only) ---------- */
    primeLoginLogs(rows) {
      cache.loginLogs = (rows || []).map(r => ({
        at: r.logged_in_at, userCode: r.user_code,
        role: r.role, name: r.full_name
      }));
    },

    getLoginLogs() { return cache.loginLogs; },

    /* ---------- attendance ---------- */
    getAttendance(classId, date) {
      if (backend()) return (cache.attendance[date || todayKey()] || {})[classId] || {};
      return (read('attendance', {})[date || todayKey()] || {})[classId] || {};
    },

    /* Returns a promise. In backend mode the edge function saves the
       row AND sends the parent SMS, then tells us how many went out. */
    setAttendance(classId, studentId, status, date) {
      const d = date || todayKey();

      if (backend()) {
        cache.attendance[d] = cache.attendance[d] || {};
        cache.attendance[d][classId] = cache.attendance[d][classId] || {};
        cache.attendance[d][classId][studentId] = status;
        return Backend.saveAttendance(classId, [{ studentId: studentId, status: status }], d)
          .catch(err => {
            delete cache.attendance[d][classId][studentId];
            UI.toast('!', 'Not saved', err.message || 'Attendance could not be saved', 'absent');
            return { error: err.message };
          });
      }

      const all = read('attendance', {});
      all[d] = all[d] || {};
      all[d][classId] = all[d][classId] || {};
      all[d][classId][studentId] = status;
      write('attendance', all);
      return Promise.resolve({ saved: 1, offline: true });
    },

    /* Save a whole class in one call — used by "mark everyone present". */
    setAttendanceBulk(classId, marks, date) {
      if (backend()) {
        const d = date || todayKey();
        cache.attendance[d] = cache.attendance[d] || {};
        cache.attendance[d][classId] = cache.attendance[d][classId] || {};
        marks.forEach(m => cache.attendance[d][classId][m.studentId] = m.status);
        return Backend.saveAttendance(classId, marks, d);
      }
      marks.forEach(m => Store.setAttendance(classId, m.studentId, m.status, date));
      return Promise.resolve({ saved: marks.length, offline: true });
    },

    markedClassesToday() {
      if (backend()) return Object.keys(cache.attendance[todayKey()] || {});
      return Object.keys(read('attendance', {})[todayKey()] || {});
    },

    attendanceSummary(classId, date) {
      const marks = Store.getAttendance(classId, date);
      const out = { present: 0, absent: 0, late: 0 };
      Object.keys(marks).forEach(k => { if (out[marks[k]] !== undefined) out[marks[k]]++; });
      return out;
    },

    /* ---------- parent SMS log ---------- */
    getSms() { return backend() ? cache.sms : read('sms', []); },

    addSms(entry) {
      const row = Object.assign({ at: new Date().toISOString() }, entry);
      if (backend()) {
        cache.sms.unshift(row);            // the server already stored it
      } else {
        const log = read('sms', []);
        log.unshift(row);
        write('sms', log.slice(0, 200));
      }
      document.dispatchEvent(new CustomEvent('se:sms', { detail: row }));
    },

    refreshSms() {
      if (!backend()) return Promise.resolve(Store.getSms());
      return Backend.smsLog().then(rows => { Store.primeSms(rows); return cache.sms; });
    },

    clearSms() { if (!backend()) write('sms', []); },

    /* ---------- marks ---------- */
    getMarkOverride(studentId, subject, exam) {
      if (backend()) return cache.marks[studentId + '|' + subject + '|' + exam];
      return read('markOverrides', {})[studentId + '|' + subject + '|' + exam];
    },

    setMarkOverride(studentId, subject, exam, score) {
      const key = studentId + '|' + subject + '|' + exam;
      if (backend()) {
        cache.marks[key] = score;
        return Backend.saveMark(studentId, subject, exam, score)
          .catch(err => { UI.toast('!', 'Not saved', err.message, 'absent'); });
      }
      const all = read('markOverrides', {});
      all[key] = score;
      write('markOverrides', all);
      return Promise.resolve();
    },

    todayKey, read, write
  };

  global.Store = Store;

})(window);
