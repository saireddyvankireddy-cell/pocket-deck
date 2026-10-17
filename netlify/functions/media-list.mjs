import { authRequired, json } from './lib/oauth.mjs';
import { call, flatten, kindOf, paths, scanFolderTree } from './lib/pcloud.mjs';
export default async request => {
  const denied = authRequired(request); if (denied) return denied;
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');
  const folderid = url.searchParams.get('folderid');
  if (!['photo', 'audio'].includes(kind)) return json({ error: 'Invalid library kind.' }, 400);
  if (folderid !== null && !/^\d{1,20}$/.test(folderid)) return json({ error: 'Invalid library folder.' }, 400);
  try {
    const found = new Map();
    const scanned = new Set(); const missingPaths = []; const unavailableFolders=[];
    for (const target of folderid === null ? paths(kind).map(path => ({ path })) : [{ folderid }]) {
      try {
        let files;
        if(folderid==='0'){const scan=await scanFolderTree(params=>call(request,'listfolder',params),target,'/');files=scan.files;unavailableFolders.push(...scan.unavailable);}
        else {const data=await call(request,'listfolder',{...target,recursive:1});files=flatten(data.metadata,target.path||data.metadata.path||data.metadata.name||'');}
        for (const file of files) {
          scanned.add(file.fileid);
          const mediaType=kindOf(file.name);if(mediaType!==kind&&!(kind==='photo'&&mediaType==='video'))continue;
          found.set(file.fileid, { id: `pc-${file.fileid}`, mediaType, name: file.name.replace(/\.[^.]+$/, ''), fileName: file.name, size: Number(file.size || 0), folderName: file.folderName, folderPath: file.folderPath, folderId: file.folderId, addedAt: Date.parse(file.created || file.modified) || 0, version: String(file.hash || file.modified || ''), contentHash: file.hash ? String(file.hash) : '', width: Number(file.width || 0), height: Number(file.height || 0) });
        }
      } catch (error) { if (folderid !== null || ![2002, 2005, 2055].includes(error.result)) throw error; missingPaths.push(target.path); }
    }
    return json({ items: [...found.values()].sort((a, b) => b.addedAt - a.addedAt), scan: { totalFiles: scanned.size, otherFiles: scanned.size - found.size, missingPaths, unavailableFolders, complete:unavailableFolders.length===0 } });
  } catch(error) {
    const code=Number.isInteger(error.result)?error.result:null;
    const message=code===2003?'pCloud denied folder access (code 2003). Your token must be allowed to read this folder.':code===2000||code===1000?'pCloud sign-in expired. Reconnect and refresh.':error.name==='TimeoutError'||/timed out/.test(error.message)?'pCloud folder scan timed out. Refresh to retry or choose a smaller folder.':`Could not scan pCloud folders${code?' (pCloud code '+code+')':''}. Refresh to retry. Indexing has not started.`;
    return json({error:message,providerCode:code,scanFailed:true},code===2003?403:code===2000||code===1000?401:502);
  }
};
