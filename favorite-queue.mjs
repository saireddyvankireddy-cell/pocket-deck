// Device-side retry list for hearts that pCloud did not confirm yet. Pure helpers, unit tested.
export function addFavoriteRetry(list, entry, limit = 200) {
  const next = (Array.isArray(list) ? list : []).filter(item => item && item.photoId !== entry.photoId);
  next.push({ photoId: entry.photoId, value: Boolean(entry.value), at: Number(entry.at) || 0 });
  return next.slice(-limit);
}
export function settleFavoriteRetries(list, settledIds) {
  const settled = new Set(settledIds);
  return (Array.isArray(list) ? list : []).filter(item => item && !settled.has(item.photoId));
}
export function pendingFavoriteRetries(list) {
  return (Array.isArray(list) ? list : []).filter(item => item && /^pc-\d{1,20}$/.test(item.photoId || '') && typeof item.value === 'boolean');
}
