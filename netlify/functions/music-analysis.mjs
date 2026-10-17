import {randomUUID} from 'node:crypto';
import {authRequired,json,origin,session} from './lib/oauth.mjs';
import {call} from './lib/pcloud.mjs';
import listMedia from './media-list.mjs';
import metadata from './photo-metadata.mjs';
import {MUSIC_MODEL} from '../../smart-features.mjs';
import {normalizeTrack} from '../../music-state.mjs';
const jobs=new Map();
function key(request){const user=session(request);return user.host+':'+user.uid;}
function status(job){return job?{running:job.running,total:job.total,completed:job.completed,phase:job.phase,message:job.message,folderId:job.folderId}:{running:false,total:0,completed:0};}
async function run(request,job,known){
 try{
  const response=await listMedia(new Request(new URL('./media-list?kind=audio'+(job.folderId===null?'':'&folderid='+encodeURIComponent(job.folderId)),request.url),{headers:request.headers}));const data=await response.json();if(!response.ok)throw new Error(data.error);
  const existing=new Map(known.map(row=>[row.id,row.version]));const tracks=data.items.filter(track=>existing.get(track.id)!==track.version);job.total=tracks.length;
  const {textEmbedding}=await import('./lib/visual-ai.mjs');
  for(const track of tracks){if(job.stop)break;job.phase='Indexing song titles';const current=(await call(request,'stat',{fileid:track.id.slice(3)})).metadata;if(String(current.hash||current.modified||'')!==track.version)continue;const vector=await textEmbedding(track.name,'music title: ');if(job.stop)break;const embedding=Buffer.from(vector.map(x=>Math.max(1,Math.min(255,Math.round(x*127)+128)))).toString('base64');const operation={id:randomUUID(),at:Date.now(),type:'music-index',track:normalizeTrack(track),model:MUSIC_MODEL,embedding};const saved=await metadata(new Request(new URL('./photo-metadata?action=write',request.url),{method:'POST',headers:request.headers,body:JSON.stringify({operation})}));const result=await saved.json();if(!saved.ok)throw new Error(result.error);job.completed++;}
  job.phase=job.stop?'Paused':'Finished';
 }catch(error){job.phase='Stopped';job.message=/pCloud|permission|expired/i.test(error.message)?error.message:'Song title indexing could not finish. Keep the Mac awake and retry.';}finally{job.running=false;}
}
export default async request=>{
 const denied=authRequired(request);if(denied)return denied;
 if(request.method==='GET')return json(status(jobs.get(key(request))));
 if(request.method!=='POST')return json({error:'Method not allowed.'},405);
 if(request.headers.get('origin')!==origin())return json({error:'Request origin not allowed.'},403);
 const body=await request.json().catch(()=>null);const id=key(request);
 if(body?.action==='stop'){const job=jobs.get(id);if(job)job.stop=true;return json(status(job));}
 if(body?.action==='text'){if(typeof body.query!=='string'||!body.query.trim()||body.query.length>300)return json({error:'Invalid music search.'},400);try{const {textEmbedding}=await import('./lib/visual-ai.mjs');return json({embedding:await textEmbedding(body.query,'music title: '),model:MUSIC_MODEL});}catch{return json({error:'Music AI search is unavailable. Keep the Mac awake and retry.'},503);}}
 if(body?.action!=='start'||!Array.isArray(body.known)||body.known.length>90000||!body.known.every(row=>/^pc-\d{1,20}$/.test(row.id||'')&&typeof row.version==='string'&&row.version.length<200)||(body.folderId!==null&&body.folderId!==undefined&&!/^\d{1,20}$/.test(body.folderId)))return json({error:'Invalid music index request.'},400);
 const folderId=body.folderId??null;const current=jobs.get(id);if(current?.running){if(current.stop||current.folderId!==folderId)return json({error:'Previous song indexing is stopping. Wait a moment and retry.'},409);return json(status(current));}
 const job={folderId,running:true,total:0,completed:0,phase:'Starting',message:'',stop:false};jobs.set(id,job);void run(request,job,body.known);return json(status(job));
};
