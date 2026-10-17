import {cachedRecord,saveRecordCache} from './lib/local-cache.mjs';
import { authRequired, json, origin, session } from './lib/oauth.mjs';
import { call, pcloudURL } from './lib/pcloud.mjs';
import { validOperation } from '../../photo-state.mjs';

const listings=new Map();
const listingKey=request=>{const user=session(request);return user.host+':'+user.uid;};
const ROOT = '/Sai Photos/Web/v1/Operations';
const validID = id => /^[a-f0-9-]{36}$/.test(id || '');
async function readOperation(request, fileid, fresh=false) {
  if(!fresh){const cached=await cachedRecord(request,fileid);if(validOperation(cached))return cached;}
  const link = await call(request, 'getfilelink', { fileid });
  if (!/^[a-z0-9-]+\.pcloud\.com$/i.test(link.hosts?.[0] || '') || !link.path?.startsWith('/')) throw new Error('Invalid metadata link');
  const response = await fetch(`https://${link.hosts[0]}${link.path}`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('Metadata unavailable');
  const op = await response.json(); if (!validOperation(op)) throw new Error('Invalid metadata');if(!fresh)await saveRecordCache(request,fileid,op);return op;
}
export default async request => {
  const denied = authRequired(request); if (denied) return denied;
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (request.headers.get('origin') !== origin()) return json({ error: 'Request origin not allowed.' }, 403);
  const body = await request.json().catch(() => null);
  const action = new URL(request.url).searchParams.get('action');
  let stage = action === 'write' ? 'save app records' : 'restore app records';
  try {
    if (action === 'sync') {
      if (!Array.isArray(body?.known) || body.known.length > 90000 || !body.known.every(validID)) return json({ error: 'Invalid sync request.' }, 400);
      const known = new Set(body.known); let contents;
      try {const key=listingKey(request);const cached=listings.get(key);if(process.env.SAI_PHOTOS_CACHE_DISABLED!=='true'&&cached&&cached.until>Date.now())contents=cached.contents;else{contents=(await call(request,'listfolder',{path:ROOT})).metadata.contents||[];if(process.env.SAI_PHOTOS_CACHE_DISABLED!=='true')listings.set(key,{contents,until:Date.now()+5000});}}
      catch (error) { if ([2002, 2005, 2055].includes(error.result)) return json({ operations: [] }); throw error; }
      const missing = contents.filter(file => !file.isfolder && validID(file.name.replace(/\.json$/, '')) && !known.has(file.name.replace(/\.json$/, '')));
      // Send bounded pages; the client keeps requesting until all are received.
      const page=[];let uncached=0;
      for(let offset=0;offset<Math.min(missing.length,1000);offset+=32){const files=missing.slice(offset,Math.min(offset+32,1000));const flags=await Promise.all(files.map(file=>cachedRecord(request,file.fileid)));for(let i=0;i<files.length;i++){if(!validOperation(flags[i])&&uncached>=60)break;page.push(files[i]);if(!validOperation(flags[i]))uncached++;}if(uncached>=60)break;}
      const operations = []; const skipped = [];
      for (let i = 0; i < page.length; i += 6) {
        const files=page.slice(i,Math.min(i+6,page.length));const results=await Promise.allSettled(files.map(file=>readOperation(request,file.fileid)));
        for(let j=0;j<results.length;j++){const result=results[j];const id=files[j].name.replace(/\.json$/,'');if(result.status==='fulfilled'&&result.value.id===id)operations.push(result.value);else skipped.push(id);}
      }
      return json({ operations, skipped, more: missing.length > page.length });
    }
    if (action === 'write') {
      if (!validOperation(body?.operation)) return json({ error: 'Invalid photo metadata.' }, 400);
      const operation = { ...body.operation, at: Date.now() };
      const filename = `${operation.id}.json`;
      try {
        const existing = await call(request, 'stat', { path: `${ROOT}/${filename}` });
        return json({ operation: await readOperation(request, existing.metadata.fileid) });
      } catch (error) { if (![2002, 2005, 2009, 2055].includes(error.result)) throw error; }
      let folderid='0';
      for(const name of ['Sai Photos','Web','v1','Operations']){
        stage='create '+name+' app folder';
        const folder=await call(request,'createfolderifnotexists',{folderid,name});
        const next=String(folder.metadata?.folderid ?? '');
        if(!/^\d{1,20}$/.test(next))throw new Error('Folder creation not confirmed');
        folderid=next;
      }
      stage='upload app record';
      const form = new FormData(); form.append('folderid', folderid); form.append('nopartial', '1');
      form.append('file', new Blob([JSON.stringify(operation)], { type: 'application/json' }), filename);
      const response = await fetch(pcloudURL(request, 'uploadfile', {folderid,nopartial:1}), { method: 'POST', body: form, signal: AbortSignal.timeout(30000) });
      const data = await response.json(); if (!response.ok || data.result !== 0) {const error=new Error('Save failed');error.result=data.result;throw error;}
      const saved=data.metadata?.[0];if(!saved?.fileid)throw new Error('Upload not confirmed');
      stage='verify app record';const verified=await readOperation(request,saved.fileid,true);
      if(JSON.stringify(verified)!==JSON.stringify(operation))throw new Error('Saved record verification failed');
      await saveRecordCache(request,saved.fileid,verified);const listing=listings.get(listingKey(request));if(listing&&!listing.contents.some(file=>String(file.fileid)===String(saved.fileid)))listing.contents.push({fileid:saved.fileid,name:filename,isfolder:false});return json({ operation:verified });
    }
    return json({ error: 'Unknown metadata action.' }, 400);
  } catch(error) {
    const code=Number.isInteger(error.result)?error.result:null;
    const message=code===2003?`pCloud denied permission to ${stage} (code 2003). Your token needs write access to the Sai Photos folder.`:code===2008?'pCloud storage is full (code 2008). Free space in pCloud and retry.':[1000,2000].includes(code)?'pCloud sign-in expired. Reconnect to the same pCloud account.':`Could not ${stage}${code?' (pCloud code '+code+')':''}. Your pending record is retained and sync will retry automatically.`;
    return json({error:message,providerCode:code,stage},code===2003?403:[1000,2000].includes(code)?401:502);
  }
};
