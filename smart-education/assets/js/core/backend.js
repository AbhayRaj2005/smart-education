/* ============================================================
   MODULE: core/backend.js
   Every call that leaves the browser lives here.
   ============================================================ */

(function (global) {

  let client = null;

  function db() {
    if (client) return client;

    if (typeof supabase === 'undefined' || !supabase.createClient) {
      throw new Error('supabase-js did not load — check the CDN script tag');
    }

    client = supabase.createClient(
      SE_CONFIG.supabaseUrl,
      SE_CONFIG.supabaseAnonKey
    );

    return client;
  }

  function emailFor(code) {
    return String(code).trim().toLowerCase() + '@' + SE_CONFIG.emailDomain;
  }

  /* ---------- auth ---------- */

  async function signIn(role, code, password) {
    const { data, error } = await db().auth.signInWithPassword({
      email: emailFor(code),
      password: password
    });

    if (error) return { ok: false, error: 'login.error.wrong' };

    const { data: profile, error: pErr } = await db()
      .from('profiles')
      .select('user_code, role, full_name, teacher_id, student_id')
      .eq('id', data.user.id)
      .single();

    if (pErr || !profile) {
      await db().auth.signOut();
      return { ok: false, error: 'login.error.wrong' };
    }

    if (profile.role !== role) {
      await db().auth.signOut();
      return { ok: false, error: 'login.error.wrong' };
    }

    /* Best-effort login record — a logging failure should never block
       sign-in, so this is fired without awaiting or checking the result.
       RLS (supabase/login-logs.sql) only lets each user write their own
       row and only lets admins read the list. */
    db().from('login_logs').insert({
      profile_id: data.user.id,
      user_code: profile.user_code,
      role: profile.role,
      full_name: profile.full_name
    });

    return {
      ok: true,
      user: {
        id: profile.teacher_id || profile.student_id || profile.user_code,
        code: profile.user_code,
        name: profile.full_name,
        role: profile.role,
        title: ''
      }
    };
  }

  async function signOut() {
    try {
      await db().auth.signOut();
    } catch (e) {}
  }

  async function session() {
    const { data } = await db().auth.getSession();
    return data ? data.session : null;
  }

  /* ---------- reads ---------- */

  async function loadAll(user) {
    const c = db();
    const today = new Date().toISOString().slice(0, 10);

    const [
      classes,
      teachers,
      teacherClasses,
      subjects,
      students,
      marks,
      fees,
      instalments,
      syllabus,
      timetable,
      attendance,
      attSummary,
      sms,
      loginLogs
    ] = await Promise.all([
      c.from('classes').select('*').order('grade'),
      c.from('teachers').select('*').order('name'),
      c.from('teacher_classes').select('*'),
      c.from('class_subjects').select('*'),
      c.from('students').select('*').order('class_id').order('roll'),
      c.from('marks').select('*'),
      c.from('fees').select('*'),
      c.from('fee_instalments').select('*').order('seq'),
      c.from('syllabus').select('*').order('seq'),
      c.from('timetable').select('*').order('period'),
      c.from('attendance').select('*').eq('taken_on', today),
      c.from('student_attendance_summary').select('*'),
      user.role === 'admin' || user.role === 'teacher'
        ? c.from('sms_log').select('*').order('sent_at', { ascending: false }).limit(100)
        : Promise.resolve({ data: [] }),
      /* only admins can read this (see supabase/login-logs.sql RLS) */
      user.role === 'admin'
        ? c.from('login_logs').select('*').order('logged_in_at', { ascending: false }).limit(200)
        : Promise.resolve({ data: [] })
    ]);

    const fail = [classes, teachers, students].find(r => r.error);

    if (fail) {
      throw new Error(fail.error.message);
    }

    return {
      classes: classes.data || [],
      teachers: teachers.data || [],
      teacherClasses: teacherClasses.data || [],
      subjects: subjects.data || [],
      students: students.data || [],
      marks: marks.data || [],
      fees: fees.data || [],
      instalments: instalments.data || [],
      syllabus: syllabus.data || [],
      timetable: timetable.data || [],
      attendance: attendance.data || [],
      attSummary: attSummary.data || [],
      sms: sms.data || [],
      loginLogs: loginLogs.data || []
    };
  }

  async function attendanceFor(classId, date) {
    const { data } = await db()
      .from('attendance')
      .select('*')
      .eq('class_id', classId)
      .eq(
        'taken_on',
        date || new Date().toISOString().slice(0, 10)
      );

    return data || [];
  }

  /* ---------- writes ---------- */

  async function saveAttendance(classId, marks, date) {
    const s = await session();

    if (!s) throw new Error('Not signed in');

    const res = await fetch(
      SE_CONFIG.supabaseUrl + '/functions/v1/mark-attendance',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + s.access_token,
          'apikey': SE_CONFIG.supabaseAnonKey
        },
        body: JSON.stringify({
          classId: classId,
          date: date || new Date().toISOString().slice(0, 10),
          marks: marks,
          language: I18N.lang()
        })
      }
    );

    if (!res.ok) {
      throw new Error(
        (await res.json().catch(() => ({}))).error || 'Save failed'
      );
    }

    return res.json();
  }

  async function saveMark(studentId, subject, exam, score) {
    const { error } = await db()
      .from('marks')
      .upsert(
        {
          student_id: studentId,
          subject: subject,
          exam: exam,
          score: score,
          max_score: 100,
          updated_at: new Date().toISOString()
        },
        {
          onConflict: 'student_id,subject,exam'
        }
      );

    if (error) throw new Error(error.message);
  }

  async function smsLog() {
    const { data } = await db()
      .from('sms_log')
      .select('*')
      .order('sent_at', { ascending: false })
      .limit(100);

    return data || [];
  }

  /* ---------- forgot password ---------- */

  async function requestOtp(role, code, email) {
    const res = await fetch(SE_CONFIG.supabaseUrl + '/functions/v1/request-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SE_CONFIG.supabaseAnonKey },
      body: JSON.stringify({ role, code, email })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not send the code');
    return data; /* { ok, otp, firstTime } — see request-otp/index.ts for why otp comes back here */
  }

  async function verifyOtp(role, code, email, otp, newPassword) {
    const res = await fetch(SE_CONFIG.supabaseUrl + '/functions/v1/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': SE_CONFIG.supabaseAnonKey },
      body: JSON.stringify({ role, code, email, otp, newPassword })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not reset the password');
    return data;
  }

  /* ---------- admin: add a student ---------- */

  async function createStudent(payload) {
    const { data: sessionData } = await db().auth.getSession();
    const token = sessionData && sessionData.session ? sessionData.session.access_token : null;
    if (!token) throw new Error('Please sign in again and retry.');

    const res = await fetch(SE_CONFIG.supabaseUrl + '/functions/v1/admin-create-student', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SE_CONFIG.supabaseAnonKey,
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not add the student');
    return data; /* { ok, id, password } */
  }

  async function createTeacher(payload) {
    const { data: sessionData } = await db().auth.getSession();
    const token = sessionData && sessionData.session ? sessionData.session.access_token : null;
    if (!token) throw new Error('Please sign in again and retry.');

    const res = await fetch(SE_CONFIG.supabaseUrl + '/functions/v1/admin-create-teacher', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SE_CONFIG.supabaseAnonKey,
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not add the teacher');
    return data; /* { ok, id, password } */
  }

  /* ---------- photos ---------- */

  async function uploadAvatar(kind, id, file) {
    if (!file || !file.type || file.type.indexOf('image/') !== 0) {
      throw new Error('Please choose an image file.');
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new Error('Photo must be 5 MB or smaller.');
    }

    const c = db();
    const path = kind + 's/' + id;

    const { error: upErr } = await c.storage.from('avatars')
      .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
    if (upErr) throw new Error(upErr.message);

    /* cache-bust so the new photo shows up immediately, not the browser's
       cached copy of the old file at the same path */
    const { data } = c.storage.from('avatars').getPublicUrl(path);
    const url = data.publicUrl;

    const table = kind === 'teacher' ? 'teachers' : 'students';
    const { error: dbErr } = await c.from(table).update({ photo_url: url }).eq('id', id);
    if (dbErr) throw new Error(dbErr.message);

    return url;
  }

  /* ---------- AI TUTOR ---------- */

  async function askTutor(subject, question, history, image) {
    const s = await session();

    if (!s) {
      throw new Error('Not signed in');
    }

    const res = await fetch(
      SE_CONFIG.supabaseUrl + '/functions/v1/ask-tutor',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + s.access_token,
          'apikey': SE_CONFIG.supabaseAnonKey
        },
        body: JSON.stringify({
          subject: subject || '',
          question: question,
          language: I18N.lang(),
          history: Array.isArray(history) ? history : [],
          imageBase64: image ? image.base64 : undefined,
          mimeType: image ? image.mimeType : undefined
        })
      }
    );

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      /* The function sends `detail` with the real upstream message.
         Handy while setting the tutor up; harmless once it works. */
      if (data.detail) {
        console.error('ask-tutor detail:', res.status, data.status, data.detail);
      }
      throw new Error(data.error || 'Tutor request failed');
    }

    return data;
  }

  /* ---------- ADMIN: FEES (editable) ---------- */
  /* Fees/fee_instalments already exist in schema.sql with admin-only
     write RLS — this was previously read-only in the browser. These
     four calls are the missing "admin can actually change it" half. */

  async function adminStudentFee(studentId) {
    const c = db();
    const [feeRow, instRows] = await Promise.all([
      c.from('fees').select('*').eq('student_id', studentId).maybeSingle(),
      c.from('fee_instalments').select('*').eq('student_id', studentId).order('seq')
    ]);
    if (feeRow.error) throw new Error(feeRow.error.message);
    if (instRows.error) throw new Error(instRows.error.message);
    return {
      total: feeRow.data ? Number(feeRow.data.total) : 0,
      instalments: (instRows.data || []).map(i => ({
        id: i.id, seq: i.seq, amount: Number(i.amount),
        dueDate: i.due_date, paidOn: i.paid_on, receiptNo: i.receipt_no
      }))
    };
  }

  async function saveFeeTotal(studentId, total) {
    const { error } = await db().from('fees').upsert({ student_id: studentId, total: total });
    if (error) throw new Error(error.message);
  }

  async function saveInstalment(studentId, seq, amount, dueDate, paidOn, receiptNo) {
    const { error } = await db().from('fee_instalments').upsert({
      student_id: studentId, seq: seq, amount: amount,
      due_date: dueDate || null, paid_on: paidOn || null, receipt_no: receiptNo || null
    }, { onConflict: 'student_id,seq' });
    if (error) throw new Error(error.message);
  }

  async function deleteInstalment(id) {
    const { error } = await db().from('fee_instalments').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  /* ---------- SKILLING ---------- */
  /* Skill catalog is read-only for everyone signed in (see
     schema-additions.sql). Attempts and certificates are written
     by the student themselves — RLS only lets a student insert
     rows with their own student_id. */

  async function skillsCatalog() {
    const { data, error } = await db()
      .from('skills').select('*').order('subject').order('seq');
    if (error) throw new Error(error.message);
    return data || [];
  }

  async function skillQuestions(skillId) {
    const { data, error } = await db()
      .from('skill_questions').select('*').eq('skill_id', skillId).order('seq');
    if (error) throw new Error(error.message);
    return data || [];
  }

  async function skillAttempts(studentId) {
    const { data, error } = await db()
      .from('skill_attempts').select('*')
      .eq('student_id', studentId)
      .order('attempted_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  }

  async function submitSkillAttempt(studentId, skillId, scorePct, passed) {
    const { error } = await db().from('skill_attempts').insert({
      student_id: studentId, skill_id: skillId, score_pct: scorePct, passed: passed
    });
    if (error) throw new Error(error.message);
  }

  async function skillCertificates(studentId) {
    const { data, error } = await db()
      .from('skill_certificates').select('*').eq('student_id', studentId);
    if (error) throw new Error(error.message);
    return data || [];
  }

  async function issueCertificate(studentId, subject) {
    const { error } = await db()
      .from('skill_certificates')
      .upsert({ student_id: studentId, subject: subject }, { onConflict: 'student_id,subject' });
    if (error) throw new Error(error.message);
  }

  /* ---------- STUDY PLAN ---------- */

  async function latestStudyPlan(studentId) {
    const { data: plans, error } = await db()
      .from('study_plans').select('*')
      .eq('student_id', studentId)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    if (!plans || !plans.length) return null;

    const plan = plans[0];
    const { data: items, error: iErr } = await db()
      .from('study_plan_items').select('*')
      .eq('plan_id', plan.id)
      .order('item_date').order('seq');
    if (iErr) throw new Error(iErr.message);

    return { plan: plan, items: items || [] };
  }

  async function replaceStudyPlan(studentId, targetDate, items) {
    /* One active plan per student — clear any earlier one first.
       Cascades and removes its items too. */
    await db().from('study_plans').delete().eq('student_id', studentId);

    const { data: plan, error } = await db()
      .from('study_plans')
      .insert({ student_id: studentId, target_date: targetDate })
      .select().single();
    if (error) throw new Error(error.message);

    const rows = items.map((it, i) => ({
      plan_id: plan.id,
      item_date: it.date,
      subject: it.subject,
      chapter_title: it.chapter,
      task_type: it.type,
      seq: i
    }));

    if (rows.length) {
      const { error: iErr } = await db().from('study_plan_items').insert(rows);
      if (iErr) throw new Error(iErr.message);
    }

    return plan;
  }

  async function toggleStudyItem(itemId, done) {
    const { error } = await db()
      .from('study_plan_items').update({ done: done }).eq('id', itemId);
    if (error) throw new Error(error.message);
  }

  /* ---------- TUTOR PROGRESS LOG ---------- */
  /* Best-effort, fire-and-forget, same pattern as the login_logs
     insert above — a logging failure should never break the chat. */

  function logTutorQuestion(studentId, subject, question) {
    db().from('tutor_log').insert({
      student_id: studentId,
      subject: subject || null,
      question: String(question).slice(0, 500)
    });
  }

  async function tutorLog(studentId, limit) {
    const { data, error } = await db()
      .from('tutor_log').select('*')
      .eq('student_id', studentId)
      .order('asked_at', { ascending: false })
      .limit(limit || 50);
    if (error) throw new Error(error.message);
    return data || [];
  }

  /* ---------- ASSESSMENT (AI question papers + AI grading) ---------- */
  /* Question generation and grading happen server-side in the
     generate-assessment / grade-submission Edge Functions (same
     GEMINI_API_KEY as the tutor). Everything else here is plain
     Supabase reads/writes, same pattern as Skilling. */

  async function callFunction(name, payload) {
    const s = await session();
    if (!s) throw new Error('Not signed in');

    const res = await fetch(SE_CONFIG.supabaseUrl + '/functions/v1/' + name, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + s.access_token,
        'apikey': SE_CONFIG.supabaseAnonKey
      },
      body: JSON.stringify(payload || {})
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (data.detail) console.error(name + ' detail:', res.status, data.status, data.detail);
      throw new Error(data.error || (name + ' failed'));
    }
    return data;
  }

  /* teacher: ask Gemini for a question paper and save it as a draft */
  function generateAssessment(classId, subject, chapterTitle, counts) {
    return callFunction('generate-assessment', { classId, subject, chapterTitle, counts });
  }

  /* teacher: photo of an actual paper -> Gemini vision reads it and saves
     a draft the same way generateAssessment does */
  function generateAssessmentFromPhoto(classId, subject, chapterTitle, imageBase64, mimeType) {
    return callFunction('generate-assessment-from-photo', { classId, subject, chapterTitle, imageBase64, mimeType });
  }

  /* teacher: build a question paper by hand, no AI involved. Saved as a
     draft ('manual' source) exactly like an AI one, so publish/close/results
     all work the same way afterwards. */
  async function createManualAssessment(classId, subject, chapterTitle, teacherId, questions) {
    const title = (chapterTitle ? chapterTitle : subject) + ' \u2014 question paper';
    const { data: assessment, error: aErr } = await db()
      .from('assessments')
      .insert({
        class_id: classId, subject, chapter_title: chapterTitle || null,
        title, created_by: teacherId, status: 'draft', source: 'manual'
      })
      .select('id').single();
    if (aErr) throw new Error(aErr.message);

    const rows = questions.map((q, i) => ({
      assessment_id: assessment.id,
      seq: i + 1,
      type: q.type,
      question: q.question,
      options: q.type === 'mcq' ? q.options : null,
      correct_index: q.type === 'mcq' ? q.correctIndex : null,
      model_answer: q.type === 'mcq' ? null : (q.modelAnswer || null),
      max_marks: q.maxMarks
    }));
    const { error: qErr } = await db().from('assessment_questions').insert(rows);
    if (qErr) {
      await db().from('assessments').delete().eq('id', assessment.id);
      throw new Error(qErr.message);
    }
    return { assessmentId: assessment.id, title, count: rows.length };
  }

  /* teacher: every assessment (any status) for the classes RLS lets them see */
  async function teacherAssessments(classIds) {
    const { data, error } = await db()
      .from('assessments').select('*')
      .in('class_id', classIds).order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  }

  async function publishAssessment(id, status) {
    const { error } = await db().from('assessments').update({ status: status }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  async function deleteAssessment(id) {
    const { error } = await db().from('assessments').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  /* student: only ever sees status = 'published' rows for their own class (RLS) */
  async function studentAssessments(classId) {
    const { data, error } = await db()
      .from('assessments').select('*')
      .eq('class_id', classId).eq('status', 'published')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  }

  async function assessmentQuestions(assessmentId) {
    const { data, error } = await db()
      .from('assessment_questions').select('*')
      .eq('assessment_id', assessmentId).order('seq');
    if (error) throw new Error(error.message);
    return data || [];
  }

  async function mySubmission(assessmentId, studentId) {
    const { data, error } = await db()
      .from('assessment_submissions').select('*, assessment_answers(*)')
      .eq('assessment_id', assessmentId).eq('student_id', studentId).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  }

  /* every submission (any student) for one assessment — teacher results view */
  async function assessmentResults(assessmentId) {
    const { data, error } = await db()
      .from('assessment_submissions').select('*')
      .eq('assessment_id', assessmentId).order('total_score', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  }

  /* student: save answers (MCQ already scored client-side), then ask the
     Edge Function to AI-grade the short/essay ones and total the result. */
  async function submitAssessment(assessmentId, studentId, answers) {
    const { data: submission, error: sErr } = await db()
      .from('assessment_submissions')
      .insert({ assessment_id: assessmentId, student_id: studentId, status: 'grading' })
      .select().single();
    if (sErr) throw new Error(sErr.message);

    const rows = answers.map(a => ({
      submission_id: submission.id,
      question_id: a.questionId,
      selected_index: a.selectedIndex != null ? a.selectedIndex : null,
      answer_text: a.answerText || null,
      score: a.score != null ? a.score : null    // pre-filled for mcq only
    }));
    const { error: rowErr } = await db().from('assessment_answers').insert(rows);
    if (rowErr) throw new Error(rowErr.message);

    const graded = await callFunction('grade-submission', { submissionId: submission.id });
    return { submissionId: submission.id, ...graded };
  }

  /* student: on-the-fly AI practice questions for one Skilling level;
     caller should fall back to the seeded skill_questions on error. */
  function generateSkillQuiz(skillId) {
    return callFunction('generate-skill-quiz', { skillId });
  }

  /* ---------- NOTICES ---------- */
  /* Fetched separately from loadAll() on purpose: if the notices SQL has
     not been run yet, the rest of the portal must still open normally.
     Who may read / write what is decided by RLS in
     supabase/schema-notices-timetable.sql — the author name and role
     are stamped by the database, not sent from here. */

  async function listNotices() {
    const { data, error } = await db()
      .from('notices').select('*')
      .order('created_at', { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    return data || [];
  }

  async function postNotice(n) {
    const { data, error } = await db().from('notices').insert({
      title: n.title,
      body: n.body || '',
      target_class: n.targetClass || null,
      expires_on: n.expiresOn || null
    }).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function deleteNotice(id) {
    /* .select() so a row RLS refused to delete shows up as "0 rows"
       instead of silently looking like success */
    const { data, error } = await db().from('notices').delete().eq('id', id).select();
    if (error) throw new Error(error.message);
    if (!data || !data.length) throw new Error('Not allowed, or already removed.');
  }

  /* ---------- TIMETABLE (admin edits) ---------- */

  async function saveTimetableSlot(classId, weekday, period, subject, teacherId, room) {
    const { error } = await db().from('timetable').upsert({
      class_id: classId, weekday: weekday, period: period,
      subject: subject, teacher_id: teacherId, room: room || null
    }, { onConflict: 'class_id,weekday,period' });
    if (error) throw new Error(error.message);
  }

  async function clearTimetableSlot(classId, weekday, period) {
    const { error } = await db().from('timetable').delete()
      .eq('class_id', classId).eq('weekday', weekday).eq('period', period);
    if (error) throw new Error(error.message);
  }

  /* ---------- public API ---------- */

  global.Backend = {
    db,
    emailFor,
    signIn,
    signOut,
    session,
    loadAll,
    attendanceFor,
    saveAttendance,
    saveMark,
    smsLog,
    askTutor,
    adminStudentFee,
    saveFeeTotal,
    saveInstalment,
    deleteInstalment,
    requestOtp,
    verifyOtp,
    createStudent,
    createTeacher,
    uploadAvatar,
    skillsCatalog,
    skillQuestions,
    skillAttempts,
    submitSkillAttempt,
    skillCertificates,
    issueCertificate,
    latestStudyPlan,
    replaceStudyPlan,
    toggleStudyItem,
    logTutorQuestion,
    tutorLog,
    generateAssessment,
    generateAssessmentFromPhoto,
    createManualAssessment,
    teacherAssessments,
    publishAssessment,
    deleteAssessment,
    studentAssessments,
    assessmentQuestions,
    mySubmission,
    assessmentResults,
    submitAssessment,
    generateSkillQuiz,
    listNotices,
    postNotice,
    deleteNotice,
    saveTimetableSlot,
    clearTimetableSlot
  };

})(window);