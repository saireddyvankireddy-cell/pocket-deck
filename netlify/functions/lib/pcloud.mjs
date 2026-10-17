import { session } from './oauth.mjs';

const photos = new Set(['jpg','jpeg','png','webp','gif','heic','heif']);
const videos = new Set(["mp4","mov","m4v","3gp","avi","mkv"]);
const audio = new Set(['mp3','m4a','aac','wav','ogg','oga','opus','flac','webm']);
export function kindOf(name) {
  const ext = String(name || '').toLowerCase().split('.').pop();
  return videos.has(ext)?'video':photos.has(ext) ? 'photo' : audio.has(ext) ? 'audio' : null;
}
export function pcloudURL(request, method, params = {}) {
  const account = session(request);
  if (!account) throw new Error('Unauthorized');
  const url = new URL(`https://${account.host}/${method}`);
  // Keep the token server-side, including for binary thumbnail endpoints.
  url.searchParams.set(account.tokenType === 'auth' ? 'auth' : 'access_token', account.token);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  return url;
}
export async function call(request, method, params = {}) {
  const response = await fetch(pcloudURL(request, method, params), { signal: AbortSignal.timeout(30000) });
  const data = await response.json();
  if (!response.ok || data.result !== 0) {
    const error = new Error('pCloud request failed'); error.result = data.result; throw error;
  }
  return data;
}
export function flatten(folder, folderPath = '') {
  const name=folder.name || folderPath.split('/').filter(Boolean).at(-1) || 'pCloud';
  return (folder.contents || []).flatMap(item => item.isfolder
    ? flatten(item, (folderPath==='/'?'/':folderPath?folderPath.replace(/\/$/, '')+'/':'')+item.name)
    : [{...item,folderName:name,folderPath:folderPath || '/',folderId:String(folder.folderid ?? item.parentfolderid ?? '')}]);
}
export function paths(kind) {
  return (kind === 'photo' ? process.env.PCLOUD_PHOTO_PATHS || '/Pictures,/Automatic Upload,/Automatic Folder' : process.env.PCLOUD_AUDIO_PATHS || '/Music').split(',').map(value => value.trim()).filter(Boolean);
}

// Shallow batches avoid a single enormous recursive root response.
export async function scanFolderTree(read, target, initialPath = '', {deadlineMs=180000,maxFolders=20000}={}) {
  const queue=[{target,path:initialPath,root:true}];const visited=new Set();const files=[];const unavailable=[];const started=Date.now();let folders=0;
  while(queue.length){
    if(Date.now()-started>deadlineMs)throw new Error('Folder scan timed out');
    const batch=queue.splice(0,4);
    const results=await Promise.allSettled(batch.map(row=>read({...row.target,recursive:0})));
    for(let i=0;i<batch.length;i++){
      const row=batch[i],result=results[i];
      if(result.status==='rejected'){
        if(!row.root&&[2003,2005,2009,2055].includes(result.reason.result)){unavailable.push(row.path);continue;}
        throw result.reason;
      }
      const folder=result.value.metadata;if(!folder||!Array.isArray(folder.contents))throw new Error('Invalid folder response');
      const id=String(folder.folderid??row.target.folderid??row.target.path);if(visited.has(id))continue;visited.add(id);
      if(++folders>maxFolders)throw new Error('Folder scan limit reached');
      const path=row.path||folder.path||(String(folder.folderid)==='0'?'/':folder.name||'/');
      for(const item of folder.contents){
        if(item.isfolder){const childId=String(item.folderid??'');if(!/^\d{1,20}$/.test(childId))throw new Error('Invalid child folder');if(!visited.has(childId))queue.push({target:{folderid:childId},path:path.replace(/\/$/,'')+'/'+item.name,root:false});}
        else files.push({...item,folderName:folder.name||'pCloud',folderPath:path,folderId:String(folder.folderid??item.parentfolderid??'')});
      }
    }
  }
  return {files,unavailable,folders};
}
