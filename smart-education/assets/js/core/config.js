/* ============================================================
   MODULE: core/config.js
   The only file you edit when you move from demo data to your
   own Supabase project.

   demo: true   → everything runs on the sample data in the
                  browser, no server needed (good for showing it off)
   demo: false  → the app reads and writes your Supabase project

   The anon key is safe to ship in the browser: it can only do
   what your row-level-security policies allow. The SERVICE ROLE
   key must never appear in any file under assets/.
   ============================================================ */

window.SE_CONFIG = {
  demo: false,

    supabaseUrl: 'https://tnzimqhdasatxbixkjzr.supabase.co',          // e.g. 'https://abcdefgh.supabase.co'
  supabaseAnonKey: 'sb_publishable_lBCz7dRW6DthIJsw7g6VCQ_Q5FR7wQV',      // Project settings → API → anon public

  // Supabase auth needs an email, so the login screen turns the
  // user ID into one: TCH-01 → tch-01@smarteducation.internal
  emailDomain: 'smarteducation.internal',

    schoolName: 'ST.Thomas Public School',

  // "Forgot password" emails the OTP using EmailJS (dashboard.emailjs.com
  // → free, no server needed). Create a service + template there, then
  // paste the three IDs below. See BACKEND-SETUP.md for the exact steps
  // and the template variables this app sends ({{to_email}}, {{otp}},
  // {{user_name}}).
  emailjs: {
    publicKey: 'ZlntMoI7k37C8AOSN',   // Account → General → Public Key
    serviceId: 'service_iadjgeh',     // Email Services → your service's ID
    templateId: 'template_wv4agrc'    // Email Templates → your template's ID
  }
};

window.SE_BACKEND = function () {
  return !SE_CONFIG.demo && !!SE_CONFIG.supabaseUrl && !!SE_CONFIG.supabaseAnonKey;
};
