import test from 'node:test';
import assert from 'node:assert/strict';
import {indexProgressSummary} from '../settings.mjs';
const library=()=>({photos:()=>[{id:'pc-1',version:'a'},{id:'pc-2',version:'b'}],meta:{visuals:{'pc-1':{version:'a',model:'clip-base32-q8-v1'}}},visualJob:{running:false}});
test('Settings counter reflects new restored indexes without reopening and distinguishes idle from running',()=>{
 const lib=library();assert.match(indexProgressSummary(lib),/1 \/ 2/);assert.match(indexProgressSummary(lib),/No AI search job/);
 lib.meta.visuals['pc-2']={version:'b',model:'clip-base32-q8-v1'};assert.match(indexProgressSummary(lib),/2 \/ 2/);assert.match(indexProgressSummary(lib),/complete/);
 lib.visualJob={running:true,phase:'Saving index in pCloud',updatedAt:1000};assert.match(indexProgressSummary(lib,2000),/Running: Saving/);assert.match(indexProgressSummary(lib,241000),/No step progress for 4 minutes/);
});
test('Failed sync and paused indexing are visible; changed file versions do not count as completed',()=>{
 const lib=library();lib.visualJob={running:false,phase:'Paused'};lib.cloudError='Offline';assert.match(indexProgressSummary(lib),/paused/);assert.match(indexProgressSummary(lib),/Offline/);
 lib.meta.visuals['pc-1'].version='old';assert.match(indexProgressSummary(lib),/0 \/ 2/);
 lib.visualStatusError='Service unavailable';assert.match(indexProgressSummary(lib),/Cannot read indexing status/);
});

test('AI coverage separates completed stages and ignores stale indexes and videos',async()=>{
 const {indexCoverage,indexCoverageSummary}=await import('../settings.mjs');
 const lib={photos:()=>[{id:'pc-1',version:'new'},{id:'pc-2',version:'b'},{id:'pc-3',version:'v',mediaType:'video'}],meta:{visuals:{'pc-1':{version:'old',model:'clip-base32-q8-v1'},'pc-2':{version:'b',model:'clip-base32-q8-v1'}},indexes:{'pc-1':{version:'new'},'pc-3':{version:'v'}},checksums:{'pc-2':{version:'old'}}}};
 assert.deepEqual(indexCoverage(lib),{total:2,visual:1,faces:1,checksums:0});
 assert.match(indexCoverageSummary(lib),/faces & text 1 \/ 2/);
 assert.match(indexCoverageSummary(lib),/not recognition accuracy/);
});


test('shared pending counts skip unchanged cross-device results and exclude unsaved indexes',async()=>{
 const {sharedIndexProgress}=await import('../photo-tools.mjs');
 const photos=Array.from({length:20456},(_,i)=>({id:'pc-'+i,version:'v'}));
 const lib={photos:()=>photos,meta:{visuals:Object.fromEntries(photos.slice(0,600).map(p=>[p.id,{version:'v',model:'clip-base32-q8-v1'}]))},data:{pending:[]}};
 assert.deepEqual(sharedIndexProgress(lib),{done:600,pending:19856,total:20456});
 lib.data.pending=[{type:'visual-index',photoId:'pc-0',version:'v'}];assert.equal(sharedIndexProgress(lib).done,599);
 lib.data.pending=[];photos[0].version='changed';assert.equal(sharedIndexProgress(lib).pending,19857);
});
