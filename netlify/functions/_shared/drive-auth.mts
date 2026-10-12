import { GoogleAuth } from 'google-auth-library';

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
