import { getStore } from '@netlify/blobs';
import { GoogleAuth } from 'google-auth-library';

export function mediaStore() {
  // Only the production-only scheduled function writes to this site-wide store.
  return getStore('website-media', { consistency: 'strong' });
}

export function configured() {
  return Boolean(Netlify.env.get('DRIVE_MEDIA_FOLDER_ID') && Netlify.env.get('GOOGLE_SERVICE_ACCOUNT_JSON'));
}

export async function driveToken() {
  const credentials = JSON.parse(Netlify.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || '{}');
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('Google Drive token unavailable');
  return token;
}

export async function listDriveFiles() {
  const token = await driveToken();
  const folder = Netlify.env.get('DRIVE_MEDIA_FOLDER_ID');
  const files: any[] = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q: `'${folder!.replace(/'/g, "\\'")}' in parents and trashed = false`,
      fields: 'nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,size)',
      pageSize: '1000',
      orderBy: 'createdTime',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true'
    });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) throw new Error(`Google Drive listing failed: ${response.status}`);
    const page = await response.json();
    files.push(...(page.files || []));
    pageToken = page.nextPageToken || '';
  } while (pageToken);
  // Netlify streamed function responses are limited to 20 MB.
  return files.filter(file => (/^image\/(jpeg|png|webp|gif|avif)$/.test(file.mimeType) || file.mimeType === 'application/pdf')
    && Number(file.size || 0) <= 20 * 1024 * 1024);
}
