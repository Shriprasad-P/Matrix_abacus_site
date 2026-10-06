import type { Config, Context } from '@netlify/functions';
import { createHash, pbkdf2Sync, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const levels = ['Beginner', 'Level 1', 'Level 2', 'Level 3'];
const challengeRules: Record<string, [number, number, number]> = {
  Beginner: [1, 99, 60], 'Level 1': [100, 999, 50],
  'Level 2': [1000, 4999, 40], 'Level 3': [5000, 9999, 30]
};
const checkpoints = [0, 25, 50, 75, 100];
const now = () => new Date().toISOString();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const slotId = (slot: any) => `${slot.day}|${slot.start}|${slot.end}`;
const id = () => Date.now() * 1000 + randomInt(1000);
const col = (name: string) => database().collection(name);
const list = async (name: string) => (await col(name).get()).docs.map(doc => doc.data());
const one = async (name: string, key: string | number) => (await col(name).doc(String(key)).get()).data();
const put = async (name: string, value: any) => { await col(name).doc(String(value.id)).create(value); return value; };
const order = (items: any[]) => items.sort((a, b) => b.id - a.id);
const fail = (status: number, error: string) => { throw Object.assign(new Error(error), { status }); };
const required = (condition: boolean, message: string, status = 400) => { if (!condition) fail(status, message); };

function database() {
  if (!getApps().length) {
    if (process.env.FIRESTORE_EMULATOR_HOST) {
      initializeApp({ projectId: 'matrix-abacus' });
      return getFirestore();
    }
    const source = Netlify.env.get('FIREBASE_SERVICE_ACCOUNT_JSON');
    if (!source) fail(503, 'Institute database is not configured');
    const account = JSON.parse(source!);
    required(account.project_id === 'matrix-abacus', 'Wrong Firebase project configured', 503);
    initializeApp({ credential: cert(account) });
  }
  return getFirestore();
}

function reply(body: any, status = 200, origin = '', headers: Record<string, string> = {}) {
  const cors = ['capacitor://localhost', 'http://localhost'].includes(origin)
    ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS' } : {};
  return Response.json(body, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...cors, ...headers
  } });
}

async function input(req: Request) {
  required(req.headers.get('content-type')?.split(';')[0] === 'application/json', 'Expected JSON details.');
  const raw = await req.text();
  required(raw.length > 0 && raw.length <= 16384, 'Request is too large or empty.');
  let value;
  try { value = JSON.parse(raw); } catch { fail(400, 'Invalid JSON details.'); }
  required(value && typeof value === 'object' && !Array.isArray(value), 'Details must be an object.');
  return value;
}

async function identity(req: Request) {
  const cookie = req.headers.get('cookie')?.match(/(?:^|; )abacus_session=([^;]+)/)?.[1];
  const bearer = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  const token = bearer || cookie;
  if (!token) return null;
  const session = await one('abacus_sessions', hash(token));
  if (!session || session.expires <= Date.now()) return null;
  if (session.role === 'student') {
    const student = await one('abacus_students', session.student_id);
    if (!student || student.archived || student.access_version !== session.access_version) return null;
  }
  return session;
}

function requireRole(session: any, role?: string) {
  required(Boolean(session), 'Sign in required', 401);
  if (role) required(session.role === role, 'This portal cannot access that action', 403);
}

async function loginSlot(ip: string) {
  const ref = col('abacus_login_attempts').doc(hash(ip));
  return database().runTransaction(async tx => {
    const snap = await tx.get(ref);
    const previous = snap.data();
    const current = previous && previous.window_start > Date.now() - 900000
      ? previous : { failures: 0, window_start: Date.now() };
    required(current.failures < 10, 'Too many sign-in attempts. Try again later.', 429);
    tx.set(ref, { ...current, failures: current.failures + 1 });
  });
}

async function releaseLoginSlot(ip: string) {
  const ref = col('abacus_login_attempts').doc(hash(ip));
  await database().runTransaction(async tx => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.data()!.failures > 0)
      tx.update(ref, { failures: snap.data()!.failures - 1 });
  });
}

function matchSecret(a: string, b: string) {
  const x = Buffer.from(hash(a), 'hex'), y = Buffer.from(hash(b), 'hex');
  return timingSafeEqual(x, y);
}

async function login(req: Request, path: string, ip: string) {
  const data = await input(req);
  await loginSlot(ip);
  let role = 'admin', studentId: number | null = null, accessVersion: number | null = null;
  if (path.endsWith('/admin')) {
    const password = Netlify.env.get('ABACUS_ADMIN_PASSWORD');
    required(Boolean(password), 'Admin sign-in is not configured', 503);
    required(typeof data.password === 'string' && matchSecret(data.password, password!), 'Incorrect admin password', 401);
  } else {
    role = 'student';
    studentId = Number(data.student_id);
    const student = Number.isSafeInteger(studentId) && studentId > 0
      ? await one('abacus_students', studentId) : null;
    const candidate = typeof data.code === 'string' && student?.access_salt
      ? pbkdf2Sync(data.code, Buffer.from(student.access_salt, 'hex'), 200000, 32, 'sha256').toString('hex') : '';
    required(Boolean(student && !student.archived && student.access_hash && candidate &&
      timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(student.access_hash, 'hex'))),
      'Invalid student ID or access code', 401);
    accessVersion = student.access_version;
  }
  const token = randomBytes(32).toString('base64url');
  await col('abacus_sessions').doc(hash(token)).set({
    role, student_id: studentId, access_version: accessVersion, expires: Date.now() + 28800000
  });
  await releaseLoginSlot(ip);
  return { role, student_id: studentId, token };
}

function studentDetails(data: any) {
  const name = String(data.name || '').trim(), guardian = String(data.guardian || '').trim();
  const phone = String(data.phone || '').trim(), age = Number(data.age), level = String(data.level || '');
  required(name.length >= 1 && name.length <= 80 && guardian.length >= 1 && guardian.length <= 80,
    'Student and guardian names must be 1–80 characters.');
  required(Number.isInteger(age) && age >= 4 && age <= 18, 'Age must be a whole number from 4 to 18.');
  required(phone.length >= 7 && phone.length <= 20 && /^[+\d ()-]+$/.test(phone), 'Enter a valid phone number.');
  required(levels.includes(level), 'Choose a valid level.');
  return { name, guardian, phone, age, level };
}

function newCode() {
  const code = randomBytes(9).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  const digest = pbkdf2Sync(code, Buffer.from(salt, 'hex'), 200000, 32, 'sha256').toString('hex');
  return { code, salt, digest };
}

function feeDetails(data: any) {
  const label = String(data.label || '').trim(), amount = String(data.amount || '').trim();
  const upi_id = String(data.upi_id || '').trim(), instructions = String(data.instructions || '').trim();
  const due_date = String(data.due_date || '').trim();
  required(label.length >= 1 && label.length <= 80, 'Fee name must be 1–80 characters.');
  required(/^\d{1,7}(?:\.\d{1,2})?$/.test(amount) && Number(amount) > 0 &&
    Number(amount) <= 1000000, 'Enter an amount from ₹0.01 to ₹10,00,000.');
  required(!upi_id || (upi_id.length <= 100 && /^[\w.-]+@[\w.-]+$/.test(upi_id)), 'Enter a valid UPI ID.');
  required(instructions.length <= 300 && Boolean(upi_id || instructions),
    'Provide a UPI ID or bank payment instructions (up to 300 characters).');
  const date = new Date(due_date + 'T00:00:00Z');
  required(/^\d{4}-\d{2}-\d{2}$/.test(due_date) && !Number.isNaN(date.getTime()) &&
    date.toISOString().startsWith(due_date), 'Enter a valid payment due date.');
  return { label, amount_paise: Math.round(Number(amount) * 100), upi_id, instructions, due_date };
}

function worksheetDetails(data: any) {
  const title = String(data.title || '').trim(), level = String(data.level || '').trim();
  const lines = String(data.questions || '').trim().split(/\r?\n/);
  required(title.length >= 1 && title.length <= 80 &&
    (levels.includes(level) || level === 'All levels') && lines.length >= 1 && lines.length <= 12,
    'Enter a title, level, and 1–12 questions.');
  const questions = lines.map(line => {
    const match = line.match(/^\s*(\d{1,4})\s*([+-])\s*(\d{1,4})\s*$/);
    required(Boolean(match), 'Use one addition or subtraction question per line, such as 12 + 5.');
    const left = Number(match![1]), right = Number(match![3]);
    const answer = match![2] === '+' ? left + right : left - right;
    required(answer >= 0 && answer <= 9999, 'Each answer must be from 0 to 9999.');
    return { prompt: `${left} ${match![2]} ${right}`, answer };
  });
  return { title, level, questions };
}

function scheduleDetails(data: any) {
  required(typeof data.enabled === 'boolean' && Array.isArray(data.slots) &&
    data.slots.length <= 35, 'Choose whether scheduling is open and add up to 35 class times.');
  const slots = data.slots.map((slot: any) => {
    required(slot && typeof slot === 'object' && !Array.isArray(slot), 'Each class time needs a day, start, and end.');
    const day = slot.day, start = slot.start, end = slot.end;
    const capacity = slot.capacity ?? 12, instructor = String(slot.instructor || '').trim();
    required(Number.isInteger(day) && day >= 0 && day <= 6 &&
      typeof start === 'string' && typeof end === 'string' &&
      /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end) &&
      start < end && Number.isInteger(capacity) && capacity >= 1 && capacity <= 100 &&
      instructor.length <= 80, 'Choose a valid weekday, time, instructor, and capacity (1–100) for every class.');
    return { day, start, end, capacity, instructor };
  });
  required(new Set(slots.map(slotId)).size === slots.length, 'Remove duplicate class times.');
  required(!data.enabled || new Set(slots.map((slot: any) => slot.day)).size >= 2,
    'Offer classes on at least two different days before opening scheduling.');
  return { enabled: data.enabled, slots: slots.sort((a: any, b: any) =>
    a.day - b.day || a.start.localeCompare(b.start) || a.end.localeCompare(b.end)) };
}

async function getData(path: string, session: any) {
  requireRole(session);
  if (path === '/api/me') {
    if (session.role === 'admin') return { role: 'admin' };
    const student = await one('abacus_students', session.student_id);
    return { role: 'student', student: student && {
      id: student.id, name: student.name, age: student.age, level: student.level,
      progress: student.progress, mastery_streak: student.mastery_streak
    } };
  }
  if (path === '/api/students') {
    requireRole(session, 'admin');
    return order(await list('abacus_students')).map(({ access_salt, access_hash, first_fee_cycle_id, mastery_streak, ...student }) => student);
  }
  if (path === '/api/sessions') {
    const students = await list('abacus_students');
    return order((await list('abacus_practice_sessions')).filter(row =>
      session.role === 'admin' || row.student_id === session.student_id).map(row => {
      const student = students.find(item => item.id === row.student_id);
      return { ...row, student_name: student?.name || '', current_level: student?.level || '' };
    }));
  }
  if (path === '/api/schedule') {
    const settings = await one('abacus_settings', 'schedule') || { enabled: false, slots: [] };
    const students = (await list('abacus_students')).filter(student => !student.archived);
    const selections = await list('abacus_student_schedules');
    const bookings = new Map<string, number>();
    for (const choice of selections) if (students.some(student => student.id === choice.student_id))
      for (const slot of choice.selection) bookings.set(slotId(slot), (bookings.get(slotId(slot)) || 0) + 1);
    const slots = settings.slots.map((slot: any) => ({ ...slot, booked: bookings.get(slotId(slot)) || 0 }));
    if (session.role === 'admin') return {
      enabled: settings.enabled, slots,
      students: students.sort((a, b) => a.name.localeCompare(b.name)).map(student => {
        const choice = selections.find(item => item.student_id === student.id);
        return { student_id: student.id, name: student.name,
          selection: choice?.selection || [], updated_at: choice?.updated_at || null };
      })
    };
    const choice = selections.find(item => item.student_id === session.student_id);
    return { enabled: settings.enabled, slots, selection: choice?.selection || [], updated_at: choice?.updated_at || null };
  }
  if (path === '/api/fees') {
    const allCycles = order(await list('abacus_fee_cycles'));
    const allPayments = order(await list('abacus_fee_payments'));
    if (session.role === 'admin') {
      const students = await list('abacus_students');
      return { cycles: allCycles, history: [], payments: allCycles.flatMap(cycle =>
        students.filter(student => cycle.id >= student.first_fee_cycle_id).map(student => {
          const payment = allPayments.find(item => item.cycle_id === cycle.id && item.student_id === student.id);
          return { cycle_id: cycle.id, student_id: student.id, student_name: student.name,
            archived: student.archived ? 1 : 0, payment_id: payment?.id || null,
            reference: payment?.reference || null, status: payment?.status || null,
            submitted_at: payment?.submitted_at || null, reviewed_at: payment?.reviewed_at || null,
            admin_note: payment?.admin_note || null };
        })) };
    }
    const student = await one('abacus_students', session.student_id);
    const cycles = allCycles.filter(cycle => cycle.id >= student!.first_fee_cycle_id);
    const mine = allPayments.filter(payment => payment.student_id === session.student_id);
    return { cycles, payments: cycles.map(cycle => {
      const payment = mine.find(item => item.cycle_id === cycle.id);
      return { cycle_id: cycle.id, payment_id: payment?.id || null, reference: payment?.reference || null,
        status: payment?.status || null, submitted_at: payment?.submitted_at || null,
        reviewed_at: payment?.reviewed_at || null, admin_note: payment?.admin_note || null };
    }), history: mine.map(payment => {
      const cycle = cycles.find(item => item.id === payment.cycle_id);
      return { ...payment, label: cycle?.label, amount_paise: cycle?.amount_paise, due_date: cycle?.due_date };
    }) };
  }
  if (path === '/api/worksheets') {
    const student = session.role === 'student' ? await one('abacus_students', session.student_id) : null;
    const all = order(await list('abacus_worksheets'));
    const visible = session.role === 'admin' ? all : all.filter(item =>
      item.level === 'All levels' || item.level === student?.level);
    const students = session.role === 'admin' ? await list('abacus_students') : [];
    const attempts = order((await list('abacus_worksheet_attempts')).filter(item =>
      session.role === 'admin' || item.student_id === session.student_id));
    return { worksheets: visible.map(({ questions, ...item }) => ({
      ...item, questions: questions.map((question: any) => ({ prompt: question.prompt }))
    })), attempts: attempts.map(attempt => {
      const worksheet = all.find(item => item.id === attempt.worksheet_id);
      const answers = attempt.answers;
      const { answers: hidden, ...row } = attempt;
      return { ...row, title: worksheet?.title || '', current_level: students.find(item =>
        item.id === attempt.student_id)?.level, student_name: students.find(item =>
        item.id === attempt.student_id)?.name,
        attempt_number: attempts.filter(item => item.student_id === attempt.student_id &&
          item.worksheet_id === attempt.worksheet_id && item.id <= attempt.id).length,
        correctness: worksheet?.questions.map((question: any, index: number) =>
          answers[index] === question.answer) || [],
        ...(session.role === 'admin' ? { answers } : {}) };
    }) };
  }
  fail(404, 'Not found');
}

async function postData(path: string, req: Request, session: any): Promise<[any, number]> {
  requireRole(session);
  if (path === '/api/students') {
    requireRole(session, 'admin');
    const details = studentDetails(await input(req));
    const { code, salt, digest } = newCode();
    const student = await database().runTransaction(async tx => {
      const countRef = col('abacus_settings').doc('student_counter');
      const feeRef = col('abacus_settings').doc('fee');
      const count = (await tx.get(countRef)).data();
      const fee = (await tx.get(feeRef)).data();
      const studentId = count?.next || 1001;
      const value = { id: studentId, ...details, progress: 0, mastery_streak: 0, archived: false,
        access_salt: salt, access_hash: digest, access_version: 1,
        first_fee_cycle_id: fee?.current_id || 0, created_at: now(), active_challenge_id: null };
      tx.create(col('abacus_students').doc(String(studentId)), value);
      tx.set(countRef, { next: studentId + 1 });
      return value;
    });
    const { access_salt, access_hash, access_version, first_fee_cycle_id, active_challenge_id, ...publicStudent } = student;
    return [{ ...publicStudent, access_code: code }, 201];
  }
  if (path === '/api/fees') {
    requireRole(session, 'admin');
    const details = feeDetails(await input(req));
    const cycle = { id: id(), ...details, active: 1, created_at: now() };
    await database().runTransaction(async tx => {
      const settingsRef = col('abacus_settings').doc('fee');
      const settings = await tx.get(settingsRef);
      const previousRef = settings.data()?.current_id ? col('abacus_fee_cycles').doc(String(settings.data()!.current_id)) : null;
      const previous = previousRef ? await tx.get(previousRef) : null;
      if (previous?.exists) tx.update(previousRef!, { active: 0 });
      tx.create(col('abacus_fee_cycles').doc(String(cycle.id)), cycle);
      tx.set(settingsRef, { current_id: cycle.id });
    });
    return [cycle, 201];
  }
  if (path === '/api/worksheets') {
    requireRole(session, 'admin');
    const details = worksheetDetails(await input(req));
    const worksheet = await put('abacus_worksheets', { id: id(), ...details, created_at: now() });
    return [{ id: worksheet.id, title: worksheet.title }, 201];
  }
  if (path === '/api/challenges') {
    requireRole(session, 'student');
    const challengeId = id();
    const result = await database().runTransaction(async tx => {
      const studentRef = col('abacus_students').doc(String(session.student_id));
      const snap = await tx.get(studentRef);
      const student = snap.data();
      required(Boolean(student && !student.archived), 'Student account is archived', 401);
      const [minimum, maximum, duration] = challengeRules[student!.level];
      const started = Date.now();
      const challenge = { id: challengeId, student_id: session.student_id, target: randomInt(minimum, maximum + 1),
        level_at_start: student!.level, duration_seconds: duration, started_at: started,
        deadline_at: started + duration * 1000, completed_at: null };
      tx.create(col('abacus_challenges').doc(String(challengeId)), challenge);
      tx.update(studentRef, { active_challenge_id: challengeId });
      return { id: challengeId, target: challenge.target, level: student!.level,
        duration_seconds: duration, mastery_streak: student!.mastery_streak, mastery_required: 5 };
    });
    return [result, 201];
  }
  const match = path.match(/^\/api\/(challenges|worksheets|fees|students)\/(\d+)\/(answer|submit|reset-code|archive)$/);
  if (!match) {
    if (path === '/api/sessions') fail(410, 'Start a timed challenge before submitting practice.');
    fail(404, 'Not found');
  }
  const [, kind, rawId, action] = match, itemId = Number(rawId);
  required(Number.isSafeInteger(itemId) && itemId > 0, 'Invalid item ID');
  if (kind === 'challenges' && action === 'answer') {
    requireRole(session, 'student');
    const { answer } = await input(req);
    required(Number.isInteger(answer) && answer >= 0 && answer <= 9999, 'Answer must be a number from 0 to 9999.');
    const sessionId = id();
    const result = await database().runTransaction(async tx => {
      const challengeRef = col('abacus_challenges').doc(String(itemId));
      const studentRef = col('abacus_students').doc(String(session.student_id));
      const challenge = (await tx.get(challengeRef)).data();
      const student = (await tx.get(studentRef)).data();
      required(Boolean(challenge && challenge.student_id === session.student_id), 'Challenge not found', 404);
      required(challenge!.completed_at === null && student?.active_challenge_id === itemId,
        'This challenge has already ended', 409);
      required(challenge!.level_at_start === student!.level, 'Student level changed. Start a new challenge.', 409);
      const finished = Date.now(), correct = answer === challenge!.target;
      const onTime = finished <= challenge!.deadline_at;
      const streak = correct && onTime ? Math.min(5, student!.mastery_streak + 1) : 0;
      const promoted = streak >= 5 && student!.level !== levels[levels.length - 1];
      const nextLevel = promoted ? levels[levels.indexOf(student!.level) + 1] : student!.level;
      const elapsed = Math.round((finished - challenge!.started_at) / 100) / 10;
      tx.update(challengeRef, { completed_at: finished });
      tx.update(studentRef, { level: nextLevel, progress: promoted ? 0 : student!.progress,
        mastery_streak: promoted ? 0 : streak, active_challenge_id: null });
      tx.create(col('abacus_practice_sessions').doc(String(sessionId)), {
        id: sessionId, student_id: session.student_id, target: challenge!.target, answer,
        correct: correct ? 1 : 0, level_at_attempt: challenge!.level_at_start,
        duration_seconds: challenge!.duration_seconds, elapsed_seconds: elapsed, on_time: onTime ? 1 : 0,
        auto_promoted: promoted ? 1 : 0, reviewed_progress: promoted ? 100 : null,
        admin_note: promoted ? 'Promoted after five correct timed challenges' : '',
        created_at: now(), reviewed_at: null
      });
      return { session_id: sessionId, correct, on_time: onTime, promoted, level: nextLevel,
        mastery_streak: promoted ? 0 : streak, mastery_required: 5, elapsed_seconds: elapsed };
    });
    return [result, 201];
  }
  if (kind === 'worksheets' && action === 'submit') {
    requireRole(session, 'student');
    const { answers } = await input(req);
    required(Array.isArray(answers) && answers.every(item => Number.isInteger(item) && item >= 0 && item <= 9999),
      'Answer every question with a number from 0 to 9999.');
    const attemptId = id();
    const result = await database().runTransaction(async tx => {
      const worksheet = (await tx.get(col('abacus_worksheets').doc(String(itemId)))).data();
      const student = (await tx.get(col('abacus_students').doc(String(session.student_id)))).data();
      const countRef = col('abacus_attempt_counts').doc(`${itemId}_${session.student_id}`);
      const count = (await tx.get(countRef)).data()?.count || 0;
      required(Boolean(worksheet && (worksheet.level === 'All levels' || worksheet.level === student?.level)),
        'Worksheet not found for your level', 404);
      required(answers.length === worksheet!.questions.length, 'Answer every question.');
      required(count < 3, 'This worksheet has reached its three-attempt limit', 409);
      const correctness = worksheet!.questions.map((question: any, index: number) => answers[index] === question.answer);
      const score = correctness.filter(Boolean).length;
      tx.set(countRef, { count: count + 1 });
      tx.create(col('abacus_worksheet_attempts').doc(String(attemptId)), {
        id: attemptId, worksheet_id: itemId, student_id: session.student_id, answers, score,
        total: worksheet!.questions.length, level_at_attempt: student!.level,
        reviewed_progress: null, admin_note: '', submitted_at: now(), reviewed_at: null
      });
      return { id: attemptId, score, total: worksheet!.questions.length, correctness };
    });
    return [result, 201];
  }
  if (kind === 'fees' && action === 'submit') {
    requireRole(session, 'student');
    const reference = String((await input(req)).reference || '').trim().toUpperCase();
    required(/^[A-Z0-9][A-Z0-9_/-]{5,59}$/.test(reference), 'Enter a 6–60 character UPI or bank reference.');
    const paymentId = id();
    const result = await database().runTransaction(async tx => {
      const cycle = (await tx.get(col('abacus_fee_cycles').doc(String(itemId)))).data();
      const student = (await tx.get(col('abacus_students').doc(String(session.student_id)))).data();
      const latestRef = col('abacus_payment_latest').doc(`${session.student_id}_${itemId}`);
      const latest = (await tx.get(latestRef)).data();
      const referenceRef = col('abacus_payment_references').doc(reference);
      const used = await tx.get(referenceRef);
      required(Boolean(cycle && student && itemId >= student.first_fee_cycle_id),
        'Fee not available for this student', 404);
      required(!latest || latest.status === 'rejected', 'This payment is already submitted or confirmed', 409);
      required(!used.exists, 'This reference has already been submitted', 409);
      const payment = { id: paymentId, cycle_id: itemId, student_id: session.student_id, reference,
        status: 'pending', submitted_at: now(), reviewed_at: null, admin_note: '' };
      tx.create(col('abacus_fee_payments').doc(String(paymentId)), payment);
      tx.create(referenceRef, { payment_id: paymentId });
      tx.set(latestRef, { payment_id: paymentId, status: 'pending' });
      return payment;
    });
    return [result, 201];
  }
  if (kind === 'students' && (action === 'reset-code' || action === 'archive')) {
    requireRole(session, 'admin');
    const ref = col('abacus_students').doc(String(itemId));
    if (action === 'reset-code') {
      const { code, salt, digest } = newCode();
      await database().runTransaction(async tx => {
        const student = (await tx.get(ref)).data();
        required(Boolean(student), 'Student not found', 404);
        tx.update(ref, { access_salt: salt, access_hash: digest, access_version: student!.access_version + 1 });
      });
      return [{ student_id: itemId, access_code: code }, 200];
    }
    const { archived } = await input(req);
    required(typeof archived === 'boolean', 'Choose archive or restore.');
    await database().runTransaction(async tx => {
      const student = (await tx.get(ref)).data();
      required(Boolean(student), 'Student not found', 404);
      const choice = (await tx.get(col('abacus_student_schedules').doc(String(itemId)))).data();
      const slots = archived === student!.archived ? [] : (choice?.selection || []);
      const counts = [];
      for (const slot of slots) {
        const slotRef = col('abacus_slot_counts').doc(hash(slotId(slot)));
        counts.push({ ref: slotRef, count: (await tx.get(slotRef)).data()?.count || 0 });
      }
      tx.update(ref, { archived, access_version: archived ? student!.access_version + 1 : student!.access_version });
      counts.forEach(item => tx.set(item.ref, { count: Math.max(0, item.count + (archived ? -1 : 1)) }));
    });
    return [{ archived }, 200];
  }
  fail(404, 'Not found');
}

async function putData(path: string, req: Request, session: any): Promise<any> {
  requireRole(session);
  if (path === '/api/schedule/settings') {
    requireRole(session, 'admin');
    const settings = scheduleDetails(await input(req));
    await col('abacus_settings').doc('schedule').set(settings);
    return settings;
  }
  if (path === '/api/schedule/my') {
    requireRole(session, 'student');
    const { slot_ids } = await input(req);
    required(Array.isArray(slot_ids) && slot_ids.length === 2 &&
      slot_ids.every(item => typeof item === 'string') && new Set(slot_ids).size === 2,
      'Choose exactly two class times on different days.');
    return database().runTransaction(async tx => {
      const settings = (await tx.get(col('abacus_settings').doc('schedule'))).data();
      required(Boolean(settings?.enabled), 'Class scheduling is closed by the institute.', 409);
      const available = new Map(settings!.slots.map((slot: any) => [slotId(slot), slot]));
      required(slot_ids.every((key: string) => available.has(key)),
        'A class time is no longer available. Refresh and choose again.', 409);
      const selected: any[] = slot_ids.map((key: string) => available.get(key));
      required(selected[0].day !== selected[1].day, 'Choose classes on two different days.');
      const choiceRef = col('abacus_student_schedules').doc(String(session.student_id));
      const old = (await tx.get(choiceRef)).data()?.selection || [];
      const keys = [...new Set([...old.map(slotId), ...slot_ids])].sort();
      const counts = new Map<string, { ref: any, count: number }>();
      for (const key of keys) {
        const ref = col('abacus_slot_counts').doc(hash(key));
        counts.set(key, { ref, count: (await tx.get(ref)).data()?.count || 0 });
      }
      for (const key of slot_ids) {
        const entry = counts.get(key)!;
        const effective = entry.count - (old.some((slot: any) => slotId(slot) === key) ? 1 : 0);
        required(effective < (available.get(key) as any).capacity,
          'A class is full. Refresh and choose another time.', 409);
      }
      for (const key of keys) {
        const prior = old.some((slot: any) => slotId(slot) === key) ? 1 : 0;
        const next = slot_ids.includes(key) ? 1 : 0;
        if (prior !== next) tx.set(counts.get(key)!.ref, { count: Math.max(0, counts.get(key)!.count + next - prior) });
      }
      selected.sort((a, b) => a.day - b.day || a.start.localeCompare(b.start));
      tx.set(choiceRef, { student_id: session.student_id, selection: selected, updated_at: now() });
      return { selection: selected };
    });
  }
  const studentMatch = path.match(/^\/api\/students\/(\d+)$/);
  if (studentMatch) {
    requireRole(session, 'admin');
    const studentId = Number(studentMatch[1]);
    required(Number.isSafeInteger(studentId), 'Invalid student ID');
    const details = studentDetails(await input(req));
    const ref = col('abacus_students').doc(String(studentId));
    await database().runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      required(Boolean(current), 'Student not found', 404);
      tx.update(ref, { ...details, progress: details.level === current!.level ? current!.progress : 0,
        mastery_streak: details.level === current!.level ? current!.mastery_streak : 0,
        active_challenge_id: details.level === current!.level ? current!.active_challenge_id : null });
    });
    return { id: studentId };
  }
  const reviewMatch = path.match(/^\/api\/(sessions|worksheets|fees)\/(\d+)\/review$/);
  if (!reviewMatch) fail(404, 'Not found');
  requireRole(session, 'admin');
  const [, kind, rawId] = reviewMatch, itemId = Number(rawId);
  required(Number.isSafeInteger(itemId), 'Invalid item ID');
  const data = await input(req);
  if (kind === 'fees') {
    const status = data.status, note = String(data.note || '').trim();
    required(['paid', 'rejected'].includes(status) && note.length <= 300,
      'Choose paid or rejected and keep the note under 300 characters.');
    required(status !== 'paid' || data.bank_verified === true,
      'Confirm that the bank or UPI statement matches before marking paid.');
    return database().runTransaction(async tx => {
      const ref = col('abacus_fee_payments').doc(String(itemId));
      const payment = (await tx.get(ref)).data();
      required(Boolean(payment && payment.status === 'pending'), 'Only pending payments can be reviewed', 409);
      tx.update(ref, { status, admin_note: note, reviewed_at: now() });
      tx.set(col('abacus_payment_latest').doc(`${payment!.student_id}_${payment!.cycle_id}`),
        { payment_id: itemId, status });
      return { status };
    });
  }
  const progress = Number(data.progress), note = String(data.note || '').trim();
  required(checkpoints.includes(progress) && note.length <= 500,
    'Choose a checkpoint from 0 to 100 and keep the note under 500 characters.');
  const collection = kind === 'sessions' ? 'abacus_practice_sessions' : 'abacus_worksheet_attempts';
  return database().runTransaction(async tx => {
    const ref = col(collection).doc(String(itemId));
    const result = (await tx.get(ref)).data();
    required(Boolean(result), kind === 'sessions' ? 'Practice session not found' : 'Worksheet result not found', 404);
    const studentRef = col('abacus_students').doc(String(result!.student_id));
    const student = (await tx.get(studentRef)).data();
    required(result!.level_at_attempt === student?.level,
      'This result belongs to an earlier or unverified level. Current progress was not changed.', 409);
    const actual = Math.max(student!.progress, progress);
    tx.update(ref, { reviewed_progress: progress, admin_note: note, reviewed_at: now() });
    tx.update(studentRef, { progress: actual });
    return { student_id: result!.student_id, progress: actual, ...(kind === 'sessions' ? { session_id: itemId } : {}) };
  });
}

export default async (req: Request, context: Context) => {
  const origin = req.headers.get('origin') || '';
  const path = new URL(req.url).pathname;
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
    ...(['capacitor://localhost', 'http://localhost'].includes(origin)
      ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
  } });
  if (req.method !== 'GET' && origin && ![new URL(req.url).origin, 'capacitor://localhost', 'http://localhost'].includes(origin))
    return reply({ error: 'Request origin not allowed' }, 403, origin);
  try {
    if (req.method === 'POST' && ['/api/login/admin', '/api/login/student'].includes(path)) {
      const result = await login(req, path, context.ip);
      if (origin === 'capacitor://localhost' || origin === 'http://localhost') return reply(result, 200, origin);
      const { token, ...body } = result;
      return reply(body, 200, origin, { 'Set-Cookie': `abacus_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800` });
    }
    const session = await identity(req);
    if (req.method === 'GET') return reply(await getData(path, session), 200, origin);
    if (req.method === 'POST' && path === '/api/logout') {
      const cookie = req.headers.get('cookie')?.match(/(?:^|; )abacus_session=([^;]+)/)?.[1];
      const bearer = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
      if (cookie) await col('abacus_sessions').doc(hash(cookie)).delete();
      if (bearer) await col('abacus_sessions').doc(hash(bearer)).delete();
      return reply({ signed_out: true }, 200, origin, { 'Set-Cookie': 'abacus_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0' });
    }
    if (req.method === 'POST') {
      const [body, status] = await postData(path, req, session);
      return reply(body, status, origin);
    }
    if (req.method === 'PUT') return reply(await putData(path, req, session), 200, origin);
    return reply({ error: 'Not implemented' }, 501, origin);
  } catch (error: any) {
    const status = Number(error.status) || 500;
    if (status >= 500) console.error(error);
    return reply({ error: status >= 500 ? 'Institute service unavailable' : error.message }, status, origin);
  }
};

export const config: Config = { path: '/api/*', excludedPath: '/api/media/*' };

export { feeDetails, worksheetDetails, scheduleDetails };
