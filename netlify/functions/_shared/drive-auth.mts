import { GoogleAuth } from 'google-auth-library';

export async function driveToken() {
  const key = Netlify.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') || Netlify.env.get('FIREBASE_SERVICE_ACCOUNT_JSON');
  if (!key) throw new Error('Google Drive service account is not configured');
  const credentials = JSON.parse(key);
  const auth = new GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly']
  });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error('Google Drive token unavailable');
  return token;
}
