import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,readdir,stat,unlink} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {session} from './oauth.mjs';
const root=process.env.SAI_PHOTOS_CACHE_DIR||join(process.platform==='darwin'?join(homedir(),'Library','Caches'):process.env.XDG_CACHE_HOME||join(homedir(),'.cache'),'Sai Photos');
const quick=promise=>Promise.race([promise,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Local cache unavailable')),2000);timer.unref();promise.finally(()=>clearTimeout(timer)).catch(()=>{});})]);
const digest=value=>createHash('sha256').update(value).digest('hex');
function account(request){const user=session(request);return digest(user.host+':'+user.uid);}
const records=new Map();
const disabled=()=>process.env.SAI_PHOTOS_CACHE_DISABLED==='true';
export async function cachedRecord(request,fileid){if(disabled())return null;const key=account(request)+':'+fileid;if(records.has(key))return records.get(key);try{const record=JSON.parse(await quick(readFile(join(root,'records',account(request),String(fileid)+'.json'),'utf8')));records.set(key,record);return record;}catch{return null;}}
export async function saveRecordCache(request,fileid,record){if(disabled())return;records.set(account(request)+':'+fileid,record);try{const folder=join(root,'records',account(request));await quick(mkdir(folder,{recursive:true}));await quick(writeFile(join(folder,String(fileid)+'.json'),JSON.stringify(record),{mode:0o600}));}catch{}}
export async function cachedPreview(request,metadata,mode){if(disabled())return null;const folder=join(root,'previews',account(request));const name=String(metadata.fileid)+'-'+digest(String(metadata.hash||metadata.modified)+'-'+mode)+'.jpg';const path=join(folder,name);try{return {bytes:await quick(readFile(path)),path};}catch{return {bytes:null,path,folder};}}
let previewWrites=0;
export async function savePreviewCache(entry,bytes){if(!entry||disabled())return;try{await quick(mkdir(entry.folder,{recursive:true}));await quick(writeFile(entry.path,bytes,{mode:0o600}));if(++previewWrites%50===0){const files=await readdir(entry.folder);if(files.length>2000){const ages=await Promise.all(files.map(async name=>({name,age:(await stat(join(entry.folder,name))).mtimeMs})));ages.sort((a,b)=>a.age-b.age);await Promise.all(ages.slice(0,files.length-2000).map(row=>unlink(join(entry.folder,row.name))));}}}catch{}}
export async function clearPreviewCache(request,fileid){try{const folder=join(root,'previews',account(request));for(const name of await readdir(folder))if(name.startsWith(String(fileid)+'-'))await unlink(join(folder,name));}catch{}}
