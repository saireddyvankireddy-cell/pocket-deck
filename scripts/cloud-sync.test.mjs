import test from 'node:test';
import assert from 'node:assert/strict';
import {syncRecords} from '../cloud-sync.mjs';
import {replayOperations} from '../photo-state.mjs';
const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000000`;
const like=n=>({id:id(n),at:n,type:'music-like',track:{id:'pc-'+n,name:'Song '+n,fileName:'song'+n+'.mp3',size:10,version:'v1'},value:true});
const data=()=>({operations:[],pending:[]});
test('a second device with an empty cache restores likes, favorites, indexes and history from cloud records',async()=>{
 const cloud=new Map();const phone1=data();const photo={id:id(3),at:3,type:'favorite',photoId:'pc-3',value:true};const index={id:id(4),at:4,type:'index',photoId:'pc-3',text:'ROSES',faces:[],version:'v1'};const history={id:id(5),at:5,type:'music-play',track:like(1).track,playedAt:100,position:20};phone1.pending=[like(1),photo,index,history];
 const write=async op=>{const saved=cloud.get(op.id)||{...op,at:op.at+1000};cloud.set(op.id,saved);return {operation:saved};};const read=async known=>({operations:[...cloud.values()].filter(op=>!known.includes(op.id)),more:false});
 await syncRecords({data:phone1,write,read,persist:async()=>{}});assert.equal(phone1.pending.length,0);
 const phone2=data();await syncRecords({data:phone2,write,read,persist:async()=>{}});const restored=replayOperations(phone2.operations);assert.equal(restored.musicLikes['pc-1'],true);assert.equal(restored.favorites['pc-3'],true);assert.equal(restored.indexes['pc-3'].text,'ROSES');assert.equal(restored.musicHistory['pc-1'].playedAt,100);assert.equal(restored.musicResume.position,20);
});
test('failed restore cannot block an upload; rejected writes stay queued and recover with the same ID',async()=>{
 const local=data();local.pending=[like(1)];let writes=0;const written=[];
 const result=await syncRecords({data:local,write:async op=>{writes++;written.push(op.id);return {operation:op};},read:async()=>{throw new Error('Restore unavailable');},persist:async()=>{}});assert.equal(writes,1);assert.equal(local.pending.length,0);assert.ok(result.readError);
 local.pending.push(like(2));const failure=await syncRecords({data:local,write:async()=>{throw new Error('Write access denied');},read:async()=>({operations:[like(3)],more:false}),persist:async()=>{}});assert.ok(failure.writeError);assert.equal(local.pending[0].id,id(2));assert.equal(replayOperations(local.operations).musicLikes['pc-3'],true);
 await syncRecords({data:local,write:async op=>{written.push(op.id);return {operation:op};},read:async()=>({operations:[],more:false}),persist:async()=>{}});assert.equal(local.pending.length,0);assert.ok(written.includes(id(2)));
});
test('changes made during restore are uploaded, while an incorrect acknowledgement cannot clear the queue',async()=>{
 const local=data();let readOnce=false;await syncRecords({data:local,read:async()=>{if(!readOnce){readOnce=true;local.pending.push(like(1));}return {operations:[],more:false};},write:async op=>({operation:op}),persist:async()=>{}});assert.equal(local.pending.length,0);assert.equal(local.operations.length,1);
 local.pending.push(like(2));const failure=await syncRecords({data:local,read:async()=>({operations:[],more:false}),write:async op=>({operation:{...op,value:false}}),persist:async()=>{}});assert.ok(failure.writeError);assert.equal(local.pending.length,1);
});
test('restore publishes each persisted page before the entire journal finishes',async()=>{
 const local=data();const pages=[];let requests=0;
 await syncRecords({data:local,read:async()=>({operations:[like(++requests)],more:requests<3}),write:async()=>{},persist:async()=>{},onPage:()=>pages.push(local.operations.length)});
 assert.deepEqual(pages,[1,2,3]);
});
test('a stalled pagination response ends with a recoverable error instead of looping',async()=>{
 const local=data();let requests=0;
 const result=await syncRecords({data:local,read:async()=>{requests++;return {operations:[],more:true}},write:async()=>{},persist:async()=>{}});
 assert.equal(requests,1);assert.match(result.readError.message,/no progress/);
});
test('one malformed cloud record cannot block valid favorites in the same page',async()=>{
 const local=data();let requests=0;
 const result=await syncRecords({data:local,read:async known=>{requests++;return {operations:requests===1?[like(1),{id:id(2),type:'unknown',at:2}]:[like(3)],more:requests===1}},write:async()=>{},persist:async()=>{}});
 assert.equal(requests,2);assert.deepEqual(local.operations.map(op=>op.id),[id(1),id(3)]);assert.ok(result.readError);assert.deepEqual(result.skipped,[id(2)]);
});
