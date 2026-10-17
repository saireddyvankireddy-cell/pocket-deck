import test from 'node:test';
import assert from 'node:assert/strict';
import {PhotoLibrary} from '../photo-library.mjs';

test('index start restores cloud versions before submitting known photos; failed restore launches no analysis',async()=>{
 const previous=globalThis.document;const elements=new Map();globalThis.document={getElementById:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}};
 try{
  const events=[];const ctx={account:'test',meta:{visuals:{},checksums:{}},photoFolder:()=>({id:'0'}),scopeLoading:false,indexing:false,sections(){events.push('buttons-ready');},visualProgress(){},async sync(){events.push('restore');this.meta.visuals['pc-1']={model:'clip-base32-q8-v1',version:'saved-version'};return true;},async api(path,options){events.push('submit');const request=JSON.parse(options.body);assert.equal(request.folderId,'0');assert.deepEqual(request.known,[{id:'pc-1',version:'saved-version'}]);},async index(){events.push('faces');}};
  ctx.startVisualIndex=PhotoLibrary.prototype.startVisualIndex;
  await PhotoLibrary.prototype.beginIndexing.call(ctx);
  assert.deepEqual(events,['restore','submit','faces','buttons-ready']);assert.equal(ctx.preparingIndex,false);
  events.length=0;ctx.sync=async()=>{events.push('failed-restore');return false;};ctx.cloudError='Offline';
  await PhotoLibrary.prototype.beginIndexing.call(ctx);
  assert.deepEqual(events,['failed-restore','buttons-ready']);assert.match(elements.get('indexStatus').textContent,/Indexing paused/);
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});

test('2,000 completed unchanged face indexes report full completion without invoking analysis',async()=>{
 const previous=globalThis.document;const elements=new Map();globalThis.document={getElementById:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}};
 try{
  const photos=Array.from({length:2000},(_,i)=>({id:'pc-'+(i+1),version:'unchanged'}));
  const ctx={account:'test',indexing:false,scopeLoading:false,photos:()=>photos,meta:{indexes:Object.fromEntries(photos.map(photo=>[photo.id,{version:photo.version}]))},data:{pending:[]},render(){}};
  await PhotoLibrary.prototype.index.call(ctx);
  assert.match(elements.get('indexStatus').textContent,/Already completed.*2,000 \/ 2,000/);assert.match(elements.get('indexStatus').textContent,/no re-indexing needed/);assert.equal(ctx.indexing,false);
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});

test('visual progress uses shared cloud records, not a local job estimate',async()=>{
 const previous=globalThis.document;const elements=new Map();globalThis.document={getElementById:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}};
 try{
  const photos=Array.from({length:2000},(_,i)=>({id:'pc-'+i,version:'v'}));
  const ctx={account:'test',photos:()=>photos,meta:{checksums:{},visuals:Object.fromEntries(photos.slice(0,600).map(p=>[p.id,{version:'v',model:'clip-base32-q8-v1'}]))},data:{pending:[]},api:async(path)=>path==='photo-analysis'?{phase:'Indexing',running:true,total:200,completed:80}:{}};
  await PhotoLibrary.prototype.visualProgress.call(ctx);assert.match(elements.get('visualIndexStatus').textContent,/600 \/ 2,000 completed · 1,400 pending/);
  ctx.meta.visuals=Object.fromEntries(photos.map(p=>[p.id,{version:'v',model:'clip-base32-q8-v1'}]));ctx.api=async()=>({phase:'Finished',running:false,total:0,completed:0});
  await PhotoLibrary.prototype.visualProgress.call(ctx);assert.match(elements.get('visualIndexStatus').textContent,/2,000 \/ 2,000 completed · 0 pending/);
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});

test('failed photo scan blocks index start before any cloud or AI work',async()=>{
 const previous=globalThis.document;const elements=new Map();globalThis.document={getElementById:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}};
 try{let called=false;const ctx={account:'test',indexing:false,scopeLoading:false,scanError:'Folder scan timed out',sync(){called=true;}};await PhotoLibrary.prototype.beginIndexing.call(ctx);assert.equal(called,false);assert.match(elements.get('indexStatus').textContent,/Indexing blocked.*timed out/);
 }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});

for(const mode of ['visual','faces','all'])test('Samsung '+mode+' indexing keeps visual and face models sequential',async()=>{
 const previousDocument=globalThis.document,previousWindow=globalThis.window;const elements=new Map();globalThis.window={SAI_ANDROID:true};globalThis.document={getElementById:id=>{if(!elements.has(id))elements.set(id,{value:id==='indexMode'?mode:'',close(){}});return elements.get(id);}};
 try{const events=[];const ctx={account:'sample',sections(){},async sync(){events.push('restore');return true;},async startVisualIndex(){events.push('visual');return true;},async index(){events.push('faces');},async api(){return {running:false,phase:'Finished'};},async visualProgress(){}};
  await PhotoLibrary.prototype.beginIndexing.call(ctx);
  assert.deepEqual(events,mode==='visual'?['restore','visual']:mode==='faces'?['restore','faces']:['restore','visual','restore','faces']);assert.equal(ctx.preparingIndex,false);
 }finally{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;}
});

test('Samsung Everything pauses before faces if visual indexing fails',async()=>{
 const previousDocument=globalThis.document,previousWindow=globalThis.window;const elements=new Map();globalThis.window={SAI_ANDROID:true};globalThis.document={getElementById:id=>{if(!elements.has(id))elements.set(id,{value:id==='indexMode'?'all':'',close(){}});return elements.get(id);}};
 try{let faces=0;const ctx={account:'sample',sections(){},async sync(){return true;},async startVisualIndex(){return true;},async index(){faces++;},async api(){return {running:false,phase:'Stopped',message:'pCloud write denied'};}};await PhotoLibrary.prototype.beginIndexing.call(ctx);assert.equal(faces,0);assert.match(elements.get('indexStatus').textContent,/pCloud write denied/);}finally{if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;if(previousWindow===undefined)delete globalThis.window;else globalThis.window=previousWindow;}
});

test('deleting a photo during a scan clears loading and requires a verifiable refresh',async()=>{
 const {cancelLibraryScan}=await import('../photo-tools.mjs');let aborted=0;
 const state={generation:7};const library={scopeLoading:true,scanError:''};
 assert.equal(cancelLibraryScan(state,library,{abort(){aborted++;}}),true);
 assert.equal(state.generation,8);assert.equal(aborted,1);assert.equal(library.scopeLoading,false);assert.match(library.scanError,/Refresh/);
 library.scopeLoading=false;library.scanError='';cancelLibraryScan(state,library,null);assert.equal(library.scanError,'');
});
