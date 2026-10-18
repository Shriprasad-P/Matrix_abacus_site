import assert from 'node:assert/strict';
import { test } from 'node:test';
import { feeDetails, worksheetDetails, scheduleDetails, videoEntitlement, videoOfferDetails,
  addCalendarMonths, videoRange, videoProgressStep, practiceBand } from './netlify/functions/abacus-api.mts';

test('practice targets increase within a level as the timed streak grows', () => {
  assert.deepEqual(practiceBand('Beginner', 0), { tier: 1, range: [1, 9] });
  assert.deepEqual(practiceBand('Beginner', 2), { tier: 2, range: [10, 49] });
  assert.deepEqual(practiceBand('Beginner', 4), { tier: 3, range: [50, 99] });
  assert.deepEqual(practiceBand('Level 3', 4), { tier: 3, range: [8000, 9999] });
});

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

test('video access requires a purchased level that has not expired', () => {
  const at = Date.parse('2026-10-12T00:00:00Z');
  const student = { id: 1001, archived: false, approved_at: '2026-10-12T00:00:00Z' };
  const access = { student_id: 1001, level: 'Beginner', expires_at: at + 1000 };
  assert.equal(videoEntitlement(student, access, 'Beginner', at), true);
  assert.equal(videoEntitlement(student, access, 'Beginner', at + 1000), false);
  assert.equal(videoEntitlement(student, access, 'Level 1', at), false);
  assert.equal(videoEntitlement({ ...student, archived: true }, access, 'Beginner', at), false);
  assert.equal(videoEntitlement({ ...student, approved_at: null }, access, 'Beginner', at), false);
  assert.equal(videoEntitlement(student, { ...access, student_id: 1002 }, 'Beginner', at), false);
  assert.equal(videoOfferDetails({level:'Level 1',amount:'499',upi_id:'school@upi'}).amount_paise,49900);
  assert.throws(() => videoOfferDetails({level:'Level 5',amount:'499',upi_id:'school@upi'}));
  assert.equal(new Date(addCalendarMonths(Date.parse('2026-01-31T10:00:00Z'))).toISOString(),
    '2026-03-31T10:00:00.000Z');
  assert.equal(new Date(addCalendarMonths(Date.parse('2026-12-31T10:00:00Z'))).toISOString(),
    '2027-02-28T10:00:00.000Z');
});

test('video playback serves one bounded byte range at a time', () => {
  const size = 20 * 1024 * 1024;
  assert.deepEqual(videoRange('bytes=0-', size), { start: 0, end: 4 * 1024 * 1024 - 1 });
  assert.deepEqual(videoRange('bytes=1048576-1048577', size), { start: 1048576, end: 1048577 });
  assert.throws(() => videoRange('bytes=0-1,4-5', size));
  assert.throws(() => videoRange(`bytes=${size}-`, size));
});

test('lesson completion credit rejects jumps and replayed sections', () => {
  const start = Date.parse('2026-10-17T00:00:00Z');
  const play = { duration_ms: 60000, started_at: start, last_reported_at: start,
    last_position_ms: 0, credited_position_ms: 0, watched_ms: 0 };
  assert.throws(() => videoProgressStep(play, 40000, start + 5000));
  assert.throws(() => videoProgressStep(play, 55000, start + 60000));
  const first = { ...play, ...videoProgressStep(play, 10000, start + 10000) };
  assert.equal(first.watched_ms, 10000);
  const rewind = { ...first, ...videoProgressStep(first, 2000, start + 12000) };
  const replay = videoProgressStep(rewind, 10000, start + 20000);
  assert.equal(replay.watched_ms, 10000);
  assert.equal(videoProgressStep(first, 20000, start + 20000).watched_ms, 20000);
});
