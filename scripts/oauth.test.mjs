process.env.SAI_PHOTOS_CACHE_DISABLED='true';
import { pcloudURL } from '../netlify/functions/lib/pcloud.mjs';
import musicDelete from '../netlify/functions/music-delete.mjs';
import test from 'node:test';
import {existsSync} from 'node:fs';
import assert from 'node:assert/strict';
import { authHandler, session } from '../netlify/functions/lib/oauth.mjs';
import listMedia from '../netlify/functions/media-list.mjs';
import mediaContent from '../netlify/functions/media-content.mjs';
import folders from '../netlify/functions/folders.mjs';
import photoMetadata from '../netlify/functions/photo-metadata.mjs';
import photoDelete from '../netlify/functions/photo-delete.mjs';
import photosDelete from '../netlify/functions/photos-delete.mjs';
import photoAnalysis from '../netlify/functions/photo-analysis.mjs';
import musicAnalysis from '../netlify/functions/music-analysis.mjs';

test('OAuth state, session isolation, region validation and protected media', async () => {
  process.env.PCLOUD_CLIENT_ID = 'test-client';
  process.env.PCLOUD_CLIENT_SECRET = 'test-secret';
  process.env.SAI_PHOTOS_SESSION_KEY = 'a'.repeat(64);
  process.env.SAI_PHOTOS_ORIGIN = 'https://photos.example';
  process.env.SAI_PHOTOS_ALLOW_HTTP = 'false';
  const base = 'https://photos.example/.netlify/functions/';
  const req = (path, options = {}) => new Request(base + path, options);
  const originalFetch = globalThis.fetch;
  let called = 0;
  try {
    globalThis.fetch = async (url, options) => {
      called++;
      assert.equal(new URL(url).hostname, 'eapi.pcloud.com');
      assert.equal(options.body.get('client_secret'), 'test-secret');
      return new Response(JSON.stringify({ result: 0, access_token: 'mock-token', uid: 123 }));
    };
    assert.equal((await listMedia(req('media-list?kind=photo'))).status, 401);
    const start = await authHandler(req('pcloud-auth?action=start'));
    assert.equal(start.status, 302);
    const authURL = new URL(start.headers.get('location'));
    assert.equal(authURL.hostname, 'my.pcloud.com');
    assert.equal(authURL.searchParams.get('response_type'), 'code');
    assert.equal(authURL.searchParams.get('redirect_uri'), base + 'pcloud-auth?action=callback');
    const state = authURL.searchParams.get('state');
    const stateCookie = start.headers.getSetCookie()[0].split(';')[0];
    assert.match(start.headers.getSetCookie()[0], /HttpOnly; SameSite=Lax.*Secure/);
    const callback = `pcloud-auth?action=callback&code=mock-code&state=${state}&hostname=eapi.pcloud.com`;
    assert.equal((await authHandler(req(callback))).status, 400);
    assert.equal((await authHandler(req(callback.replace(state, 'wrong'), { headers: { cookie: stateCookie } }))).status, 400);
    assert.equal((await authHandler(req(callback.replace('eapi.pcloud.com', 'attacker.example'), { headers: { cookie: stateCookie } }))).status, 400);
    assert.equal(called, 0);
    const complete = await authHandler(req(callback, { headers: { cookie: stateCookie } }));
    assert.equal(complete.status, 302); assert.equal(called, 1);
    const cookies = complete.headers.getSetCookie(); assert.equal(cookies.length, 2);
    const cookie = cookies[0].split(';')[0];
    assert.ok(!cookie.includes('mock-token'));
    const authenticated = req('pcloud-auth?action=status', { headers: { cookie } });
    assert.equal(session(authenticated).host, 'eapi.pcloud.com');
    assert.equal(session(req('pcloud-auth?action=status')), null);
    assert.equal(session(req('pcloud-auth?action=status', { headers: { cookie: cookie.slice(0, -8) + 'tampered' } })), null);
    assert.equal((await authHandler(req('pcloud-auth?action=logout', { method: 'POST', headers: { origin: 'https://attacker.example', cookie } }))).status, 403);
    const logout = await authHandler(req('pcloud-auth?action=logout', { method: 'POST', headers: { origin: 'https://photos.example', cookie } }));
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    globalThis.fetch = async url => {
      assert.equal(new URL(url).searchParams.get('access_token'), 'mock-token');
      return new Response(JSON.stringify({ result: 0, metadata: { contents: [{ fileid: 1, name: 'one.jpg', size: 10, created: '2026-10-13' }, { fileid: 2, name: 'two.mp3', size: 12 }, { fileid: 3, name: 'private.txt' }] } }));
    };
    const library = await listMedia(req('media-list?kind=photo', { headers: { cookie } }));
    assert.deepEqual((await library.json()).items.map(item => item.id), ['pc-1']);
    assert.equal((await folders(req('folders?folderid=0'))).status, 401);
    assert.equal((await folders(req('folders?folderid=bad', { headers: { cookie } }))).status, 400);
    const folderCalls = [];
    globalThis.fetch = async url => {
      const parsed = new URL(url); folderCalls.push(parsed.searchParams);
      assert.equal(parsed.hostname, 'eapi.pcloud.com');
      return new Response(JSON.stringify({ result: 0, metadata: { folderid: 42, name: 'Music', contents: [{ isfolder: true, folderid: 99, name: 'Albums', contents: [{ fileid: 88, name: 'song.mp3', size: 12 }] }, { fileid: 90, name: 'cover.jpg', size: 10 }] } }));
    };
    const folderResult = await folders(req('folders?folderid=42', { headers: { cookie } }));
    assert.deepEqual((await folderResult.json()).folders, [{ id: '99', name: 'Albums' }]);
    assert.equal(folderCalls[0].get('recursive'), '0');
    const selectedMusic = await listMedia(req('media-list?kind=audio&folderid=42', { headers: { cookie } }));
    assert.deepEqual((await selectedMusic.json()).items.map(item => item.id), ['pc-88']);
    assert.equal(folderCalls.length, 2); assert.equal(folderCalls[1].get('folderid'), '42');
    assert.equal(folderCalls[1].get('recursive'), '1'); assert.equal(folderCalls[1].has('path'), false);
    const selectedPhotos=await listMedia(req('media-list?kind=photo&folderid=42', { headers: { cookie } }));const photoScan=await selectedPhotos.json();assert.equal(selectedPhotos.status,200);assert.deepEqual(photoScan.items.map(item=>item.id),['pc-90']);assert.deepEqual(photoScan.scan,{totalFiles:2,otherFiles:1,missingPaths:[],unavailableFolders:[],complete:true});assert.equal(folderCalls.at(-1).get('folderid'),'42');assert.equal(folderCalls.at(-1).get('recursive'),'1');
    assert.equal((await listMedia(req('media-list?kind=photo&folderid=bad', { headers: { cookie } }))).status,400);
    assert.equal((await mediaContent(req('media-content?id=../../secret', { headers: { cookie } }))).status, 400);
    globalThis.fetch = async (url, options) => {
      const parsed = new URL(url);
      if (parsed.pathname === '/stat') return new Response(JSON.stringify({ result: 0, metadata: { name: 'song.mp3' } }));
      if (parsed.pathname === '/getfilelink') return new Response(JSON.stringify({ result: 0, hosts: ['c1.pcloud.com'], path: '/signed/song.mp3' }));
      assert.equal(options.headers.get('range'), 'bytes=0-2');
      return new Response('abc', { status: 206, headers: { 'content-range': 'bytes 0-2/10', 'content-type': 'audio/mpeg' } });
    };
    const media = await mediaContent(req('media-content?id=pc-2', { headers: { cookie, range: 'bytes=0-2' } }));
    assert.equal(media.status, 206); assert.equal(media.headers.get('content-range'), 'bytes 0-2/10');
    assert.equal(await media.text(), 'abc');
    const metadataOperation = { id:'11111111-1111-4111-8111-111111111111', at:1, type:'favorite', photoId:'pc-1', value:true };
    const metadataRequest = (action, body, origin = 'https://photos.example') => req('photo-metadata?action=' + action, { method:'POST', headers:{ cookie, origin, 'content-type':'application/json' }, body:JSON.stringify(body) });
    assert.equal((await photoMetadata(metadataRequest('write',{operation:metadataOperation},'https://attacker.example'))).status,403);
    let savedOperation;
    let uploadCount = 0; let missingRecordCode = 2055;
    globalThis.fetch = async (url, options) => {
      const parsed = new URL(url);
      if (parsed.hostname === 'c1.pcloud.com') return new Response(JSON.stringify(savedOperation));
      if (parsed.pathname === '/stat') return new Response(JSON.stringify(savedOperation ? {result:0,metadata:{fileid:99}} : {result:missingRecordCode}));
      if (parsed.pathname === '/createfolderifnotexists') { assert.ok(['Sai Photos','Web','v1','Operations'].includes(parsed.searchParams.get('name'))); assert.match(parsed.searchParams.get('folderid'),/^\d+$/);return new Response(JSON.stringify({result:0,metadata:{folderid:42}})); }
      if (parsed.pathname === '/uploadfile') {
        assert.equal(options.body.get('folderid'),'42');assert.equal(parsed.searchParams.get('folderid'),'42');
        savedOperation=JSON.parse(await options.body.get('file').text());
        assert.ok(!JSON.stringify(savedOperation).includes('mock-token')); uploadCount++;
        return new Response(JSON.stringify({result:0,metadata:[{fileid:99}]}));
      }
      if (parsed.pathname === '/listfolder') return new Response(JSON.stringify({result:0,metadata:{contents:[{fileid:99,name:metadataOperation.id+'.json'}]}}));
      if (parsed.pathname === '/getfilelink') return new Response(JSON.stringify({result:0,hosts:['c1.pcloud.com'],path:'/operation.json'}));
      throw new Error('Unexpected metadata request');
    };
    assert.equal((await photoMetadata(metadataRequest('write',{operation:metadataOperation}))).status,200);
    assert.equal((await photoMetadata(metadataRequest('write',{operation:metadataOperation}))).status,200);
    assert.equal(uploadCount,1);
    const restore=await photoMetadata(metadataRequest('sync',{known:[]}));
    assert.equal((await restore.json()).operations[0].photoId,'pc-1');
    const incremental=await photoMetadata(metadataRequest('sync',{known:[metadataOperation.id]}));
    assert.equal((await incremental.json()).operations.length,0);
    globalThis.fetch=async url=>{
      const parsed=new URL(url);
      if(parsed.pathname==='/listfolder')return new Response(JSON.stringify({result:0,metadata:{contents:[{fileid:99,name:metadataOperation.id+'.json'},{fileid:100,name:'22222222-2222-4222-8222-222222222222.json'}]}}));
      if(parsed.pathname==='/getfilelink')return new Response(JSON.stringify({result:0,hosts:['c1.pcloud.com'],path:parsed.searchParams.get('fileid')==='99'?'/valid.json':'/bad.json'}));
      return new Response(parsed.pathname==='/valid.json'?JSON.stringify(savedOperation):'not json');
    };
    const partial=await photoMetadata(metadataRequest('sync',{known:[]}));const partialData=await partial.json();assert.equal(partial.status,200);assert.equal(partialData.operations.length,1);assert.deepEqual(partialData.skipped,['22222222-2222-4222-8222-222222222222']);
    globalThis.fetch=async()=>new Response(JSON.stringify({result:2003}));const deniedWrite=await photoMetadata(metadataRequest('write',{operation:metadataOperation}));assert.equal(deniedWrite.status,403);assert.equal((await deniedWrite.json()).providerCode,2003);
    globalThis.fetch=async (url,options)=>{const parsed=new URL(url);if(parsed.pathname==='/stat')return new Response(JSON.stringify({result:2009}));if(parsed.pathname==='/createfolderifnotexists')return new Response(JSON.stringify({result:0,metadata:{folderid:42}}));if(parsed.pathname==='/uploadfile')return new Response(JSON.stringify({result:0,metadata:[{fileid:101}]}));if(parsed.pathname==='/getfilelink')return new Response(JSON.stringify({result:0,hosts:['c1.pcloud.com'],path:'/wrong.json'}));return new Response(JSON.stringify({...metadataOperation,value:false}));};
    const unverified=await photoMetadata(metadataRequest('write',{operation:metadataOperation}));assert.equal(unverified.status,502);assert.equal((await unverified.json()).stage,'verify app record');
    globalThis.fetch=async()=>new Response(JSON.stringify({result:2055}));
    const emptyCloud=await photoMetadata(metadataRequest('sync',{known:[]}));assert.equal(emptyCloud.status,200);assert.deepEqual((await emptyCloud.json()).operations,[]);
    const deleteRequest = (body, origin = 'https://photos.example') => req('photo-delete', { method:'POST', headers:{ cookie, origin, 'content-type':'application/json' }, body:JSON.stringify(body) });
    const confirmed = { id:'pc-1', fileName:'photo.jpg', confirmed:true };
    let deletes = 0; let statName = 'photo.jpg'; let deleteFails = false; let missing = false; let unconfirmed = false; let shared = false; let providerFailure = null;
    globalThis.fetch = async url => {
      const parsed = new URL(url);
      assert.equal(parsed.hostname,'eapi.pcloud.com'); assert.equal(parsed.searchParams.get('fileid'),'1');
      if (providerFailure) return new Response(JSON.stringify({result:providerFailure}));
      if (parsed.pathname === '/stat') return new Response(JSON.stringify(missing ? {result:2009} : {result:0,metadata:{name:statName,fileid:1,isfolder:false,...(shared ? {ismine:false,candelete:false} : {})}}));
      assert.equal(parsed.pathname,'/deletefile'); deletes++;
      return new Response(JSON.stringify(deleteFails ? {result:2003} : {result:0,metadata:{fileid:1,isdeleted:!unconfirmed}}));
    };
    assert.equal((await photoDelete(deleteRequest(confirmed,'https://attacker.example'))).status,403);
    assert.equal((await photoDelete(deleteRequest({...confirmed,confirmed:false}))).status,400);
    assert.equal((await photoDelete(req('photo-delete',{headers:{cookie}}))).status,405);
    assert.equal(deletes,0);
    statName='song.mp3'; assert.equal((await photoDelete(deleteRequest(confirmed))).status,400); assert.equal(deletes,0);
    statName='renamed.jpg'; assert.equal((await photoDelete(deleteRequest(confirmed))).status,409); assert.equal(deletes,0);
    statName='photo.jpg'; const removed=await photoDelete(deleteRequest(confirmed)); assert.equal(removed.status,200); assert.equal((await removed.json()).deleted,true); assert.equal(deletes,1);
    deleteFails=true; const failure=await photoDelete(deleteRequest(confirmed)); assert.equal(failure.status,403); assert.notEqual((await failure.json()).deleted,true);
    deleteFails=false; unconfirmed=true; assert.equal((await photoDelete(deleteRequest(confirmed))).status,502);
    missing=true; const previousDeletes=deletes; assert.equal((await photoDelete(deleteRequest(confirmed))).status,200); assert.equal(deletes,previousDeletes);
    missing=false;unconfirmed=false;statName='song.mp3';
    const song={...confirmed,fileName:'song.mp3'};
    assert.equal((await musicDelete(deleteRequest(song,'https://attacker.example'))).status,403);
    assert.equal((await musicDelete(deleteRequest({...song,confirmed:false}))).status,400);
    assert.equal((await musicDelete(req('music-delete',{headers:{cookie}}))).status,405);
    statName='photo.jpg';assert.equal((await musicDelete(deleteRequest(song))).status,400);
    statName='renamed.mp3';assert.equal((await musicDelete(deleteRequest(song))).status,409);
    statName='song.mp3';assert.equal((await musicDelete(deleteRequest(song))).status,200);
    deleteFails=true;assert.equal((await musicDelete(deleteRequest(song))).status,403);
    deleteFails=false;unconfirmed=true;assert.equal((await musicDelete(deleteRequest(song))).status,502);
    missing=true;const musicDeletes=deletes;assert.equal((await musicDelete(deleteRequest(song))).status,200);assert.equal(deletes,musicDeletes);
    missing=false;unconfirmed=false;shared=true;statName='photo.jpg';const beforeShared=deletes;
    const sharedDenied=await photoDelete(deleteRequest(confirmed));assert.equal(sharedDenied.status,403);assert.equal((await sharedDenied.json()).reason,'shared-folder-permission');assert.equal(deletes,beforeShared);
    shared=false;providerFailure=2000;const expired=await photoDelete(deleteRequest(confirmed));assert.equal(expired.status,401);assert.equal((await expired.json()).providerCode,2000);
    providerFailure=5000;const unavailable=await photoDelete(deleteRequest(confirmed));assert.equal(unavailable.status,502);const diagnosis=await unavailable.json();assert.equal(diagnosis.providerCode,5000);assert.equal(diagnosis.stage,'stat');assert.ok(!JSON.stringify(diagnosis).includes('mock-token'));
    providerFailure=null;
    const bulkBody={confirmed:true,items:[{id:'pc-1',fileName:'photo.jpg',version:'old'},{id:'pc-2',fileName:'two.jpg',version:'current'}]};
    const bulkReq=(body=bulkBody,origin='https://photos.example')=>req('photos-delete',{method:'POST',headers:{cookie,origin},body:JSON.stringify(body)});
    assert.equal((await photosDelete(req('photos-delete'))).status,401);
    assert.equal((await photosDelete(bulkReq(bulkBody,'https://attacker.example'))).status,403);
    assert.equal((await photosDelete(bulkReq({...bulkBody,confirmed:false}))).status,400);
    let bulkDeletes=[];
    globalThis.fetch=async url=>{const parsed=new URL(url);const id=parsed.searchParams.get('fileid');if(parsed.pathname==='/stat')return new Response(JSON.stringify({result:0,metadata:{fileid:Number(id),name:id==='1'?'photo.jpg':'two.jpg',hash:'current'}}));bulkDeletes.push(id);return new Response(JSON.stringify({result:0,metadata:{fileid:Number(id),isdeleted:true}}));};
    const bulkResults=(await (await photosDelete(bulkReq())).json()).results;
    assert.equal(bulkResults[0].deleted,false);assert.match(bulkResults[0].error,/changed/);assert.equal(bulkResults[1].deleted,true);assert.deepEqual(bulkDeletes,['2']);
    assert.equal((await photoAnalysis(req('photo-analysis'))).status,401);
    assert.equal((await photoAnalysis(req('photo-analysis',{method:'POST',headers:{cookie,origin:'https://attacker.example'},body:'{}'}))).status,403);
    assert.equal((await photoAnalysis(req('photo-analysis',{method:'POST',headers:{cookie,origin:'https://photos.example'},body:JSON.stringify({action:'start',known:[{id:'invalid',version:'1'}]})}))).status,400);
    assert.equal((await musicAnalysis(req('music-analysis'))).status,401);
    assert.equal((await musicAnalysis(req('music-analysis',{method:'POST',headers:{cookie,origin:'https://attacker.example'},body:'{}'}))).status,403);
    assert.equal((await musicAnalysis(req('music-analysis',{method:'POST',headers:{cookie,origin:'https://photos.example'},body:JSON.stringify({action:'start',known:[{id:'invalid',version:'1'}]})}))).status,400);
    let indexedFolder;
    globalThis.fetch=async url=>{const parsed=new URL(url);assert.equal(parsed.pathname,'/listfolder');indexedFolder=parsed.searchParams.get('folderid');return new Response(JSON.stringify({result:0,metadata:{contents:[{fileid:42,name:'selected.jpg',hash:'current',size:10}]}}));};
    const startIndex=req('photo-analysis',{method:'POST',headers:{cookie,origin:'https://photos.example'},body:JSON.stringify({action:'start',folderId:'42',known:[{id:'pc-42',version:'current'}],checksums:[]})});
    assert.equal((await photoAnalysis(startIndex)).status,200);
    let indexJob;
    for(let attempt=0;attempt<100;attempt++){indexJob=await (await photoAnalysis(req('photo-analysis',{headers:{cookie}}))).json();if(!indexJob.running)break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(indexedFolder,'42');assert.equal(indexJob.folderId,'42');assert.equal(indexJob.total,0);assert.equal(indexJob.running,false);
    const tokenRequest=(body,origin='https://photos.example')=>req('pcloud-auth?action=token',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
    const tokenBody={token:'test-personal-token',tokenType:'auth',host:'eapi.pcloud.com'};
    let tokenChecks=0;
    globalThis.fetch=async (url,options)=>{tokenChecks++;assert.equal(String(url),'https://eapi.pcloud.com/userinfo');assert.equal(options.body.get('auth'),'test-personal-token');assert.equal(options.body.has('access_token'),false);return new Response(JSON.stringify({result:0,userid:456}));};
    assert.equal((await authHandler(req('pcloud-auth?action=token'))).status,405);
    assert.equal((await authHandler(tokenRequest(tokenBody,'https://attacker.example'))).status,403);
    assert.equal((await authHandler(tokenRequest({...tokenBody,host:'attacker.example'}))).status,400);
    assert.equal((await authHandler(tokenRequest({...tokenBody,tokenType:'password'}))).status,400);
    assert.equal((await authHandler(tokenRequest({...tokenBody,token:'x'.repeat(513)}))).status,400);assert.equal(tokenChecks,0);
    const tokenConnected=await authHandler(tokenRequest(tokenBody));assert.equal(tokenConnected.status,200);assert.equal((await tokenConnected.json()).accountId,'456');
    const tokenCookie=tokenConnected.headers.getSetCookie()[0].split(';')[0];assert.ok(!tokenCookie.includes(tokenBody.token));assert.match(tokenConnected.headers.getSetCookie()[0],/HttpOnly; SameSite=Lax.*Secure/);
    const tokenSession=req('media-list?kind=photo',{headers:{cookie:tokenCookie}});assert.equal(session(tokenSession).tokenType,'auth');
    const personalURL=pcloudURL(tokenSession,'stat',{fileid:1});assert.equal(personalURL.searchParams.get('auth'),tokenBody.token);assert.equal(personalURL.searchParams.has('access_token'),false);
    assert.equal(pcloudURL(authenticated,'stat').searchParams.get('access_token'),'mock-token');
    globalThis.fetch=async (url,options)=>{assert.equal(options.body.get('access_token'),'test-oauth-token');return new Response(JSON.stringify({result:0,userid:789}));};
    const oauthToken=await authHandler(tokenRequest({...tokenBody,token:'test-oauth-token',tokenType:'access_token'}));assert.equal(oauthToken.status,200);
    globalThis.fetch=async()=>new Response(JSON.stringify({result:2000}));const rejected=await authHandler(tokenRequest(tokenBody));assert.equal(rejected.status,401);assert.equal(rejected.headers.getSetCookie().length,0);
    globalThis.fetch=async()=>{throw new Error('sensitive upstream detail test-personal-token');};const failed=await authHandler(tokenRequest(tokenBody));assert.equal(failed.status,502);assert.ok(!(await failed.text()).includes(tokenBody.token));
    delete process.env.PCLOUD_CLIENT_SECRET;
    assert.equal((await listMedia(req('media-list?kind=photo'))).status, 401);
    assert.equal(session(tokenSession).uid,'456');
    const tokenOnlyStatus=await authHandler(req('pcloud-auth?action=status'));const tokenOnly=await tokenOnlyStatus.json();assert.equal(tokenOnly.configured,false);assert.equal(tokenOnly.tokenConfigured,true);
    assert.equal((await authHandler(req('pcloud-auth?action=logout',{method:'POST',headers:{origin:'https://photos.example',cookie:tokenCookie}}))).status,200);
  } finally { globalThis.fetch = originalFetch; }
});

test('token playlist save continues after pCloud stat 2055, verifies upload and restores on a fresh device',async()=>{
  const originalFetch=globalThis.fetch;
  process.env.SAI_PHOTOS_SESSION_KEY='a'.repeat(64);process.env.SAI_PHOTOS_ORIGIN='https://photos.example';
  const base='https://photos.example/.netlify/functions/';const operation={id:'33333333-3333-4333-8333-333333333333',at:1,type:'music-playlist',playlistId:'44444444-4444-4444-8444-444444444444',name:'Sleep'};
  let saved;let uploads=0;let folderid=0;const names=[];
  globalThis.fetch=async(url,options)=>{
    const parsed=new URL(url);
    if(parsed.pathname==='/userinfo'){assert.equal(options.body.get('auth'),'mock-personal-token');return new Response(JSON.stringify({result:0,userid:123}));}
    if(parsed.hostname==='c1.pcloud.com')return new Response(JSON.stringify(saved));
    assert.equal(parsed.searchParams.get('auth'),'mock-personal-token');assert.equal(parsed.searchParams.has('access_token'),false);
    if(parsed.pathname==='/stat')return new Response(JSON.stringify(saved?{result:0,metadata:{fileid:99}}:{result:2055}));
    if(parsed.pathname==='/createfolderifnotexists'){assert.equal(parsed.searchParams.get('folderid'),String(folderid));names.push(parsed.searchParams.get('name'));folderid++;return new Response(JSON.stringify({result:0,metadata:{folderid}}));}
    if(parsed.pathname==='/uploadfile'){assert.equal(parsed.searchParams.get('folderid'),'4');assert.equal(options.body.get('folderid'),'4');saved=JSON.parse(await options.body.get('file').text());uploads++;return new Response(JSON.stringify({result:0,metadata:[{fileid:99}],fileids:[99]}));}
    if(parsed.pathname==='/getfilelink')return new Response(JSON.stringify({result:0,hosts:['c1.pcloud.com'],path:'/record.json'}));
    if(parsed.pathname==='/listfolder')return new Response(JSON.stringify({result:0,metadata:{contents:[{fileid:99,name:operation.id+'.json'}]}}));
    throw new Error('Unexpected mock request');
  };
  try{
    const signed=await authHandler(new Request(base+'pcloud-auth?action=token',{method:'POST',headers:{origin:'https://photos.example','content-type':'application/json'},body:JSON.stringify({token:'mock-personal-token',tokenType:'auth',host:'eapi.pcloud.com'})}));assert.equal(signed.status,200);const cookie=signed.headers.getSetCookie()[0].split(';')[0];
    const request=(action,body)=>new Request(base+'photo-metadata?action='+action,{method:'POST',headers:{cookie,origin:'https://photos.example','content-type':'application/json'},body:JSON.stringify(body)});
    const result=await photoMetadata(request('write',{operation}));assert.equal(result.status,200);assert.equal((await result.json()).operation.name,'Sleep');assert.deepEqual(names,['Sai Photos','Web','v1','Operations']);assert.equal(uploads,1);
    assert.equal((await photoMetadata(request('write',{operation}))).status,200);assert.equal(uploads,1);
    const restored=await photoMetadata(request('sync',{known:[]}));assert.equal((await restored.json()).operations[0].playlistId,operation.playlistId);
  }finally{globalThis.fetch=originalFetch;}
});

test('music title indexing saves actual local AI output to pCloud and restores its validated record',{skip:!existsSync(new URL('../.ai-cache/models/Xenova/clip-vit-base-patch32/d15189d7028b43f1d3e65039190477f6af591c2a/onnx/text_model_quantized.onnx',import.meta.url))},async()=>{
 process.env.PCLOUD_CLIENT_ID='test-client';process.env.PCLOUD_CLIENT_SECRET='test-secret';process.env.SAI_PHOTOS_SESSION_KEY='a'.repeat(64);process.env.SAI_PHOTOS_ORIGIN='https://photos.example';process.env.SAI_PHOTOS_ALLOW_HTTP='false';
 const base='https://photos.example/.netlify/functions/';const originalFetch=globalThis.fetch;const stored=new Map();
 const response=data=>new Response(JSON.stringify(data));
 try{
  globalThis.fetch=async()=>response({result:0,userid:98765});
  const connected=await authHandler(new Request(base+'pcloud-auth?action=token',{method:'POST',headers:{origin:'https://photos.example'},body:JSON.stringify({token:'isolated-index-test-token',tokenType:'auth',host:'eapi.pcloud.com'})}));const cookie=connected.headers.getSetCookie()[0].split(';')[0];
  globalThis.fetch=async(url,options)=>{const parsed=new URL(url);
   if(parsed.hostname==='c1.pcloud.com')return response([...stored.values()][0]);
   if(parsed.pathname==='/listfolder')return response({result:0,metadata:{folderid:42,name:'Music',contents:parsed.searchParams.get('path')==='/Sai Photos/Web/v1/Operations'?[...stored].map(([id,op])=>({fileid:id,name:op.id+'.json'})):[{fileid:101,name:'Rose melody.mp3',size:100,hash:'v1'}]}});
   if(parsed.pathname==='/stat')return response(parsed.searchParams.get('fileid')==='101'?{result:0,metadata:{fileid:101,name:'Rose melody.mp3',hash:'v1'}}:{result:2055});
   if(parsed.pathname==='/createfolderifnotexists')return response({result:0,metadata:{folderid:42}});
   if(parsed.pathname==='/uploadfile'){const op=JSON.parse(await options.body.get('file').text());stored.set(1001,op);return response({result:0,metadata:[{fileid:1001}]});}
   if(parsed.pathname==='/getfilelink')return response({result:0,hosts:['c1.pcloud.com'],path:'/operation.json'});
   throw Error('Unexpected isolated index call');
  };
  const request=(name,body)=>new Request(base+name,{...(body?{method:'POST',body:JSON.stringify(body)}:{}),headers:{cookie,origin:'https://photos.example'}});
  assert.equal((await musicAnalysis(request('music-analysis',{action:'start',folderId:null,known:[]}))).status,200);
  let job;for(let i=0;i<1000;i++){job=await(await musicAnalysis(request('music-analysis'))).json();if(!job.running)break;await new Promise(resolve=>setTimeout(resolve,20));}
  assert.equal(job.running,false);assert.equal(job.completed,1);assert.equal(stored.size,1);const op=[...stored.values()][0];assert.equal(op.type,'music-index');assert.equal(op.track.id,'pc-101');assert.equal(op.embedding.length,684);
  const restored=await(await photoMetadata(request('photo-metadata?action=sync',{known:[]}))).json();assert.equal(restored.operations[0].embedding,op.embedding);
 }finally{globalThis.fetch=originalFetch;}
});

test('root library scans shallow folders, exposes partial access and never reports failed scan as finished',async()=>{
 process.env.SAI_PHOTOS_ORIGIN='https://photos.example';process.env.SAI_PHOTOS_SESSION_KEY='a'.repeat(64);process.env.SAI_PHOTOS_ALLOW_HTTP='false';
 const previous=globalThis.fetch;let deniedRoot=false;
 try{
  globalThis.fetch=async(url)=>{const u=new URL(url);if(u.pathname==='/userinfo')return Response.json({result:0,userid:999});if(u.pathname==='/listfolder'){assert.equal(u.searchParams.get('recursive'),'0');const id=u.searchParams.get('folderid');if(deniedRoot||id==='20')return Response.json({result:2003});return Response.json({result:0,metadata:id==='0'?{folderid:0,name:'pCloud',contents:[{isfolder:true,folderid:10,name:'Family'},{isfolder:true,folderid:20,name:'Shared'}]}:{folderid:10,name:'Family',contents:[{fileid:100,name:'photo.jpg',hash:'v1',size:123},{fileid:101,name:'song.mp3',size:234}]}});}throw new Error('Unexpected API request');};
  const base='https://photos.example/.netlify/functions/';const login=await authHandler(new Request(base+'pcloud-auth?action=token',{method:'POST',headers:{origin:'https://photos.example'},body:JSON.stringify({host:'api.pcloud.com',tokenType:'auth',token:'fake-token'})}));assert.equal(login.status,200);const cookie=login.headers.getSetCookie()[0].split(';')[0];const request=path=>new Request(base+path,{headers:{cookie}});
  const partial=await listMedia(request('media-list?kind=photo&folderid=0'));assert.equal(partial.status,200);const data=await partial.json();assert.deepEqual(data.items.map(x=>x.id),['pc-100']);assert.equal(data.scan.complete,false);assert.deepEqual(data.scan.unavailableFolders,['/Shared']);
  deniedRoot=true;const failed=await listMedia(request('media-list?kind=photo&folderid=0'));assert.equal(failed.status,403);assert.match((await failed.json()).error,/code 2003/);
  await photoAnalysis(new Request(base+'photo-analysis',{method:'POST',headers:{cookie,origin:'https://photos.example'},body:JSON.stringify({action:'start',folderId:'0',known:[]})}));
  let status;for(let i=0;i<10;i++){await new Promise(resolve=>setTimeout(resolve,0));status=await(await photoAnalysis(request('photo-analysis'))).json();if(!status.running)break;}
  assert.equal(status.phase,'Stopped');assert.match(status.message,/2003/);assert.notEqual(status.phase,'Already completed');
 }finally{globalThis.fetch=previous;}
});


test('web status advertises canonical sign-in address and cross-origin token is never sent upstream',async()=>{
 process.env.SAI_PHOTOS_ORIGIN='http://localhost:4173';process.env.SAI_PHOTOS_ALLOW_HTTP='true';process.env.SAI_PHOTOS_SESSION_KEY='b'.repeat(64);process.env.PCLOUD_CLIENT_ID='fixture';process.env.PCLOUD_CLIENT_SECRET='fixture';
 const previous=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('Must not contact pCloud');};
 try{const status=await(await authHandler(new Request('http://192.168.88.6:4173/.netlify/functions/pcloud-auth?action=status'))).json();assert.equal(status.canonicalOrigin,'http://localhost:4173');assert.equal(status.callbackURL,'http://localhost:4173/.netlify/functions/pcloud-auth?action=callback');const result=await authHandler(new Request('http://192.168.88.6:4173/.netlify/functions/pcloud-auth?action=token',{method:'POST',headers:{origin:'http://192.168.88.6:4173'},body:'{}'}));assert.equal(result.status,403);assert.match((await result.json()).error,/localhost:4173/);assert.equal(calls,0);}
 finally{globalThis.fetch=previous;}
});
