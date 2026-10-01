import test from 'node:test';
import assert from 'node:assert/strict';
import { updateMediaState } from '../netlify/functions/_shared/media-state.mjs';

test('releases six images weekly while refreshing PDFs and retaining a large queue', () => {
  const files = Array.from({ length: 500 }, (_, i) => ({
    id: String(i).padStart(3, '0'), name: `photo-${i}.jpg`,
    mimeType: 'image/jpeg', createdTime: new Date(i * 1000).toISOString()
  }));
  files.push({ id: 'pdf', name: 'level1.pdf', mimeType: 'application/pdf' });
  const day = 86400000;
  const first = updateMediaState(null, files, 0);
  assert.equal(first.published.length, 6);
  assert.equal(first.queuedCount, 494);
  assert.equal(first.pdfs.length, 1);
  assert.equal(updateMediaState(first, files, 6 * day).published.length, 6);
  const second = updateMediaState(first, files, 7 * day);
  assert.equal(second.published.length, 12);
  assert.equal(second.queuedCount, 488);
  const removed = updateMediaState(second, files.filter(f => f.id !== '000'), 8 * day);
  assert.equal(removed.published.length, 11);
});
