import {activeDeletedPhotoIds} from './smart-features.mjs';
import {normalizeFileVersion} from './photo-tools.mjs';
export function emptyPhotoState() { return { visuals: {}, checksums: {}, musicIndexes: {}, musicFolder: null, photoFolder: null, favorites: {}, hidden: {}, hiddenAlbums: {}, albums: {}, indexes: {}, peopleNames: {}, peopleNameTimes: {}, peopleNameInferred: {}, peopleLocked: false, musicDownloads: {}, musicSleep: 0, musicLikes: {}, musicHistory: {}, musicTracks: {}, playlists: {}, musicQueue: null, musicResume: null, musicSettings: null, aiSettings: null, aiChats: [] }; }
export function validTrack(track) {
  return track && /^pc-\d{1,20}$/.test(track.id || '') && typeof track.name === 'string' && track.name.length <= 1024 && typeof track.fileName === 'string' && track.fileName.length <= 1024 && Number.isFinite(track.size) && track.size >= 0 && typeof track.version === 'string' && track.version.length < 200;
}
export function validOperation(op) {
  if (!op || !/^[a-f0-9-]{36}$/.test(op.id || '') || !Number.isFinite(op.at)) return false;
  if(op.type==='visual-index')return /^pc-\d+$/.test(op.photoId||'')&&typeof op.version==='string'&&op.version.length<200&&op.model==='clip-base32-q8-v1'&&typeof op.embedding==='string'&&/^[A-Za-z0-9+/]{683}=$/.test(op.embedding)&&/^[a-f0-9]{16}$/.test(op.phash||'')&&Array.isArray(op.color)&&op.color.length===3&&op.color.every(x=>Number.isFinite(x)&&x>=0&&x<=1)&&Number.isFinite(op.contrast)&&op.contrast>=0&&Number.isFinite(op.width)&&op.width>0&&Number.isFinite(op.height)&&op.height>0;
  if(op.type==='content-index')return /^pc-\d+$/.test(op.photoId||'')&&typeof op.version==='string'&&op.version.length<200&&/^[a-f0-9]{40}$/.test(op.sha1||'');
  if(op.type==='photos-delete')return Array.isArray(op.photoIds)&&op.photoIds.length>0&&op.photoIds.length<=1000&&op.photoIds.every(id=>/^pc-\d+$/.test(id))&&new Set(op.photoIds).size===op.photoIds.length;
  if(op.type==='music-folder'||op.type==='photo-folder')return op.folder===null||op.folder&&/^\d{1,20}$/.test(op.folder.id||'')&&typeof op.folder.name==='string'&&op.folder.name.length<=1024;
  if(op.type==='music-index')return validTrack(op.track)&&op.model==='clip-music-title-q8-v1'&&typeof op.embedding==='string'&&/^[A-Za-z0-9+/]{683}=$/.test(op.embedding);
  if(op.type==='smart-album')return /^[a-f0-9-]{36}$/.test(op.albumId||'')&&typeof op.name==='string'&&op.name.trim().length>0&&op.name.length<=80&&typeof op.query==='string'&&op.query.trim().length>0&&op.query.length<=300&&(op.embedding===null||Array.isArray(op.embedding)&&op.embedding.length===512&&op.embedding.every(x=>Number.isFinite(x)&&Math.abs(x)<=1));
  if(op.type==='music-smart-playlist')return /^[a-f0-9-]{36}$/.test(op.playlistId||'')&&typeof op.name==='string'&&op.name.trim().length>0&&op.name.length<=80&&['foryou','mostplayed','liked','recent','search'].includes(op.mode)&&typeof op.query==='string'&&op.query.length<=300&&(op.embedding===undefined||op.embedding===null||Array.isArray(op.embedding)&&op.embedding.length===512&&op.embedding.every(x=>Number.isFinite(x)&&Math.abs(x)<=1));
  if (op.type === 'favorite') return /^pc-\d+$/.test(op.photoId) && typeof op.value === 'boolean';
  if (op.type === 'hidden') return /^pc-\d+$/.test(op.photoId) && typeof op.value === 'boolean';
  if (op.type === 'album-hidden') return /^[a-f0-9-]{36}$/.test(op.albumId || '') && typeof op.value === 'boolean';
  if (op.type === 'photo-delete') return /^pc-\d+$/.test(op.photoId)&&(op.restored===undefined||typeof op.restored==='boolean');
  if (op.type === 'music-delete') return /^pc-\d{1,20}$/.test(op.trackId || '');
  if (op.type === 'music-download') return validTrack(op.track) && /^[a-f0-9-]{36}$/.test(op.deviceId || '') && typeof op.value === 'boolean';
  if (op.type === 'music-sleep') return [0,5,10,15,30,45,60,90].includes(op.minutes);
  if (op.type === 'music-like') return validTrack(op.track) && typeof op.value === 'boolean';
  if (op.type === 'music-play') return validTrack(op.track) && Number.isFinite(op.playedAt) && op.playedAt >= 0 && (op.position === undefined || Number.isFinite(op.position) && op.position >= 0 && op.position <= 86400);
  if (op.type === 'music-position') return validTrack(op.track) && Number.isFinite(op.position) && op.position >= 0 && op.position <= 86400;
  if (op.type === 'music-playlist') return /^[a-f0-9-]{36}$/.test(op.playlistId || '') && typeof op.name === 'string' && op.name.trim().length > 0 && op.name.length <= 80;
  if (op.type === 'music-membership') return /^[a-f0-9-]{36}$/.test(op.playlistId || '') && validTrack(op.track) && typeof op.value === 'boolean';
  if (op.type === 'music-queue') return Array.isArray(op.tracks) && op.tracks.length <= 2000 && op.tracks.every(validTrack) && new Set(op.tracks.map(track => track.id)).size === op.tracks.length;
  if (op.type === 'music-settings') return typeof op.shuffle === 'boolean' && ['off','all','one'].includes(op.repeat) && [.5,.75,1,1.25,1.5,2].includes(op.rate);
  if(op.type==='album-delete')return /^[a-f0-9-]{36}$/.test(op.albumId||'');
  if (op.type === 'ai-settings') return ['gemini','groq','openrouter','mistral','nvidia','llm7'].includes(op.provider) && ['low','high','max'].includes(op.tier) && typeof op.webSearch === 'boolean' && ['private','cloud'].includes(op.privacy) && (op.model === undefined || op.model === null || typeof op.model === 'string' && op.model.length > 0 && op.model.length <= 120);
  if (op.type === 'ai-chat') return typeof op.question === 'string' && op.question.trim().length > 0 && op.question.length <= 300 && typeof op.answer === 'string' && op.answer.length <= 2000 && (op.photoIds === undefined || Array.isArray(op.photoIds) && op.photoIds.length <= 50 && op.photoIds.every(id => /^pc-\d+$/.test(id))) && (op.songIds === undefined || Array.isArray(op.songIds) && op.songIds.length <= 50 && op.songIds.every(id => /^pc-\d+$/.test(id)));
  if (op.type === 'album') return /^[a-f0-9-]{36}$/.test(op.albumId || '') && typeof op.name === 'string' && op.name.trim().length > 0 && op.name.length <= 80;
  if (op.type === 'membership') return /^pc-\d+$/.test(op.photoId) && /^[a-f0-9-]{36}$/.test(op.albumId || '') && typeof op.value === 'boolean';
  if (op.type === 'person-label') return Array.isArray(op.faceIds) && op.faceIds.length > 0 && op.faceIds.length <= 50000 && op.faceIds.every(id => /^pc-\d{1,20}-face-\d+$/.test(id)) && new Set(op.faceIds).size === op.faceIds.length && typeof op.name === 'string' && op.name.length <= 80 && (op.inferred === undefined || typeof op.inferred === 'boolean');
  if (op.type === 'person-name') return /^pc-\d+-face-\d+$/.test(op.personId || '') && typeof op.name === 'string' && op.name.length <= 80;
  if (op.type === 'people-reset') return true;
  if (op.type === 'people-lock') return typeof op.value === 'boolean';
  if (op.type === 'index') return /^pc-\d+$/.test(op.photoId) && typeof op.text === 'string' && op.text.length <= 50000 && typeof op.version === 'string' && op.version.length < 200 && Array.isArray(op.faces) && op.faces.length <= 100 && op.faces.every(face => Array.isArray(face.descriptor) && face.descriptor.length === 128 && face.descriptor.every(Number.isFinite) && Array.isArray(face.box) && face.box.length === 4 && face.box.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
  return false;
}
export function replayOperations(operations) {
  const result = emptyPhotoState();
  const sorted = [...new Map(operations.map(op => [op.id, op])).values()].filter(validOperation).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const deleted=activeDeletedPhotoIds(sorted);
  const deletedAlbums=new Set(sorted.filter(op=>op.type==='album-delete').map(op=>op.albumId));
  for (const record of sorted) {
    const op={...record,version:normalizeFileVersion(record.version),...(record.track?{track:{...record.track,version:normalizeFileVersion(record.track.version)}}:{})};
    if (op.type === 'music-download') { const device = result.musicDownloads[op.deviceId] ||= {}; device[op.track.id] = op.value; }
    if (op.type === 'music-sleep') result.musicSleep = op.minutes;
    if(op.type==='visual-index')result.visuals[op.photoId]={version:op.version,model:op.model,embedding:op.embedding,phash:op.phash,color:op.color,contrast:op.contrast,width:op.width,height:op.height};
    if(op.type==='content-index')result.checksums[op.photoId]={version:op.version,sha1:op.sha1};
    if(op.type==='music-folder')result.musicFolder=op.folder;
    if(op.type==='photo-folder')result.photoFolder=op.folder;
    if(op.type==='photos-delete'){for(const photoId of op.photoIds){if(!deleted.has(photoId))continue;delete result.favorites[photoId];delete result.hidden[photoId];delete result.indexes[photoId];delete result.visuals[photoId];delete result.checksums[photoId];for(const album of Object.values(result.albums))delete album.members[photoId];}}
    if(op.type==='music-index')result.musicIndexes[op.track.id]={version:op.track.version,model:op.model,embedding:op.embedding};
    if(op.type==='smart-album')result.albums[op.albumId]={name:op.name,members:{},query:op.query,embedding:op.embedding,smart:true};
    if(op.type==='music-smart-playlist')result.playlists[op.playlistId]={name:op.name,members:{},smart:{mode:op.mode,query:op.query,embedding:op.embedding||null}};
    if (op.track) result.musicTracks[op.track.id] = op.track;
    if (op.type === 'music-like') result.musicLikes[op.track.id] = op.value;
    if (op.type === 'music-play') {
      const history = result.musicHistory[op.track.id] ||= { playedAt:0, count:0 };
      history.playedAt = Math.max(history.playedAt,op.playedAt); history.count++;
      result.musicResume = { track:op.track, position:op.position || 0 };
    }
    if (op.type === 'music-position') result.musicResume = { track:op.track, position:op.position };
    if (op.type === 'music-playlist') { const playlist = result.playlists[op.playlistId] ||= { name:op.name, members:{} }; playlist.name = op.name; }
    if (op.type === 'music-membership') { const playlist = result.playlists[op.playlistId] ||= { name:'Playlist', members:{} }; playlist.members[op.track.id] = op.value; }
    if (op.type === 'music-queue') { result.musicQueue = op.tracks.map(track => track.id); for (const track of op.tracks) result.musicTracks[track.id] = track; }
    if (op.type === 'music-settings') result.musicSettings = { shuffle:op.shuffle, repeat:op.repeat, rate:op.rate, at:op.at };
    if (op.type === 'ai-settings') result.aiSettings = { provider:op.provider, tier:op.tier, model:op.model ?? null, webSearch:op.webSearch, privacy:op.privacy, at:op.at };
    if (op.type === 'ai-chat') { result.aiChats.push({ at:op.at, question:op.question, answer:op.answer, photoIds:op.photoIds || [], songIds:op.songIds || [] }); if (result.aiChats.length > 200) result.aiChats = result.aiChats.slice(-200); }
    if (op.type === 'music-delete') {
      for (const device of Object.values(result.musicDownloads)) delete device[op.trackId];
      delete result.musicIndexes[op.trackId]; delete result.musicLikes[op.trackId]; delete result.musicHistory[op.trackId]; delete result.musicTracks[op.trackId];
      for (const playlist of Object.values(result.playlists)) delete playlist.members[op.trackId];
      if (result.musicQueue) result.musicQueue = result.musicQueue.filter(id => id !== op.trackId);
      if (result.musicResume?.track.id === op.trackId) result.musicResume = null;
    }
    if (op.type === 'photo-delete' && deleted.has(op.photoId)) {
      delete result.favorites[op.photoId]; delete result.hidden[op.photoId]; delete result.indexes[op.photoId];delete result.visuals[op.photoId];delete result.checksums[op.photoId];
      for (const album of Object.values(result.albums)) delete album.members[op.photoId];
    }
    if (op.type === 'favorite') result.favorites[op.photoId] = op.value;
    if (op.type === 'hidden') result.hidden[op.photoId] = op.value;
    if (op.type === 'album-hidden') result.hiddenAlbums[op.albumId] = op.value;
    if (op.type === 'album') { const album = result.albums[op.albumId] ||= { name: op.name, members: {} }; album.name = op.name; }
    if (op.type === 'membership') { const album = result.albums[op.albumId] ||= { name: 'Album', members: {} }; album.members[op.photoId] = op.value; }
    if (op.type === 'index') result.indexes[op.photoId] = { text: op.text, faces: op.faces, version: op.version };
    if (op.type === 'person-name') { result.peopleNames[op.personId] = op.name; result.peopleNameTimes[op.personId] = op.at; result.peopleNameInferred[op.personId] = false; }
    if (op.type === 'person-label') for (const faceId of op.faceIds) { result.peopleNames[faceId] = op.name; result.peopleNameTimes[faceId] = op.at; result.peopleNameInferred[faceId] = op.inferred === true; }
    if (op.type === 'people-reset') { result.peopleNames = {}; result.peopleNameTimes = {}; result.peopleNameInferred = {}; }
    if (op.type === 'people-lock') result.peopleLocked = op.value === true;
  }
  for(const id of deletedAlbums){delete result.albums[id];delete result.hiddenAlbums[id];}
  return result;
}
export function groupFaces(indexes, groups = []) {
  for (const [photoId, index] of Object.entries(indexes).sort(([a], [b]) => a.localeCompare(b))) {
    for (const [i, face] of index.faces.entries()) {
      let best = null; let bestDistance = 0.48;
      for (const group of groups) {
        if (group.photos.has(photoId)) continue;
        const distance = Math.sqrt(face.descriptor.reduce((sum, value, j) => sum + (value - group.descriptor[j]) ** 2, 0));
        if (distance < bestDistance) { bestDistance = distance; best = group; }
      }
      if (!best) { best = { id: `${photoId}-face-${i}`, descriptor: face.descriptor, photos: new Set(), faces: new Set(), cover: photoId, box: face.box }; groups.push(best); }
      best.photos.add(photoId);
      best.faces.add(`${photoId}-face-${i}`);
    }
  }
  return groups;
}

export function normalizePersonName(name) {
  return String(name || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}
export function faceGroupName(group, names, times = {}) {
  let name = ''; let latest = -Infinity;
  for (const faceId of group?.faces || []) {
    if (names[faceId] !== undefined && (times[faceId] ?? 0) >= latest) {
      name = names[faceId].normalize('NFKC').trim().replace(/\s+/g, ' ');
      latest = times[faceId] ?? 0;
    }
  }
  return name;
}
// Face similarity suggests groups; naming is the user's decision. A group with one name is that person (its unnamed faces included). A group that merged several names never hands a face to the wrong name: each named face stays with its own person and unnamed faces keep their own group.
export function collectPeople(groups, names, times = {}) {
  const people = new Map();
  function add(id,name,faces){let person=people.get(id);if(!person){person={id,name,photos:new Set(),faces:new Set()};people.set(id,person);}for(const faceId of faces){person.faces.add(faceId);person.photos.add(faceId.replace(/-face-\d+$/,''));}}
  for (const group of groups) {
    const named=new Map();const unnamed=[];const removed=[];
    for(const faceId of group.faces){
      const label=names[faceId];
      if(label===undefined)unnamed.push(faceId);
      else if(label==='')removed.push(faceId);
      else{const key=normalizePersonName(label);const entry=named.get(key)||{name:String(label).normalize('NFKC').trim().replace(/\s+/g,' '),faces:[]};entry.faces.push(faceId);named.set(key,entry);}
    }
    if(named.size===1&&removed.length===0){const [key,entry]=[...named][0];add('person:'+key,entry.name,[...entry.faces,...unnamed]);}
    else if(named.size===1){const [key,entry]=[...named][0];add('person:'+key,entry.name,entry.faces);if(unnamed.length)add(group.id,'',unnamed);}
    else if(named.size>1){for(const [key,entry] of named)add('person:'+key,entry.name,entry.faces);for(const faceId of unnamed)add(faceId,'',[faceId]);}
    else if(unnamed.length)add(group.id,'',unnamed);
    for(const faceId of removed)add(faceId,'',[faceId]);
  }
  return [...people.values()];
}

function faceDistance(a,b) { let sum=0; for(let i=0;i<128;i++)sum+=(a[i]-b[i])**2; return Math.sqrt(sum); }
export function matchNamedFaces(indexes, names, inferred = {}, onlyPhoto = null) {
  const profiles=new Map();
  const namedPhotos=new Map();
  for(const [photoId,index] of Object.entries(indexes)) for(const [i,face] of index.faces.entries()) {
    const faceId=photoId+'-face-'+i; const name=names[faceId]?.trim(); if(!name)continue;
    const key=normalizePersonName(name); const photos=namedPhotos.get(key)||new Set();photos.add(photoId);namedPhotos.set(key,photos);
    if(inferred[faceId])continue;
    let profile=profiles.get(key);if(!profile){profile={name,refs:[]};profiles.set(key,profile);}profile.refs.push(face.descriptor);
  }
  // Keep varied user-confirmed examples; inferred matches never become new training seeds.
  for(const profile of profiles.values()) {
    const refs=profile.refs; const candidates=refs.length<=96?refs:Array.from({length:96},(_,i)=>refs[Math.floor(i*(refs.length-1)/95)]);
    const selected=[candidates[0]];
    while(selected.length<Math.min(12,candidates.length)) {
      let best=null;let distance=0;
      for(const candidate of candidates){const nearest=Math.min(...selected.map(seed=>faceDistance(candidate,seed)));if(nearest>distance){distance=nearest;best=candidate;}}
      if(!best)break;selected.push(best);
    }
    profile.refs=selected;
  }
  const matches=[];
  for(const [photoId,index] of Object.entries(indexes)) {
    if(onlyPhoto&&photoId!==onlyPhoto)continue;
    const candidates=[];
    for(const [i,face] of index.faces.entries()) {
      const faceId=photoId+'-face-'+i;if(names[faceId]!==undefined)continue;
      const scores=[...profiles].map(([key,profile])=>({key,name:profile.name,distance:Math.min(...profile.refs.map(seed=>faceDistance(face.descriptor,seed)))})).sort((a,b)=>a.distance-b.distance);
      const best=scores[0];if(!best||best.distance>=.48||scores[1]&&scores[1].distance-best.distance<.08||namedPhotos.get(best.key).has(photoId))continue;
      candidates.push({faceId,...best});
    }
    for(const candidate of candidates) {
      const competing=candidates.filter(other=>other!==candidate&&other.key===candidate.key);
      if(competing.some(other=>other.distance-candidate.distance<.08))continue;
      matches.push({faceId:candidate.faceId,name:candidate.name});
    }
  }
  return matches;
}
