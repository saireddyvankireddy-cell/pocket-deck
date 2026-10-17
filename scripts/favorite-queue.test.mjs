import test from 'node:test';
import assert from 'node:assert/strict';
import { addFavoriteRetry, settleFavoriteRetries, pendingFavoriteRetries } from '../favorite-queue.mjs';
test('favourite retries keep the newest heart per photo and settle after sync', () => {
  let queue = addFavoriteRetry([], { photoId: 'pc-1', value: true, at: 1 });
  queue = addFavoriteRetry(queue, { photoId: 'pc-1', value: false, at: 2 });
  queue = addFavoriteRetry(queue, { photoId: 'pc-2', value: true, at: 3 });
  assert.deepEqual(queue.map(item => [item.photoId, item.value]), [['pc-1', false], ['pc-2', true]]);
  assert.deepEqual(settleFavoriteRetries(queue, ['pc-1']).map(item => item.photoId), ['pc-2']);
  assert.deepEqual(pendingFavoriteRetries([{ photoId: 'bad', value: true }, ...queue]).map(item => item.photoId), ['pc-1', 'pc-2']);
  const capped = [...Array(210).keys()].reduce((list, n) => addFavoriteRetry(list, { photoId: 'pc-' + (n + 10), value: true, at: n }), []);
  assert.equal(capped.length, 200);
  assert.equal(settleFavoriteRetries([], ['pc-1']).length, 0);
});
