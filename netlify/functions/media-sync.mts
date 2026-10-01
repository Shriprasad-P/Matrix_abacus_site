import type { Config } from '@netlify/functions';
import { configured, listDriveFiles, mediaStore } from './media-lib.mts';
import { updateMediaState } from './media-state.mjs';

export default async () => {
  if (!configured()) {
    console.log('Drive media folder is not configured yet');
    return;
  }
  const files = await listDriveFiles();
  const store = mediaStore();
  const previous = await store.get('state', { type: 'json' });
  const next = updateMediaState(previous, files, Date.now());
  await store.setJSON('state', next);
  console.log(`Media synced: ${next.published.length} published images, ${next.queuedCount} queued, ${next.pdfs.length} PDFs`);
};

export const config: Config = { schedule: '0 4 * * *' };
