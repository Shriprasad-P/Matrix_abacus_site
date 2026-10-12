import assert from 'node:assert/strict';
import { test } from 'node:test';
import api from './netlify/functions/abacus-api.mts';

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
  assert.equal((await call('/api/videos', 'GET', null, student, true)).data.unlocked, false);
  for (let i = 0; i < 5; i++) {
    const challenge = await call('/api/challenges', 'POST', {}, student, true);
    const answer = await call('/api/challenges/' + challenge.data.id + '/answer', 'POST',
      { answer: challenge.data.target }, student, true);
    assert.equal(answer.data.correct, true);
    assert.equal(answer.data.promoted, i === 4);
    assert.equal((await call('/api/challenges/' + challenge.data.id + '/answer', 'POST',
      { answer: challenge.data.target }, student, true)).status, 409);
  }
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
  const videos = await call('/api/videos', 'GET', null, student, true);
  assert.equal(videos.data.unlocked, true);
  assert.equal(videos.data.configured, false);
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
  const worksheet = await call('/api/worksheets', 'POST',
    { title: 'Level one pilot', level: 'Level 1', questions: '100 + 5' }, admin);
  const attempt = await call('/api/worksheets/' + worksheet.data.id + '/submit', 'POST',
    { answers: [105] }, student, true);
  assert.equal(attempt.data.score, 1);
  const review = await call('/api/worksheets/' + attempt.data.id + '/review', 'PUT',
    { progress: 25, note: 'Good' }, admin);
  assert.equal(review.data.progress, 25);
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
});
