import {cachedPreview,savePreviewCache} from './lib/local-cache.mjs';
import { authRequired, json } from './lib/oauth.mjs';
import { call, kindOf, pcloudURL } from './lib/pcloud.mjs';
export default async request => {
  const denied = authRequired(request); if (denied) return denied;
  if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!/^pc-\d+$/.test(id || '')) return json({ error: 'Invalid file ID.' }, 400);
  const fileid = id.slice(3);
  try {
    const data = await call(request, 'stat', { fileid });
    const kind = kindOf(data.metadata?.name);
    if (!kind) return json({ error: 'Unsupported media file.' }, 400);
    if ((url.searchParams.get('thumbnail') === '1' || url.searchParams.get('preview') === '1') && ['photo','video'].includes(kind)) {
      const preview = url.searchParams.get('preview') === '1';
      const cached=await cachedPreview(request,{...data.metadata,fileid},preview?'preview':'thumbnail');if(cached?.bytes)return new Response(request.method==='HEAD'?null:cached.bytes,{headers:{'content-type':'image/jpeg','cache-control':'no-store'}});
      const response = await fetch(pcloudURL(request, 'getthumb', { fileid, size: preview ? '1280x960' : '320x320', crop: preview ? 0 : 1 }), { signal: AbortSignal.timeout(30000) });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) return json({ error: 'Preview unavailable.' }, 422);
      const bytes=Buffer.from(await response.arrayBuffer());if(response.headers.get('content-type')?.startsWith('image/jpeg'))await savePreviewCache(cached,bytes);return new Response(request.method === 'HEAD' ? null : bytes, { headers: { 'content-type': response.headers.get('content-type'), 'cache-control': 'no-store' } });
    }
    const link = await call(request, url.searchParams.get('video')==='1'?'getvideolink':'getfilelink', { fileid });
    const host = link.hosts?.[0];
    if (!host || !/^[a-z0-9-]+\.pcloud\.com$/i.test(host) || !link.path?.startsWith('/')) throw new Error('Invalid download link');
    const headers = new Headers();
    const range = request.headers.get('range'); if (range) headers.set('range', range);
    const response = await fetch(`https://${host}${link.path}`, { method: request.method, headers, signal: AbortSignal.timeout(60000) });
    if (![200, 206, 416].includes(response.status)) throw new Error('Download unavailable');
    const resultHeaders = new Headers({ 'cache-control': 'no-store', 'content-type': response.headers.get('content-type') || 'application/octet-stream', 'x-content-type-options': 'nosniff' });
    for (const name of ['content-range', 'accept-ranges', 'content-length']) { const value = response.headers.get(name); if (value) resultHeaders.set(name, value); }
    return new Response(response.body, { status: response.status, headers: resultHeaders });
  } catch { return json({ error: 'Could not load this file from pCloud.' }, 502); }
};
