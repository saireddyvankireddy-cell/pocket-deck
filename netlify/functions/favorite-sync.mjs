import { authRequired, json, origin } from './lib/oauth.mjs';
import { call } from './lib/pcloud.mjs';
import { pickFavoritesCollection, favoriteIdsFrom } from './lib/favorites.mjs';
const NOT_FOUND = 'pCloud Favourites was not found on this account yet. In pCloud’s own app, tap the star on any photo once, then sync again.';
const photoId = value => typeof value === 'string' && /^pc-\d{1,20}$/.test(value);
const error = (error, stage) => {
  const code = Number.isInteger(error.result) ? error.result : null;
  if ([1000, 2000].includes(code)) return json({ error: `pCloud sign-in is no longer valid (code ${code}). Connect pCloud again, then retry.`, providerCode: code, stage }, 401);
  return json({ error: `pCloud Favourites ${stage} failed${code === null ? '' : ` (pCloud code ${code})`}. Hearts stay saved here; Sync now retries.`, providerCode: code, stage }, 502);
};
export default async request => {
  const denied = authRequired(request); if (denied) return denied;
  const action = new URL(request.url).searchParams.get('action') || 'status';
  if (request.method === 'GET') {
    try {
      const list = await call(request, 'collection_list', { showfiles: 1, pagesize: 5000 });
      const collection = pickFavoritesCollection(list.collections || []);
      if (!collection) return json({ found: false });
      const fileIds = favoriteIdsFrom(collection.contents || []);
      const items = Number.isInteger(collection.items) ? collection.items : fileIds.length;
      return json({ found: true, collectionId: collection.id, name: collection.name || 'Favorites', items, fileIds, truncated: fileIds.length < items });
    } catch (failure) { return error(failure, 'read'); }
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (request.headers.get('origin') !== origin()) return json({ error: 'Request origin not allowed.' }, 403);
  const body = await request.json().catch(() => null);
  let known = null;
  try { known = pickFavoritesCollection((await call(request, 'collection_list', {})).collections || []); }
  catch (failure) { return error(failure, 'read'); }
  try {
    if (action === 'link' || action === 'unlink') {
      if (!photoId(body?.photoId)) return json({ error: 'Choose a photo first.' }, 400);
      if (!known) return json({ error: NOT_FOUND }, 404);
      try { await call(request, action === 'link' ? 'collection_linkfiles' : 'collection_unlinkfiles', { collectionid: known.id, fileids: body.photoId.slice(3), ...(action === 'link' ? { noitems: 1 } : {}) }); }
      catch (failure) { const already = action === 'link' ? failure.result === 2072 : failure.result === 2009; if (!already) throw failure; return json({ synced: true, photoId: body.photoId, already: true }); }
      return json({ synced: true, photoId: body.photoId });
    }
    if (action === 'update') {
      const add = Array.isArray(body?.add) ? body.add : [];
      const remove = Array.isArray(body?.remove) ? body.remove : [];
      if (add.length + remove.length > 2000) return json({ error: 'Too many favourites in one sync.' }, 400);
      if (![...add, ...remove].every(photoId)) return json({ error: 'Choose valid photos.' }, 400);
      if (!known) return json({ error: NOT_FOUND }, 404);
      let linked = 0, unlinked = 0;
      for (let offset = 0; offset < add.length; offset += 100) { await call(request, 'collection_linkfiles', { collectionid: known.id, fileids: add.slice(offset, offset + 100).map(id => id.slice(3)).join(','), noitems: 1 }); linked += Math.min(100, add.length - offset); }
      for (let offset = 0; offset < remove.length; offset += 100) { await call(request, 'collection_unlinkfiles', { collectionid: known.id, fileids: remove.slice(offset, offset + 100).map(id => id.slice(3)).join(',') }); unlinked += Math.min(100, remove.length - offset); }
      return json({ linked, unlinked });
    }
    return json({ error: 'Invalid favourites action.' }, 400);
  } catch (failure) { return error(failure, 'sync'); }
};
