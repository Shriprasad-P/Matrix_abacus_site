import type { Config } from '@netlify/functions';
import { configured, mediaStore } from './media-lib.mts';

export default async () => {
  if (!configured()) return Response.json({ ready: false, images: [], pdfs: [] });
  const state = await mediaStore().get('state', { type: 'json' });
  if (!state) return Response.json({ ready: false, images: [], pdfs: [] });
  const toPublic = (file: any) => ({
    name: file.name,
    href: `/api/media/file/${encodeURIComponent(file.id)}`
  });
  return Response.json({
    ready: true,
    images: state.published.map(toPublic),
    pdfs: state.pdfs.map(toPublic),
    queuedCount: state.queuedCount,
    lastPublishedAt: state.lastPublishedAt
  }, { headers: { 'Cache-Control': 'public, max-age=300' } });
};

export const config: Config = { path: '/api/media/manifest' };
