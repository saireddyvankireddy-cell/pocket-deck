import test from 'node:test';
import assert from 'node:assert/strict';
import { pickFavoritesCollection, favoriteIdsFrom, favoriteDiffs } from '../netlify/functions/lib/favorites.mjs';
test('pCloud Favourites collection is found among system and user collections', () => {
  const collections = [
    { id: 38, name: 'Most Listened', system: true, type: 'audio' },
    { id: 40, name: 'my music', system: false, type: 'audio' },
    { id: 77, name: 'Favourites', system: true, type: 'generic' },
  ];
  assert.equal(pickFavoritesCollection(collections).id, 77);
  assert.equal(pickFavoritesCollection([{ id: 1, name: 'Favorites', system: false }]), null, 'user-made collections named Favorites must not be used');
  assert.equal(pickFavoritesCollection([{ id: 2, name: 'Favorites', system: true }]).id, 2);
  assert.equal(pickFavoritesCollection([{ id: 3, name: 'favorite', system: true }]).id, 3);
  assert.equal(pickFavoritesCollection([]), null);
  assert.equal(pickFavoritesCollection(undefined), null);
});
test('favourite file ids map safely and skip folders or broken entries', () => {
  assert.deepEqual(favoriteIdsFrom([{ fileid: 101 }, { fileid: 102, name: 'b.jpg' }]), ['pc-101', 'pc-102']);
  assert.deepEqual(favoriteIdsFrom([{ fileid: 1, isfolder: true }, { name: 'no id' }, null, { fileid: 0 }]), ['pc-0']);
  assert.deepEqual(favoriteIdsFrom([]), []);
});
test('two-way diff imports cloud stars and pushes local hearts without overlap', () => {
  const result = favoriteDiffs(['pc-1', 'pc-2', 'pc-3'], ['pc-2', 'pc-4']);
  assert.deepEqual(result.importIds.sort(), ['pc-1', 'pc-3']);
  assert.deepEqual(result.pushIds, ['pc-4']);
  const empty = favoriteDiffs(['pc-9'], ['pc-9']);
  assert.deepEqual(empty, { importIds: [], pushIds: [] });
});
