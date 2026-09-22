/* ============================================================
   MODULE: modules/sms.js
   Parent notifications. The moment a teacher marks a student
   absent, the parent's number gets a message and the school
   keeps a copy in the SMS log (admin portal).

   In this build the send is mocked with a toast. To go live,
   point `deliver()` at your SMS gateway (MSG91, Twilio, Gupshup)
   and keep everything else as it is.
   ============================================================ */

(function (global) {

  /* Demo-only sender. With a backend configured, sending happens in
     the Supabase edge function (supabase/functions/mark-attendance)
     so the gateway key never reaches the browser. */
  function deliver(payload) {
    return Promise.resolve({ ok: true, mock: true });
  }

  function absentMessage(student) {
    return I18N.t('sms.absentBody', {
      parent: student.parent,
      phone: student.phone,
      student: student.name,
      class: UI.classLabel(student.classId),
      date: I18N.today()
    });
  }

  function notifyAbsent(student, serverResult) {
    const text = absentMessage(student);
    const payload = {
      studentId: student.id,
      student: student.name,
      classId: student.classId,
      parent: student.parent,
      phone: student.phone,
      text: text,
      type: 'absent'
    };
    /* Backend mode: mark-attendance already sent the SMS and wrote
       the log row, so just show it and keep the local copy in step. */
    if (typeof SE_BACKEND === 'function' && SE_BACKEND()) {
      if (serverResult && serverResult.error) return;
      Store.addSms(payload);
      UI.toast('✉️', I18N.t('sms.title'), text);
      return;
    }

    deliver(payload).then(() => {
      Store.addSms(payload);
      UI.toast('✉️', I18N.t('sms.title'), text);
    });
  }

  /* Admin view: everything the school has sent to parents. */
  function renderLog(container) {
    const log = Store.getSms();
    const card = UI.el('div', 'card');
    card.innerHTML = '<div class="card-head"><h3>' + UI.esc(I18N.t('sms.log')) + '</h3>' +
      '<span class="tag grey">' + log.length + '</span></div>';

    if (!log.length) {
      card.appendChild(UI.el('div', 'card-pad empty-note', UI.esc(I18N.t('sms.log.empty'))));
      container.appendChild(card);
      return;
    }

    let rows = '';
    log.forEach(m => {
      const when = new Date(m.at).toLocaleString(I18N.lang() === 'hi' ? 'hi-IN' : 'en-IN',
        { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      rows += '<tr><td><strong>' + UI.esc(m.parent) + '</strong><div class="cell-sub">' +
        UI.esc(m.phone) + '</div></td>' +
        '<td>' + UI.esc(m.student) + '<div class="cell-sub">' + UI.esc(UI.classLabel(m.classId)) + '</div></td>' +
        '<td class="msg-cell">' + UI.esc(m.text) + '</td>' +
        '<td class="nowrap">' + UI.esc(when) + '</td></tr>';
    });

    card.innerHTML += '<table><thead><tr><th>' + UI.esc(I18N.t('sms.to')) + '</th><th>' +
      UI.esc(I18N.t('g.student')) + '</th><th>' + UI.esc(I18N.t('sms.message')) + '</th><th>' +
      UI.esc(I18N.t('sms.time')) + '</th></tr></thead><tbody>' + rows + '</tbody></table>';
    container.appendChild(card);
  }

  global.SMS = { notifyAbsent, renderLog, absentMessage, deliver };

})(window);
