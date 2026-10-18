import assert from 'node:assert/strict';
import { test } from 'node:test';
import api from './netlify/functions/abacus-api.mts';
import { getFirestore } from 'firebase-admin/firestore';

test('admin and student flows keep scoring, seats, and payments on the server', {
  skip: !process.env.FIRESTORE_EMULATOR_HOST
}, async () => {
  globalThis.Netlify = { env: { get: key => key === 'ABACUS_ADMIN_PASSWORD' ? 'local-test-password' : undefined } };
  const base = 'https://matrixabacus.com';
  async function call(path, method = 'GET', body, token, mobile = false) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers[mobile ? 'Authorization' : 'Cookie'] = mobile
      ? 'Bearer ' + token : 'abacus_session=' + token;
    if (mobile) headers.Origin = 'capacitor://localhost';
    const response = await api(new Request(base + path, {
      method, headers, body: body && JSON.stringify(body)
    }), { ip: '192.0.2.123' });
    const data = await response.json();
    assert.ok(response.status < 500, `${path}: ${data.error || response.status}`);
    return { status: response.status, data, response };
  }
  const adminLogin = await call('/api/login/admin', 'POST', { password: 'local-test-password' });
  assert.equal(adminLogin.status, 200);
  const admin = adminLogin.response.headers.get('set-cookie').match(/abacus_session=([^;]+)/)[1];
  const added = await call('/api/students', 'POST', {
    name: 'Pilot Student', age: 9, guardian: 'Pilot Guardian', phone: '9999999999', level: 'Beginner'
  }, admin);
  assert.equal(added.status, 201);
  const studentId = added.data.id;
  assert.equal(added.data.access_code, undefined);
  assert.equal((await call('/api/login/student', 'POST',
    { phone: '9999999999', password: '0000000000' }, null, true)).status, 401);
  assert.equal((await call('/api/login/student', 'POST',
    { phone: '7777777777', password: '7777777777' }, null, true)).status, 401);
  const studentLogin = await call('/api/login/student', 'POST',
    { phone: '9999999999', password: '9999999999' }, null, true);
  assert.equal(studentLogin.status, 200);
  const student = studentLogin.data.token;
  assert.equal((await call('/api/videos', 'GET', null, student, true)).data.videos.length, 0);
  for (let i = 0; i < 5; i++) {
    const challenge = await call('/api/challenges', 'POST', {}, student, true);
    const answer = await call('/api/challenges/' + challenge.data.id + '/answer', 'POST',
      { answer: challenge.data.target }, student, true);
    assert.equal(answer.data.correct, true);
    assert.equal(answer.data.promoted, i === 4);
    assert.equal((await call('/api/challenges/' + challenge.data.id + '/answer', 'POST',
      { answer: challenge.data.target }, student, true)).status, 409);
  }
  const recent = await call('/api/sessions', 'GET', null, admin);
  assert.equal(recent.data.length, 5);
  assert.equal((await call('/api/sessions?before=' + recent.data.at(-1).id,
    'GET', null, admin)).data.length, 0);
  assert.equal((await call('/api/sessions?before=invalid', 'GET', null, admin)).status, 400);
  const me = await call('/api/me', 'GET', null, student, true);
  assert.equal(me.data.student.level, 'Level 1');
  const fee = await call('/api/fees', 'POST', {
    label: 'Pilot fee', amount: '100.00', due_date: '2026-10-31', upi_id: 'school@upi'
  }, admin);
  const payment = await call('/api/fees/' + fee.data.id + '/submit', 'POST',
    { reference: 'PILOT' + Date.now() }, student, true);
  assert.equal(payment.data.status, 'pending');
  assert.equal((await call('/api/fees/' + fee.data.id + '/submit', 'POST',
    { reference: 'PILOT' + Date.now() }, student, true)).status, 409);
  const denied = await call('/api/fees/' + payment.data.id + '/review', 'PUT',
    { status: 'paid', bank_verified: false }, admin);
  assert.equal(denied.status, 400);
  const paid = await call('/api/fees/' + payment.data.id + '/review', 'PUT',
    { status: 'paid', bank_verified: true }, admin);
  assert.equal(paid.data.status, 'paid');
  const adminFees = await call('/api/fees', 'GET', null, admin);
  assert.equal(adminFees.data.cycles.find(cycle => cycle.id === fee.data.id).active, 1);
  assert.equal(adminFees.data.payments.find(row => row.student_id === studentId).status, 'paid');
  const videos = await call('/api/videos', 'GET', null, student, true);
  assert.equal(videos.data.videos.length, 0);
  assert.equal(videos.data.configured, false);
  const offer = await call('/api/video-offers/level-1', 'PUT',
    { level: 'Level 1', amount: '499.00', upi_id: 'school@upi' }, admin);
  assert.equal(offer.data.amount_paise, 49900);
  const purchase = await call('/api/video-orders', 'POST',
    { level: 'Level 1', reference: 'COURSE' + Date.now() }, student, true);
  assert.equal(purchase.data.status, 'pending');
  assert.equal((await call('/api/video-orders', 'POST',
    { level: 'Level 1', reference: 'COURSE2' + Date.now() }, student, true)).status, 409);
  assert.equal((await call('/api/video-orders/' + purchase.data.id + '/review', 'PUT',
    { status: 'paid', bank_verified: false }, admin)).status, 400);
  const verified = await call('/api/video-orders/' + purchase.data.id + '/review', 'PUT',
    { status: 'paid', bank_verified: true }, admin);
  assert.equal(verified.data.status, 'paid');
  assert.ok(verified.data.access_expires_at > Date.now());
  const courses = await call('/api/video-courses', 'GET', null, student, true);
  assert.equal(courses.data.courses.find(item => item.level === 'Level 1').active, true);
  assert.equal(courses.data.courses.find(item => item.level === 'Beginner').active, false);
  assert.equal((await call('/api/final-tests', 'POST', { level: 'Level 1' }, student, true)).status, 409);
  assert.equal((await call('/api/certificates', 'GET', null, student, true)).data.length, 0);
  const finalId = Date.now() * 1000 + 717;
  await getFirestore().collection('abacus_final_tests').doc(String(finalId)).create({
    id: finalId, student_id: studentId, level: 'Level 1', index: 4, correct: 4,
    target: 777, deadline_at: Date.now() + 30000, finished_at: null, passed: false
  });
  const finalAnswer = await call('/api/final-tests/' + finalId + '/answer', 'POST',
    { answer: 777 }, student, true);
  assert.equal(finalAnswer.data.passed, true);
  assert.equal((await call('/api/certificates', 'GET', null, student, true)).data.length, 1);
  const certPath = '/api/certificates/' + finalAnswer.data.certificate_id + '.svg';
  const certificate = await api(new Request(base + certPath, {
    headers: { Authorization: 'Bearer ' + student, Origin: 'capacitor://localhost' }
  }), { ip: '192.0.2.123' });
  assert.equal(certificate.status, 200);
  assert.match(await certificate.text(), /Certificate of Completion/);
  assert.equal((await call(certPath, 'GET', null, null, false)).status, 401);
  const slots = [
    { day: 1, start: '16:00', end: '17:00', capacity: 1 },
    { day: 3, start: '16:00', end: '17:00', capacity: 1 }
  ];
  await call('/api/schedule/settings', 'PUT', { enabled: true, slots }, admin);
  const booked = await call('/api/schedule/my', 'PUT',
    { slot_ids: ['1|16:00|17:00', '3|16:00|17:00'] }, student, true);
  assert.equal(booked.data.selection.length, 2);
  const second = await call('/api/students', 'POST', {
    name: 'Second Pilot', age: 9, guardian: 'Second Guardian', phone: '8888888888', level: 'Beginner'
  }, admin);
  const secondLogin = await call('/api/login/student', 'POST',
    { phone: '8888888888', password: '8888888888' }, null, true);
  assert.equal((await call('/api/schedule/my', 'PUT',
    { slot_ids: ['1|16:00|17:00', '3|16:00|17:00'] }, secondLogin.data.token, true)).status, 409);
  await call('/api/schedule/settings', 'PUT', { enabled: true, slots: [slots[1],
    { day: 5, start: '16:00', end: '17:00', capacity: 1 }] }, admin);
  assert.equal((await call('/api/schedule', 'GET', null, admin)).data.students
    .find(item => item.student_id === studentId).selection.length, 2);
  assert.equal((await call('/api/schedule/students/' + studentId + '/clear', 'POST', null, admin)).status, 200);
  const cleared = await call('/api/schedule', 'GET', null, student, true);
  assert.equal(cleared.data.needs_rescheduling, true);
  assert.equal(cleared.data.selection.length, 0);
  const rescheduled = await call('/api/schedule/my', 'PUT',
    { slot_ids: ['3|16:00|17:00', '5|16:00|17:00'] }, student, true);
  assert.equal(rescheduled.data.selection.length, 2);
  const worksheet = await call('/api/worksheets', 'POST',
    { title: 'Level one pilot', level: 'Level 1', questions: '100 + 5' }, admin);
  const attempt = await call('/api/worksheets/' + worksheet.data.id + '/submit', 'POST',
    { answers: [105] }, student, true);
  assert.equal(attempt.data.score, 1);
  const review = await call('/api/worksheets/' + attempt.data.id + '/review', 'PUT',
    { progress: 25, note: 'Good' }, admin);
  assert.equal(review.data.progress, 25);
  const lowerReview = await call('/api/worksheets/' + attempt.data.id + '/review', 'PUT',
    { progress: 0, note: 'Keep practicing' }, admin);
  assert.equal(lowerReview.data.progress, 25);
  const adminWorksheets = await call('/api/worksheets', 'GET', null, admin);
  assert.equal(adminWorksheets.data.attempts.find(item => item.id === attempt.data.id).attempt_number, 1);
  assert.equal((await call('/api/worksheets', 'GET', null, student, true)).data.attempts
    .find(item => item.id === attempt.data.id).reviewed_progress, 25);
  const sibling = await call('/api/students', 'POST', {
    name: 'Sibling Pilot', age: 7, guardian: 'Pilot Guardian', phone: '9999999999', level: 'Beginner'
  }, admin);
  const choice = await call('/api/login/student', 'POST',
    { phone: '9999999999', password: '9999999999' }, null, true);
  assert.equal(choice.data.choose_student, true);
  assert.equal(choice.data.token, undefined);
  assert.deepEqual(choice.data.students.map(item => item.id).sort(), [studentId, sibling.data.id].sort());
  assert.equal((await call('/api/login/student', 'POST',
    { phone: '9999999999', password: '9999999999', student_id: second.data.id }, null, true)).status, 401);
  const siblingLogin = await call('/api/login/student', 'POST',
    { phone: '9999999999', password: '9999999999', student_id: sibling.data.id }, null, true);
  assert.equal(siblingLogin.status, 200);
  assert.equal((await call('/api/me', 'GET', null, siblingLogin.data.token, true)).data.student.id, sibling.data.id);
  await call('/api/students/' + studentId, 'PUT', {
    name: 'Pilot Student', age: 9, guardian: 'Pilot Guardian', phone: '7777777777', level: 'Level 1'
  }, admin);
  assert.equal((await call('/api/me', 'GET', null, student, true)).status, 401);
  assert.equal((await call('/api/login/student', 'POST',
    { phone: '9999999999', password: '9999999999', student_id: studentId }, null, true)).status, 401);
  const updatedLogin = await call('/api/login/student', 'POST',
    { phone: '7777777777', password: '7777777777' }, null, true);
  assert.equal(updatedLogin.status, 200);
  await call('/api/students/' + studentId + '/archive', 'POST', { archived: true }, admin);
  assert.equal((await call('/api/me', 'GET', null, updatedLogin.data.token, true)).status, 401);
  const batch = getFirestore().batch();
  const seed = Date.now() * 1000 + 10000;
  for (let index = 0; index < 101; index++) {
    const sessionId = seed + index;
    batch.create(getFirestore().collection('abacus_practice_sessions').doc(String(sessionId)), {
      id: sessionId, student_id: studentId, target: 1, answer: 1, correct: true,
      level_at_attempt: 'Beginner', reviewed_progress: 25
    });
    batch.create(getFirestore().collection('abacus_worksheet_attempts').doc(String(sessionId)), {
      id: sessionId, worksheet_id: worksheet.data.id, student_id: studentId,
      answers: [105], score: 1, total: 1, level_at_attempt: 'Level 1',
      reviewed_progress: 25, attempt_number: 1
    });
  }
  await batch.commit();
  const firstPage = await call('/api/sessions', 'GET', null, admin);
  assert.equal(firstPage.data.length, 100);
  const olderPage = await call('/api/sessions?before=' + firstPage.data.at(-1).id,
    'GET', null, admin);
  assert.equal(olderPage.data.length, 6);
  const worksheetPage = await call('/api/worksheets', 'GET', null, admin);
  assert.equal(worksheetPage.data.attempts.length, 100);
  assert.equal(worksheetPage.data.has_more_attempts, true);
  assert.equal((await call('/api/worksheets?before=' + worksheetPage.data.next_cursor,
    'GET', null, admin)).data.attempts.length, 2);
});
