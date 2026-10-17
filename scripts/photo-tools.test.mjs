import test from 'node:test';
import assert from 'node:assert/strict';
import {photoGroups,hashDistance,perceptualHash,unpackEmbedding,cosine,duplicateCandidates} from '../photo-tools.mjs';
import {validOperation,replayOperations} from '../photo-state.mjs';
const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-000000000000`;
const photo=(n,size=100)=>({id:'pc-'+n,fileName:'photo'+n+'.jpg',size,version:'v1',contentHash:'123'});
const encoded=Buffer.from(new Array(512).fill(129)).toString('base64');
const feature=()=>({model:'clip-base32-q8-v1',version:'v1',phash:'f0f0f0f0f0f0f0f0',embedding:encoded,color:[.2,.3,.4],contrast:.2,width:1000,height:800});
test('duplicates keep the largest original and reject different geometry, content or blank thumbnails',()=>{
 const photos=[photo(1,100),photo(2,300),photo(3,200)];const visuals=Object.fromEntries(photos.map(p=>[p.id,feature()]));const groups=photoGroups(photos,visuals);assert.equal(groups.length,1);assert.equal(groups[0].keeper.id,'pc-2');assert.deepEqual(new Set(groups[0].copies.map(p=>p.id)),new Set(['pc-1','pc-3']));
 visuals['pc-1'].width=3000;assert.equal(photoGroups(photos,visuals)[0].copies.length,1);visuals['pc-3'].contrast=0;assert.equal(photoGroups(photos,visuals).length,0);
 const exact=photoGroups([photo(1),photo(2)],{}, {'pc-1':{version:'v1',sha1:'a'.repeat(40)},'pc-2':{version:'v1',sha1:'a'.repeat(40)}});assert.equal(exact[0].kind,'Byte-identical copies');
 assert.equal(duplicateCandidates([photo(1),photo(2),photo(3,900)]).length,2);
});
test('perceptual hashes and quantized embeddings are stable; visual search compares vectors',()=>{
 const pixels=Uint8Array.from({length:1024},(_,i)=>i%255);assert.equal(perceptualHash(pixels),perceptualHash(pixels));assert.equal(hashDistance('f'.repeat(16),'0'.repeat(16)),64);assert.equal(hashDistance('0'.repeat(16),'0'.repeat(15)+'1'),1);
 const vector=unpackEmbedding(encoded);assert.equal(vector.length,512);assert.ok(Math.abs(cosine(vector,vector)-1)<1e-6);
});
test('visual indexes, exact checksums, shared music folders and deletion batches restore from pCloud',()=>{
 const visual={id:id(1),at:1,type:'visual-index',photoId:'pc-1',...feature()};const checksum={id:id(2),at:2,type:'content-index',photoId:'pc-1',version:'v1',sha1:'a'.repeat(40)};const folder={id:id(3),at:3,type:'music-folder',folder:{id:'42',name:'My Music'}};assert.ok([visual,checksum,folder].every(validOperation));const state=replayOperations([visual,checksum,folder]);assert.equal(state.visuals['pc-1'].embedding,encoded);assert.equal(state.checksums['pc-1'].sha1,'a'.repeat(40));assert.equal(state.musicFolder.id,'42');
 const removed=replayOperations([visual,checksum,folder,{id:id(4),at:4,type:'photos-delete',photoIds:['pc-1']}]);assert.equal(removed.visuals['pc-1'],undefined);assert.equal(removed.checksums['pc-1'],undefined);assert.equal(validOperation({...visual,embedding:'fake'}),false);assert.equal(validOperation({id:id(5),at:5,type:'photos-delete',photoIds:['pc-1','pc-1']}),false);
});
