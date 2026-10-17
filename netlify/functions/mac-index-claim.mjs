import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { session, sessionConfigured } from './lib/oauth.mjs';

const json = (data, status = 200) => new Response(JSON.stringify(data, null, 2), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export default async (request) => {
  const host = (request.headers.get('host') || '').split(':')[0].toLowerCase();
  if (!['localhost', '127.0.0.1', '::1'].includes(host)) return json({ error: 'Open this page on the Mac itself while signed in.' }, 403);
  if (!sessionConfigured()) return json({ error: 'pCloud server session setup is not configured yet.' }, 503);
  const pair = (request.headers.get('cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith('sai_photos_session='));
  const account = session(request);
  if (!pair || !account) return json({ error: 'Sign in to pCloud in this browser first, then reload this page.' }, 401);
  const file = path.join(os.homedir(), '.sai-index-session');
  fs.writeFileSync(file, pair.slice('sai_photos_session='.length) + '\n', { mode: 0o600 });
  return json({
    ok: true,
    account: String(account.uid),
    file,
    savedAt: new Date().toISOString(),
    note: 'The Mac indexing agent picks this up within a minute and keeps AI indexing complete in the background, saving every result to pCloud.',
  });
};
