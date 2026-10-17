const DB_NAME = 'sai-photos-web-v1';
let db;
const downloads = new Map();
let activeDownloads = 0;
const waitingDownloads = [];
const cacheGenerations = new Map();
async function download(url, mode) {
  if (mode !== 'original') {
    if (activeDownloads >= 4) await new Promise(resolve => mode==='preview'?waitingDownloads.unshift(resolve):waitingDownloads.push(resolve));
    else activeDownloads++;
  }
  try {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Image unavailable');
    return await response.blob();
  } finally {
    if (mode !== 'original') { const next = waitingDownloads.shift(); if (next) next(); else activeDownloads--; }
  }
}
function database() {
  return db ||= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 3);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('accounts')) request.result.createObjectStore('accounts');
      if (!request.result.objectStoreNames.contains('songs')) request.result.createObjectStore('songs');
      if (!request.result.objectStoreNames.contains('images')) request.result.createObjectStore('images').createIndex('age', ['bucket','savedAt']);
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
export async function readAccount(id) {
  const databaseHandle = await database();
  return new Promise((resolve, reject) => { const request = databaseHandle.transaction('accounts').objectStore('accounts').get(String(id)); request.onsuccess = () => resolve(request.result || { operations: [], pending: [] }); request.onerror = () => reject(request.error); });
}
export async function saveAccount(id, data) {
  const databaseHandle = await database();
  return new Promise((resolve, reject) => { const tx = databaseHandle.transaction('accounts', 'readwrite'); tx.objectStore('accounts').put(data, String(id)); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
}
export async function cachedImage(account, item, mode = 'thumbnail', cacheOnly = false) {
  const photoKey = `${account}-${item.id}`;
  const generation = cacheGenerations.get(photoKey) || 0;
  const url = '/.netlify/functions/media-content?id=' + encodeURIComponent(item.id) + (mode === 'thumbnail' ? '&thumbnail=1' : mode === 'preview' ? '&preview=1' : mode === 'video' ? '&video=1' : '');
  const key = new URL(url, location.href); key.searchParams.set('version', item.version || String(item.addedAt));
  const bucket = `${account}-${mode}`; const cacheKey = `${bucket}-${key.href}`;
  try {
    const dbHandle = await database();
    const found = await new Promise((resolve,reject) => { const request = dbHandle.transaction('images').objectStore('images').get(cacheKey); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    if (found && generation === (cacheGenerations.get(photoKey) || 0)) return URL.createObjectURL(found.blob);
  } catch {}
  if (cacheOnly) return null;
  let pending = downloads.get(cacheKey);
  if (!pending) { pending = download(key.pathname+key.search, mode); downloads.set(cacheKey, pending); }
  let blob;
  try { blob = await pending; } finally { if (downloads.get(cacheKey) === pending) downloads.delete(cacheKey); }
  if (generation !== (cacheGenerations.get(photoKey) || 0)) throw new Error('Image was removed');
  if (mode === 'audio' && blob.size > 25000000) throw new Error('Song exceeds the local cache limit');
  if (mode === 'video' && blob.size > 200000000) throw new Error('Video exceeds the 200 MB local cache limit');
  if (blob.size < (mode === 'original' ? 30000000 : mode === 'audio' ? 25000001 : mode === 'video' ? 200000001 : 5000000)) {
    try {
      const dbHandle = await database();
      await new Promise((resolve,reject) => {
        const tx = dbHandle.transaction('images','readwrite'); const store = tx.objectStore('images');
        const range = IDBKeyRange.bound([bucket,0],[bucket,Number.MAX_SAFE_INTEGER]);
        const keysRequest = store.index('age').getAllKeys(range);
        keysRequest.onsuccess = () => {
          if (mode === 'video') {
            const valuesRequest = store.index('age').getAll(range);
            valuesRequest.onsuccess = () => {
              const rows = valuesRequest.result || [];
              let total = rows.reduce((sum,row)=>sum+((row.blob&&row.blob.size)||0),0);
              let count = rows.length;
              let drop = 0;
              while (drop < rows.length && (count >= 4 || total + blob.size > 500000000)) { total -= (rows[drop].blob&&rows[drop].blob.size)||0; count -= 1; drop += 1; }
              for (const entry of keysRequest.result.slice(0, drop)) store.delete(entry);
              if (generation === (cacheGenerations.get(photoKey) || 0)) store.put({ blob, bucket, savedAt: Date.now() }, cacheKey);
            };
          } else {
            const max = mode === 'original' ? 24 : mode === 'audio' ? 12 : 160;
            for (const entry of keysRequest.result.slice(0, Math.max(0, keysRequest.result.length-max+1))) store.delete(entry);
            if (generation === (cacheGenerations.get(photoKey) || 0)) store.put({ blob, bucket, savedAt: Date.now() }, cacheKey);
          }
        };
        tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error);
      });
    } catch (error) { if (mode === 'audio') throw error; /* Viewing still works when Safari's cache is full. */ }
  }
  return URL.createObjectURL(blob);
}
export async function forgetPhotoImages(account, photoId) {
  await removeDownloadedSong(account, photoId);
  const photoKey = `${account}-${photoId}`;
  cacheGenerations.set(photoKey, (cacheGenerations.get(photoKey) || 0) + 1);
  const handle = await database();
  await new Promise((resolve, reject) => {
    const tx = handle.transaction('images','readwrite'); const store = tx.objectStore('images');
    const request = store.getAllKeys();
    request.onsuccess = () => { for (const key of request.result) if (String(key).startsWith(`${account}-`) && String(key).includes(`media-content?id=${photoId}&`)) store.delete(key); };
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}

const SONG_LIMIT = 100 * 1024 * 1024;
const DOWNLOAD_LIMIT = 500 * 1024 * 1024;
const songKey = (account, track) => `${account}:${track.id}:${track.version}`;
export async function downloadedSong(account, track) {
  const handle = await database();
  const found = await new Promise((resolve,reject) => { const r=handle.transaction('songs').objectStore('songs').get(songKey(account,track));r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error); });
  return found ? URL.createObjectURL(found.blob) : null;
}
export async function listDownloadedSongs(account) {
  const handle=await database();
  const rows=await new Promise((resolve,reject)=>{const r=handle.transaction('songs').objectStore('songs').getAll();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  return rows.filter(row=>row.account===String(account)).map(row=>row.track);
}
export async function downloadSong(account, track) {
  if(track.size>SONG_LIMIT)throw new Error('This song exceeds the 100 MB download limit.');
  const photoKey=`${account}-${track.id}`;const generation=cacheGenerations.get(photoKey)||0;
  const response=await fetch('/.netlify/functions/media-content?id='+encodeURIComponent(track.id),{credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw new Error('Could not download from pCloud. Check your connection.');
  if(Number(response.headers.get('content-length'))>SONG_LIMIT)throw new Error('This song exceeds the 100 MB download limit.');
  const reader=response.body.getReader();const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>SONG_LIMIT)throw new Error('This song exceeds the 100 MB download limit.');chunks.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}
  if(!size)throw new Error('pCloud returned an empty song.');
  const blob=new Blob(chunks,{type:response.headers.get('content-type')||'application/octet-stream'});
  const handle=await database();
  await new Promise((resolve,reject)=>{
    const tx=handle.transaction('songs','readwrite');const store=tx.objectStore('songs');const request=store.getAll();let failure;
    request.onsuccess=()=>{if(generation!==(cacheGenerations.get(photoKey)||0)){failure=new Error('Song was removed.');tx.abort();return;}const total=request.result.filter(row=>!(row.account===String(account)&&row.track.id===track.id)).reduce((sum,row)=>sum+row.blob.size,0);if(total+size>DOWNLOAD_LIMIT){failure=new Error('Downloads reached 500 MB. Remove a download first.');tx.abort();return;}for(const row of request.result)if(row.account===String(account)&&row.track.id===track.id)store.delete(songKey(account,row.track));store.put({account:String(account),track,blob,savedAt:Date.now()},songKey(account,track));};
    tx.oncomplete=resolve;tx.onerror=()=>reject(failure||new Error('Safari storage is full. Remove downloads and retry.'));tx.onabort=()=>reject(failure||new Error('Safari could not save the download.'));
  });
  return URL.createObjectURL(blob);
}
export async function removeDownloadedSong(account,id){
  const photoKey=`${account}-${id}`;cacheGenerations.set(photoKey,(cacheGenerations.get(photoKey)||0)+1);
  const handle=await database();await new Promise((resolve,reject)=>{const tx=handle.transaction('songs','readwrite');const store=tx.objectStore('songs');const request=store.getAll();request.onsuccess=()=>{for(const row of request.result)if(row.account===String(account)&&row.track.id===id)store.delete(songKey(account,row.track));};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
}

export async function photoCacheInfo(account,clear=false){
 const handle=await database();return new Promise((resolve,reject)=>{const totals={bytes:0,count:0,audioBytes:0,audioCount:0,videoBytes:0,videoCount:0,songBytes:0,songCount:0};const tx=handle.transaction('images',clear?'readwrite':'readonly'),store=tx.objectStore('images'),request=store.openCursor();request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;const bucket=String(cursor.value.bucket||'');if(String(cursor.key).startsWith(account+'-')){const size=cursor.value.blob?.size||0;if(bucket.endsWith('-audio')){totals.audioBytes+=size;totals.audioCount++;}else if(bucket.endsWith('-video')){totals.videoBytes+=size;totals.videoCount++;}else{totals.bytes+=size;totals.count++;if(clear)cursor.delete();}}cursor.continue();};tx.oncomplete=()=>{totals.totalBytes=totals.bytes+totals.audioBytes+totals.videoBytes+totals.songBytes;totals.totalCount=totals.count+totals.audioCount+totals.videoCount+totals.songCount;resolve(totals);};tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
}
export async function clearMirror(account){
 const handle=await database();return new Promise((resolve,reject)=>{const tx=handle.transaction(['images','songs'],'readwrite');const images=tx.objectStore('images'),cursor=images.openCursor();cursor.onsuccess=()=>{const cursorValue=cursor.result;if(!cursorValue)return;const bucket=String(cursorValue.value.bucket||'');if(String(cursorValue.key).startsWith(account+'-')&&(bucket.endsWith('-audio')||bucket.endsWith('-video')))cursorValue.delete();cursorValue.continue();};const songs=tx.objectStore('songs'),songsCursor=songs.openCursor();songsCursor.onsuccess=()=>{const cursorValue=songsCursor.result;if(!cursorValue)return;if(String(cursorValue.value.account)===String(account))cursorValue.delete();cursorValue.continue();};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
}
