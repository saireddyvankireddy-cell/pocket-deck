import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('gallery HTML has unique IDs and initializes services needed before login',async()=>{
 const html=await readFile(new URL('../index.html',import.meta.url),'utf8');const ids=[...html.matchAll(/\bid="([^" ]+)"/g)].map(m=>m[1]);assert.equal(new Set(ids).size,ids.length,'Duplicate IDs break control wiring');
 const module=await readFile(new URL('../photo-library.mjs',import.meta.url),'utf8');assert.match(module,/this\.cleanup=new PhotoCleanup\(this\)/);assert.match(module,/this\.appliedDeletes=new Set\(\)/);assert.match(module,/this\.tileObserver=new IntersectionObserver/);
});
