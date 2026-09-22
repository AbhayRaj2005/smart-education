/* ============================================================
   PAGE: login.html — "Forgot password?" modal
   Step 1: ID + email  →  Step 2: 6-digit code  →  Step 3: new
   password. The code is emailed with EmailJS (see config.js).
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  const backdrop = document.getElementById('fpBackdrop');
  if (!backdrop) return; /* modal not on this page */

  const modal = backdrop.querySelector('.modal');
  const dots = backdrop.querySelectorAll('.fp-dot');
  const errorBox = document.getElementById('fpError');

  const panels = {
    1: document.getElementById('fpStep1'),
    2: document.getElementById('fpStep2'),
    3: document.getElementById('fpStep3'),
    done: document.getElementById('fpDone')
  };

  let state = { role: 'teacher', code: '', email: '', otp: '' };
  let emailjsReady = false;

  try {
    if (window.emailjs && SE_CONFIG.emailjs && SE_CONFIG.emailjs.publicKey) {
      emailjs.init({ publicKey: SE_CONFIG.emailjs.publicKey });
      emailjsReady = true;
    }
  } catch (e) { emailjsReady = false; }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
  }
  function clearError() { errorBox.hidden = true; }

  function goTo(step) {
    clearError();
    Object.keys(panels).forEach(k => { panels[k].hidden = String(k) !== String(step); });
    dots.forEach(d => d.classList.toggle('active', Number(d.dataset.step) <= (step === 'done' ? 3 : step)));
  }

  function open() {
    /* pick up whichever role tab is active on the login form right now */
    const activeTab = document.querySelector('.role-tab.active');
    state = { role: activeTab ? activeTab.dataset.role : 'teacher', code: '', email: '', otp: '' };
    document.getElementById('fpId').value = document.getElementById('loginId').value || '';
    document.getElementById('fpEmail').value = '';
    document.getElementById('fpOtp').value = '';
    document.getElementById('fpPw1').value = '';
    document.getElementById('fpPw2').value = '';
    goTo(1);
    backdrop.hidden = false;
    requestAnimationFrame(() => backdrop.classList.add('open'));
    document.getElementById('fpId').focus();
  }

  function close() {
    backdrop.classList.remove('open');
    setTimeout(() => { backdrop.hidden = true; }, 180);
  }

  document.getElementById('forgotLink').addEventListener('click', open);
  document.getElementById('fpClose').addEventListener('click', close);
  document.getElementById('fpCloseDone').addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !backdrop.hidden) close(); });

  async function sendOtpEmail(email, otp) {
    if (!emailjsReady) {
      throw new Error(I18N.t('fp.err.notconfigured'));
    }
    try {
      await emailjs.send(SE_CONFIG.emailjs.serviceId, SE_CONFIG.emailjs.templateId, {
        to_email: email,
        otp: otp,
        user_name: state.code
      });
    } catch (emailErr) {
      throw emailErr;
    }
  }

  /* ---- step 1: request code ---- */
  panels[1].addEventListener('submit', async e => {
    e.preventDefault();
    clearError();

    const code = document.getElementById('fpId').value.trim();
    const email = document.getElementById('fpEmail').value.trim();
    if (!code || !email) { showError(I18N.t('login.error.empty')); return; }

    const btn = document.getElementById('fpSendBtn');
    btn.disabled = true;
    btn.textContent = I18N.t('fp.sending');

    try {
      const res = await Backend.requestOtp(state.role, code, email);
      if (res.otp) await sendOtpEmail(email, res.otp);

      state.code = code;
      state.email = email;

      document.getElementById('fpStep2Body').textContent = I18N.t('fp.step2.body').replace('{email}', email);
      goTo(2);
      document.getElementById('fpOtp').focus();
    } catch (err) {
      showError(err.message || I18N.t('fp.err.generic'));
    } finally {
      btn.disabled = false;
      btn.textContent = I18N.t('fp.send');
    }
  });

  /* ---- step 2: verify code (just format-checked here; the real
     check happens with the password in step 3) ---- */
  panels[2].addEventListener('submit', e => {
    e.preventDefault();
    clearError();
    const otp = document.getElementById('fpOtp').value.trim();
    if (!/^\d{6}$/.test(otp)) { showError(I18N.t('fp.err.otp')); return; }
    state.otp = otp;
    goTo(3);
    document.getElementById('fpPw1').focus();
  });

  document.getElementById('fpBackTo1').addEventListener('click', () => goTo(1));

  document.getElementById('fpResend').addEventListener('click', async () => {
    clearError();
    const btn = document.getElementById('fpResend');
    btn.disabled = true;
    try {
      const res = await Backend.requestOtp(state.role, state.code, state.email);
      if (res.otp) await sendOtpEmail(state.email, res.otp);
    } catch (err) {
      showError(err.message || I18N.t('fp.err.generic'));
    } finally {
      btn.disabled = false;
    }
  });

  /* ---- step 3: set new password ---- */
  panels[3].addEventListener('submit', async e => {
    e.preventDefault();
    clearError();

    const pw1 = document.getElementById('fpPw1').value;
    const pw2 = document.getElementById('fpPw2').value;
    if (pw1.length < 6) { showError(I18N.t('fp.err.short')); return; }
    if (pw1 !== pw2) { showError(I18N.t('fp.err.mismatch')); return; }

    const btn = document.getElementById('fpSaveBtn');
    btn.disabled = true;
    btn.textContent = I18N.t('fp.saving');

    try {
      await Backend.verifyOtp(state.role, state.code, state.email, state.otp, pw1);
      goTo('done');
    } catch (err) {
      showError(err.message || I18N.t('fp.err.generic'));
    } finally {
      btn.disabled = false;
      btn.textContent = I18N.t('fp.save');
    }
  });

});
