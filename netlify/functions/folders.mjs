import { authRequired, json } from './lib/oauth.mjs';
import { call } from './lib/pcloud.mjs';
export default async request => {
  const denied = authRequired(request); if (denied) return denied;
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  const folderid = new URL(request.url).searchParams.get('folderid') || '0';
  if (!/^\d{1,20}$/.test(folderid)) return json({ error: 'Invalid folder ID.' }, 400);
  try {
    const { metadata } = await call(request, 'listfolder', { folderid, recursive: 0 });
    return json({ id: String(metadata.folderid), name: metadata.name || 'pCloud', folders: (metadata.contents || []).filter(item => item.isfolder).map(item => ({ id: String(item.folderid), name: item.name })).sort((a, b) => a.name.localeCompare(b.name)) });
  } catch { return json({ error: 'Could not browse this folder. Try again or reconnect pCloud.' }, 502); }
};
