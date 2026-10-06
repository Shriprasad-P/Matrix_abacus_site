import assert from 'node:assert/strict';
import { test } from 'node:test';
import { feeDetails, worksheetDetails, scheduleDetails } from './netlify/functions/abacus-api.mts';

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
