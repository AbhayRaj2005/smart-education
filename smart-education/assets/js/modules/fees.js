/* ============================================================
   MODULE: modules/fees.js
   Tuition fee: the statement a student sees, and the
   class-wise ledger the admin sees.
   ============================================================ */

(function (global) {

  /* ---------- student: my fee ---------- */
  function renderStudentFees(container, student) {
    const f = student.fees;
    const pct = Math.round(f.paid / f.total * 100);

    const card = UI.el('div', 'card');
    card.innerHTML = '<div class="card-head"><h3>' + UI.esc(I18N.t('s.myFees')) + '</h3>' +
      '<span class="tag ' + (f.due === 0 ? 'green' : 'amber') + '">' +
      UI.esc(f.due === 0 ? I18N.t('s.cleared') : I18N.t('g.due') + ' ' + SCHOOL.money(f.due)) + '</span></div>' +
      '<div class="card-pad"><div class="fee-figures">' +
      '<div><span>' + UI.esc(I18N.t('g.total')) + '</span><strong>' + SCHOOL.money(f.total) + '</strong></div>' +
      '<div><span>' + UI.esc(I18N.t('g.paid')) + '</span><strong>' + SCHOOL.money(f.paid) + '</strong></div>' +
      '<div><span>' + UI.esc(I18N.t('g.due')) + '</span><strong>' + SCHOOL.money(f.due) + '</strong></div>' +
      '</div><div class="progress" style="margin-top:14px"><div style="width:' + pct + '%"></div></div></div>';

    let rows = '';
    f.instalments.forEach(i => {
      const paid = !!i.paidOn;
      rows += '<tr><td>' + UI.esc(I18N.t('s.installment')) + ' ' + i.n + '</td>' +
        '<td>' + SCHOOL.money(i.amount) + '</td>' +
        '<td>' + UI.esc(i.dueDate) + '</td>' +
        '<td>' + (paid
          ? '<span class="tag green">' + UI.esc(I18N.t('s.cleared')) + ' · ' + UI.esc(i.paidOn) + '</span>'
          : '<span class="tag amber">' + UI.esc(I18N.t('s.pending')) + '</span>') + '</td></tr>';
    });

    card.innerHTML += '<table><thead><tr><th>' + UI.esc(I18N.t('s.installment')) + '</th><th>' +
      UI.esc(I18N.t('g.total')) + '</th><th>' + UI.esc(I18N.t('s.dueOn')) + '</th><th>' +
      UI.esc(I18N.t('g.status')) + '</th></tr></thead><tbody>' + rows + '</tbody></table>';

    if (f.due > 0) {
      const pad = UI.el('div', 'card-pad btn-row');
      const btn = UI.el('button', 'btn btn-marigold btn-sm', UI.esc(I18N.t('s.payNow')));
      btn.type = 'button';
      btn.addEventListener('click', () =>
        UI.toast('₹', I18N.t('s.payNow'), SCHOOL.money(f.due) + ' · ' + student.name));
      pad.appendChild(btn);
      card.appendChild(pad);
    }

    container.appendChild(card);
  }

  /* ---------- admin: ledger ---------- */
  function renderLedger(container) {
    const isLive = typeof SE_BACKEND === 'function' && SE_BACKEND();

    const head = UI.el('div', 'view-head');
    head.innerHTML = '<div><h2 class="view-title">' + UI.esc(I18N.t('a.feeLedger')) + '</h2>' +
      '<p class="view-sub">' + UI.esc(I18N.t('a.classwise')) + '</p></div>';
    container.appendChild(head);

    let total = 0, paid = 0;
    const perClass = SCHOOL.classes.map(c => {
      const roster = SCHOOL.studentsOf(c.id);
      const t = roster.reduce((a, s) => a + s.fees.total, 0);
      const p = roster.reduce((a, s) => a + s.fees.paid, 0);
      total += t; paid += p;
      return { cls: c, roster: roster.length, total: t, paid: p, due: t - p };
    });

    const kpis = UI.el('div', 'kpi-row');
    kpis.innerHTML =
      UI.kpi(I18N.t('g.total'), SCHOOL.money(total), I18N.t('a.feesCollected')) +
      UI.kpi(I18N.t('a.collected'), SCHOOL.money(paid), Math.round(paid / total * 100) + '%') +
      UI.kpi(I18N.t('a.outstanding'), SCHOOL.money(total - paid), Math.round((total - paid) / total * 100) + '%', 'down') +
      UI.kpi(I18N.t('a.totalStudents'), SCHOOL.students.length, SCHOOL.classes.length + ' ' + I18N.t('nav.classes'));
    container.appendChild(kpis);

    let rows = '';
    perClass.forEach(r => {
      const pct = Math.round(r.paid / r.total * 100);
      rows += '<tr><td><strong>' + UI.esc(UI.classLabel(r.cls)) + '</strong></td>' +
        '<td>' + r.roster + '</td><td>' + SCHOOL.money(r.total) + '</td>' +
        '<td>' + SCHOOL.money(r.paid) + '</td><td>' + SCHOOL.money(r.due) + '</td>' +
        '<td><div class="progress mini"><div style="width:' + pct + '%"></div></div><span class="cell-sub">' +
        pct + '%</span></td>' +
        (isLive ? '<td><button type="button" class="btn btn-outline btn-sm" data-class="' + UI.esc(r.cls.id) + '">Manage</button></td>' : '') +
        '</tr>';
    });

    const card = UI.el('div', 'card');
    card.innerHTML = '<div class="card-head"><h3>' + UI.esc(I18N.t('a.classwise')) + '</h3></div>' +
      '<table><thead><tr><th>' + UI.esc(I18N.t('g.class')) + '</th><th>' + UI.esc(I18N.t('g.students')) +
      '</th><th>' + UI.esc(I18N.t('g.total')) + '</th><th>' + UI.esc(I18N.t('a.collected')) + '</th><th>' +
      UI.esc(I18N.t('a.outstanding')) + '</th><th>' + UI.esc(I18N.t('g.progress')) + '</th>' +
      (isLive ? '<th></th>' : '') +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
    container.appendChild(card);

    if (isLive) {
      card.querySelectorAll('button[data-class]').forEach(btn => {
        btn.addEventListener('click', () => {
          const cls = SCHOOL.classById(btn.dataset.class);
          openManageClassFees(cls);
        });
      });
    }
  }

  /* ---- admin: pick a student in a class to edit their fee plan ---- */
  function openManageClassFees(cls) {
    const roster = SCHOOL.studentsOf(cls.id);
    const backdrop = UI.el('div', 'se-modal-backdrop');
    backdrop.innerHTML =
      '<div class="se-modal" role="dialog" aria-modal="true">' +
        '<button type="button" class="se-modal-close" aria-label="Close">&times;</button>' +
        '<h2>' + UI.esc(UI.classLabel(cls)) + ' \u2014 fees</h2>' +
        '<table><thead><tr><th>Student</th><th>Total</th><th>Paid</th><th>Due</th><th></th></tr></thead>' +
        '<tbody id="mcfBody"></tbody></table>' +
      '</div>';
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('open'));

    const tbody = backdrop.querySelector('#mcfBody');
    roster.forEach(s => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td>' + UI.esc(s.name) + ' <span class="meta">' + UI.esc(s.roll || '') + '</span></td>' +
        '<td>' + SCHOOL.money(s.fees.total) + '</td>' +
        '<td>' + SCHOOL.money(s.fees.paid) + '</td>' +
        '<td>' + SCHOOL.money(s.fees.due) + '</td>' +
        '<td><button type="button" class="btn btn-outline btn-sm">Edit</button></td>';
      tr.querySelector('button').addEventListener('click', () => openStudentFeeEditor(s));
      tbody.appendChild(tr);
    });

    function close() { backdrop.classList.remove('open'); setTimeout(() => backdrop.remove(), 180); }
    backdrop.querySelector('.se-modal-close').addEventListener('click', close);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  }

  /* ---- admin: edit one student's total fee + every instalment ---- */
  function openStudentFeeEditor(student) {
    const backdrop = UI.el('div', 'se-modal-backdrop');
    backdrop.innerHTML =
      '<div class="se-modal" role="dialog" aria-modal="true">' +
        '<button type="button" class="se-modal-close" aria-label="Close">&times;</button>' +
        '<h2>' + UI.esc(student.name) + ' \u2014 fee plan</h2>' +
        '<div id="sfeError" hidden class="se-modal-error"></div>' +
        '<div class="se-form-grid">' +
          '<div><label>Total fee (\u20b9)</label><input id="sfeTotal" type="number" min="0"></div>' +
        '</div>' +
        '<h3 style="margin-top:16px;">Instalments</h3>' +
        '<div id="sfeRows"></div>' +
        '<div class="btn-row stack-top"><button type="button" id="sfeAddRow" class="btn btn-outline btn-sm">+ Add instalment</button></div>' +
        '<div class="se-modal-actions">' +
          '<button type="button" class="btn btn-ghost btn-sm" id="sfeCancel">Cancel</button>' +
          '<button type="button" class="btn btn-sm" id="sfeSave">Save</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('open'));

    function close() { backdrop.classList.remove('open'); setTimeout(() => backdrop.remove(), 180); }
    backdrop.querySelector('.se-modal-close').addEventListener('click', close);
    backdrop.querySelector('#sfeCancel').addEventListener('click', close);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });

    const errBox = backdrop.querySelector('#sfeError');
    const totalInput = backdrop.querySelector('#sfeTotal');
    const rowsWrap = backdrop.querySelector('#sfeRows');
    let nextSeq = 1;

    function addRow(inst) {
      inst = inst || {};
      const seq = inst.seq || nextSeq;
      nextSeq = Math.max(nextSeq, seq + 1);
      const row = UI.el('div', 'card card-pad stack-top');
      row.dataset.id = inst.id || '';
      row.dataset.seq = seq;
      const paid = !!inst.paidOn;
      row.innerHTML =
        '<div class="se-form-grid">' +
          '<div><label>Instalment ' + seq + ' amount</label><input class="sfeAmount" type="number" min="0" value="' + (inst.amount || '') + '"></div>' +
          '<div><label>Due date</label><input class="sfeDue" type="date" value="' + (inst.dueDate || '') + '"></div>' +
          '<div><label><input class="sfePaidBox" type="checkbox" ' + (paid ? 'checked' : '') + '> Paid</label></div>' +
          '<div class="sfePaidFields" ' + (paid ? '' : 'hidden') + '>' +
            '<label>Paid on</label><input class="sfePaidOn" type="date" value="' + (inst.paidOn || '') + '">' +
          '</div>' +
          '<div class="sfePaidFields" ' + (paid ? '' : 'hidden') + '>' +
            '<label>Receipt no.</label><input class="sfeReceipt" value="' + UI.esc(inst.receiptNo || '') + '">' +
          '</div>' +
        '</div>' +
        '<button type="button" class="btn btn-ghost btn-sm sfeRemove">Remove instalment</button>';

      row.querySelector('.sfePaidBox').addEventListener('change', e => {
        row.querySelectorAll('.sfePaidFields').forEach(f => f.hidden = !e.target.checked);
        if (e.target.checked && !row.querySelector('.sfePaidOn').value) {
          row.querySelector('.sfePaidOn').value = new Date().toISOString().slice(0, 10);
        }
      });
      row.querySelector('.sfeRemove').addEventListener('click', () => row.remove());
      rowsWrap.appendChild(row);
    }

    Backend.adminStudentFee(student.id).then(data => {
      totalInput.value = data.total || student.fees.total || 0;
      if (data.instalments.length) {
        data.instalments.forEach(addRow);
      } else {
        addRow();
      }
    }).catch(err => {
      errBox.hidden = false;
      errBox.textContent = err.message;
      totalInput.value = student.fees.total || 0;
      addRow();
    });

    backdrop.querySelector('#sfeAddRow').addEventListener('click', () => addRow());

    backdrop.querySelector('#sfeSave').addEventListener('click', async () => {
      errBox.hidden = true;
      const saveBtn = backdrop.querySelector('#sfeSave');
      saveBtn.disabled = true;
      try {
        const total = parseFloat(totalInput.value) || 0;
        await Backend.saveFeeTotal(student.id, total);

        const rows = Array.from(rowsWrap.children);
        for (const row of rows) {
          const amount = parseFloat(row.querySelector('.sfeAmount').value) || 0;
          if (amount <= 0) continue;
          const dueDate = row.querySelector('.sfeDue').value || null;
          const isPaid = row.querySelector('.sfePaidBox').checked;
          const paidOn = isPaid ? (row.querySelector('.sfePaidOn').value || new Date().toISOString().slice(0, 10)) : null;
          const receiptNo = isPaid ? row.querySelector('.sfeReceipt').value.trim() : null;
          await Backend.saveInstalment(student.id, Number(row.dataset.seq), amount, dueDate, paidOn, receiptNo);
        }

        UI.toast('\u2705', 'Fees saved', student.name, 'success');
        close();
        location.reload();
      } catch (err) {
        errBox.hidden = false;
        errBox.textContent = err.message;
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  global.Fees = { renderStudentFees, renderLedger };

})(window);
