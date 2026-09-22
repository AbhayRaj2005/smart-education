/* ============================================================
   MODULE: modules/login-log.js
   Admin-only view: every successful sign-in, teacher or student,
   newest first. The row is written server-side the moment
   Backend.signIn() succeeds (see core/backend.js) and is
   readable only by admins (see supabase/login-logs.sql RLS).
   ============================================================ */

(function (global) {

  function roleTag(role) {
    const cls = role === 'teacher' ? 'green' : role === 'admin' ? 'amber' : 'grey';
    return '<span class="tag ' + cls + '">' + UI.esc(I18N.t('role.' + role)) + '</span>';
  }

  function renderLog(container) {
    const log = Store.getLoginLogs();
    const card = UI.el('div', 'card');
    card.innerHTML = '<div class="card-head"><h3>' + UI.esc(I18N.t('login.log')) + '</h3>' +
      '<span class="tag grey">' + log.length + '</span></div>';

    if (!log.length) {
      card.appendChild(UI.el('div', 'card-pad empty-note', UI.esc(I18N.t('login.log.empty'))));
      container.appendChild(card);
      return;
    }

    let rows = '';
    log.forEach(r => {
      const when = new Date(r.at).toLocaleString(I18N.lang() === 'hi' ? 'hi-IN' : 'en-IN',
        { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      rows += '<tr><td><strong>' + UI.esc(r.name) + '</strong><div class="cell-sub">' +
        UI.esc(r.userCode) + '</div></td>' +
        '<td>' + roleTag(r.role) + '</td>' +
        '<td class="nowrap">' + UI.esc(when) + '</td></tr>';
    });

    card.innerHTML += '<table><thead><tr><th>' + UI.esc(I18N.t('g.name')) + '</th><th>' +
      UI.esc(I18N.t('g.role')) + '</th><th>' + UI.esc(I18N.t('login.time')) +
      '</th></tr></thead><tbody>' + rows + '</tbody></table>';
    container.appendChild(card);
  }

  global.LoginLog = { renderLog };

})(window);
