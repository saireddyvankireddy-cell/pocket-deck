export function pickFavoritesCollection(collections = []) {
  return collections.find(collection => collection && collection.system === true && /favou?rites?/i.test(String(collection.name || ''))) || null;
}
export function favoriteIdsFrom(contents = []) {
  const ids = [];
  for (const item of contents) if (item && !item.isfolder && item.fileid !== undefined && item.fileid !== null) ids.push('pc-' + item.fileid);
  return ids;
}
export function favoriteDiffs(cloudIds = [], localIds = []) {
  const cloud = new Set(cloudIds), local = new Set(localIds);
  return { importIds: [...cloud].filter(id => !local.has(id)), pushIds: [...local].filter(id => !cloud.has(id)) };
}
