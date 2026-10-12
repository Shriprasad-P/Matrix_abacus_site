import assert from 'node:assert/strict';
import { test } from 'node:test';
import { feeDetails, worksheetDetails, scheduleDetails, videoEntitlement, videoRange } from './netlify/functions/abacus-api.mts';

test('fee and worksheet input cannot create invalid records', () => {
  assert.equal(feeDetails({ label: 'October', amount: '0.01', upi_id: 'school@upi', due_date: '2026-10-31' }).amount_paise, 1);
  assert.throws(() => feeDetails({ label: 'October', amount: '10.00', upi_id: 'school@upi', due_date: '2026-02-31' }));
  assert.throws(() => feeDetails({ label: 'October', amount: '0', upi_id: 'school@upi', due_date: '2026-10-31' }));
  assert.deepEqual(worksheetDetails({ title: 'Basics', level: 'Beginner', questions: '12 + 5\n9 - 3' }).questions
    .map(item => item.answer), [17, 6]);
  assert.throws(() => worksheetDetails({ title: 'Bad', level: 'Beginner', questions: '1 - 9' }));
});

test('open scheduling requires two distinct days and unique slots', () => {
  const slots = [
    { day: 1, start: '16:00', end: '17:00', capacity: 12 },
    { day: 3, start: '16:00', end: '17:00', capacity: 12 }
  ];
  assert.equal(scheduleDetails({ enabled: true, slots }).slots.length, 2);
  assert.throws(() => scheduleDetails({ enabled: true, slots: [slots[0], slots[0]] }));
  assert.throws(() => scheduleDetails({ enabled: true, slots: [slots[0]] }));
});

test('video access requires an active student and a paid current fee', () => {
  const student = { id: 1001, archived: false, first_fee_cycle_id: 42 };
  const paid = { student_id: 1001, cycle_id: 42, status: 'paid' };
  assert.equal(videoEntitlement(student, 42, paid), true);
  assert.equal(videoEntitlement(student, 42, { ...paid, status: 'pending' }), false);
  assert.equal(videoEntitlement(student, 43, paid), false);
  assert.equal(videoEntitlement({ ...student, archived: true }, 42, paid), false);
  assert.equal(videoEntitlement(student, 42, { ...paid, student_id: 1002 }), false);
});

test('video playback serves one bounded byte range at a time', () => {
  const size = 20 * 1024 * 1024;
  assert.deepEqual(videoRange('bytes=0-', size), { start: 0, end: 8 * 1024 * 1024 - 1 });
  assert.deepEqual(videoRange('bytes=1048576-1048577', size), { start: 1048576, end: 1048577 });
  assert.throws(() => videoRange('bytes=0-1,4-5', size));
  assert.throws(() => videoRange(`bytes=${size}-`, size));
});
