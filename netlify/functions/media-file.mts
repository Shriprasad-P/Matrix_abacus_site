import type { Config, Context } from '@netlify/functions';
import { configured, driveToken, mediaStore } from './media-lib.mts';

export default async (_request: Request, context: Context) => {
  if (!configured()) return new Response('Not found', { status: 404 });
  const id = context.params.id;
  if (!id || !/^[\w-]+$/.test(id)) return new Response('Not found', { status: 404 });
  const state = await mediaStore().get('state', { type: 'json' });
  const file = [...(state?.published || []), ...(state?.pdfs || [])].find(item => item.id === id);
  if (!file) return new Response('Not found', { status: 404 });
  const upstream = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${await driveToken()}` }
  });
  if (!upstream.ok) return new Response('Media unavailable', { status: 502 });
  return new Response(upstream.body, {
    headers: {
      'Content-Type': file.mimeType,
      'Content-Disposition': file.mimeType === 'application/pdf' ? 'attachment' : 'inline',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff'
    }
  });
};

export const config: Config = { path: '/api/media/file/:id' };
