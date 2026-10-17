import {authRequired,json,origin} from './lib/oauth.mjs';
import {call} from './lib/pcloud.mjs';
export default async request=>{
 const denied=authRequired(request);if(denied)return denied;if(request.method!=='POST')return json({error:'Method not allowed.'},405);if(request.headers.get('origin')!==origin())return json({error:'Request origin not allowed.'},403);
 const body=await request.json().catch(()=>null);const action=body?.action;
 if(body?.confirmed!==true||(action!=='copy'&&action!=='move')||typeof body.targetFolderId!=='string'||!/^\d{1,20}$/.test(body.targetFolderId)||!Array.isArray(body.items)||!body.items.length||body.items.length>25||!body.items.every(item=>/^pc-\d+$/.test(item.id||'')&&typeof item.fileName==='string'&&item.fileName.length>0&&item.fileName.length<=1024)||new Set(body.items.map(item=>item.id)).size!==body.items.length)return json({error:'Review the selected photos and destination before transferring.'},400);
 const results=[];
 for(const item of body.items){
  try{
   await call(request,action==='move'?'renamefile':'copyfile',{fileid:item.id.slice(3),topath:body.targetFolderId,toname:item.fileName});
   results.push(action==='move'?{id:item.id,moved:true}:{id:item.id,copied:true});
  }catch(error){results.push({id:item.id,error:'Could not '+(action==='move'?'move':'copy')+' this photo'+(error&&error.result?' (pCloud '+error.result+')':'')+'.'});}
 }
 return json({results});
};
