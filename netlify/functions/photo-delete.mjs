import {clearPreviewCache} from './lib/local-cache.mjs';
import { authRequired, json, origin } from './lib/oauth.mjs';
import { call, kindOf } from './lib/pcloud.mjs';
export default async request => {
  const denied = authRequired(request); if (denied) return denied;
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (request.headers.get('origin') !== origin()) return json({ error: 'Request origin not allowed.' }, 403);
  const body = await request.json().catch(() => null);
  if (!/^pc-\d{1,20}$/.test(body?.id || '') || body.confirmed !== true || typeof body.fileName !== 'string' || !body.fileName.length || body.fileName.length > 1024) return json({ error: 'Confirm the photo before deleting it.' }, 400);
  const fileid = body.id.slice(3);
  let stage = 'stat';
  let shared = false;
  try {
    let metadata;
    try { metadata = (await call(request, 'stat', { fileid })).metadata; }
    catch (error) { if ([2009,2055].includes(error.result)) return json({ deleted: true, id: body.id, alreadyDeleted: true }); throw error; }
    if (!metadata || metadata.isfolder || !['photo','video'].includes(kindOf(metadata.name))) return json({ error: 'Only photos can be deleted from the photo viewer.' }, 400);
    shared = metadata.ismine === false;
    if (shared && metadata.candelete === false) return json({ error: 'This photo is in a shared folder without delete permission. Ask the folder owner to grant delete access.', providerCode: 2003, reason: 'shared-folder-permission' }, 403);
    if (metadata.name !== body.fileName) return json({ error: 'The photo has changed. Refresh your library and confirm again.' }, 409);
    stage = 'deletefile';
    const result = await call(request, 'deletefile', { fileid });
    if (result.metadata?.isdeleted !== true || String(result.metadata.fileid) !== fileid) throw new Error('Deletion not confirmed');
    await clearPreviewCache(request,fileid);return json({ deleted: true, id: body.id });
  } catch (error) {
    const providerCode = Number.isInteger(error.result) ? error.result : null;
    if ([1000, 2000].includes(providerCode)) return json({ error: `pCloud sign-in is no longer valid (code ${providerCode}). Disconnect and connect pCloud again, then retry.`, providerCode, stage }, 401);
    if (providerCode === 2003) return json({ error: shared
      ? 'pCloud denied deletion (code 2003). Ask the shared-folder owner to grant delete access.'
      : 'pCloud denied access (code 2003). Disconnect and connect pCloud again, approve access, then retry. If it still fails, check whether this file can be deleted in the pCloud app; Sai Photos cannot override pCloud permissions.', providerCode, stage }, 403);
    return json({ error: `Deletion could not be confirmed${providerCode === null ? '' : ` (pCloud code ${providerCode})`}. Refresh your library to check before retrying.`, providerCode, stage }, 502);
  }
};
