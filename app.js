// Gallery gesture helpers (kept in gallery-controls.mjs for isolated tests).
function sortPhotos(items,order='newest'){
 const result=[...items];if(order==='relevance')return result;const tie=(a,b)=>a.id.localeCompare(b.id);const date=item=>Number(item.addedAt)||0;
 return result.sort((a,b)=>{if(order==='largest')return (Number(b.size)||0)-(Number(a.size)||0)||tie(a,b);if(order==='smallest')return (Number(a.size)||0)-(Number(b.size)||0)||tie(a,b);if(order==='name'||order==='name-desc')return (order==='name-desc'?-1:1)*String(a.fileName||a.name).localeCompare(String(b.fileName||b.name),undefined,{numeric:true})||tie(a,b);if(!date(a)||!date(b))return (date(b)>0)-(date(a)>0)||tie(a,b);return (order==='oldest'?date(a)-date(b):date(b)-date(a))||tie(a,b);});
}
function rangeSelection(ids,anchor,end,baseline,add=true){const selected=new Set(baseline),a=ids.indexOf(anchor),b=ids.indexOf(end);if(a<0||b<0)return selected;for(const id of ids.slice(Math.min(a,b),Math.max(a,b)+1))add?selected.add(id):selected.delete(id);return selected;}
class GallerySelection{
 constructor({change,deleteSelected}){this.selected=new Set();this.mode=false;this.change=change;this.deleteSelected=deleteSelected;this.grids=[];}
 scope(key){if(key!==this.key){this.key=key;this.mode=false;this.selected.clear();this.refresh();}}
 attach(grid){
  this.grids.push(grid);
  grid.style.userSelect="none";grid.style.webkitUserSelect="none";
  grid.addEventListener("contextmenu",event=>event.preventDefault());
  const cardAt=target=>target.closest?.('[data-photo-id]');
  const prepare=(card,x,y)=>{clearTimeout(this.hold);this.x=x;this.y=y;this.down=[x,y];this.startCard=card.dataset.photoId;this.moved=false;this.cancelled=false;};
  const begin=()=>{this.mode=true;this.drag=true;this.anchor=this.startCard;this.baseline=new Set(this.selected);this.add=!this.selected.has(this.anchor);this.move(this.anchor);this.suppressClick=true;};
  const finish=()=>{clearTimeout(this.hold);cancelAnimationFrame(this.frame);this.frame=null;this.drag=false;this.pointer=null;this.touchId=null;};
  const tap=()=>{if(this.mode&&!this.moved&&!this.cancelled&&!this.drag){this.selected.has(this.startCard)?this.selected.delete(this.startCard):this.selected.add(this.startCard);this.refresh();}if(this.mode)this.suppressClick=true;};
  // A normal vertical swipe must remain browser scrolling, even in selection mode.
  // Only a held finger becomes a selection gesture; prevent its touchmove default
  // before WebView starts scrolling. Changing touch-action mid-gesture is too late.
  grid.addEventListener('touchstart',event=>{if(event.touches.length!==1){this.cancelled=true;finish();return;}const card=cardAt(event.target);if(!card||event.target.closest('input,select,button.person-remove'))return;const touch=event.touches[0];prepare(card,touch.clientX,touch.clientY);this.touchId=touch.identifier;this.hold=setTimeout(begin,450);},{passive:true});
  grid.addEventListener('touchmove',event=>{const touch=[...event.touches].find(value=>value.identifier===this.touchId);if(!touch)return;this.x=touch.clientX;this.y=touch.clientY;if(!this.drag){if(Math.hypot(this.x-this.down[0],this.y-this.down[1])>10){this.moved=true;clearTimeout(this.hold);}return;}event.preventDefault();this.hit();this.scroll();},{passive:false});
  grid.addEventListener('touchend',()=>{if(this.touchId==null)return;tap();finish();});
  grid.addEventListener('touchcancel',()=>{this.cancelled=true;finish();});
  grid.addEventListener('pointerdown',event=>{if(!['mouse','pen'].includes(event.pointerType))return;const card=cardAt(event.target);if(!card||event.target.closest('input,select,button.person-remove'))return;prepare(card,event.clientX,event.clientY);this.pointer=event.pointerId;const start=()=>{begin();grid.setPointerCapture(event.pointerId);};if(this.mode){event.preventDefault();start();}else this.hold=setTimeout(start,450);});
  grid.addEventListener('pointermove',event=>{if(!['mouse','pen'].includes(event.pointerType)||this.pointer!==event.pointerId)return;this.x=event.clientX;this.y=event.clientY;if(!this.drag&&Math.hypot(this.x-this.down[0],this.y-this.down[1])>10){this.moved=true;clearTimeout(this.hold);}if(!this.drag)return;event.preventDefault();this.hit();this.scroll();});
  grid.addEventListener('pointerup',event=>{if(['mouse','pen'].includes(event.pointerType))finish();});grid.addEventListener('pointercancel',event=>{if(['mouse','pen'].includes(event.pointerType))finish();});
  grid.addEventListener('click',event=>{if(!this.mode&&!this.suppressClick)return;const card=cardAt(event.target);if(card&&!event.target.closest('input,button.person-remove')){event.preventDefault();event.stopPropagation();}this.suppressClick=false;},true);
 }

 ids(){return [...new Set(this.grids.filter(grid=>grid.getClientRects().length).flatMap(grid=>[...grid.querySelectorAll('[data-photo-id]')].map(card=>card.dataset.photoId)))];}
 move(id){const next=rangeSelection(this.ids(),this.anchor,id,this.baseline,this.add);this.selected.clear();for(const value of next)this.selected.add(value);this.refresh();}
 hit(){const card=document.elementFromPoint(this.x,this.y)?.closest('[data-photo-id]');if(card)this.move(card.dataset.photoId);}
 scroll(){if(this.frame)return;const tick=()=>{this.frame=null;if(!this.drag)return;const edge=110,speed=this.y<edge?-14:this.y>innerHeight-edge?14:0;if(speed){window.scrollBy(0,speed);this.hit();this.frame=requestAnimationFrame(tick);}};this.frame=requestAnimationFrame(tick);}
 toggle(){this.mode=!this.mode;if(!this.mode)this.selected.clear();this.refresh();}
 refresh(){for(const grid of this.grids){grid.classList.toggle('selecting',this.mode);for(const card of grid.querySelectorAll('[data-photo-id]')){const active=this.selected.has(card.dataset.photoId);card.classList.toggle('is-selected',active);card.setAttribute('aria-selected',String(active));const box=card.querySelector('input[type=checkbox]');if(box)box.checked=active;}}this.change?.();}
 selectLoaded(){this.mode=true;for(const id of this.ids())this.selected.add(id);this.refresh();}
 clear(){this.selected.clear();this.refresh();}
}

import { APP_VERSION,setupSettings } from './settings.mjs';
import { parseQuestion,summarizeAnswer,SUGGESTED_QUESTIONS } from './assistant.mjs';
import { providerById,chat,keyStorageId } from './ai-providers.mjs';
import { cancelLibraryScan,formatSize,normalizeFileVersion } from './photo-tools.mjs';
import { listDownloadedSongs } from './photo-cache.mjs';
import { setupEnteGallery,activeDeletedPhotoIds,suggestAlbums } from './smart-features.mjs';
import { MusicPlayer } from './music-player.mjs';
import { normalizeSleepMinutes } from './music-state.mjs';
import { PhotoLibrary } from './photo-library.mjs';
import { setupDeviceSource } from './device-photos.mjs';
window.SAI_RUNNING_VERSION=APP_VERSION;
const $ = id => document.getElementById(id);
const base = '/.netlify/functions/';
const state = { tab: 'photo', photo: [], audio: [], connected: false, limit: 50, generation: 0 };
const photoLibrary = new PhotoLibrary({ api, photoFolder: () => photoFolder, photos: () => state.photo, render, onDelete: id => {
  cancelLibraryScan(state,photoLibrary,loadController);
  state.photo = state.photo.filter(photo => photo.id !== id);
  if(window.SAI_ANDROID)api('device-offline',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'remove',id})}).catch(()=>{});
  $('refresh').disabled = !state.connected;
} });
const musicPlayer = window.SAI_PHOTOS_ONLY&&!window.SAI_MUSIC_ENABLED ? {reset(){},applyCloudDeletes(){},savePosition(){},items(){return [];},render(){},playerUI(){},setSleep(){},stopSleep(){},openFullscreen(){},closeFullscreen(){},current:null,allTracks:()=>new Map(),play(){}} : new MusicPlayer({ library: photoLibrary, musicFolder:()=>musicFolder, tracks: () => state.audio, openAudio: () => setTab('audio'), render, onDelete: id => {
  cancelLibraryScan(state,photoLibrary,loadController); state.audio = state.audio.filter(track => track.id !== id); $('refresh').disabled = false;
} });
if(window.SAI_MUSIC_ENABLED&&localStorage.getItem('sai-music-suggest')!=='off')musicPlayer.view='foryou';
if(window.SAI_PHOTOS_ONLY){
  document.body.classList.add('photos-only');$('photoNavigation').hidden=false;$('indexModeWrap').hidden=false;$('photoControls').hidden=false;const tabsNav=document.querySelector('.tabs');if(tabsNav)tabsNav.hidden=true;$('openMenu').hidden=false;
  const sectionBar=document.querySelector('.photo-sections');if(sectionBar){for(const id of ['selectPhotos','sortPhotos']){const node=$(id);if(node)sectionBar.append(node);}}
  const controls=$('photoControlContent');for(const element of [$('choosePhotoFolder').closest('.music-folder'),$('photoFolderSummary'),$('indexModeWrap'),$('indexPhotos').closest('.photo-actions'),$('indexStatus'),$('visualIndexStatus')])if(element)controls.append(element);
  const accountButtons=document.createElement('div');accountButtons.className='photo-account-actions';accountButtons.append($('connect'),$('connectToken'),$('disconnect'));controls.append(accountButtons);

  const icons={navPhotos:['library','Photos'],navAlbums:['albums','Albums'],navSearch:['library','Search'],navPeople:['people','People'],navCleanup:['duplicates','Cleanup']};
  const titles={library:'Photos',albums:'Albums',people:'People',favorites:'Favorites',duplicates:'Cleanup',similar:'Similar',large:'Large files'};
  const gotoView=(view,focusSearch)=>{photoLibrary.view=view;photoLibrary.focus=null;photoLibrary.filters={};photoLibrary.filterTitle='';$('search').value='';photoLibrary.searchQuery='';photoLibrary.semanticScores=null;setTab('photo');$('appTitle').textContent=titles[view]||'Photos';for(const key of Object.keys(icons))$(key).setAttribute('aria-current',String(icons[key][0]===view&&key!=='navSearch'));if(focusSearch){$('search').focus();$('search').scrollIntoView({block:'center'});}else window.scrollTo({top:0,behavior:'smooth'});if($('menuDrawer').open)$('menuDrawer').close();};
  for(const [id,[view,label]]of Object.entries(icons))$(id).onclick=()=>gotoView(view,id==='navSearch');
  const menuViews={menuPhotos:'library',menuAlbums:'albums',menuPeople:'people',menuFavorites:'favorites',menuCleanup:'duplicates',menuSimilar:'similar',menuLarge:'large'};
  for(const [id,view] of Object.entries(menuViews))$(id).onclick=()=>gotoView(view,false);
  $('menuSearch').onclick=()=>gotoView('library',true);
  const openDrawer=()=>{const drawer=$('menuDrawer');if(!drawer.open)drawer.showModal();};
  $('openMenu').onclick=openDrawer;
  const menuDrawer=$('menuDrawer');
  menuDrawer.addEventListener('click',event=>{if(event.target===menuDrawer)menuDrawer.close();});
  let drawerTouch=null;
  menuDrawer.addEventListener('touchstart',event=>{const touch=event.touches[0];drawerTouch={x:touch.clientX,y:touch.clientY};},{passive:true});
  menuDrawer.addEventListener('touchmove',event=>{if(!drawerTouch)return;const touch=event.touches[0];if(touch.clientX-drawerTouch.x<-60&&Math.abs(touch.clientY-drawerTouch.y)<90){drawerTouch=null;menuDrawer.close();}},{passive:true});
  menuDrawer.addEventListener('touchend',()=>{drawerTouch=null;},{passive:true});
  let edgeTouch=null;
  document.addEventListener('touchstart',event=>{const touch=event.touches[0];edgeTouch=touch.clientX<=30&&!menuDrawer.open?{x:touch.clientX,y:touch.clientY}:null;},{passive:true,capture:true});
  document.addEventListener('touchmove',event=>{if(!edgeTouch||menuDrawer.open)return;const touch=event.touches[0];const dx=touch.clientX-edgeTouch.x;if(dx>70&&Math.abs(touch.clientY-edgeTouch.y)<90){edgeTouch=null;openDrawer();}else if(dx<-25){edgeTouch=null;}},{passive:true,capture:true});
  document.addEventListener('touchend',()=>{edgeTouch=null;},{passive:true,capture:true});
  $('closeMenu').onclick=()=>$('menuDrawer').close();
  $('menuSettings').onclick=()=>{$('menuDrawer').close();$('openSettings').click();};
  $('menuAccount').onclick=()=>{$('menuDrawer').close();$('openSettings').click();const page=$('settingsMenu').querySelector('[data-settings-page="account"]');if(page)page.click();};
}
setupSettings(photoLibrary);
$('settingsLibraryControls').append($('photoControls'));if(window.SAI_PHOTOS_ONLY)$('settingsAccountPage').append($('connectToken'),$('disconnect'));$('photoControls').hidden=false;$('photoControls').open=true;
if(!window.SAI_PHOTOS_ONLY){const controls=$('photoControlContent');for(const element of [$('choosePhotoFolder').closest('.music-folder'),$('photoFolderSummary'),$('indexModeWrap'),$('indexPhotos').closest('.photo-actions'),$('indexStatus'),$('visualIndexStatus')])if(element)controls.append(element);}
const gallerySelection=new GallerySelection({change:()=>{const count=gallerySelection.selected.size;if(window.SAI_PHOTOS_ONLY)$('photoNavigation').classList.toggle('has-selection',gallerySelection.mode||count>0);$('selectionToolbar').hidden=!gallerySelection.mode;$('selectPhotos').textContent=gallerySelection.mode?'Done':'Select';$('selectedPhotoCount').textContent=count+' selected';$('deleteSelectedPhotos').disabled=!count||gallerySelection.busy;const albumButton=document.getElementById('bulkAddToAlbum');if(albumButton)albumButton.disabled=!count||gallerySelection.busy;$('cleanupSelection').textContent=count+' selected';$('deleteCleanupSelection').disabled=!count||photoLibrary.cleanup.busy;},deleteSelected:()=>photoLibrary.cleanup.deleteSelection()});
photoLibrary.selection=gallerySelection;photoLibrary.cleanup.selected=gallerySelection.selected;gallerySelection.attach($('photoGrid'));gallerySelection.attach($('cleanupGroups'));
const navAi=document.createElement('button');navAi.id='navAi';navAi.setAttribute('aria-label','AI assistant');navAi.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.2l1.9 5.3 5.3 1.9-5.3 1.9L12 17.6l-1.9-5.3-5.3-1.9 5.3-1.9Z"/><path d="M18.5 15.5l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7Z"/></svg><span class="nav-label">AI</span>';
if(window.SAI_PHOTOS_ONLY){$('photoNavigation').insertBefore(navAi,$('navCleanup'));}else{const tabsNav=document.querySelector('.tabs');if(tabsNav)tabsNav.append(navAi);}
navAi.onclick=()=>{gallerySelection.mode=false;gallerySelection.selected.clear();gallerySelection.refresh();setTab('ai');window.scrollTo({top:0,behavior:'smooth'});};
$('selectPhotos').onclick=()=>gallerySelection.toggle();$('selectLoadedPhotos').onclick=()=>gallerySelection.selectLoaded();$('clearSelectedPhotos').onclick=()=>gallerySelection.clear();$('deleteSelectedPhotos').onclick=async()=>{gallerySelection.busy=true;gallerySelection.refresh();try{await photoLibrary.cleanup.deleteSelection();}finally{gallerySelection.busy=false;gallerySelection.refresh();}};
function toast(message){let el=document.getElementById('saiToast');if(!el){el=document.createElement('div');el.id='saiToast';document.body.append(el);}el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),4200);}
window.addEventListener('sai-mirror-cleared',()=>{try{for(const url of musicPlayer.cachedURLs?.values?.()||[])URL.revokeObjectURL(url);musicPlayer.cachedURLs?.clear?.();musicPlayer.downloads?.clear?.();}catch{}render();});
const deviceSource=setupDeviceSource({api,toast});if(window.SAI_ANDROID&&sourceMode()==='device'){document.body.classList.add('device-source');deviceSource.show();}
if(new URLSearchParams(location.search).get('recovered')==='1')toast('The app recovered from a startup problem and reset only the local cache. Your login and everything in pCloud are untouched; previews and downloads rebuild automatically.');
updateSourceRow();
async function bulkTransfer(action){const ids=[...gallerySelection.selected];if(!ids.length)return;const target=await openTransferPicker(action);if(!target)return;const account=photoLibrary.account;const photos=state.photo.filter(photo=>ids.includes(photo.id));if(!photos.length)return;let done=0,failed=0;const movedIds=[];gallerySelection.busy=true;gallerySelection.refresh();try{for(let offset=0;offset<photos.length;offset+=25){if(photoLibrary.account!==account)return;toast(`${action==='move'?'Moving':'Copying'} ${offset+1}–${Math.min(offset+25,photos.length)} of ${photos.length}…`);const result=await api('photos-transfer',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({confirmed:true,action,targetFolderId:target.id,items:photos.slice(offset,offset+25).map(photo=>({id:photo.id,fileName:photo.fileName}))})});const rows=result.results||[];for(const row of rows){if(row.error){failed++;continue;}done++;if(action==='move'&&row.moved){movedIds.push(row.id);photoLibrary.onDelete(row.id);}}}if(movedIds.length)photoLibrary.render();toast(`${action==='move'?'Moved':'Copied'} ${done} photo${done===1?'':'s'} to ${target.name}${failed?' · '+failed+' failed':''}.`);}catch(error){toast(`${action==='move'?'Move':'Copy'} could not finish: ${error.message||'check your connection and retry'}`);}finally{gallerySelection.busy=false;gallerySelection.refresh();}}
if($('copySelectedPhotos'))$('copySelectedPhotos').onclick=()=>bulkTransfer('copy');
if($('moveSelectedPhotos'))$('moveSelectedPhotos').onclick=()=>bulkTransfer('move');
const enteGallery=setupEnteGallery(photoLibrary);
const assistant=(()=>{
  const log=$('aiChatLog'),form=$('aiAskForm'),input=$('aiAskInput'),status=$('aiAnswerStatus'),chips=$('aiQuickChips');
  if(!log||!form)return {open(){}};
  let historyShown=false;
  const scroll=()=>{log.scrollTop=log.scrollHeight;};
  function bubble(role,text){const row=document.createElement('div');row.className='ai-bubble '+role;const body=document.createElement('p');body.textContent=text;row.append(body);log.append(row);scroll();return row;}
  function knownNames(){return (photoLibrary.people||[]).map(person=>person.name).filter(Boolean);}
  function peoplePhotoIds(name){const target=String(name||'').toLowerCase();const ids=new Set();for(const person of photoLibrary.people||[]){if(target&&String(person.name||'').toLowerCase().includes(target))for(const id of person.photos)ids.add(id);}return ids;}
  function allTracks(){try{return [...musicPlayer.allTracks().values()];}catch{return [];}}
  function matchSongs(query){const words=String(query||'').toLowerCase().split(/\s+/).filter(Boolean);if(!words.length)return [];const hits=allTracks().filter(track=>words.every(word=>track.name.toLowerCase().includes(word)));if(hits.length)return hits.slice(0,12);return allTracks().filter(track=>words.some(word=>word.length>2&&track.name.toLowerCase().includes(word))).slice(0,12);}
  async function matchPhotos(intent){
    const query=(intent.personName||intent.terms.join(' ')).trim().toLowerCase();
    let photos=query?photoLibrary.filter(state.photo,query):[...state.photo];
    if(query){try{await photoLibrary.aiSearch(query);const scores=photoLibrary.semanticScores;if(scores&&photoLibrary.searchQuery===query){const seen=new Set(photos.map(photo=>photo.id));for(const photo of state.photo)if(scores.has(photo.id)&&!seen.has(photo.id))photos.push(photo);}}catch{}}
    if(intent.videos)photos=photos.filter(photo=>photo.mediaType==='video');
    if(intent.favorites)photos=photos.filter(photo=>photoLibrary.meta.favorites[photo.id]);
    if(intent.personName){const ids=peoplePhotoIds(intent.personName);if(ids.size)photos=photos.filter(photo=>ids.has(photo.id));else if(!intent.terms.length)photos=[];}
    if(intent.year)photos=photos.filter(photo=>String(new Date(Number(photo.addedAt)||0).getFullYear())===intent.year);
    if(intent.monthOffset!==null){const now=new Date();const target=new Date(now.getFullYear(),now.getMonth()+intent.monthOffset,1);photos=photos.filter(photo=>{const date=new Date(Number(photo.addedAt)||0);return date.getFullYear()===target.getFullYear()&&date.getMonth()===target.getMonth();});}
    return photos;
  }
  function photoStrip(row,photos){if(!photos.length)return;const strip=document.createElement('div');strip.className='ai-photos';const shown=photos.slice(0,8);for(const photo of shown){const button=document.createElement('button');button.type='button';button.className='ai-photo';const image=document.createElement('img');image.alt=photo.fileName;image.loading='lazy';photoLibrary.loadTile(photo,image);button.append(image);button.onclick=()=>photoLibrary.open(photo,photos);strip.append(button);}if(photos.length>shown.length){const more=document.createElement('span');more.className='ai-more';more.textContent='+'+(photos.length-shown.length)+' more';strip.append(more);}row.append(strip);scroll();}
  function songStrip(row,songs){if(!songs.length)return;const strip=document.createElement('div');strip.className='ai-songs';for(const song of songs.slice(0,6)){const button=document.createElement('button');button.type='button';button.className='ai-song';button.textContent='▶ '+song.name;button.onclick=()=>{setTab('audio');musicPlayer.play(song,songs);};strip.append(button);}row.append(strip);scroll();}
  function factsDigest(intent,photos,songs){const lines=['Question: '+intent.raw,'On-device result counts: '+photos.length+' photo matches, '+songs.length+' song matches.'];for(const photo of photos.slice(0,12))lines.push('- '+photo.fileName+(photo.addedAt?' · '+new Date(Number(photo.addedAt)).toISOString().slice(0,10):''));for(const song of songs.slice(0,6))lines.push('- song: '+song.name);const people=knownNames().slice(0,12);if(people.length)lines.push('Named people saved on this device: '+people.join(', '));return lines.join('\n').slice(0,1800);}
  async function cloudPolish(row,intent,photos,songs){const settings=photoLibrary.meta.aiSettings;if(!settings||settings.privacy!=='cloud')return;if(['help','sleep','sleep-off','stop','index','index-status','album'].includes(intent.kind))return;const provider=providerById(settings.provider);let key='';try{key=localStorage.getItem(keyStorageId(settings.provider))||'';}catch{}if(!provider||!key||!settings.model){status.textContent='Cloud-enhanced answers are on, but no provider key or model is saved. Open Settings → AI.';return;}status.textContent='Asking '+settings.model+' on '+provider.name+'…';try{const reply=await chat(provider,key,settings.model,[{role:'system',content:'You are the Sai Photos assistant on the user’s phone. Today is '+new Date().toDateString()+'. Answer in at most three short sentences using only the facts provided; never invent files.'},{role:'user',content:factsDigest(intent,photos,songs)}],{webSearch:Boolean(settings.webSearch)&&provider.id==='gemini',maxTokens:512});const cloud=document.createElement('p');cloud.className='ai-cloud';cloud.textContent='☁ '+reply;row.append(cloud);status.textContent='Cloud-enhanced via '+settings.model+' · '+provider.name+(settings.webSearch&&provider.id==='gemini'?' · live web search':'');}catch(error){status.textContent='Cloud answer unavailable: '+error.message;}scroll();}
  async function ask(questionRaw){
    const question=String(questionRaw||'').trim().slice(0,300);if(!question)return;
    bubble('user',question);input.value='';status.textContent='Searching this device…';
    const intent=parseQuestion(question,knownNames());
    let photos=[],songs=[],facts={};
    const audio=$('audio');
    if(intent.kind==='sleep'){
      const minutes=normalizeSleepMinutes(intent.sleepMinutes);
      if(window.SAI_MUSIC_ENABLED&&musicPlayer.setSleep){musicPlayer.setSleep(minutes);}
      else facts.sleepError='Music is not enabled in this build.';
    }
    else if(intent.kind==='sleep-off'){if(window.SAI_MUSIC_ENABLED&&musicPlayer.stopSleep)musicPlayer.stopSleep();}
    else if(intent.kind==='stop'){facts.stopped=Boolean(audio&&!audio.paused);if(audio)audio.pause();}
    else if(intent.kind==='index-status'){
      facts.indexStatus={indexed:Object.keys(photoLibrary.meta.indexes).length,total:state.photo.length,visuals:Object.keys(photoLibrary.meta.visuals).length,songs:Object.keys(photoLibrary.meta.musicIndexes).length,running:Boolean(photoLibrary.indexing)};
    }
    else if(intent.kind==='index'){
      if(!photoLibrary.account)facts.indexError='Connect pCloud first — indexes are saved in pCloud.';
      else if(photoLibrary.indexing)facts.indexRunning=true;
      else { try{await photoLibrary.beginIndexing();}catch(error){facts.indexError='Could not start indexing: '+(error.message||error);} }
    }
    else if(intent.kind==='album'){
      if(!photoLibrary.account)facts.albumError='Connect pCloud first — albums are saved in pCloud.';
      else if(!intent.albumName)facts.albumError='Tell me the album name, like “create album Beach 2026”.';
      else { try{await photoLibrary.createAlbumByName(intent.albumName);}catch(error){facts.albumError='Could not create the album: '+(error.message||error);} }
    }
    try{
      if(intent.kind==='play')songs=matchSongs(intent.play);
      else if(!['help','sleep','sleep-off','stop','index','index-status','album'].includes(intent.kind))photos=await matchPhotos(intent);
    }catch(error){status.textContent='Could not search: '+error.message;}
    const answer=summarizeAnswer(intent,{photos,songs,videosIn:photos.filter(photo=>photo.mediaType==='video').length,...facts});
    const row=bubble('assistant',answer.text);
    photoStrip(row,photos);songStrip(row,songs);
    status.textContent=intent.kind==='play'&&songs.length?'Starting playback…':answer.done?'Answered on this device.':'Answered on this device from your library.';
    try{photoLibrary.change({type:'ai-chat',question,answer:answer.text.slice(0,2000),photoIds:photos.slice(0,50).map(photo=>photo.id),songIds:songs.slice(0,50).map(song=>song.id)},{quiet:true});}catch{}
    void cloudPolish(row,intent,photos,songs);
    renderSuggestions();
  }
  form.onsubmit=event=>{event.preventDefault();void ask(input.value);};
  function renderHistory(){if(historyShown)return;historyShown=true;const chats=(photoLibrary.meta.aiChats||[]).slice(-12);if(!chats.length){bubble('assistant',summarizeAnswer(parseQuestion('help'),{photos:[],songs:[]}).text);return;}for(const chat of chats){bubble('user',chat.question);bubble('assistant',chat.answer);}}
  function renderChips(){if(!chips||chips.childElementCount)return;const questions=[...SUGGESTED_QUESTIONS];const people=knownNames();if(people.length)questions.splice(2,0,'Photos of '+people[0]);for(const text of questions){const button=document.createElement('button');button.type='button';button.textContent=text;button.onclick=()=>void ask(text);chips.append(button);}}
  function renderSuggestions(){const box=$('aiSuggestions');if(!box)return;let list=[];try{list=suggestAlbums(state.photo,photoLibrary.meta,photoLibrary.people||[],new Date());}catch{list=[];}let dismissed=[];try{dismissed=JSON.parse(localStorage.getItem('sai-suggest-dismissed')||'[]');}catch{dismissed=[];}list=list.filter(suggestion=>!dismissed.includes(suggestion.query));box.replaceChildren();if(!list.length){box.hidden=true;return;}box.hidden=false;const title=document.createElement('p');title.className='ai-suggest-title';title.textContent='Suggested albums';box.append(title);for(const suggestion of list){const row=document.createElement('div');row.className='ai-suggest-row';const create=document.createElement('button');create.type='button';create.textContent=suggestion.name+' · '+suggestion.count;create.onclick=()=>{if(!photoLibrary.account){toast('Connect pCloud to create albums.');return;}if(!$('smartAlbumName')||!$('smartAlbumQuery'))return;$('smartAlbumName').value=suggestion.name;$('smartAlbumQuery').value=suggestion.query;photoLibrary.createSmartAlbum().catch(()=>{});toast('Creating “'+suggestion.name+'” — it appears in Albums once saved to pCloud.');try{dismissed.push(suggestion.query);localStorage.setItem('sai-suggest-dismissed',JSON.stringify(dismissed.slice(-100)));}catch{}renderSuggestions();};const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='ai-suggest-dismiss';dismiss.setAttribute('aria-label','Dismiss '+suggestion.name);dismiss.textContent='✕';dismiss.onclick=()=>{try{dismissed.push(suggestion.query);localStorage.setItem('sai-suggest-dismissed',JSON.stringify(dismissed.slice(-100)));}catch{}renderSuggestions();};row.append(create,dismiss);box.append(row);}}
  return {open(){renderHistory();renderChips();renderSuggestions();input.focus();},ask};
})();
if($('aiTopSearch'))$('aiTopSearch').onclick=()=>{setTab('photo');$('search').focus();$('search').scrollIntoView({block:'center'});};
if($('aiTopStatus'))$('aiTopStatus').onclick=()=>{void assistant.ask('indexing status');};
if($('aiStatusPill'))$('aiStatusPill').onclick=()=>{setTab('ai');void assistant.ask('indexing status');};
let galleryBatch=50;try{galleryBatch=localStorage.getItem('sai-gallery-batch')==='100'?100:50;$('sortPhotos').value=localStorage.getItem('sai-gallery-sort')||'newest';$('galleryTheme').value=localStorage.getItem('sai-gallery-theme')||'system';}catch{}
state.limit=galleryBatch;$('galleryBatch').value=String(galleryBatch);
function applyGalleryTheme(){const choice=$('galleryTheme').value;document.body.classList.toggle('theme-dark',choice==='dark'||choice==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);try{localStorage.setItem('sai-gallery-theme',choice);}catch{}}
applyGalleryTheme();matchMedia('(prefers-color-scheme: dark)').addEventListener('change',applyGalleryTheme);$('galleryTheme').onchange=applyGalleryTheme;
function saiUiMode(){try{return localStorage.getItem('sai-ui')==='sai'?'sai':'ente';}catch{return 'ente';}}
function applyUiMode(mode,rerender){const next=mode==='sai'?'sai':'ente';document.documentElement.dataset.ui=next;try{localStorage.setItem('sai-ui',next);}catch{}const select=$('uiStyle');if(select&&select.value!==next)select.value=next;if(rerender)photoLibrary.render();return next;}
window.saiApplyUi=mode=>applyUiMode(mode,true);window.saiUiMode=saiUiMode;
document.documentElement.dataset.ui=saiUiMode();if($('uiStyle'))$('uiStyle').value=saiUiMode();$('uiStyle').onchange=()=>{const applied=applyUiMode($('uiStyle').value,true);toast(applied==='sai'?'Interface: Sai Photos — the new look.':'Interface: Ente style (classic).');};
let wellnessActiveMs=0,wellnessMark=Date.now();
window.saiWellnessReset=()=>{wellnessActiveMs=0;wellnessMark=Date.now();};
setInterval(()=>{const now=Date.now();if(document.visibilityState==='visible'){let on=true;try{on=localStorage.getItem('sai-wellness')!=='off';}catch{}if(on)wellnessActiveMs+=now-wellnessMark;}wellnessMark=now;if(wellnessActiveMs>=600000){wellnessActiveMs=0;const dialog=$('wellnessDialog');if(dialog&&!dialog.open)dialog.showModal();}},30000);
$('galleryBatch').onchange=()=>{galleryBatch=Number($('galleryBatch').value)===100?100:50;state.limit=galleryBatch;try{localStorage.setItem('sai-gallery-batch',String(galleryBatch));}catch{}render();};
$('sortPhotos').onchange=()=>{try{localStorage.setItem('sai-gallery-sort',$('sortPhotos').value);}catch{}state.limit=galleryBatch;render();};
const galleryMoreObserver=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)&&!$('more').hidden&&state.tab==='photo'){appendMorePhotos();}},{rootMargin:'1400px'});galleryMoreObserver.observe($('more'));
$('appVersion').textContent='Version '+APP_VERSION;
$('reloadApp').onclick=async()=>{try{for(const registration of await navigator.serviceWorker?.getRegistrations()||[])await registration.update();}catch{}location.reload();};
if(!window.SAI_ANDROID)setInterval(async()=>{try{const response=await fetch('/version.json',{cache:'no-store'});const release=await response.json();if(release.version&&release.version!==APP_VERSION){$('updateBanner').hidden=false;$('updateMessage').textContent='New version '+release.version+' is ready. Pause indexing, then reload the app.';}}catch{}},60000);
let loadController = null;
let accountId = null;
let musicFolder = null;
let photoFolder = null;
let folderKind = 'audio';
let folderTrail = [];
let folderGeneration = 0;
let transferResolver = null;
function sourceMode() { try { const value = localStorage.getItem('sai-source'); return value === 'device' ? value : 'pcloud'; } catch { return 'pcloud'; } }
function updateSourceRow() {
  const row = $('photoSources'); if (!row) return;
  const mode = sourceMode(); const android = Boolean(window.SAI_ANDROID);
  row.hidden = !android;
  $('sourceDevice').hidden = !android;
  $('sourcePcloud').classList.toggle('active', mode !== 'device');
  $('sourceDevice').classList.toggle('active', mode === 'device');
  $('sourcePcloud').textContent = 'pCloud';
  $('sourceDevice').textContent = 'This phone';
  updateAiStatusPill();
}
function updateAiStatusPill() {
  const pill = $('aiStatusPill'); if (!pill) return;
  const total = state.photo.length; const indexed = Object.keys(photoLibrary.meta.indexes).length; const visuals = Object.keys(photoLibrary.meta.visuals).length;
  const running = Boolean(photoLibrary.indexing);
  if (!total && !indexed) { pill.hidden = true; return; }
  pill.hidden = false;
  pill.textContent = running ? 'AI indexing… ' + indexed + '/' + total : 'AI ' + indexed + '/' + total + ' indexed' + (visuals ? ' · ' + visuals + ' image search' : '');
  pill.title = 'Indexed ' + indexed + ' of ' + total + ' photos' + (visuals ? ' · ' + visuals + ' with AI image search' : '') + '. Tap for details in the AI tab.';
}
async function switchSource(mode) {
  try { localStorage.setItem('sai-source', mode); } catch {}
  if (mode === 'device') {
    if (gallerySelection.mode) { gallerySelection.mode = false; gallerySelection.refresh(); }
    document.body.classList.add('device-source'); updateSourceRow(); deviceSource.show();
    toast('Source: photos on this phone');
    return;
  }
  document.body.classList.remove('device-source'); deviceSource.hide();
  folderKind = 'photo';
  await selectFolder(restoreFolder('photo'));
  updateSourceRow();
  toast('Source: pCloud');
}
function openFolderPicker(kind) {
  folderKind = kind;
  folderTrail = [{ id: '0', name: 'pCloud' }];
  $('folderPickerTitle').textContent = kind === 'photo' ? 'Choose photo folder' : 'Choose music folder';
  $('defaultMusicFolder').textContent = kind === 'photo' ? 'Use default photo folders' : 'Use default music folders';
  $('folderHint').textContent = kind === 'photo' ? 'Photos in subfolders are included. Choosing pCloud includes all supported photos. Favorites, albums and indexes stay saved when you switch folders.' : 'Songs in subfolders are included. This does not move your files.';
  $('folderPicker').showModal(); browseFolder();
}
function openTransferPicker(action) {
  folderKind = 'photo';
  folderTrail = [{ id: '0', name: 'pCloud' }];
  $('folderPickerTitle').textContent = action === 'move' ? 'Move photos to…' : 'Copy photos to…';
  $('defaultMusicFolder').textContent = 'Use pCloud (root)';
  $('useMusicFolder').textContent = 'Choose this folder';
  $('folderHint').textContent = action === 'move' ? 'Selected photos will be moved out of their current pCloud folder. Originals are kept until you delete them from Trash.' : 'Selected photos are copied; originals stay where they are.';
  $('folderPicker').showModal(); browseFolder();
  return new Promise(resolve => { transferResolver = resolve; });
}
$('chooseMusicFolder').onclick = () => openFolderPicker('audio');
$('choosePhotoFolder').onclick = () => openFolderPicker('photo');
$('sourcePcloud').onclick = () => switchSource('pcloud');
$('sourceDevice').onclick = () => switchSource('device');
$('indexAllPhotos').onclick = async () => {
  if (!state.connected || photoLibrary.indexing || photoLibrary.scopeLoading) return;
  $('indexAllPhotos').disabled = true;
  folderKind = 'photo';
  await selectFolder({id:'0',name:'All pCloud folders'});
  if (!state.connected || photoFolder?.id !== '0' || photoLibrary.scopeLoading) return;
  $('indexStatus').textContent = 'All folders: duplicate checksums, similar images and visual search run on the Mac. Faces and English text need this page open on the Mac. Unsupported files are counted but not AI indexed.';
  await photoLibrary.beginIndexing();
};
$('closeFolderPicker').onclick = () => $('folderPicker').close();
$('folderPicker').addEventListener('close', () => { folderGeneration++; });
$('folderUp').onclick = () => { if (folderTrail.length > 1) { folderTrail.pop(); browseFolder(); } };
$('useMusicFolder').onclick = () => selectFolder({ id: folderTrail.at(-1).id, name: folderTrail.map(folder => folder.name).join(' / ') });
$('defaultMusicFolder').onclick = () => selectFolder(null);
function folderStorageKey(kind) { return 'sai-photos-' + (kind === 'photo' ? 'photo' : 'music') + '-folder-' + accountId; }
function restoreFolder(kind) {
  let folder = null;
  try {
    const saved = JSON.parse(localStorage.getItem(folderStorageKey(kind)));
    if (saved && /^\d{1,20}$/.test(saved.id) && typeof saved.name === 'string') folder = saved;
  } catch {}
  return folder;
}
function updateFolderLabels() {
  $('musicFolderLabel').textContent = musicFolder?.name || 'Default music folders';
  $('photoFolderLabel').textContent = photoFolder?.name || 'Pictures / Automatic Upload / Automatic Folder';
}
async function selectFolder(folder) {
  if (transferResolver) {
    const resolve = transferResolver; transferResolver = null;
    $('folderPicker').close();
    $('useMusicFolder').textContent = 'Use this folder';
    $('folderPickerTitle').textContent = folderKind === 'photo' ? 'Choose photo folder' : 'Choose music folder';
    $('defaultMusicFolder').textContent = folderKind === 'photo' ? 'Use default photo folders' : 'Use default music folders';
    resolve(folder || { id: '0', name: 'pCloud' });
    return;
  }
  const kind = folderKind;
  const account = accountId;
  if(!accountId){
    if(kind==='photo')photoFolder=folder;
    try{if(folder)localStorage.setItem(folderStorageKey(kind),JSON.stringify(folder));else localStorage.removeItem(folderStorageKey(kind));}catch{}
    updateFolderLabels();render();return;
  }
  if(kind==='photo')enteGallery.reset();
  state.generation++; loadController?.abort();
  if (kind === 'photo') {
    photoLibrary.stop = true;
    photoLibrary.scopeLoading = true;
    photoLibrary.semanticScores = null; photoLibrary.searchQuery = '';
    photoLibrary.view = 'library'; photoLibrary.focus = null;
    $('search').value = ''; $('photoSearchStatus').textContent = '';
    if ($('viewer').open) $('viewer').close();
    photoFolder = folder; state.photo = []; state.limit = galleryBatch;
    $('photoFolderSummary').textContent = 'Loading selected folder…';
    updateFolderLabels(); $('folderPicker').close(); render();
    // Stop the old scope before allowing a new indexing job to start.
    await api('photo-analysis', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'stop'})}).catch(()=>{});
  } else {
    musicFolder = folder;
    musicPlayer.savePosition(); musicPlayer.reset(); photoLibrary.change({type:'music-queue',tracks:[]});await api('music-analysis',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'stop'})}).catch(()=>{});
    state.audio = [];
  }
  if (accountId !== account) return;
  try { if (folder) localStorage.setItem(folderStorageKey(kind), JSON.stringify(folder)); else localStorage.removeItem(folderStorageKey(kind)); } catch {}
  updateFolderLabels(); $('folderPicker').close(); render();
  await photoLibrary.change({type:kind === 'photo' ? 'photo-folder' : 'music-folder',folder});
  if (accountId === account) await loadLibrary();
}
async function browseFolder() {
  const generation = ++folderGeneration;
  const current = folderTrail.at(-1);
  $('folderPath').textContent = folderTrail.map(folder => folder.name).join(' / ');
  $('folderUp').disabled = folderTrail.length <= 1;
  $('useMusicFolder').disabled = true;
  $('folderList').replaceChildren(); $('folderStatus').textContent = 'Loading folders…';
  try {
    const data = await api('folders?folderid=' + encodeURIComponent(current.id));
    if (generation !== folderGeneration) return;
    $('useMusicFolder').disabled = false;
    $('folderStatus').textContent = data.folders.length ? 'Open a folder, then choose Use this folder.' : 'No subfolders here. You can select this folder.';
    for (const folder of data.folders) {
      const li = document.createElement('li'); const button = document.createElement('button');
      button.textContent = folder.name + ' ›';
      button.onclick = () => { folderTrail.push(folder); browseFolder(); };
      li.append(button); $('folderList').append(li);
    }
  } catch (error) { if (generation === folderGeneration) $('folderStatus').textContent = error.message; }
}
$('photosTab').onclick = () => setTab('photo');
$('musicTab').onclick = () => setTab('audio');
let searchDelay,searchRenderDelay;$('search').oninput = () => { state.limit = galleryBatch;photoLibrary.searchQuery=$('search').value;photoLibrary.semanticScores=null;clearTimeout(searchRenderDelay);searchRenderDelay=setTimeout(render,160);clearTimeout(searchDelay);searchDelay=setTimeout(()=>photoLibrary.aiSearch($('search').value),350); };
$('more').onclick = () => { appendMorePhotos(); };
$('connect').onclick = async () => {
  if(!window.SAI_ANDROID){location.href=base+'pcloud-auth?action=start';return;}
  $('connect').disabled=true;$('status').textContent='Opening pCloud sign-in in your browser…';
  try{await api('pcloud-auth?action=start',{method:'POST'});$('status').textContent='Complete pCloud sign-in in your browser. You will return here automatically. You can also use Connect with token.';}
  catch(error){$('status').textContent=error.message;}finally{$('connect').disabled=false;}
};
window.addEventListener('sai-auth-changed',async()=>{resetMedia();await checkConnection();});
let tokenAttempt = 0;
let authCanonicalOrigin = null;
$('connectToken').onclick = () => {
  if(!window.SAI_ANDROID&&authCanonicalOrigin&&location.origin!==authCanonicalOrigin){$('status').textContent='Open '+authCanonicalOrigin+' to sign in. This address differs from the configured web callback; your token has not been sent.';return;}
  $('tokenStatus').textContent = '';
  $('tokenTransport').textContent = location.protocol === 'https:' ? 'Your token is sent to this server over HTTPS and kept in an encrypted, HttpOnly session. It is not saved in browser storage.' : 'This local Wi-Fi address uses unencrypted HTTP. Prefer entering the token on your Mac at this address, or use HTTPS. The token is kept in an encrypted, HttpOnly session and is not saved in browser storage.';
  $('tokenDialog').showModal();$('pcloudToken').focus();
};
$('cancelToken').onclick = () => $('tokenDialog').close();
$('tokenDialog').addEventListener('cancel', event => { if ($('submitToken').disabled) event.preventDefault(); });
$('tokenDialog').addEventListener('close', () => { tokenAttempt++;$('pcloudToken').value = ''; });
$('tokenForm').onsubmit = async event => {
  event.preventDefault(); const attempt = ++tokenAttempt;
  const token = $('pcloudToken').value.trim(); const tokenType = $('pcloudTokenType').value; const host = $('pcloudTokenRegion').value;
  $('pcloudToken').value = ''; $('submitToken').disabled = true; $('cancelToken').disabled = true; $('tokenStatus').textContent = 'Verifying with pCloud…';
  try {
    await api('pcloud-auth?action=token', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({token,tokenType,host}) });
    if (attempt !== tokenAttempt) return;
    $('tokenDialog').close(); resetMedia(); await checkConnection();
  } catch (error) { if (attempt === tokenAttempt) $('tokenStatus').textContent = error.message; }
  finally { $('submitToken').disabled = false; $('cancelToken').disabled = false; }
};
$('refresh').onclick = loadLibrary;
$('disconnect').onclick = async () => {
  try {
    await api('pcloud-auth?action=logout', { method: 'POST' });
    try { localStorage.removeItem('sai-last-account'); } catch {}
    resetMedia();
    await checkConnection();
  } catch { $('status').textContent = 'Could not disconnect. Try again.'; }
};
async function api(path, options = {}) {
  const response = await fetch(base + path, { credentials: 'same-origin', cache: 'no-store', ...options });
  const data = await response.json();
  if (!response.ok) {const error=new Error(data.error || 'Request failed');error.status=response.status;throw error;}
  return data;
}
function resetMedia() {
  musicPlayer.reset();
  state.generation++;
  loadController?.abort();
  $('audio').pause(); $('audio').removeAttribute('src'); $('audio').load();
  if ($('viewer').open) $('viewer').close();
  state.photo = []; state.audio = []; state.connected = false;
  enteGallery.reset();photoLibrary.disconnect();
  $('chooseMusicFolder').disabled = true; $('choosePhotoFolder').disabled = true;
  if ($('folderPicker').open) $('folderPicker').close();
  musicFolder = null; photoFolder = null; accountId = null; photoLibrary.scopeLoading = false; updateFolderLabels(); $('photoFolderSummary').textContent = '';
  $('nowPlaying').textContent = 'Choose a song to play'; render();
}
async function checkConnection() {
  try {
    const status = await api('pcloud-auth?action=status');
    state.connected = status.connected;
    authCanonicalOrigin = status.canonicalOrigin || null;
    accountId = status.accountId;
    if (state.connected) { try { localStorage.setItem('sai-last-account',accountId); } catch {} musicFolder=restoreFolder('audio'); photoFolder=restoreFolder('photo'); updateSourceRow(); if(window.SAI_PHOTOS_ONLY&&!photoFolder)photoFolder={id:'0',name:'All pCloud folders'}; await photoLibrary.connect(accountId); for(const [type,field] of [['music-folder','musicFolder'],['photo-folder','photoFolder']]) { if(photoLibrary.data.operations.some(op=>op.type===type)) { if(field==='musicFolder')musicFolder=photoLibrary.meta[field];else photoFolder=photoLibrary.meta[field]; } else { const folder=field==='musicFolder'?musicFolder:photoFolder; if(folder&&!photoLibrary.restoring)photoLibrary.change({type,folder}); } } updateFolderLabels(); }
    $('chooseMusicFolder').disabled = !state.connected; $('choosePhotoFolder').disabled = !state.connected;
    $('connect').hidden = state.connected; $('disconnect').hidden = !state.connected;
    $('connect').disabled = window.SAI_PHOTOS_ONLY?!status.tokenConfigured:!status.configured; $('connectToken').disabled = !status.tokenConfigured; $('connectToken').textContent = state.connected ? 'Change token' : 'Connect with token';
    $('refresh').disabled = !state.connected;
    $('status').textContent = state.connected ? 'Connected to pCloud' : (status.configured || status.tokenConfigured) ? 'Connect your pCloud account to get started.' : 'pCloud OAuth setup is pending. Your client ID and private server configuration are needed.';
    if (state.connected) await loadLibrary(); else render();
  } catch (error) {
    if(window.SAI_ANDROID){$('status').textContent=error.message||'Unable to load your account. Check the connection and retry.';$('connectToken').disabled=false;$('connectToken').hidden=false;render();return;}
    let saved;try{saved=localStorage.getItem('sai-last-account');}catch{}
    if(saved){accountId=saved;state.connected=true;await photoLibrary.connect(saved);try{state.audio=await listDownloadedSongs(saved);}catch{}setTab('audio');musicPlayer.view='downloads';render();$('status').textContent='Offline · downloaded songs on this device';$('disconnect').hidden=false;$('connect').hidden=true;}
    else $('status').textContent = 'Cannot reach the server. Keep your Mac awake and try refreshing.';
  }
}
window.saiAuthChanged = () => { checkConnection(); };
window.saiAuthError = message => { $('status').textContent = message || 'pCloud login could not be completed. Try again.'; };
async function loadLibrary() {
  if (!state.connected) return;
  loadController?.abort(); loadController = new AbortController();
  const generation = ++state.generation;let cachedPhotos=false;let cachedAudio=false;
  $('refresh').disabled = true; photoLibrary.scopeLoading = true; photoLibrary.scanError=''; $('indexPhotos').disabled = true; $('indexAllPhotos').disabled=true; $('status').textContent = 'Loading your pCloud library…';
  try {
    const folderQueries = {photo: photoFolder ? '&folderid=' + encodeURIComponent(photoFolder.id) : '', audio: musicFolder ? '&folderid=' + encodeURIComponent(musicFolder.id) : ''};
    if(window.SAI_PHOTOS_ONLY&&state.tab==='photo'){try{const cached=await api('media-list?kind=photo&cached=1'+folderQueries.photo,{signal:loadController.signal});if(generation!==state.generation)return;if(cached.items?.length){const deleted=activeDeletedPhotoIds(photoLibrary.data.operations);state.photo=cached.items.filter(item=>!deleted.has(item.id)).map(item=>({...item,version:normalizeFileVersion(item.version),contentHash:normalizeFileVersion(item.contentHash)}));cachedPhotos=true;render();$('status').textContent='Showing saved photo list · refreshing pCloud…';}}catch{}}
    if(window.SAI_MUSIC_ENABLED&&state.tab==='audio'){try{const cached=await api('media-list?kind=audio&cached=1'+folderQueries.audio,{signal:loadController.signal});if(generation!==state.generation)return;if(cached.items?.length){state.audio=cached.items.map(item=>({...item,version:normalizeFileVersion(item.version)}));cachedAudio=true;render();}}catch{}}
    const kinds=window.SAI_MUSIC_ENABLED?[state.tab]:window.SAI_PHOTOS_ONLY?['photo']:['photo','audio'];
    const results = await Promise.allSettled(kinds.map(kind => api('media-list?kind=' + kind + folderQueries[kind], { signal: loadController.signal })));
    if (generation !== state.generation) return;
    const errors = [];
    for (const [index, kind] of kinds.entries()) {
      const result = results[index];
      if (result.status === 'fulfilled') { state[kind] = result.value.items.map(item=>({...item,version:normalizeFileVersion(item.version),contentHash:normalizeFileVersion(item.contentHash)})); if(kind==='photo') {const deleted=activeDeletedPhotoIds([...photoLibrary.data.operations,...photoLibrary.data.pending]);state.photo=state.photo.filter(photo=>!deleted.has(photo.id));const scan=result.value.scan;if(scan?.complete!==false){for(const id of ['indexStatus','visualIndexStatus'])if($(id).textContent.startsWith('Indexing blocked:'))$(id).textContent='';}if(scan?.complete===false)photoLibrary.scanError='Some pCloud folders could not be read: '+scan.unavailableFolders.join(', ')+'. Choose an accessible folder or fix its permissions before indexing all folders.'; $('photoFolderSummary').textContent = scan ? `${state.photo.length.toLocaleString()} photos · ${scan.totalFiles.toLocaleString()} files scanned including subfolders · ${scan.otherFiles.toLocaleString()} other files${scan.missingPaths.length ? ' · Unavailable default folders: '+scan.missingPaths.join(', ') : ''}${scan.complete===false?' · Incomplete scan: '+scan.unavailableFolders.length+' inaccessible folders':''}` : `${state.photo.length.toLocaleString()} ${state.photo.length===1?'photo':'photos'} including subfolders`; } }
      else { if(!(kind==='photo'&&(cachedPhotos||window.SAI_ANDROID&&state.photo.length))&&!(kind==='audio'&&window.SAI_MUSIC_ENABLED&&(cachedAudio||state.audio.length)))state[kind] = [];if(kind==='audio')$('musicDownloadStatus').textContent='Could not refresh songs: '+result.reason.message+(state.audio.length?' · Showing the saved song list.':' · Choose a folder or retry.'); if(kind==='photo'){photoLibrary.scanError=result.reason.message;$('photoFolderSummary').textContent=photoLibrary.scanError;$('indexStatus').textContent='Indexing blocked: folder scan failed. Refresh to retry.';$('visualIndexStatus').textContent='';} errors.push((kind === 'photo' ? 'Photos: ' : 'Music: ') + result.reason.message); }
    }
    $('status').textContent = `Connected · ${state.photo.length} ${state.photo.length===1?'photo':'photos'}${window.SAI_PHOTOS_ONLY?'':' · '+state.audio.length+' songs'}${errors.length ? ' · ' + errors.join(' · ') : ''}`;
    render();
  } catch (error) {
    if (generation !== state.generation || error.name === 'AbortError') return;
    $('status').textContent = error.message;
  } finally { if (generation === state.generation) { $('refresh').disabled = false; photoLibrary.scopeLoading = false; photoLibrary.sections(); } }
}
function setTab(tab) {
  if(window.SAI_PHOTOS_ONLY&&!window.SAI_MUSIC_ENABLED)tab='photo';
  state.tab = tab; state.limit = galleryBatch; clearTimeout(searchDelay); photoLibrary.searchQuery = ''; photoLibrary.semanticScores = null; $('search').value = '';
  $('photosTab').classList.toggle('active', tab === 'photo'); $('musicTab').classList.toggle('active', tab === 'audio');
  $('photosTab').setAttribute('aria-pressed', String(tab === 'photo')); $('musicTab').setAttribute('aria-pressed', String(tab === 'audio'));
  $('photosPanel').hidden = tab !== 'photo'; $('musicPanel').hidden = tab !== 'audio'; $('aiPanel').hidden = tab !== 'ai';
  const aiButton=$('navAi');if(aiButton){aiButton.setAttribute('aria-current',String(tab==='ai'));aiButton.classList.toggle('active',tab==='ai');}
  $('search').placeholder = tab === 'photo' ? 'Search photos' : 'Search songs';document.body.classList.toggle('music-active',tab==='audio');if(window.SAI_MUSIC_ENABLED){$('navMusic')?.setAttribute('aria-current',String(tab==='audio'));for(const id of ['galleryPageTitle','galleryDiscovery','galleryMemories'])if($(id))$(id).hidden=tab!=='photo';}render();if(window.SAI_MUSIC_ENABLED){if(tab!=='audio')musicPlayer.closeFullscreen();musicPlayer.playerUI();}if(tab!=='ai'&&window.SAI_MUSIC_ENABLED&&state.connected&&!state[tab].length)loadLibrary();if(tab==='ai')assistant.open();
}
function appendPhotoCards(items, from, to, query, lastPhotoDay) {
  const grid = $('photoGrid');
  for (const item of items.slice(from, to)) {
    if (photoLibrary.view === 'library' && !query && ['newest','oldest'].includes($('sortPhotos').value)) {
      const day = item.addedAt ? new Date(item.addedAt).toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'}) : 'Undated photos';
      if (day !== lastPhotoDay) { lastPhotoDay = day; const heading=document.createElement('h3'); heading.className='photo-day'; heading.textContent=day; grid.append(heading); }
    }
    const button = document.createElement('button');
    button.className = 'photo-tile';
    const image = document.createElement('img'); image.alt = item.fileName; image.loading = 'lazy'; image.decoding = 'async';
    photoLibrary.loadTile(item, image);
    image.onerror = () => { image.alt = 'Preview unavailable: ' + item.fileName; };
    const label = document.createElement('span'); label.textContent = formatSize(item.size); label.title = 'Original file size: '+Number(item.size||0).toLocaleString()+' bytes';
    button.append(image, label); button.onclick = () => photoLibrary.open(item, items);
    const card = document.createElement('div'); card.className='photo-card'; card.dataset.photoId=item.id; card.dataset.mediaType=item.mediaType||"photo"; card.append(button);
    const remove = photoLibrary.personRemoval(item); if (remove) card.append(remove);
    grid.append(card);
  }
  return lastPhotoDay;
}
function appendMorePhotos() {
  if (state.tab !== 'photo') return;
  const query = $('search').value.trim().toLowerCase();
  const items = sortPhotos(photoLibrary.filter(state.photo, query), $('sortPhotos').value);
  const from = state.limit; state.limit += galleryBatch;
  const headings = $('photoGrid').querySelectorAll('.photo-day');
  appendPhotoCards(items, from, state.limit, query, headings.length ? headings[headings.length-1].textContent : '');
  $('more').hidden = items.length <= state.limit;
}
function render() {
  if(window.SAI_PHOTOS_ONLY)document.body.classList.toggle('cleanup-view',['duplicates','similar','large'].includes(photoLibrary.view));
  musicPlayer.applyCloudDeletes();photoLibrary.releaseGrid();
  const query = (state.tab === 'photo' ? $('search').value : $('musicSearch').value).trim().toLowerCase();
  $('search').hidden = state.tab !== 'photo';
  const items = state.tab === 'photo' ? sortPhotos(photoLibrary.filter(state.photo, query),$('sortPhotos').value) : state.tab === 'audio' ? musicPlayer.items(query) : [];
  gallerySelection.scope([photoLibrary.account,photoLibrary.view,photoLibrary.focus,query,photoFolder?.id||'default',JSON.stringify(photoLibrary.filters)].join(':'));$('galleryToolbar').hidden=state.tab!=='photo';
  $('count').textContent = state.tab === 'ai' ? 'AI assistant' : `${items.length} ${state.tab === 'photo' ? items.length === 1 ? 'photo' : 'photos' : items.length === 1 ? 'song' : 'songs'}`;
  $('empty').hidden = state.tab === 'ai' || items.length > 0;
  $('empty').querySelector('h2').textContent = state.tab==='photo'&&photoLibrary.scanError?'Photo library could not load':state.tab === 'photo' ? 'Your photos, together' : 'Your music, together';
  $('empty').querySelector('p').textContent = !state.connected ? window.SAI_PHOTOS_ONLY?'Connect pCloud to bring your photos together.':'Connect pCloud to browse your photos and music.' : state.tab==='photo'&&photoLibrary.scanError?photoLibrary.scanError+' · Open Settings → Backup to choose a folder or refresh.': $('search').value ? 'No matches. Try another search.' : 'No supported files found in your configured pCloud folders.';
  $('photoGrid').replaceChildren(); $('songs').replaceChildren();
  $('more').hidden = state.tab !== 'photo' || items.length <= state.limit;
  if (state.tab === 'photo') appendPhotoCards(items, 0, state.limit, query, '');
  photoLibrary.sections();
  gallerySelection.refresh();
  if(state.tab==='photo')enteGallery.render();
  if (state.tab === 'audio') musicPlayer.render(items);
  updateAiStatusPill();
}
if(window.SAI_MUSIC_ENABLED){
 document.body.classList.add('music-enabled');const nav=$('photoNavigation'),music=document.createElement('button');music.id='navMusic';music.setAttribute('aria-label','Music');music.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5.6l10-2.1V16"/><circle cx="6.6" cy="18" r="2.5"/><circle cx="16.6" cy="16" r="2.5"/></svg><span class="nav-label">Music</span>';nav.insertBefore(music,$('navFavorites'));music.onclick=()=>{gallerySelection.mode=false;gallerySelection.selected.clear();gallerySelection.refresh();setTab('audio');if(musicPlayer.current)musicPlayer.openFullscreen();window.scrollTo({top:0,behavior:'smooth'});};
 nav.addEventListener('click',event=>{const button=event.target.closest('button');if(button&&button.id!=='navMusic')setTab('photo');},true);
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
if(window.SAI_MUSIC_ENABLED&&!window.SAI_PHOTOS_ONLY)setTab('audio');
checkConnection();

setInterval(()=>{
  if(!state.connected||document.visibilityState!=='visible')return;
  let changed=false;
  for(const [type,field] of [['music-folder','musicFolder'],['photo-folder','photoFolder']]) {
    const has=photoLibrary.data.operations.some(op=>op.type===type);
    const current=field==='musicFolder'?musicFolder:photoFolder;
    if(has&&JSON.stringify(current)!==JSON.stringify(photoLibrary.meta[field])) {
      if(field==='musicFolder'){musicFolder=photoLibrary.meta[field];state.audio=[];}
      else{photoFolder=photoLibrary.meta[field];state.photo=[];photoLibrary.stop=true;photoLibrary.semanticScores=null;photoLibrary.view='library';photoLibrary.focus=null;api('photo-analysis',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'stop'})}).catch(()=>{});if($('viewer').open)$('viewer').close();}
      changed=true;
    }
  }
  if(changed){updateFolderLabels();loadLibrary();}
},5000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state.connected)loadLibrary();});
const autoIndexKick=async()=>{try{if(document.visibilityState!=='visible')return;await photoLibrary.autoResumeIndex();}catch{}};
setTimeout(autoIndexKick,12000);setInterval(autoIndexKick,600000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){setTimeout(autoIndexKick,5000);if(document.body.classList.contains('device-source'))deviceSource.reload();}});
