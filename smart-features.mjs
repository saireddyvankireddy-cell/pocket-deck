import {formatSize,cosine,unpackEmbedding} from './photo-tools.mjs';
import {normalizePersonName} from './photo-state.mjs';
export const MUSIC_MODEL='clip-music-title-q8-v1';
export function albumQueryFilters(query){
 const filters=[];const words=[];
 for(const token of String(query||'').trim().split(/\s+/)){
  const lower=token.toLowerCase();
  if(/^year:\d{4}$/.test(lower))filters.push({kind:'year',value:Number(lower.slice(5))});
  else if(/^month:\d{4}-\d{2}$/.test(lower))filters.push({kind:'month',value:lower.slice(6)});
  else if(/^media:(photo|video)$/.test(lower))filters.push({kind:'media',value:lower.slice(6)});
  else if(token)words.push(token);
 }
 return {filters,words};
}
export function photoAlbumMatches(photo,album,meta,people){
 const {filters,words}=albumQueryFilters(album.query);
 for(const filter of filters){
  const date=new Date(Number(photo.addedAt)||0);
  if(filter.kind==='year'&&date.getFullYear()!==filter.value)return false;
  if(filter.kind==='month'&&date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')!==filter.value)return false;
  if(filter.kind==='media'&&(photo.mediaType||'photo')!==filter.value)return false;
 }
 const query=words.join(' ').trim().toLowerCase();
 if(!query)return filters.length>0;
 if(['favorites','favourites','favorite photos','favourite photos'].includes(query))return Boolean(meta.favorites[photo.id]);
 const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
 const phrase=normalize(query);const contains=value=>(' '+normalize(value)+' ').includes(' '+phrase+' ');
 const named=people.some(person=>person.name&&normalizePersonName(person.name)===normalizePersonName(query)&&person.photos.has(photo.id));
 // File names and current OCR are evidence; generic visual resemblance is not a person's identity.
 return named||contains(photo.fileName)||Boolean(meta.indexes[photo.id]?.version===photo.version&&contains(meta.indexes[photo.id]?.text));
}
export function suggestAlbums(photos,meta,people,now=new Date(),limit=8){
 const suggestions=[];const albumList=Object.values(meta.albums||{});
 const existingNames=new Set(albumList.map(album=>String(album.name||'').toLowerCase()));
 const existingQueries=new Set(albumList.map(album=>String(album.query||'').toLowerCase()));
 const photoById=new Map(photos.map(photo=>[photo.id,photo]));
 const add=(name,query,kind,count)=>{if(suggestions.length>=limit)return;if(existingNames.has(name.toLowerCase())||existingQueries.has(query.toLowerCase()))return;suggestions.push({name,query,kind,count});};
 const monthKey=date=>date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0');
 const previous=new Date(now.getFullYear(),now.getMonth()-1,1);
 const monthPhotos=photos.filter(photo=>{const date=new Date(Number(photo.addedAt)||0);return date.getFullYear()===previous.getFullYear()&&date.getMonth()===previous.getMonth();});
 if(monthPhotos.length>=15)add('Recap · '+previous.toLocaleString(undefined,{month:'long',year:'numeric'}),'month:'+monthKey(previous),'month',monthPhotos.length);
 const monthVideos=monthPhotos.filter(photo=>photo.mediaType==='video');
 if(monthVideos.length>=8)add('Videos · '+previous.toLocaleString(undefined,{month:'long',year:'numeric'}),'media:video month:'+monthKey(previous),'video',monthVideos.length);
 let personCount=0;
 for(const person of people||[]){
  if(personCount>=4||!person.name)continue;
  const years=new Map();
  for(const id of person.photos){const photo=photoById.get(id);if(!photo)continue;const date=new Date(Number(photo.addedAt)||0);if(!date.getTime())continue;years.set(date.getFullYear(),(years.get(date.getFullYear())||0)+1);}
  const top=[...years.entries()].sort((a,b)=>b[1]-a[1])[0];
  if(top&&top[1]>=8){add(person.name+' · '+top[0],person.name+' year:'+top[0],'person',top[1]);personCount+=1;}
 }
 const favoriteCount=photos.filter(photo=>meta.favorites?.[photo.id]).length;
 if(favoriteCount>=20)add('♥ Favourites','favorites','favorites',favoriteCount);
 const termDocs=new Map();
 for(const photo of photos){
  const index=meta.indexes?.[photo.id];if(!index||index.version!==photo.version||!index.text)continue;
  const seen=new Set();
  for(const word of String(index.text).toLowerCase().split(/[^\p{L}\p{N}]+/u)){if(word.length<4||seen.has(word))continue;seen.add(word);termDocs.set(word,(termDocs.get(word)||0)+1);}
 }
 const personWords=new Set((people||[]).flatMap(person=>String(person.name||'').toLowerCase().split(/\s+/)).filter(Boolean));
 const skipTerms=new Set(['this','that','with','from','photo','image','screenshot','whatsapp','samsung','telugu','india','your']);
 const terms=[...termDocs.entries()].filter(([word,count])=>count>=10&&!personWords.has(word)&&!skipTerms.has(word)).sort((a,b)=>b[1]-a[1]).slice(0,3);
 for(const [word,count] of terms)add('Tag · '+word,word,'term',count);
 return suggestions;
}
const stop=new Set(['song','songs','music','full','video','lyrics','official','audio','telugu','mp3','m4a','wav','the','and','with']);
function words(track){return new Set(`${track.name} ${track.fileName}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word=>word.length>2&&!stop.has(word)));}
export function recommendMusic(tracks,meta){
 const seeds=[...new Map([...Object.values(meta.musicTracks||{}),...tracks].map(track=>[track.id,track])).values()].filter(track=>meta.musicLikes[track.id]||meta.musicHistory[track.id]);
 const tokens=new Map();const vectors=[];
 for(const seed of seeds){const weight=(meta.musicLikes[seed.id]?3:0)+Math.log1p(meta.musicHistory[seed.id]?.count||0);for(const word of words(seed))tokens.set(word,(tokens.get(word)||0)+weight);const index=meta.musicIndexes?.[seed.id];if(index?.version===seed.version&&index.model===MUSIC_MODEL)vectors.push({vector:unpackEmbedding(index.embedding),weight});}
 const profile=Array(512).fill(0);for(const {vector,weight}of vectors)for(let i=0;i<512;i++)profile[i]+=vector[i]*weight;
 return tracks.map(track=>{const index=meta.musicIndexes?.[track.id];const semantic=vectors.length&&index?.version===track.version&&index.model===MUSIC_MODEL?cosine(unpackEmbedding(index.embedding),profile):0;const terms=[...words(track)].reduce((sum,word)=>sum+(tokens.get(word)||0),0);const liked=Boolean(meta.musicLikes[track.id]);const count=meta.musicHistory[track.id]?.count||0;const score=(liked?2:0)+Math.log1p(count)*.4+semantic*4+Math.log1p(terms);const reason=liked?'You liked this':semantic>.3?'Similar title to your listening favourites':terms?'Shares title terms with your favourites':count?'You played this before':'Explore your library';return {track,score,reason};}).sort((a,b)=>b.score-a.score||a.track.id.localeCompare(b.track.id));
}
export function musicMix(tracks,meta,rule){
 let items=[...tracks];
 if(rule.mode==='foryou')items=recommendMusic(items,meta).map(row=>row.track).slice(0,50);
 if(rule.mode==='mostplayed')items=items.filter(track=>meta.musicHistory[track.id]).sort((a,b)=>meta.musicHistory[b.id].count-meta.musicHistory[a.id].count);
 if(rule.mode==='liked')items=items.filter(track=>meta.musicLikes[track.id]);
 if(rule.mode==='recent')items=items.filter(track=>meta.musicHistory[track.id]).sort((a,b)=>meta.musicHistory[b.id].playedAt-meta.musicHistory[a.id].playedAt);
 const intent=musicIntent(rule.query||'');const query=intent.query;if(intent.mode==='liked')items=items.filter(track=>meta.musicLikes[track.id]);if(intent.mode==='recent'||intent.mode==='mostplayed')items=items.filter(track=>meta.musicHistory[track.id]);if(query){const scores=new Map(rule.embedding?items.filter(track=>meta.musicIndexes?.[track.id]?.version===track.version).map(track=>[track.id,cosine(unpackEmbedding(meta.musicIndexes[track.id].embedding),rule.embedding)]):[]);const cutoff=Math.max(.65,...[Math.max(...scores.values())-.05]);items=items.filter(track=>query.split(/\s+/).every(word=>`${track.name} ${track.fileName}`.toLowerCase().includes(word))||(scores.get(track.id)||0)>=cutoff);}
 return items;
}
export function musicIntent(query){
 let text=query.toLowerCase().trim();let mode=null;
 if(/\bmost played\b/.test(text)){mode='mostplayed';text=text.replace(/\bmost played\b/g,'');}
 else if(/\b(recently played|recent)\b/.test(text)){mode='recent';text=text.replace(/\b(recently played|recent)\b/g,'');}
 else if(/\b(liked|favourites|favorites)\b/.test(text)){mode='liked';text=text.replace(/\b(liked|favourites|favorites)\b/g,'');}
 else if(/\b(downloaded|offline)\b/.test(text)){mode='downloads';text=text.replace(/\b(downloaded|offline)\b/g,'');}
 text=text.replace(/\b(play|show|find|me|my|the|songs|song|music|tracks|please)\b/g,' ').replace(/\s+/g,' ').trim();
 return {mode,query:text};
}

// Sai Photos gallery workflows, informed by Ente's public gallery/search UI.
export function galleryFacets(photos){
 const folders=new Map(),years=new Map(),types=new Map();
 for(const photo of photos){const folder=photo.folderPath||photo.folderName||'Unknown folder';folders.set(folder,(folders.get(folder)||0)+1);const stamp=Number(photo.addedAt);if(stamp>0){const year=new Date(stamp).getFullYear();years.set(String(year),(years.get(String(year))||0)+1);}const type=(photo.fileName||'').split('.').pop().toUpperCase();if(type)types.set(type,(types.get(type)||0)+1);}
 return {folders:[...folders].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])),years:[...years].sort((a,b)=>Number(b[0])-Number(a[0])),types:[...types].sort((a,b)=>b[1]-a[1])};
}
export function matchesGalleryFilter(photo,filter={}){
 if(filter.media&&photo.mediaType!==filter.media&&!(filter.media==='photo'&&!photo.mediaType))return false;
 if(filter.ids&&!filter.ids.includes(photo.id))return false;
 if(filter.folder&&(photo.folderPath||photo.folderName||'Unknown folder')!==filter.folder)return false;
 if(filter.year&&(!photo.addedAt||String(new Date(Number(photo.addedAt)).getFullYear())!==filter.year))return false;
 if(filter.type&&(photo.fileName||'').split('.').pop().toUpperCase()!==filter.type)return false;
 return true;
}
export function galleryMemories(photos,now=new Date(),people=[]){
 const dated=photos.filter(photo=>Number(photo.addedAt)>0),result=[];
 const byId=new Map(dated.map(photo=>[photo.id,photo]));
 const day=dated.filter(photo=>{const d=new Date(Number(photo.addedAt));return d.getMonth()===now.getMonth()&&d.getDate()===now.getDate()&&d.getFullYear()<now.getFullYear();});
 if(day.length)result.push({title:'On this day',photos:day});
 const years=galleryFacets(dated).years;
 for(const [year]of years.slice(0,4)){const ago=now.getFullYear()-Number(year);if(ago<1)continue;const members=dated.filter(photo=>String(new Date(Number(photo.addedAt)).getFullYear())===year);if(members.length)result.push({title:ago===1?'1 year ago · '+year:ago+' years ago · '+year,photos:members});}
 const month=now.getMonth();
 const season=dated.filter(photo=>{const d=new Date(Number(photo.addedAt));return d.getMonth()===month&&d.getFullYear()<now.getFullYear();});
 if(season.length>=8)result.push({title:'This month in past years',photos:season.slice(0,60)});
 for(const person of people){const name=String(person.name||'').trim();if(!name)continue;const members=[...person.photos].map(id=>byId.get(id)).filter(Boolean).filter(photo=>new Date(Number(photo.addedAt)).getFullYear()<now.getFullYear());if(members.length<3)continue;members.sort((a,b)=>Number(b.addedAt)-Number(a.addedAt));const year=new Date(Number(members[0].addedAt)).getFullYear();result.push({title:name+' · '+year,photos:members.filter(photo=>new Date(Number(photo.addedAt)).getFullYear()===year).slice(0,30)});}
 return result;
}
export function activeDeletedPhotoIds(operations){const result=new Set();for(const op of [...operations].sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id))){if(op.type==='photos-delete')for(const id of op.photoIds)result.add(id);if(op.type==='photo-delete')op.restored?result.delete(op.photoId):result.add(op.photoId);}return result;}

export function setupEnteGallery(library){
 const $=id=>document.getElementById(id),make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;};
 const shell=make('section','gallery-discovery');shell.id='galleryDiscovery';shell.hidden=true;$('galleryToolbar').before(shell);
 const memories=make('section','gallery-memories');memories.id='galleryMemories';$('galleryToolbar').before(memories);
 const title=make('h2','gallery-page-title','Photos');title.id='galleryPageTitle';if(window.SAI_PHOTOS_ONLY)$('search').closest('.tools').before(title);else $('photosPanel').prepend(title);
 const filterBar=make('div','gallery-filter-bar');$('galleryToolbar').before(filterBar);
 const albumActions=make('div','album-actions');$('collectionCards').before(albumActions);
 const albumButton=make('button','','New album'),smartButton=make('button','','Smart album');albumButton.onclick=()=>$('newAlbum').click();smartButton.onclick=()=>$('newSmartAlbum').click();albumActions.append(albumButton,smartButton);
 const selectAll=make('button','','Select all matching');selectAll.id='selectAllMatching';$('selectionToolbar').append(selectAll);selectAll.onclick=()=>{const selection=library.selection;if(!selection)return;const rows=['duplicates','similar'].includes(library.view)?library.cleanup.groups.flatMap(g=>[g.keeper,...g.copies]):library.view==='large'?[...library.photos()].sort((a,b)=>b.size-a.size).slice(0,200):library.filter(library.photos(),$('search').value.trim().toLowerCase());selection.mode=true;selection.selected.clear();for(const p of rows)selection.selected.add(p.id);selection.refresh();};
 const bulkAlbum=make('button','','Add to album');bulkAlbum.id='bulkAddToAlbum';$('selectionToolbar').append(bulkAlbum);
 const albumDialog=make('dialog','gallery-sheet'),albumTitle=make('h2','','Add selected photos to album'),albumSelect=make('select'),albumStatus=make('p'),albumSave=make('button','primary','Add selected'),albumCancel=make('button','','Cancel');albumSelect.setAttribute('aria-label','Choose album');albumDialog.append(albumTitle,albumSelect,albumStatus,albumCancel,albumSave);document.body.append(albumDialog);albumCancel.onclick=()=>albumDialog.close();
 bulkAlbum.onclick=()=>{albumSelect.replaceChildren();for(const [id,album]of Object.entries(library.meta.albums).filter(([,a])=>!a.smart)){const option=make('option','',album.name);option.value=id;albumSelect.append(option);}albumStatus.textContent=albumSelect.options.length?'Selected originals stay in their pCloud folders.':'Create an album first.';albumSave.disabled=!albumSelect.options.length;albumDialog.showModal();};
 albumSave.onclick=async()=>{albumSave.disabled=true;albumCancel.disabled=true;try{const ids=[...library.selection.selected],albumId=albumSelect.value;albumSelect.disabled=true;for(const photoId of ids)await library.change({type:'membership',albumId,photoId,value:true});albumStatus.textContent=ids.length+' photos added. '+(library.data.pending.length?'Cloud saving is pending.':'Saved in pCloud.');}catch(e){albumStatus.textContent=e.message;}finally{albumSave.disabled=false;albumCancel.disabled=false;albumSelect.disabled=false;}};
 let tab='home',lastStamp='',lastPhotos=null,showMemories=true,builtStamp='';try{showMemories=localStorage.getItem('sai-show-memories')!=='false';}catch{}
 const clear=()=>{library.filters={};$('search').value='';library.searchQuery='';library.semanticScores=null;library.focus=null;};
 const navigate=(next)=>{tab=next;clear();library.view=next==='albums'?'albums':next==='favorites'?'favorites':'library';library.render();window.scrollTo({top:0,behavior:'smooth'});};
 if(window.SAI_PHOTOS_ONLY){for(const [id,next]of [['navPhotos','home'],['navAlbums','albums'],['navSearch','search']])$(id).onclick=()=>navigate(next);$('navPeople').hidden=true;$('navCleanup').hidden=true;const favorites=make('button','','♡');favorites.id='navFavorites';favorites.setAttribute('aria-label','Favorites');favorites.onclick=()=>navigate('favorites');$('navSearch').before(favorites);}

 if(window.SAI_PHOTOS_ONLY){
  // Original line icons; do not ship Apple artwork or depend on SF Symbols.
  const paths={navPhotos:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',navAlbums:'<rect x="6" y="6" width="15" height="15" rx="3"/><path d="M3 17V6a3 3 0 0 1 3-3h11"/>',navFavorites:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',navSearch:'<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>'};
  for(const [id,label]of [['navPhotos','Library'],['navAlbums','Albums'],['navFavorites','Favorites'],['navSearch','Search']]){const button=$(id);button.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths[id]+'</svg>';button.append(make('span','nav-label',label));button.setAttribute('aria-label',label);}
 }

 const section=(container,label)=>{const heading=make('h3','discovery-title',label),row=make('div','discovery-row');container.append(heading,row);return row;};
 const chip=(parent,label,run,sub='')=>{const b=make('button','discovery-chip',label);if(sub)b.append(make('small','',sub));b.onclick=run;parent.append(b);return b;};
 const filter=(value,label)=>{tab='search';library.view='library';library.focus=null;library.filters=value;$('search').value='';library.searchQuery='';library.semanticScores=null;library.filterTitle=label;library.render();window.scrollTo({top:0,behavior:'smooth'});};
 const photoCard=(parent,label,photos,run,person=null)=>{const button=make('button','discovery-photo');if(photos.length){const image=make('img');image.alt=label;if(person){const frame=make('div','person-face-preview');frame.append(image);library.facePreview(person,photos.map(p=>p.id),new Map(library.photos().map(p=>[p.id,p])),image);button.append(frame);}else{library.loadTile(photos[0],image);button.append(image);}}button.append(make('strong','',label),make('small','',photos.length+' photos'));button.onclick=run;parent.append(button);};
 const exportButton=make('button','','Export app records');$('settingsAccountPage').append(exportButton);exportButton.onclick=async()=>{if(!library.account)return;if(window.SAI_ANDROID){exportButton.disabled=true;try{const records=[...library.data.operations,...library.data.pending];let part=[],bytes=0,page=0;const save=async()=>{if(!part.length)return;const result=await library.api('device-export',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({format:'sai-photos-record-export-v1',account:library.account,page:++page,operations:part})});part=[];bytes=0;};for(const op of records){const size=JSON.stringify(op).length;if(size>1500000)throw new Error('One record is too large to export. It remains in pCloud.');if(bytes+size>1500000)await save();part.push(op);bytes+=size;}await save();exportButton.textContent=page+' record files saved to Downloads / Sai Photos';}catch(e){exportButton.textContent=e.message;}finally{exportButton.disabled=false;}return;}const blob=new Blob([JSON.stringify({format:'sai-photos-record-export-v1',account:library.account,operations:library.data.operations,pending:library.data.pending},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=make('a');link.href=url;link.download='Sai-Photos-app-records.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const memoryToggle=make('button','','Show memories: '+(showMemories?'On':'Off'));$('settingsMenu').append(memoryToggle);memoryToggle.onclick=()=>{showMemories=!showMemories;try{localStorage.setItem('sai-show-memories',String(showMemories));}catch{}memoryToggle.textContent='Show memories: '+(showMemories?'On':'Off');lastStamp='';};
  let notificationsOn=false,memoryCount=0,lastNotifiedCount=-1;try{notificationsOn=localStorage.getItem('sai-memory-notifications')==='true';}catch{}
  const sendNotificationPrefs=async count=>{if(!window.SAI_ANDROID||!library.account)return;try{await library.api('device-notify-prefs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:notificationsOn,count,hour:20})});}catch{}};
  const notifyToggle=make('button','','Memory notifications: '+(notificationsOn?'On':'Off'));if(window.SAI_ANDROID){$('settingsMenu').append(notifyToggle);notifyToggle.onclick=()=>{notificationsOn=!notificationsOn;try{localStorage.setItem('sai-memory-notifications',String(notificationsOn));}catch{}notifyToggle.textContent='Memory notifications: '+(notificationsOn?'On':'Off');lastNotifiedCount=-1;sendNotificationPrefs(memoryCount);};}
  const reportMemories=groups=>{const ids=new Set();for(const group of groups)for(const photo of group.photos)ids.add(photo.id);memoryCount=ids.size;if(window.SAI_ANDROID&&notificationsOn&&library.account&&memoryCount!==lastNotifiedCount){lastNotifiedCount=memoryCount;sendNotificationPrefs(memoryCount);}};
 const viewerVideo=make('video');viewerVideo.id='viewerVideo';viewerVideo.controls=true;viewerVideo.playsInline=true;viewerVideo.preload='metadata';viewerVideo.hidden=true;$('imageStage').append(viewerVideo);
 const rename=make('button','','Rename album');albumActions.append(rename);rename.onclick=async()=>{const album=library.meta.albums[library.focus];if(!album)return;const name=await library.askName('Album name',album.name);if(!name?.trim())return;await library.change(album.smart?{type:'smart-album',albumId:library.focus,name:name.trim().slice(0,80),query:album.query,embedding:album.embedding||null}:{type:'album',albumId:library.focus,name:name.trim().slice(0,80)});library.render();};
 const deleteAlbum=make('button','','Delete album');albumActions.append(deleteAlbum);
 const deleteDialog=make('dialog','gallery-sheet'),deleteTitle=make('h2','','Delete album?'),deleteText=make('p'),deleteCancel=make('button','','Cancel'),deleteConfirm=make('button','danger','Delete album');deleteDialog.append(deleteTitle,deleteText,deleteCancel,deleteConfirm);document.body.append(deleteDialog);let deletingAlbumId=null;
 deleteCancel.onclick=()=>deleteDialog.close();deleteAlbum.onclick=()=>{const album=library.meta.albums[library.focus];if(!album)return;deletingAlbumId=library.focus;deleteText.textContent='Remove “'+album.name+'”? All original photos and videos stay in pCloud, your library and other albums.';deleteDialog.showModal();};
 deleteConfirm.onclick=async()=>{if(!deletingAlbumId)return;deleteConfirm.disabled=true;deleteCancel.disabled=true;try{const saved=await library.change({type:'album-delete',albumId:deletingAlbumId});deleteDialog.close();library.focus=null;library.render();$('photoSync').textContent=saved?'Album removed; originals kept in pCloud.':'Album removed on this device; pCloud sync will retry.';}catch(error){deleteText.textContent=error.message;}finally{deleteConfirm.disabled=false;deleteCancel.disabled=false;}};
 const removeMember=make('button','','Remove from this album');$('viewerMenu').append(removeMember);removeMember.onclick=async()=>{if(library.view!=='albums'||!library.focus||!library.current)return;await library.change({type:'membership',albumId:library.focus,photoId:library.current.id,value:false});$('viewerStatus').textContent='Removed from album; original stays in pCloud.';};$('viewer').addEventListener('close',()=>{removeMember.hidden=true;});
 const reflectViewer=()=>{removeMember.hidden=library.view!=='albums'||!library.focus||Boolean(library.meta.albums[library.focus]?.smart);};new MutationObserver(reflectViewer).observe($('viewer'),{attributes:true,attributeFilter:['open']});
 const trashButton=make('button','settings-link','Trash · Restore deleted photos');trashButton.id='settingsTrash';trashButton.hidden=!window.SAI_ANDROID;$('settingsSimilar').before(trashButton);
 const trashDialog=make('dialog','gallery-sheet');trashDialog.id='trashDialog';const trashTitle=make('h2','','pCloud Trash'),trashStatus=make('p'),trashList=make('div','trash-list'),trashClose=make('button','','Close'),trashRefresh=make('button','','Refresh');trashDialog.append(trashTitle,trashStatus,trashRefresh,trashClose,trashList);document.body.append(trashDialog);trashClose.onclick=()=>trashDialog.close();
 const loadTrash=async()=>{trashRefresh.disabled=true;trashStatus.textContent='Loading deleted photos from pCloud…';trashList.replaceChildren();try{const result=await library.api('photo-trash');trashStatus.textContent=result.total?result.total+' deleted photos'+(result.limited?' · Showing first 1,500':''):'No deleted photos in pCloud Trash.';for(const item of result.items){const row=make('div','trash-item'),label=make('div'),restore=make('button','','Restore');label.append(make('strong','',item.fileName),make('small','',formatSize(item.size)+' · Original folder ID '+item.originalFolderId));restore.onclick=async()=>{restore.disabled=true;trashClose.disabled=true;try{const result=await library.api('photo-trash',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:item.id,confirmed:true})});if(!result.restored)throw new Error('pCloud did not confirm restoration.');await library.change({type:'photo-delete',photoId:item.id,restored:true});row.remove();trashStatus.textContent='Restored '+item.fileName+'. Refreshing your library…';$('refresh').click();}catch(e){trashStatus.textContent=e.message;restore.disabled=false;}finally{trashClose.disabled=false;}};row.append(label,restore);trashList.append(row);}}catch(e){trashStatus.textContent=e.message;}finally{trashRefresh.disabled=false;}};
 trashButton.onclick=()=>{trashDialog.showModal();loadTrash();};trashRefresh.onclick=loadTrash;
 const storage=make('section','storage-card');storage.id='pcloudStorage';storage.hidden=true;const storageLabel=make('p','','Storage'),storageValue=make('strong'),storageMeter=make('progress');storage.append(storageLabel,storageValue,storageMeter);$('settingsMenu').before(storage);
 const updateStorage=async()=>{if(!window.SAI_ANDROID||!library.account)return;try{const data=await library.api('account-info');if(data.quota>0){storage.hidden=false;storageValue.textContent=formatSize(data.used)+' of '+formatSize(data.quota)+' used';storageMeter.max=data.quota;storageMeter.value=data.used;}}catch{storage.hidden=true;}};
 $('openSettings').addEventListener('click',updateStorage);$('settingsMenu').addEventListener('click',()=>{storage.hidden=true;});$('settingsBack').addEventListener('click',updateStorage);
 const securityButton=make('button','','Security ›');securityButton.hidden=!window.SAI_ANDROID;securityButton.id='settingsSecurity';securityButton.dataset.nativeOnly='true';$('settingsMenu').append(securityButton);const securityDialog=make('dialog','gallery-sheet');securityDialog.id='securityDialog';const securityTitle=make('h2','','Security'),securityText=make('p','','App lock uses your Android screen lock on this device. It does not add encryption to pCloud files.'),lockButton=make('button','','App lock'),securityStatus=make('p'),securityClose=make('button','','Close');securityDialog.append(securityTitle,securityText,lockButton,securityStatus,securityClose);document.body.append(securityDialog);securityClose.onclick=()=>securityDialog.close();let lockEnabled=false;const lockInfo=async()=>{try{const data=await library.api('device-lock');lockEnabled=data.enabled;lockButton.textContent='App lock: '+(data.enabled?'On':'Off');lockButton.disabled=!data.available;securityStatus.textContent=data.available?'Confirm with your device screen lock to change this setting.':'Set a device screen lock in Android Settings first.';}catch(e){securityStatus.textContent=e.message;}};securityButton.onclick=()=>{securityDialog.showModal();lockInfo();};lockButton.onclick=async()=>{lockButton.disabled=true;try{await library.api('device-lock',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({enabled:!lockEnabled})});await lockInfo();}catch(e){securityStatus.textContent=e.message;lockButton.disabled=false;}};
 const offlineDownload=make('button','','Download offline');offlineDownload.id='downloadOfflinePhoto';offlineDownload.hidden=!window.SAI_ANDROID;$('viewerMenu').append(offlineDownload);offlineDownload.onclick=async()=>{const p=library.current;if(!p)return;offlineDownload.disabled=true;try{const result=await library.api('device-offline',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'download',id:p.id,version:p.version})});$('viewerStatus').textContent=result.saved?'Original saved offline on this device.':'Download was not confirmed.';}catch(e){$('viewerStatus').textContent=e.message;}finally{offlineDownload.disabled=false;}};
 const offlineButton=make('button','','Offline photos · Manage downloads');offlineButton.id='manageOfflinePhotos';offlineButton.hidden=!window.SAI_ANDROID;$('clearPhotoPreviews').before(offlineButton);const offlineDialog=make('dialog','gallery-sheet');offlineDialog.id='offlinePhotosDialog';const offlineTitle=make('h2','','Offline photos'),offlineStatus=make('p'),offlineList=make('div','trash-list'),offlineClose=make('button','','Close');offlineDialog.append(offlineTitle,offlineStatus,offlineClose,offlineList);document.body.append(offlineDialog);offlineClose.onclick=()=>offlineDialog.close();const offlineInfo=async()=>{try{const result=await library.api('device-offline');offlineStatus.textContent=result.items.length+' originals · '+formatSize(result.bytes)+' of '+formatSize(result.limit)+' on this device. Removing a download keeps the pCloud original.';offlineList.replaceChildren();for(const p of result.items){const row=make('div','trash-item'),label=make('div'),remove=make('button','','Remove download');label.append(make('strong','',p.name),make('small','',formatSize(p.size)));remove.onclick=async()=>{remove.disabled=true;try{await library.api('device-offline',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'remove',id:p.id})});await offlineInfo();}catch(e){offlineStatus.textContent=e.message;remove.disabled=false;}};row.append(label,remove);offlineList.append(row);}}catch(e){offlineStatus.textContent=e.message;}};offlineButton.onclick=()=>{offlineDialog.showModal();offlineInfo();};
 const backupButton=make('button','','Backup ›');backupButton.hidden=!window.SAI_ANDROID;backupButton.id='settingsBackup';backupButton.dataset.nativeOnly='true';$('settingsMenu').append(backupButton);const backupDialog=make('dialog','gallery-sheet');backupDialog.id='backupDialog';const backupTitle=make('h2','','Backup to pCloud'),backupHelp=make('p','','Choose up to 50 device photos per upload, at most 100 MB each. Existing files are kept; name conflicts create a renamed copy. Keep the app open. This is manual upload, not automatic camera backup.'),backupFolder=make('p'),uploadButton=make('button','primary','Choose photos to upload'),backupStatus=make('p'),backupClose=make('button','','Close');backupDialog.append(backupTitle,backupHelp,backupFolder,uploadButton,backupStatus,backupClose);document.body.append(backupDialog);backupClose.onclick=()=>backupDialog.close();let uploadTimer=null,wasUploading=false;const uploadProgress=async()=>{try{const result=await library.api('device-upload');uploadButton.disabled=Boolean(result.running);backupStatus.textContent=(result.total?result.completed+' / '+result.total+' uploaded · '+result.failed+' failed. ':'')+(result.message||'');if(!result.running&&wasUploading){wasUploading=false;$('refresh').click();}if(result.running){wasUploading=true;uploadTimer=setTimeout(uploadProgress,2000);}}catch(e){backupStatus.textContent=e.message;}};backupButton.onclick=()=>{backupFolder.textContent='Destination: '+(library.photoFolder()?.name||'Pictures / Sai Photos Uploads');backupDialog.showModal();uploadProgress();};uploadButton.onclick=async()=>{uploadButton.disabled=true;try{await library.api('device-upload',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({folderId:library.photoFolder()?.id||null})});wasUploading=true;clearTimeout(uploadTimer);uploadProgress();}catch(e){backupStatus.textContent=e.message;uploadButton.disabled=false;}};
 window.saiGalleryBack=()=>{if(library.selection?.mode){library.selection.toggle();return true;}if(library.focus||Object.keys(library.filters||{}).length){library.focus=null;library.filters={};library.render();return true;}if(tab!=='home'){navigate('home');return true;}return false;};
 const suggestions=make('button','','Delete suggestions · Review only');suggestions.id='settingsDeleteSuggestions';$('settingsLarge').after(suggestions);suggestions.onclick=()=>{const candidates=library.photos().filter(p=>!library.meta.favorites[p.id]&&p.mediaType!=='video'&&((/screenshot|screen.?shot/i.test(p.fileName||''))||(library.meta.visuals[p.id]?.version===p.version&&library.meta.visuals[p.id].contrast<.045)));$('settingsDialog').close();filter({ids:candidates.map(p=>p.id)},'Review suggestions: screenshots and low-contrast images');};
 if(window.SAI_PHOTOS_ONLY){$('settingsAccountPage').append($('cloudSyncPanel'));const badge=make('button','cloud-sync-badge','Cloud');badge.id='cloudSyncBadge';badge.setAttribute('aria-label','Cloud sync status');$('openSettings').before(badge);badge.onclick=()=>{$('openSettings').click();$('settingsMenu').querySelector('[data-settings-page="account"]').click();};const status=()=>{badge.textContent=!library.account?'○':library.cloudError||library.restoreError?'Sync issue':library.data.pending.length?'Saving…':library.syncing?'Syncing…':'✓';badge.title=library.cloudError||library.restoreError||library.data.pending.length+' changes awaiting save';};new MutationObserver(status).observe($('cloudSyncPanel'),{childList:true,subtree:true,characterData:true});status();}
 const settingsSearch=make('input');settingsSearch.type='search';settingsSearch.placeholder='Search settings';settingsSearch.setAttribute('aria-label','Search settings');$('settingsMenu').prepend(settingsSearch);settingsSearch.oninput=()=>{const query=settingsSearch.value.trim().toLowerCase();for(const button of $('settingsMenu').querySelectorAll('button'))button.hidden=Boolean(button.dataset.nativeOnly&&!window.SAI_ANDROID)||!button.textContent.toLowerCase().includes(query);};
 const density=make('select');density.id='galleryColumns';density.setAttribute('aria-label','Gallery columns');for(const n of [3,4,5]){const o=make('option','',n+' columns');o.value=n;density.append(o);}try{density.value=localStorage.getItem('sai-gallery-columns')||'3';}catch{}const densityLabel=make('label','','Gallery columns');densityLabel.append(density);$('galleryBatch').closest('section').append(densityLabel);const applyDensity=()=>{document.documentElement.style.setProperty('--gallery-columns',density.value);try{localStorage.setItem('sai-gallery-columns',density.value);}catch{}};density.onchange=applyDensity;applyDensity();

 function render(){
  const photos=library.photos(),query=$('search').value.trim(),isSearch=tab==='search'&&library.view==='library',hasFilter=Object.keys(library.filters||{}).length>0,hub=isSearch&&!query&&!hasFilter;
  const native=window.SAI_PHOTOS_ONLY;document.body.classList.toggle('discovery-mode',hub);title.textContent=library.view==='albums'?'Albums':library.view==='people'?'People':library.view==='favorites'?'Favorites':isSearch?'Search':'Photos';title.hidden=!native;
  if(native){document.body.classList.toggle('gallery-subpage',tab!=='home'||library.view!=='library');title.hidden=tab==='home'&&library.view==='library';$('search').hidden=tab!=='search'&&!query;for(const [id,value]of [['navPhotos','home'],['navAlbums','albums'],['navFavorites','favorites'],['navSearch','search']])$(id)?.setAttribute('aria-current',String(tab===value));$('photoNavigation').classList.toggle('has-selection',library.selection?.mode);$('status').closest('.connection').hidden=Boolean(library.account);$('sharedIndexStatus').hidden=true;}
  if(['albums','people'].includes(library.view)&&!library.focus)$('galleryToolbar').hidden=true;
  albumActions.hidden=library.view!=='albums';rename.hidden=!library.focus;deleteAlbum.hidden=!library.focus;bulkAlbum.disabled=!library.selection?.selected.size;filterBar.replaceChildren();filterBar.hidden=!hasFilter;if(hasFilter){filterBar.append(make('span','',library.filterTitle||'Filtered photos'));chip(filterBar,'Clear filter',()=>{library.filters={};library.render();});}
  shell.hidden=!hub;memories.hidden=!showMemories||tab!=='home'||library.view!=='library'||Boolean(query)||hasFilter;
  if(hub){$('photoGrid').hidden=true;$('empty').hidden=true;$('more').hidden=true;$('galleryToolbar').hidden=true;}
  const stamp=[library.account,photos.length,library.people.map(p=>p.id+':'+p.name+':'+p.photos.size).join('|'),showMemories,Object.keys(library.meta.albums).length].join(':');
  const discoveryVisible=!shell.hidden||!memories.hidden;
  const changed=stamp!==lastStamp||lastPhotos!==photos;lastStamp=stamp;lastPhotos=photos;
  if(!discoveryVisible)return;
  if(!changed&&builtStamp===stamp)return;builtStamp=stamp;
  shell.replaceChildren();memories.replaceChildren();
  const existing=new Map(photos.map(p=>[p.id,p]));const people=section(shell,'People');for(const person of library.people.slice(0,12)){const members=[...person.photos].map(id=>existing.get(id)).filter(Boolean);if(members.length)photoCard(people,person.name||'Person',members,()=>{tab='search';library.view='people';library.focus=person.id;library.filters={};library.render();},person);}chip(people,'View all people',()=>{tab='search';library.view='people';library.focus=null;library.filters={};library.render();});

  const facets=galleryFacets(photos),folders=section(shell,'Folders');for(const [folder,count]of facets.folders.slice(0,20))chip(folders,folder.split('/').filter(Boolean).pop()||folder,()=>filter({folder},folder),count+' photos');
  const years=section(shell,'Years');for(const [year,count]of facets.years)chip(years,year,()=>filter({year},year),count+' photos');
  const types=section(shell,'File types');chip(types,'Photos',()=>filter({media:'photo'},'Photos'),photos.filter(p=>p.mediaType!=='video').length+' files');chip(types,'Videos',()=>filter({media:'video'},'Videos'),photos.filter(p=>p.mediaType==='video').length+' files');for(const [type,count]of facets.types)chip(types,type,()=>filter({type},type+' photos'),count+' photos');
  const cleanup=section(shell,'Review');for(const [view,label]of [['similar','Similar images'],['duplicates','Duplicates'],['large','Large files']])chip(cleanup,label,()=>{tab='search';clear();library.view=view;library.render();});
  if(showMemories){const groups=galleryMemories(photos,new Date(),library.people);reportMemories(groups);if(groups.length){const row=section(memories,'Memories');for(const group of groups)photoCard(row,group.title,group.photos,()=>filter({ids:group.photos.map(p=>p.id)},group.title));memories.append(make('p','discovery-muted','From your photo dates and named people.'));
  }}
 }
 return {render,navigate,filter,reset:()=>{tab='home';clear();lastStamp='';}};
}
