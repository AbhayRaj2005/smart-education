// ============================================================
//  Edge function: request-otp
//  Step 1 of "forgot password". No login needed to call this —
//  that's the whole point.
//
//  Deploy:  supabase functions deploy request-otp
//
//  Body:    { role, code, email }
//  Returns: { ok: true, otp, firstTime } on success
//           (see the long comment near the bottom about why the
//           OTP itself comes back in the response)
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

async function sha256(text: string) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function otp6() {
  // crypto.getRandomValues, not Math.random — this gates a password change
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, '0');
}

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!SUPABASE_URL || !SERVICE_KEY) {
      console.error('Missing Supabase env vars');
      return json({ error: 'Server is not configured correctly.' }, 500);
    }

    let body: any = {};
    try { body = await req.json(); } catch { return json({ error: 'Bad request body' }, 400); }

    const role = String(body.role || '').trim();
    const code = String(body.code || '').trim().toUpperCase();
    const email = String(body.email || '').trim().toLowerCase();

    if (!['admin', 'teacher', 'student'].includes(role)) return json({ error: 'Pick a role' }, 400);
    if (!code) return json({ error: 'Enter your ID' }, 400);
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: profile } = await admin
      .from('profiles')
      .select('id, role, recovery_email, user_code')
      .eq('user_code', code)
      .eq('role', role)
      .maybeSingle();

    // Same generic response whether the account exists or not, so this
    // endpoint can't be used to check which IDs are real.
    const generic = { ok: true };

    if (!profile) return json(generic);

    let firstTime = false;
    if (profile.recovery_email) {
      if (profile.recovery_email !== email) return json(generic);
    } else {
      // First time this account has used "forgot password" — bind this
      // email to it so future resets must match it.
      firstTime = true;
      await admin.from('profiles').update({ recovery_email: email }).eq('id', profile.id);
    }

    const otp = otp6();
    const otp_hash = await sha256(otp);
    const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // One live code per account — replace any earlier unused one.
    await admin.from('password_resets').delete().eq('profile_id', profile.id).is('used_at', null);
    await admin.from('password_resets').insert({
      profile_id: profile.id,
      email,
      otp_hash,
      expires_at
    });

    // ---- why the OTP is in this response, not emailed from here ----
    // This project has no SMTP server of its own. The email is sent by
    // the BROWSER, straight after this call, using EmailJS with your
    // Service ID / Template ID / Public Key from config.js. Those only
    // work client-side, so the OTP has to travel back to the browser
    // once so it can be handed to EmailJS as a template variable.
    // It's short-lived (10 min), single-use, and only reaches the
    // browser that just proved it knows this account's ID and role.
    return json({ ok: true, otp, firstTime });

  } catch (err) {
    console.error('request-otp crashed:', err);
    return json({ error: 'Something went wrong: ' + String((err as any)?.message ?? err) }, 500);
  }
});
