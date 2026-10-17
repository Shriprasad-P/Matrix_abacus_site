import test from 'node:test';
import assert from 'node:assert/strict';
import { updateMediaState } from '../netlify/functions/_shared/media-state.mjs';

test('shows the next six images each day while refreshing PDFs', () => {
  const files = Array.from({ length: 500 }, (_, i) => ({
    id: String(i).padStart(3, '0'), name: `photo-${i}.jpg`,
    mimeType: 'image/jpeg', createdTime: new Date(i * 1000).toISOString()
  }));
  files.push({ id: 'pdf', name: 'level1.pdf', mimeType: 'application/pdf' });
  const day = 86400000;
  const first = updateMediaState(null, files, 0);
  assert.equal(first.published.length, 6);
  assert.deepEqual(first.published.map(file => file.id), ['000', '001', '002', '003', '004', '005']);
  assert.equal(first.queuedCount, 494);
  assert.equal(first.pdfs.length, 1);
  assert.deepEqual(updateMediaState(first, files, 3600000).published.map(file => file.id),
    first.published.map(file => file.id));
  const second = updateMediaState(first, files, day);
  assert.deepEqual(second.published.map(file => file.id), ['006', '007', '008', '009', '010', '011']);
  assert.equal(second.queuedCount, 488);
  const removed = updateMediaState(second, files.filter(f => f.id !== '006'), day + 1);
  assert.deepEqual(removed.published.map(file => file.id), ['007', '008', '009', '010', '011']);
});

test('cycles through the folder without repeating an image in the same daily batch', () => {
  const files = Array.from({ length: 14 }, (_, i) => ({
    id: String(i), mimeType: 'image/jpeg', createdTime: new Date(i * 1000).toISOString()
  }));
  const day = 86400000;
  const first = updateMediaState(null, files, 0);
  const second = updateMediaState(first, files, day);
  const third = updateMediaState(second, files, 2 * day);
  assert.deepEqual(third.published.map(file => file.id), ['12', '13', '0', '1', '2', '3']);
  assert.equal(third.queuedCount, 10);
  assert.equal(new Set(third.published.map(file => file.id)).size, 6);
});

test('moves from the old cumulative gallery into the next daily batch', () => {
  const files = Array.from({ length: 20 }, (_, i) => ({
    id: String(i).padStart(2, '0'), mimeType: 'image/jpeg', createdTime: new Date(i * 1000).toISOString()
  }));
  const oldState = { published: files.slice(0, 12), lastPublishedAt: new Date(0).toISOString() };
  const next = updateMediaState(oldState, files, 86400000);
  assert.deepEqual(next.published.map(file => file.id), ['12', '13', '14', '15', '16', '17']);
});

test('rotates on the next India calendar day even when the cron runs seconds early', () => {
  const files = Array.from({ length: 12 }, (_, i) => ({
    id: String(i), mimeType: 'image/jpeg', createdTime: new Date(i * 1000).toISOString()
  }));
  const first = updateMediaState(null, files, 4 * 3600000 + 5000);
  const next = updateMediaState(first, files, 86400000 + 4 * 3600000);
  assert.deepEqual(next.published.map(file => file.id), ['6', '7', '8', '9', '10', '11']);
});
