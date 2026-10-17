export const VISUAL_MODEL='clip-base32-q8-v1';
export function cosine(a,b){let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i];}return aa&&bb?dot/Math.sqrt(aa*bb):0;}
export function unpackEmbedding(encoded){const bytes=typeof atob==='function'?Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)):Buffer.from(encoded,'base64');return Float32Array.from(bytes,x=>(x-128)/127);}
export function hashDistance(a,b){let distance=0;for(let i=0;i<a.length;i++){let bits=parseInt(a[i],16)^parseInt(b[i],16);while(bits){distance++;bits&=bits-1;}}return distance;}
export function perceptualHash(pixels){
 const values=[];for(let v=0;v<8;v++)for(let u=0;u<8;u++){let sum=0;for(let y=0;y<32;y++)for(let x=0;x<32;x++)sum+=pixels[y*32+x]*Math.cos((2*x+1)*u*Math.PI/64)*Math.cos((2*y+1)*v*Math.PI/64);values.push(sum);}
 const median=[...values.slice(1)].sort((a,b)=>a-b)[31];let hash='';for(let i=0;i<64;i+=4){let digit=0;for(let j=0;j<4;j++)digit=(digit<<1)|(values[i+j]>median?1:0);hash+=digit.toString(16);}return hash;
}
class HashTree {
 add(hash,value){if(!this.root){this.root={hash,value,children:new Map()};return;}let node=this.root;while(true){const distance=hashDistance(hash,node.hash);if(!node.children.has(distance)){node.children.set(distance,{hash,value,children:new Map()});return;}node=node.children.get(distance);}}
 near(hash,radius){const result=[];const stack=this.root?[this.root]:[];while(stack.length){const node=stack.pop();const distance=hashDistance(hash,node.hash);if(distance<=radius)result.push(node.value);for(const [edge,child]of node.children)if(edge>=distance-radius&&edge<=distance+radius)stack.push(child);}return result;}
}
export function photoGroups(photos,visuals,checksums={},similar=false){
 const ordered=[...photos].sort((a,b)=>b.size-a.size||a.id.localeCompare(b.id));const exact=new Map();const assigned=new Set();const groups=[];
 if(!similar){for(const photo of ordered){const sum=checksums[photo.id];if(sum?.version!==photo.version||!sum.sha1)continue;const key=sum.sha1+':'+photo.size;const list=exact.get(key)||[];list.push(photo);exact.set(key,list);}for(const list of exact.values())if(list.length>1){groups.push({keeper:list[0],copies:list.slice(1),kind:'Byte-identical copies'});list.forEach(photo=>assigned.add(photo.id));}}
 const tree=new HashTree();const vectors=new Map();const vector=id=>{if(!vectors.has(id))vectors.set(id,unpackEmbedding(visuals[id].embedding));return vectors.get(id);};for(const group of groups){const feature=visuals[group.keeper.id];if(feature?.phash&&feature.version===group.keeper.version)tree.add(feature.phash,group);}
 for(const photo of ordered){if(assigned.has(photo.id))continue;const feature=visuals[photo.id];if(!feature||feature.version!==photo.version||feature.contrast<0.02)continue;let found;
 for(const group of tree.near(feature.phash,similar?10:3)){
  const other=visuals[group.keeper.id];const ratio=(feature.width/feature.height)/(other.width/other.height);const color=feature.color.reduce((sum,value,i)=>sum+Math.abs(value-other.color[i]),0)/3;
  if(Math.abs(1-ratio)>(similar?0.2:0.025)||color>(similar?0.18:0.055))continue;
  if(feature.embedding&&other.embedding&&cosine(vector(photo.id),vector(group.keeper.id))<(similar?0.75:0.96))continue;
  found=group;break;
 }
 if(found){found.copies.push(photo);if(found.kind==='Byte-identical copies')found.kind='Mixed exact and visual copies · review carefully';}else{const group={keeper:photo,copies:[],kind:similar?'Similar photos · review carefully':'Visually matching copies · review carefully'};groups.push(group);tree.add(feature.phash,group);}
 }
 return groups.filter(group=>group.copies.length);
}
export function duplicateCandidates(photos){const groups=new Map();for(const photo of photos){if(!photo.contentHash)continue;const key=photo.contentHash+':'+photo.size;const group=groups.get(key)||[];group.push(photo);groups.set(key,group);}return [...groups.values()].filter(group=>group.length>1).flat();}
export function formatSize(bytes){if(!Number.isFinite(bytes)||bytes<0)return 'Size unavailable';if(bytes>=1024**3)return (bytes/1024**3).toFixed(2)+' GB';if(bytes>=1024**2)return (bytes/1024**2).toFixed(2)+' MB';if(bytes>=1024)return (bytes/1024).toFixed(1)+' KB';return bytes+' B';}

export async function withIndexDeadline(promise,ms,label='Indexing'){
 let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>{const error=new Error(label+' timed out; saved indexes are retained.');error.name='IndexTimeout';reject(error);},ms);})]);}finally{clearTimeout(timer);}
}

// Keep pCloud numeric hashes compatible with existing JavaScript cloud records.
export function normalizeFileVersion(value){const text=String(value??'');if(/^(?:[0-9]{15,}|[0-9]+(?:\.[0-9]+)?[eE]\+?[0-9]+)$/.test(text)){const number=Number(text);if(Number.isFinite(number)&&number>=1e14)return String(number);}return text;}

// Conservative visual matches: weak similarities must not become search results.
export function confidentVisualScores(scores,minimum=.28,band=.04){
 const entries=[...scores].filter(([,score])=>Number.isFinite(score));
 const best=entries.reduce((max,[,score])=>Math.max(max,score),-Infinity);
 const cutoff=Math.max(minimum,best-band);
 return new Map(entries.filter(([,score])=>score>=cutoff));
}

// Count only current, cloud-confirmed records in the selected photo scope.
export function sharedIndexProgress(library,stage='visual'){
 const photos=library.photos().filter(p=>p.mediaType!=='video');
 const type=stage==='visual'?'visual-index':stage==='faces'?'index':'content-index';
 const map=stage==='visual'?library.meta.visuals:stage==='faces'?library.meta.indexes:library.meta.checksums;
 const unsaved=new Set((library.data?.pending||[]).filter(op=>op.type===type).map(op=>op.photoId+':'+normalizeFileVersion(op.version)));
 const done=photos.filter(p=>{const index=map?.[p.id];return index&&normalizeFileVersion(index.version)===normalizeFileVersion(p.version||String(p.addedAt))&&(stage!=='visual'||index.model===VISUAL_MODEL)&&!unsaved.has(p.id+':'+normalizeFileVersion(index.version));}).length;
 return {done,pending:photos.length-done,total:photos.length};
}
export function sharedIndexLabel(library,stage='visual'){
 const c=sharedIndexProgress(library,stage);
 return `${c.done.toLocaleString()} / ${c.total.toLocaleString()} completed · ${c.pending.toLocaleString()} pending`;
}

export function cancelLibraryScan(state,library,controller){
 const scanning=library.scopeLoading;
 state.generation++;controller?.abort();library.scopeLoading=false;
 if(scanning)library.scanError='Folder scan was cancelled after a library change. Refresh to verify the folder before indexing.';
 return scanning;
}
