// ============================================================
//  Edge function: verify-otp
//  Step 2 of "forgot password" — check the code, set the new
//  password permanently.
//
//  Deploy:  supabase functions deploy verify-otp
//
//  Body:    { role, code, email, otp, newPassword }
//  Returns: { ok: true }
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
    const otp = String(body.otp || '').trim();
    const newPassword = String(body.newPassword || '');

    if (!['admin', 'teacher', 'student'].includes(role)) return json({ error: 'Pick a role' }, 400);
    if (!/^\d{6}$/.test(otp)) return json({ error: 'Enter the 6-digit code' }, 400);
    if (newPassword.length < 6) return json({ error: 'Password must be at least 6 characters' }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: profile } = await admin
      .from('profiles')
      .select('id, role, recovery_email')
      .eq('user_code', code)
      .eq('role', role)
      .maybeSingle();

    if (!profile || profile.recovery_email !== email) {
      return json({ error: 'That code is invalid or has expired' }, 400);
    }

    const { data: reset } = await admin
      .from('password_resets')
      .select('id, otp_hash, expires_at, used_at')
      .eq('profile_id', profile.id)
      .is('used_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!reset) return json({ error: 'That code is invalid or has expired' }, 400);
    if (new Date(reset.expires_at).getTime() < Date.now()) {
      return json({ error: 'That code has expired — request a new one' }, 400);
    }

    const otp_hash = await sha256(otp);
    if (otp_hash !== reset.otp_hash) {
      return json({ error: 'Incorrect code' }, 400);
    }

    const { error: pwErr } = await admin.auth.admin.updateUserById(profile.id, { password: newPassword });
    if (pwErr) {
      console.error('updateUserById failed:', pwErr);
      return json({ error: 'Could not update the password — try again' }, 500);
    }

    await admin.from('password_resets').update({ used_at: new Date().toISOString() }).eq('id', reset.id);

    return json({ ok: true });

  } catch (err) {
    console.error('verify-otp crashed:', err);
    return json({ error: 'Something went wrong: ' + String((err as any)?.message ?? err) }, 500);
  }
});
