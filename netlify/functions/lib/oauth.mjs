import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export const API_HOSTS = new Set(['api.pcloud.com', 'eapi.pcloud.com']);
const SESSION = 'sai_photos_session';
const STATE = 'sai_photos_oauth_state';
export function sessionConfigured() {
  return Boolean(/^[a-f0-9]{64}$/i.test(process.env.SAI_PHOTOS_SESSION_KEY || '') && validOrigin());
}
export function configured() {
  return Boolean(process.env.PCLOUD_CLIENT_ID && process.env.PCLOUD_CLIENT_SECRET && /^[a-f0-9]{64}$/i.test(process.env.SAI_PHOTOS_SESSION_KEY || '') && validOrigin());
}
function validOrigin() {
  try {
    const url = new URL(process.env.SAI_PHOTOS_ORIGIN);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && process.env.SAI_PHOTOS_ALLOW_HTTP === 'true' && /^(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)$/.test(url.hostname);
  } catch { return false; }
}
export function origin() { return new URL(process.env.SAI_PHOTOS_ORIGIN).origin; }
export function callbackURL() { return origin() + '/.netlify/functions/pcloud-auth?action=callback'; }
function seal(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(process.env.SAI_PHOTOS_SESSION_KEY, 'hex'), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}
function unseal(value) {
  try {
    const buffer = Buffer.from(value, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', Buffer.from(process.env.SAI_PHOTOS_SESSION_KEY, 'hex'), buffer.subarray(0, 12));
    decipher.setAuthTag(buffer.subarray(12, 28));
    const data = JSON.parse(Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8'));
    return data.exp > Date.now() ? data : null;
  } catch { return null; }
}
function readCookie(request, name) {
  const pairs = (request.headers.get('cookie') || '').split(';').map(pair => pair.trim());
  return pairs.find(pair => pair.startsWith(name + '='))?.slice(name.length + 1) || '';
}
function cookie(name, value, seconds) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${origin().startsWith('https:') ? '; Secure' : ''}`;
}
export function session(request) {
  if (!sessionConfigured()) return null;
  const data = unseal(readCookie(request, SESSION));
  return data?.type === 'session' && API_HOSTS.has(data.host) && data.token ? data : null;
}
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}
export function authRequired(request) {
  return !sessionConfigured() ? json({ error: 'pCloud server session setup is not configured yet.' }, 503) : !session(request) ? json({ error: 'Connect pCloud to access your library.' }, 401) : null;
}
export async function authHandler(request) {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || 'status';
  if (action === 'status' && request.method === 'GET') {
    const account = session(request);
    return json({ configured: configured(), tokenConfigured: sessionConfigured(), connected: Boolean(account), accountId: account ? String(account.uid) : null, canonicalOrigin: sessionConfigured() ? origin() : null, callbackURL: configured() ? callbackURL() : null });
  }
  if (action === 'token') {
    if (!sessionConfigured()) return json({ error: 'Configure the server origin and session key first.' }, 503);
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    if (request.headers.get('origin') !== origin()) return json({ error: 'Sign-in must use the configured address: '+origin()+'. Open that address and reconnect. OAuth callback: '+callbackURL() }, 403);
    const body = await request.json().catch(() => null);
    if (!body || !API_HOSTS.has(body.host) || !['access_token', 'auth'].includes(body.tokenType) || typeof body.token !== 'string' || !/^[\x21-\x7e]{1,512}$/.test(body.token)) return json({ error: 'Enter a valid token, token type and pCloud region.' }, 400);
    try {
      const checked = await fetch(`https://${body.host}/userinfo`, { method: 'POST', body: new URLSearchParams({ [body.tokenType]: body.token }), signal: AbortSignal.timeout(20000) });
      const account = await checked.json();
      if (!checked.ok || account.result !== 0 || !/^\d{1,20}$/.test(String(account.userid || ''))) return json({ error: 'pCloud did not accept this token. Check the token type, US/Europe region, and whether it has expired.' }, 401);
      const response = json({ connected: true, accountId: String(account.userid) });
      response.headers.append('set-cookie', cookie(SESSION, seal({ type: 'session', token: body.token, tokenType: body.tokenType, host: body.host, uid: String(account.userid), exp: Date.now() + 30 * 86400000 }), 30 * 86400));
      response.headers.append('set-cookie', cookie(STATE, '', 0));
      return response;
    } catch { return json({ error: 'Could not verify the token with pCloud. Check your connection and retry.' }, 502); }
  }
  if (action === 'logout' && request.method === 'POST') {
    if (!sessionConfigured()) return json({ error: 'Server session setup is pending.' }, 503);
    if (request.headers.get('origin') !== origin()) return json({ error: 'Sign-in must use the configured address: '+origin()+'. Open that address and reconnect. OAuth callback: '+callbackURL() }, 403);
    const response = json({ connected: false });
    response.headers.append('set-cookie', cookie(SESSION, '', 0));
    return response;
  }
  if (!configured()) return json({ error: 'pCloud OAuth setup is pending. Use a token or configure OAuth on the server.' }, 503);
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  if (action === 'start') {
    if (url.origin !== origin()) return new Response(null, { status: 302, headers: { location: origin() + '/.netlify/functions/pcloud-auth?action=start', 'cache-control': 'no-store' } });
    const state = randomBytes(32).toString('hex');
    const authorize = new URL('https://my.pcloud.com/oauth2/authorize');
    authorize.search = new URLSearchParams({ client_id: process.env.PCLOUD_CLIENT_ID, response_type: 'code', redirect_uri: callbackURL(), state, force_reapprove: '1' }).toString();
    return new Response(null, { status: 302, headers: { location: authorize.href, 'cache-control': 'no-store', 'set-cookie': cookie(STATE, seal({ type: 'state', state, exp: Date.now() + 600000 }), 600), 'referrer-policy': 'no-referrer' } });
  }
  if (action === 'callback') {
    const saved = unseal(readCookie(request, STATE));
    if (saved?.type !== 'state' || !saved.state || saved.state !== url.searchParams.get('state')) return json({ error: 'Sign-in expired or invalid. Return to Sai Photos and connect again.' }, 400);
    const host = url.searchParams.get('hostname');
    const code = url.searchParams.get('code');
    if (!code || !API_HOSTS.has(host)) return json({ error: 'pCloud sign-in was cancelled or returned an invalid region. Return to '+origin()+' and retry; registered web callback must be '+callbackURL() }, 400);
    try {
      const tokenResponse = await fetch(`https://${host}/oauth2_token`, { method: 'POST', body: new URLSearchParams({ client_id: process.env.PCLOUD_CLIENT_ID, client_secret: process.env.PCLOUD_CLIENT_SECRET, code }), signal: AbortSignal.timeout(20000) });
      const token = await tokenResponse.json();
      if (!tokenResponse.ok || token.result !== 0 || !token.access_token) throw new Error('Token exchange failed');
      const response = new Response(null, { status: 302, headers: { location: origin() + '/', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
      response.headers.append('set-cookie', cookie(SESSION, seal({ type: 'session', token: token.access_token, host, uid: token.uid, exp: Date.now() + 30 * 86400000 }), 30 * 86400));
      response.headers.append('set-cookie', cookie(STATE, '', 0));
      return response;
    } catch { return json({ error: 'pCloud authorization could not finish. Check the server client ID/secret and register the web callback '+callbackURL()+' in pCloud. The Android callback is separate.' }, 502); }
  }
  return json({ error: 'Unknown action.' }, 404);
}
