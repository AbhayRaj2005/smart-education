// ============================================================
//  Edge function: generate-timetable
//  Admin-only. Admin gives the school's physical resources
//  (buildings, labs, classrooms, periods/day); this function
//  works out how many shifts are needed, which class runs in
//  which shift, and fills every class's weekly grid \u2014 picking
//  a teacher per subject from teacher_classes, avoiding teacher
//  double-booking and lab over-booking \u2014 then overwrites the
//  `timetable` table with the result.
//
//  This is a deterministic greedy scheduler, NOT an AI call: a
//  real constraint problem like this is solved far more reliably
//  by an algorithm than by asking an LLM to fill in a grid, so no
//  Gemini key is needed here.
//
//  Deploy:  supabase functions deploy generate-timetable
//
//  Body:    { buildings, labs, classrooms, periodsPerDay }
//  Returns: { ok: true, shiftsUsed, classesScheduled, warnings: string[] }
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

// subjects that need a lab period instead of the class's own room
const LAB_SUBJECTS = ['Science', 'Computer Science'];
// when a class's weekly periods don't split evenly across its subjects,
// these get the leftover periods first (core subjects)
const CORE_PRIORITY = ['Mathematics', 'Science', 'English'];

function clampInt(v: unknown, min: number, max: number, dflt: number) {
  const n = parseInt(String(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, n));
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

    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ error: 'Sign in required' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: callerData, error: callerErr } = await admin.auth.getUser(token);
    if (callerErr || !callerData?.user) return json({ error: 'Sign in required' }, 401);

    const { data: callerProfile } = await admin
      .from('profiles').select('role').eq('id', callerData.user.id).maybeSingle();
    if (!callerProfile || callerProfile.role !== 'admin') {
      return json({ error: 'Only an admin can generate the timetable' }, 403);
    }

    let body: any = {};
    try { body = await req.json(); } catch { return json({ error: 'Bad request body' }, 400); }

    const buildings = clampInt(body.buildings, 1, 50, 1);
    const labs = clampInt(body.labs, 0, 50, 1);
    const classrooms = clampInt(body.classrooms, 1, 500, 10);
    const periodsPerDay = clampInt(body.periodsPerDay, 3, 12, 7);

    const { data: classes, error: clsErr } = await admin
      .from('classes').select('id, grade').order('id');
    if (clsErr) return json({ error: clsErr.message }, 500);
    if (!classes?.length) return json({ error: 'No classes found \u2014 add classes first.' }, 400);

    const { data: tcRows, error: tcErr } = await admin
      .from('teacher_classes').select('class_id, teacher_id, teachers(id, name, subject)');
    if (tcErr) return json({ error: tcErr.message }, 500);

    // classId -> [{ subject, teacherId, teacherName }] (one teacher per subject per class)
    const classSubjects: Record<string, { subject: string; teacherId: string; teacherName: string }[]> = {};
    (tcRows || []).forEach((r: any) => {
      const t = r.teachers;
      if (!t || !t.subject) return;
      const list = (classSubjects[r.class_id] = classSubjects[r.class_id] || []);
      if (!list.find(s => s.subject === t.subject)) {
        list.push({ subject: t.subject, teacherId: t.id, teacherName: t.name });
      }
    });

    const actualShifts = Math.max(1, Math.ceil(classes.length / classrooms));
    const cappedShifts = Math.min(actualShifts, 4); // 4 shifts/day is already a lot for any school

    // upsert the resource numbers so the admin panel can show them back
    await admin.from('school_resources').upsert({
      id: 1, buildings, labs, classrooms, periods_per_day: periodsPerDay, shifts: cappedShifts
    });

    // assign every class to a shift, round-robin, deterministic order
    const shiftOf: Record<string, number> = {};
    classes.forEach((c, i) => { shiftOf[c.id] = (i % cappedShifts) + 1; });

    // fixed room label per class within its shift (reused every period)
    const roomOf: Record<string, string> = {};
    const perShiftCounter: Record<number, number> = {};
    classes.forEach(c => {
      const sh = shiftOf[c.id];
      const idx = (perShiftCounter[sh] = (perShiftCounter[sh] || 0) + 1);
      roomOf[c.id] = 'Room ' + (((idx - 1) % classrooms) + 1) + (buildings > 1 ? ' \u00b7 Blk ' + (((idx - 1) % buildings) + 1) : '');
    });

    const WEEKDAYS = [1, 2, 3, 4, 5];
    const warnings: string[] = [];

    // busy[teacherId|day|period|shift] = true
    const teacherBusy = new Set<string>();
    // labBusy[day|period|shift] = count of classes using a lab that slot
    const labBusy: Record<string, number> = {};

    type Row = { class_id: string; weekday: number; period: number; subject: string; teacher_id: string; room: string; shift: number; room_type: string };
    const rows: Row[] = [];
    let scheduledClasses = 0;

    for (const cls of classes) {
      const subjects = classSubjects[cls.id];
      if (!subjects || !subjects.length) {
        warnings.push(cls.id + ': no teacher is assigned to this class yet \u2014 skipped. Add teachers under Teachers \u2192 assign classes, then re-run.');
        continue;
      }

      const shift = shiftOf[cls.id];
      const room = roomOf[cls.id];
      const weeklySlots = periodsPerDay * WEEKDAYS.length;

      // sort subjects: core subjects first so they get any leftover periods
      const ordered = subjects.slice().sort((a, b) => {
        const pa = CORE_PRIORITY.indexOf(a.subject), pb = CORE_PRIORITY.indexOf(b.subject);
        return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb) || a.subject.localeCompare(b.subject);
      });

      const base = Math.floor(weeklySlots / ordered.length);
      let remainder = weeklySlots % ordered.length;
      const needed: Record<string, number> = {};
      ordered.forEach(s => { needed[s.subject] = base + (remainder-- > 0 ? 1 : 0); });

      let rotate = 0; // rotates which subject gets first refusal each period, for variety
      let filled = 0;

      for (const day of WEEKDAYS) {
        for (let period = 1; period <= periodsPerDay; period++) {
          let placed = false;
          for (let tries = 0; tries < ordered.length; tries++) {
            const s = ordered[(rotate + tries) % ordered.length];
            if (needed[s.subject] <= 0) continue;

            const tKey = s.teacherId + '|' + day + '|' + period + '|' + shift;
            if (teacherBusy.has(tKey)) continue;

            const isLab = LAB_SUBJECTS.includes(s.subject);
            const lKey = day + '|' + period + '|' + shift;
            if (isLab && (labBusy[lKey] || 0) >= labs) continue;

            // place it
            teacherBusy.add(tKey);
            if (isLab) labBusy[lKey] = (labBusy[lKey] || 0) + 1;
            needed[s.subject]--;
            rows.push({
              class_id: cls.id, weekday: day, period, subject: s.subject, teacher_id: s.teacherId,
              room: isLab ? 'Lab ' + (((labBusy[lKey] || 1) - 1) % Math.max(1, labs) + 1) : room,
              shift, room_type: isLab ? 'lab' : 'classroom'
            });
            filled++;
            placed = true;
            rotate = (rotate + tries + 1) % ordered.length;
            break;
          }
          if (!placed) { /* left free this period \u2014 no subject could be placed without a clash */ }
        }
      }

      const short = Object.entries(needed).filter(([, n]) => n > 0);
      if (short.length) {
        warnings.push(cls.id + ': ' + short.map(([sub, n]) => n + ' \u00d7 ' + sub).join(', ') +
          ' period(s) could not be placed this week \u2014 likely not enough labs/teachers free at the same time. Add more labs or spread classes across more shifts.');
      }
      scheduledClasses++;
    }

    if (!rows.length) {
      return json({ error: 'Nothing could be scheduled \u2014 make sure classes have teachers assigned first.' }, 400);
    }

    const classIds = classes.map(c => c.id);
    const { error: delErr } = await admin.from('timetable').delete().in('class_id', classIds);
    if (delErr) return json({ error: 'Could not clear the old timetable: ' + delErr.message }, 500);

    const { error: insErr } = await admin.from('timetable').insert(rows);
    if (insErr) return json({ error: 'Could not save the new timetable: ' + insErr.message }, 500);

    return json({
      ok: true,
      shiftsUsed: cappedShifts,
      classesScheduled: scheduledClasses,
      periodsPlaced: rows.length,
      warnings
    });

  } catch (err) {
    console.error('generate-timetable crashed:', err);
    return json({ error: 'Something went wrong: ' + String((err as any)?.message ?? err) }, 500);
  }
});
