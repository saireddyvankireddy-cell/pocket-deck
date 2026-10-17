import test from 'node:test';
import assert from 'node:assert/strict';
import {confidentVisualScores} from '../photo-tools.mjs';
import {sortPhotos} from '../gallery-controls.mjs';
test('weak generic matches are excluded and empty results stay empty',()=>{
 assert.equal(confidentVisualScores(new Map([['portrait',.24],['studio',.26]])).size,0);
 const matches=confidentVisualScores(new Map([['beach',.36],['coast',.34],['portrait',.23],['weak',.29],['invalid',NaN]]));
 assert.deepEqual([...matches.keys()],['beach','coast']);
 assert.equal(confidentVisualScores(new Map()).size,0);
});
test('relevance keeps AI ranking even when file sizes would reverse the order',()=>{
 const items=[{id:'best',size:1},{id:'second',size:100}];assert.deepEqual(sortPhotos(items,'relevance'),items);assert.equal(sortPhotos(items,'largest')[0].id,'second');
});
