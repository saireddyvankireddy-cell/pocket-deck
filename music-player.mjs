import {recommendMusic,musicMix,musicIntent,MUSIC_MODEL} from './smart-features.mjs';
import {cosine,unpackEmbedding} from './photo-tools.mjs';
import { normalizeTrack, shuffleQueue, nextTrackId, previousTrackId, insertNext, sleepDeadline, sleepRemaining, matchesMusic } from './music-state.mjs';
import { cachedImage, forgetPhotoImages, downloadedSong, downloadSong, listDownloadedSongs, removeDownloadedSong } from './photo-cache.mjs';
const $=id=>document.getElementById(id);
function formatTime(seconds){const value=Math.max(0,Math.floor(seconds||0));return Math.floor(value/60)+':'+String(value%60).padStart(2,'0');}
function newID() {
  const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const s=[...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('');return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`;
}
export class MusicPlayer {
  constructor({ library, tracks, render, onDelete, musicFolder, openAudio }) {
    this.musicFolder=musicFolder||(()=>null);this.semanticScores=null;this.searchQuery='';this.onDelete=onDelete;this.deletedIDs=new Set();this.library=library;this.tracks=tracks;this.renderApp=render;this.openAudio=openAudio;this.account=null;this.view='all';this.playlist=null;this.current=null;
    this.queue=[];this.shuffle=false;this.repeat='off';this.queueRestored=false;this.historyRecorded=false;this.settingsAt=0;this.limit=200;
    this.downloads=new Map();this.downloadBusy=new Set();this.sleepUntil=0;this.cachedURLs=new Map();this.cacheChecks=new Set();this.generation=0;this.lastSavedAt=0;
    for(const [id,view] of [['allMusic','all'],['forYouMusic','foryou'],['mostPlayedMusic','mostplayed'],['likedMusic','liked'],['recentMusic','recent'],['downloadedMusic','downloads'],['playlistMusic','playlists']]) $(id).onclick=()=>{this.view=view;this.playlist=null;this.limit=200;this.renderApp();};
    $('musicSearch').oninput=()=>{this.semanticScores=null;this.searchQuery=$('musicSearch').value.trim().toLowerCase();this.renderApp();clearTimeout(this.searchDelay);this.searchDelay=setTimeout(()=>this.aiSearch(this.searchQuery),350);};
    $('saveSmartMix').onclick=()=>this.saveSmartMix();$('indexMusic').onclick=()=>this.startIndex();$('stopMusicIndex').onclick=()=>this.library.api('music-analysis',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'stop'})}).catch(error=>{$('musicIndexStatus').textContent=error.message;});
    setInterval(()=>{if(this.account&&document.visibilityState==='visible'&&!$('musicPanel').hidden)this.indexProgress();},4000);
    $('sleepMusic').onchange=()=>this.setSleep(Number($('sleepMusic').value));
    setInterval(()=>this.checkSleep(),1000);
    document.addEventListener('visibilitychange',()=>this.checkSleep());
    window.addEventListener('pageshow',()=>this.checkSleep());
    $('backPlaylists').onclick=()=>{this.playlist=null;this.renderApp();};
    $('newPlaylist').onclick=()=>this.createPlaylist();
    $('addCurrentPlaylist').onclick=()=>this.current&&this.choosePlaylist(this.current);
    $('cancelSongPlaylist').onclick=()=>$('songPlaylistDialog').close();
    $('songPlaylistChoice').onchange=()=>this.playlistChoiceUI();
    $('songPlaylistForm').onsubmit=event=>{event.preventDefault();this.savePlaylistSong();};
    $('songPlaylistDialog').addEventListener('cancel',event=>{if(this.savingPlaylist)event.preventDefault();});
    $('playAll').onclick=()=>{const items=this.items($('musicSearch').value.trim().toLowerCase());if(items.length)this.play(items[0],items);};
    $('resumeMusic').onclick=()=>{const saved=this.library.meta.musicResume;if(saved)this.play(saved.track,null,saved.position);};
    $('toggleMusic').onclick=()=>this.toggle();$('miniToggleMusic').onclick=()=>this.toggle();$('expandMusicPlayer').onclick=()=>{this.expanded=!this.expanded;$('player').classList.toggle('is-expanded',this.expanded);$('expandMusicPlayer').textContent=this.expanded?'⌄':'⌃';$('expandMusicPlayer').setAttribute('aria-label',this.expanded?'Collapse playback controls':'More playback controls');};$('previousSong').onclick=()=>this.previous();$('nextSong').onclick=()=>this.next();
    $('miniPlay').onclick=()=>this.toggle();$('miniPrev').onclick=()=>this.previous();$('miniNext').onclick=()=>this.next();$('miniQueue').onclick=()=>this.openFullQueue();
    $('miniOpen').onclick=()=>{this.openAudio?.();if(this.current)this.openFullscreen();};
    $('closePlayer').onclick=()=>this.closeFullscreen();
    $('playerMenu').onclick=()=>{const open=$('player').classList.toggle('is-menu');$('playerMenu').setAttribute('aria-expanded',String(open));};
    $('seekBar').oninput=()=>{const audio=$('audio');if(Number.isFinite(audio.duration))audio.currentTime=Math.max(0,Math.min(audio.duration,Number($('seekBar').value)));this.seekUI();};
    $('likeCurrentSong').onclick=()=>this.current&&this.like(this.current);
    $('shuffleMusic').onclick=()=>{this.shuffle=!this.shuffle;if(this.shuffle)this.queue=shuffleQueue(this.queue,this.current?.id);else this.queue=[...this.originalQueue||this.queue];this.saveSettings();this.saveQueue();this.renderApp();};
    $('repeatMusic').onclick=()=>{this.repeat=['off','all','one'][(['off','all','one'].indexOf(this.repeat)+1)%3];this.saveSettings();this.playerUI();};
    $('musicSpeed').onchange=()=>{this.saveSettings();this.playerUI();};
    $('muteMusic').onclick=()=>{$('audio').muted=!$('audio').muted;this.playerUI();};
    $('deleteMusic').onclick=()=>this.current&&this.deleteTrack(this.current);
    $('cacheMusic').onclick=()=>this.cacheCurrent();
    $('moreMusic').onclick=()=>{this.limit+=200;this.renderApp();};
    const audio=$('audio');
    window.saiMediaAction=(action,value=0)=>{
      if(action==='play')this.toggle(true);else if(action==='pause')audio.pause();else if(action==='next')this.next();else if(action==='previous')this.previous();
      else if(action==='seek'&&Number.isFinite(value))audio.currentTime=Math.max(0,value/1000);
      else if(action==='queueitem'){const track=this.allTracks().get(this.queue[value]);if(track)this.play(track);}
      else if(action==='queue')this.openFullQueue();
    };
    audio.addEventListener('playing',()=>{
      if(this.checkSleep())return;this.playerUI();if(!this.current||this.historyRecorded)return;this.historyRecorded=true;
      this.library.change({type:'music-play',track:this.current,playedAt:Date.now(),position:Math.max(0,Math.min(86400,audio.currentTime || 0))});
      $('musicPlaybackStatus').textContent='Playing from '+(audio.currentSrc.startsWith('blob:')?'device cache':'pCloud');
    });
    audio.addEventListener('play',()=>this.playerUI());
    audio.addEventListener('pause',()=>{this.playerUI();if(!this.switching)this.savePosition();});
    audio.addEventListener('ended',()=>{if(this.checkSleep())return;this.savePosition(0);this.historyRecorded=false;this.next(true);});
    audio.addEventListener('loadedmetadata',()=>{
      if(this.resumePosition>0&&Number.isFinite(audio.duration))audio.currentTime=Math.min(this.resumePosition,Math.max(0,audio.duration-1));this.resumePosition=0;this.playerUI();
    });
    audio.addEventListener('timeupdate',()=>{this.nativeState();this.seekUI();if(this.checkSleep())return;if(this.current&&!audio.paused&&Date.now()-this.lastSavedAt>30000)this.savePosition();});
    audio.addEventListener('error',()=>{if(this.current)$('musicPlaybackStatus').textContent='Could not play this file. Check pCloud or try MP3/M4A.';this.playerUI();});
    audio.addEventListener('waiting',()=>{if(this.current)$('musicPlaybackStatus').textContent='Buffering…';});
    audio.addEventListener('playing',()=>{if(this.current&&!audio.paused)$('musicPlaybackStatus').textContent=audio.currentSrc.startsWith('blob:')?'Playing from device cache':'Playing from pCloud';});
    if('mediaSession' in navigator) {
      for(const [action,handler] of [['play',()=>this.toggle(true)],['pause',()=>audio.pause()],['nexttrack',()=>this.next()],['previoustrack',()=>this.previous()],['seekto',event=>{if(Number.isFinite(event.seekTime))audio.currentTime=event.seekTime;}]])try{navigator.mediaSession.setActionHandler(action,handler);}catch{}
    }
  }
  reset() {
    this.stopSleep();this.downloads.clear();this.current=null;this.semanticScores=null;this.searchQuery='';this.deletedIDs.clear();this.generation++;this.queue=[];this.originalQueue=[];this.queueRestored=true;this.historyRecorded=false;this.playlist=null;
    this.switching=true;$('audio').pause();$('audio').removeAttribute('src');$('audio').load();this.switching=false;
    for(const url of this.cachedURLs.values())URL.revokeObjectURL(url);this.cachedURLs.clear();this.cacheChecks.clear();
    $('nowPlaying').textContent='Choose a song to play';$('musicPlaybackStatus').textContent='';this.playerUI();
  }
  applyCloudDeletes(){
    const account=this.library.account;if(this.deleteAccount!==account){this.deleteAccount=account;this.appliedDeleteRecords=new Set();}
    for(const op of this.library.data.operations){if(op.type!=='music-delete'||this.appliedDeleteRecords.has(op.id))continue;this.appliedDeleteRecords.add(op.id);const id=op.trackId;if(this.current?.id===id){this.current=null;this.generation++;this.switching=true;$('audio').pause();$('audio').removeAttribute('src');$('audio').load();this.switching=false;}
      this.queue=this.queue.filter(trackId=>trackId!==id);this.originalQueue=(this.originalQueue||[]).filter(trackId=>trackId!==id);this.downloads.delete(id);for(const [key,url]of this.cachedURLs)if(key.startsWith(`${account}-${id}-`)){URL.revokeObjectURL(url);this.cachedURLs.delete(key);}if(this.tracks().some(track=>track.id===id))this.onDelete?.(id);forgetPhotoImages(account,id).catch(()=>{});
    }
  }
  allTracks() {
    return new Map([...Object.values(this.library.meta.musicTracks),...this.tracks(),...this.downloads.values()].map(track=>{const item=normalizeTrack(track);return [item.id,item];}));
  }
  items(query='') {
    if(query!==this.lastQuery){this.limit=200;this.lastQuery=query;}
    const meta=this.library.meta;const all=this.allTracks();let items;
    if(this.view==='all')items=this.tracks().map(normalizeTrack);
    else if(this.view==='downloads')items=[...this.downloads.values()];
    else if(this.view==='liked')items=[...all.values()].filter(track=>meta.musicLikes[track.id]);
    else if(this.view==='recent')items=[...all.values()].filter(track=>meta.musicHistory[track.id]).sort((a,b)=>meta.musicHistory[b.id].playedAt-meta.musicHistory[a.id].playedAt);
    else items=this.playlist?[...all.values()].filter(track=>meta.playlists[this.playlist]?.members[track.id]):[];
    if(this.view==='foryou'||this.view==='mostplayed')items=musicMix(this.tracks().map(normalizeTrack),meta,{mode:this.view,query:''});
    if(this.view==='playlists'&&this.playlist&&meta.playlists[this.playlist]?.smart)items=musicMix(this.tracks().map(normalizeTrack),meta,meta.playlists[this.playlist].smart);
    const intent=musicIntent(query);if(intent.mode==='downloads')items=items.filter(track=>this.downloads.get(track.id)?.version===track.version);else if(intent.mode)items=musicMix(items,meta,{mode:intent.mode,query:''});
    const scores=this.searchQuery===query?this.semanticScores:null;const cutoff=scores?Math.max(.65,Math.max(...scores.values())-.05):Infinity;
    const filtered=items.filter(track=>!this.deletedIDs.has(track.id)&&(matchesMusic(track,intent.query)||scores?.get(track.id)>=cutoff));
    return scores&&intent.query?filtered.sort((a,b)=>10*(Number(matchesMusic(b,intent.query))-Number(matchesMusic(a,intent.query)))+(scores.get(b.id)||0)-(scores.get(a.id)||0)):filtered;
  }
  render(items) {
    const account=this.library.account;
    if(account!==this.account){this.reset();this.account=account;this.queueRestored=false;this.settingsAt=0;this.shuffle=false;this.repeat='off';$('musicSpeed').value='1';$('audio').playbackRate=1;this.view='all';this.playlist=null;this.refreshDownloads();this.restoreSleep();}

    const meta=this.library.meta;
    this.listIds=items.map(track=>track.id);
    if(!this.queueRestored&&meta.musicQueue){this.queue=[...meta.musicQueue];this.originalQueue=[...this.queue];this.queueRestored=true;}
    if(meta.musicSettings&&meta.musicSettings.at!==this.settingsAt){this.settingsAt=meta.musicSettings.at;this.shuffle=meta.musicSettings.shuffle;this.repeat=meta.musicSettings.repeat;$('musicSpeed').value=String(meta.musicSettings.rate);}
    for(const [id,view] of [['allMusic','all'],['forYouMusic','foryou'],['mostPlayedMusic','mostplayed'],['likedMusic','liked'],['recentMusic','recent'],['downloadedMusic','downloads'],['playlistMusic','playlists']])$(id).classList.toggle('active',this.view===view);
    $('newPlaylist').disabled=!account;$('indexMusic').disabled=!account;$('saveSmartMix').disabled=!account||this.view==='playlists'||this.view==='downloads';$('playAll').disabled=!items.length||!account;
    $('musicSync').textContent=$('photoSync').textContent;
    if(!this.searchQuery)$('musicSmartStatus').textContent=this.view==='foryou'?(Object.keys(meta.musicHistory).length||Object.values(meta.musicLikes).some(Boolean)?'For You uses your likes, listening history and similar song titles. AI suggestions improve after Index song titles.':'Like and play songs to personalise For You. For now, explore this library mix.'):this.view==='mostplayed'?'Songs ranked by your saved play counts.':'';
    const overview=this.view==='playlists'&&!this.playlist;
    $('musicPlaylistCards').hidden=!overview;$('playlistHeading').hidden=!this.playlist;
    $('playlistTitle').textContent=meta.playlists[this.playlist]?.name||'';
    $('musicPlaylistCards').replaceChildren();
    if(overview){
      const query=$('musicSearch').value.trim().toLowerCase();const playlists=Object.entries(meta.playlists).filter(([,playlist])=>playlist.name.toLowerCase().includes(query));
      for(const [id,playlist] of playlists){const button=document.createElement('button');button.className='collection-card';const name=document.createElement('strong');name.textContent='♫ '+playlist.name;const count=document.createElement('span');count.textContent=(playlist.smart?musicMix(this.tracks().map(normalizeTrack),meta,playlist.smart).length:Object.values(playlist.members).filter(Boolean).length)+' songs'+(playlist.smart?' · Smart mix':'');button.append(name,count);button.onclick=()=>{this.playlist=id;this.renderApp();};$('musicPlaylistCards').append(button);}
      $('count').textContent=playlists.length+' playlists';$('empty').hidden=Boolean(playlists.length);if(!playlists.length){$('empty').querySelector('h2').textContent='Your playlists';$('empty').querySelector('p').textContent='Create a playlist and add songs from the library.';}
    }
    if(!overview&&!items.length&&account){$('empty').querySelector('h2').textContent=this.view==='downloads'?'Your offline downloads':this.view==='liked'&&this.library.restoring?'Restoring your liked songs from pCloud…':this.view==='liked'?'Your liked songs':this.view==='recent'?'Your recently played songs':'No songs in this view';$('empty').querySelector('p').textContent=this.view==='downloads'?'Tap Download offline beside a song. Downloads are stored on this device after their records are saved in pCloud.':this.view==='liked'?'Tap a heart beside any song to add it here.':this.view==='recent'?'Songs appear here after playback starts.':'Choose your pCloud music folder or try another search.';}
    $('songs').replaceChildren();
    for(const track of items.slice(0,this.limit)){
      const row=document.createElement('li');row.className='music-track'+(this.current?.id===track.id?' is-playing':'');
      const play=document.createElement('button');play.className='song';const note=document.createElement('span');note.className='note';note.textContent=this.current?.id===track.id&&!$('audio').paused?'♫':'♪';
      const name=document.createElement('span');name.className='name';name.textContent=track.name;
      if(this.view==='mostplayed'){const count=document.createElement('span');count.className='music-time';count.textContent=(meta.musicHistory[track.id]?.count||0)+' plays';name.append(count);}
      if(this.view==='foryou'){const reason=document.createElement('span');reason.className='music-time';reason.textContent=meta.musicLikes[track.id]?'You liked this':meta.musicHistory[track.id]?'From your listening history':'Suggested from your library';name.append(reason);}
      if(this.view==='recent'){const when=document.createElement('span');when.className='music-time';when.textContent=new Date(meta.musicHistory[track.id].playedAt).toLocaleString();name.append(when);}
      play.append(note,name);play.onpointerdown=()=>this.warmCache([track]);play.onfocus=()=>this.warmCache([track]);play.onclick=()=>this.play(track,items);
      const like=document.createElement('button');like.className='heart';like.textContent=meta.musicLikes[track.id]?'♥':'♡';like.setAttribute('aria-label',meta.musicLikes[track.id]?'Unlike '+track.name:'Like '+track.name);like.setAttribute('aria-pressed',String(Boolean(meta.musicLikes[track.id])));like.onclick=()=>this.like(track);
      const actions=document.createElement('div');actions.className='track-actions';const next=document.createElement('button');next.textContent='⏭';next.title='Play next';next.setAttribute('aria-label','Play next: '+track.name);next.onclick=()=>{const known=this.allTracks();known.set(track.id,track);this.queue=insertNext(this.queue,this.current?.id,track.id);this.originalQueue=[...this.queue];this.queueRestored=true;this.saveQueue(known);this.renderApp();};actions.append(next);
      if(this.view==='playlists'&&this.playlist&&!meta.playlists[this.playlist]?.smart){const remove=document.createElement('button');remove.textContent='✕';remove.title='Remove from this playlist';remove.setAttribute('aria-label','Remove '+track.name+' from playlist');remove.onclick=()=>this.removePlaylistSong(track,this.playlist);actions.append(remove);}
      const add=document.createElement('button');add.textContent='＋';add.title='Add to playlist';add.setAttribute('aria-label','Add to playlist: '+track.name);add.onclick=()=>this.choosePlaylist(track);actions.append(add);
      const download=document.createElement('button');const ready=this.downloads.get(track.id)?.version===track.version;download.textContent=this.downloadBusy.has(track.id)?'…':'⬇';if(ready)download.classList.add('active');download.title=ready?'Remove download from this device':'Download offline to this device';download.disabled=this.downloadBusy.has(track.id);download.setAttribute('aria-label',(ready?'Remove download: ':'Download offline: ')+track.name);download.onclick=()=>ready?this.removeDownload(track):this.downloadTrack(track);actions.append(download);
      const del=document.createElement('button');del.className='danger';del.textContent='🗑';del.title='Delete from pCloud';del.setAttribute('aria-label','Delete from pCloud: '+track.name);del.onclick=()=>this.deleteTrack(track);actions.append(del);
      row.append(play,like,actions);$('songs').append(row);
    }
    $('moreMusic').hidden=items.length<=this.limit||overview;
    this.queueUI();this.playerUI();this.warmCache(items.slice(0,30));
  }
  async saveSmartMix(){
    if(!this.account)return;const account=this.account;const mode=['foryou','mostplayed','liked','recent'].includes(this.view)?this.view:'search';const intent=musicIntent($('musicSearch').value.trim());const query=intent.query.slice(0,300);
    const name=await this.library.askName('Save smart mix · updates with your library');if(!name||this.account!==account)return;
    const actualMode=intent.mode&&intent.mode!=='downloads'?intent.mode:mode;const pending=this.library.data.pending.find(op=>op.type==='music-smart-playlist'&&op.name===name&&op.mode===actualMode&&op.query===query);
    try{let embedding=null;if(query&&Object.keys(this.library.meta.musicIndexes).length)embedding=(await this.library.api('music-analysis',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'text',query})})).embedding;if(this.account!==account)return;await this.library.changeCloud({type:'music-smart-playlist',playlistId:pending?.playlistId||newID(),name:name.slice(0,80),mode:actualMode,query,embedding});if(this.account===account){this.view='playlists';this.playlist=null;this.renderApp();$('musicSmartStatus').textContent='Smart mix saved in pCloud.';}}catch(error){$('musicSmartStatus').textContent=error.message;}
  }
  async startIndex(){if(!this.account)return;try{const known=Object.entries(this.library.meta.musicIndexes).filter(([,index])=>index.model===MUSIC_MODEL).map(([id,index])=>({id,version:index.version}));await this.library.api('music-analysis',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'start',folderId:this.musicFolder()?.id||null,known})});this.indexProgress();}catch(error){$('musicIndexStatus').textContent=error.message;}}
  async indexProgress(){try{const job=await this.library.api('music-analysis');$('stopMusicIndex').hidden=!job.running;$('musicIndexStatus').textContent=job.running||job.total?`Song title AI: ${job.phase} · ${job.completed}/${job.total} saved in pCloud${job.message?' · '+job.message:''}`:'';}catch{}}
  async aiSearch(query){
    const account=this.account;query=query.trim().toLowerCase();this.searchQuery=query;this.semanticScores=null;const intent=musicIntent(query);if(!intent.query||!account){$('musicSmartStatus').textContent='';if(account)this.renderApp();return;}
    const versions=new Map([...this.allTracks().values()].map(track=>[track.id,track.version]));const indexed=Object.entries(this.library.meta.musicIndexes).filter(([id,index])=>index.model===MUSIC_MODEL&&versions.get(id)===index.version);
    if(!indexed.length){$('musicSmartStatus').textContent='Search titles and filenames, or try “liked songs”. Index song titles for AI title search.';return;}
    $('musicSmartStatus').textContent='Searching song titles…';
    try{const result=await this.library.api('music-analysis',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'text',query:intent.query})});if(this.account!==account||this.searchQuery!==query)return;this.semanticScores=new Map(indexed.map(([id,index])=>[id,cosine(unpackEmbedding(index.embedding),result.embedding)]));this.renderApp();$('musicSmartStatus').textContent='AI title search · '+indexed.length+' indexed songs. Audio itself is not analysed.';}catch(error){if(this.account===account)$('musicSmartStatus').textContent=error.message;}
  }
  async createPlaylist(){
    if(!this.account)return;const account=this.account;const name=await this.library.askName('Create playlist');if(!name||this.account!==account)return;
    try{await this.library.changeCloud({type:'music-playlist',playlistId:newID(),name:name.slice(0,80)});if(this.account!==account)return;this.view='playlists';this.playlist=null;this.renderApp();$('musicDownloadStatus').textContent='Playlist saved in pCloud.';}
    catch(error){$('musicDownloadStatus').textContent=error.message||'Could not save the playlist in pCloud.';}
  }
  choosePlaylist(track){
    if(!this.account)return;this.playlistSong=normalizeTrack(track);this.playlistAccount=this.account;this.playlistDraft=null;
    $('songPlaylistName').textContent=track.name;$('songPlaylistStatus').textContent='';$('songPlaylistNewName').value='';
    const select=$('songPlaylistChoice');select.replaceChildren();
    for(const [id,playlist] of Object.entries(this.library.meta.playlists).filter(([,playlist])=>!playlist.smart)){const option=new Option(playlist.name+(playlist.members[track.id]?' · already added':''),id);option.disabled=Boolean(playlist.members[track.id]);select.append(option);}
    select.append(new Option('Create a new playlist…','new'));select.value=Object.entries(this.library.meta.playlists).find(([,playlist])=>!playlist.smart&&!playlist.members[track.id])?.[0]||'new';
    this.playlistChoiceUI();$('songPlaylistDialog').showModal();
    if(select.value==='new')$('songPlaylistNewName').focus();else select.focus();
  }
  playlistChoiceUI(){const isNew=$('songPlaylistChoice').value==='new';$('songPlaylistNewName').hidden=!isNew;$('songPlaylistNewLabel').hidden=!isNew;$('songPlaylistNewName').required=isNew;}
  async savePlaylistSong(){
    if(this.savingPlaylist||this.account!==this.playlistAccount||!this.playlistSong)return;
    const track=this.playlistSong;const account=this.account;let playlistId=$('songPlaylistChoice').value;const name=$('songPlaylistNewName').value.trim();
    if(playlistId==='new'&&!name){$('songPlaylistStatus').textContent='Enter a playlist name.';return;}
    this.savingPlaylist=true;$('saveSongPlaylist').disabled=true;$('cancelSongPlaylist').disabled=true;$('songPlaylistChoice').disabled=true;$('songPlaylistNewName').disabled=true;$('songPlaylistStatus').textContent='Saving in pCloud…';
    try{
      if(playlistId==='new'){
        const pending=this.library.data.pending.find(op=>op.type==='music-playlist'&&op.name===name);
        playlistId=this.playlistDraft?.name===name?this.playlistDraft.id:pending?.playlistId||newID();
        this.playlistDraft={id:playlistId,name};
        await this.library.changeCloud({type:'music-playlist',playlistId,name:name.slice(0,80)});
        if(this.account!==account)return;
        const select=$('songPlaylistChoice');select.append(new Option(name,playlistId));select.value=playlistId;this.playlistChoiceUI();
      }
      if(this.account!==account)return;
      await this.library.changeCloud({type:'music-membership',playlistId,track,value:true});
      if(this.account!==account)return;
      $('songPlaylistDialog').close();this.renderApp();$('musicDownloadStatus').textContent='Added '+track.name+' to '+this.library.meta.playlists[playlistId].name+' · saved in pCloud.';
    }catch(error){if(this.account===account)$('songPlaylistStatus').textContent=error.message||'Could not save in pCloud. Automatic sync will retry when the connection is available.';}
    finally{this.savingPlaylist=false;$('saveSongPlaylist').disabled=false;$('cancelSongPlaylist').disabled=false;$('songPlaylistChoice').disabled=false;$('songPlaylistNewName').disabled=false;}
  }
  async removePlaylistSong(track,playlistId){try{await this.library.changeCloud({type:'music-membership',playlistId,track,value:false});this.renderApp();$('musicDownloadStatus').textContent='Removed from playlist in pCloud. Original song stays in pCloud.';}catch{$('musicDownloadStatus').textContent='Could not update the playlist in pCloud. Check your connection and write permissions.';}}
  async deleteTrack(track) {
    if(this.deleting||!this.account)return;
    const account=this.account;const dialog=$('deleteMusicDialog');
    $('deleteMusicName').textContent=track.fileName;dialog.returnValue='';dialog.showModal();dialog.querySelector('button[value="cancel"]').focus();
    const answer=await new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue),{once:true}));
    if(answer!=='delete'||this.account!==account)return;
    this.deleting=true;this.playerUI();
    try {
      const response=await fetch('/.netlify/functions/music-delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:track.id,fileName:track.fileName,confirmed:true})});
      const result=await response.json();if(!response.ok||result.deleted!==true||result.id!==track.id)throw new Error(result.error||'Deletion could not be confirmed. Refresh before retrying.');
      if(this.account!==account)return;
      this.deletedIDs.add(track.id);this.downloads.delete(track.id);
      if(this.current?.id===track.id){this.current=null;this.generation++;this.switching=true;$('audio').pause();$('audio').removeAttribute('src');$('audio').load();this.switching=false;if('mediaSession'in navigator)navigator.mediaSession.metadata=null;}
      this.queue=this.queue.filter(id=>id!==track.id);this.originalQueue=(this.originalQueue||[]).filter(id=>id!==track.id);
      for(const [key,url] of this.cachedURLs)if(key.startsWith(`${account}-${track.id}-`)){URL.revokeObjectURL(url);this.cachedURLs.delete(key);}
      this.onDelete?.(track.id);
      await this.library.change({type:'music-delete',trackId:track.id});
      await forgetPhotoImages(account,track.id);
      this.renderApp();$('musicSync').textContent='Song deleted from pCloud.';
    } catch(error) {$('musicSync').textContent=error.message||'Could not delete. Check your connection and refresh before retrying.';}
    finally{this.deleting=false;this.playerUI();}
  }
  like(track){return this.library.change({type:'music-like',track:normalizeTrack(track),value:!this.library.meta.musicLikes[track.id]});}
  async play(track,sequence=null,resume=0){
    if(!this.library.account||this.deletedIDs.has(track.id))return;
    this.checkSleep();
    const generation=++this.generation;const account=this.account;const item=normalizeTrack(track);
    if(!this.cachedURLs.has(this.cacheKey(item))){try{const url=await downloadedSong(account,item)||await cachedImage(account,item,'audio',true);if(generation!==this.generation||account!==this.account||this.deletedIDs.has(item.id)){if(url)URL.revokeObjectURL(url);return;}if(url)this.cachedURLs.set(this.cacheKey(item),url);}catch{}}
    if(generation!==this.generation||account!==this.account)return;
    if(!navigator.onLine&&!this.cachedURLs.has(this.cacheKey(item))){$('musicDownloadStatus').textContent='This song is not downloaded on this device.';return;}
    this.savePosition();this.switching=true;
    this.current=item;this.historyRecorded=false;this.resumePosition=resume;this.lastSavedAt=Date.now();
    if(sequence){this.originalQueue=[...new Set(sequence.map(track=>track.id))].slice(0,2000);if(!this.originalQueue.includes(item.id))this.originalQueue.unshift(item.id);this.originalQueue=this.originalQueue.slice(0,2000);this.queue=this.shuffle?shuffleQueue(this.originalQueue,item.id):[...this.originalQueue];this.queueRestored=true;this.saveQueue();}
    else if(!this.queue.includes(item.id)){this.queue=[item.id];this.originalQueue=[item.id];this.saveQueue();}
    const audio=$('audio');audio.src=this.cachedURLs.get(this.cacheKey(item))||'/.netlify/functions/media-content?id='+encodeURIComponent(item.id);audio.playbackRate=Number($('musicSpeed').value);
    $('nowPlaying').textContent=item.name;$('musicPlaybackStatus').textContent='Loading…';this.switching=false;this.renderApp();
    if('mediaSession'in navigator&&'MediaMetadata'in window)try{navigator.mediaSession.metadata=new MediaMetadata({title:item.name,artist:'Sai Photos · pCloud'});}catch{}
    try{await audio.play();}catch{if(generation===this.generation)$('musicPlaybackStatus').textContent='Tap Play to start playback.';}
    const wantsOffline=String(localStorage.getItem('sai-cache-songs')??'off')==='on';
    if(wantsOffline&&!this.cachedURLs.has(this.cacheKey(item))&&this.downloads.get(item.id)?.version!==item.version&&Number(item.size||0)<=104857600)void this.cachePlayed(item,account);
    this.playerUI();
  }
  toggle(forcePlay=false){
    const audio=$('audio');if(!this.current){const resume=this.library.meta.musicResume;if(resume)return this.play(resume.track,null,resume.position);const items=this.items($('musicSearch').value.trim().toLowerCase());if(items.length)return this.play(items[0],items);return;}
    if(audio.paused||forcePlay)audio.play().catch(()=>{$('musicPlaybackStatus').textContent='Could not resume. Select the song again.';});else audio.pause();
  }
  next(ended=false){
    let id=nextTrackId(this.queue,this.current?.id,this.repeat,ended);
    if(!id&&!ended&&Array.isArray(this.listIds)){const index=this.listIds.indexOf(this.current?.id);if(index>=0&&index+1<this.listIds.length)id=this.listIds[index+1];}
    const track=id?this.allTracks().get(id):null;if(track)this.play(track);else this.playerUI();
  }
  hasNextTrack(){
    if(nextTrackId(this.queue,this.current?.id,this.repeat))return true;
    if(!Array.isArray(this.listIds))return false;
    const index=this.listIds.indexOf(this.current?.id);
    return index>=0&&index+1<this.listIds.length;
  }
  openFullscreen(){
    if(!this.current)return;this.fullscreen=true;
    const player=$('player');if(!player)return;
    player.classList.add('is-fullscreen');player.classList.remove('is-expanded');
    this.playerUI();
  }
  closeFullscreen(){
    this.fullscreen=false;const player=$('player');if(!player)return;
    player.classList.remove('is-fullscreen','is-menu');
    $('playerMenu').setAttribute('aria-expanded','false');
    this.playerUI();
  }
  seekUI(){
    const audio=$('audio');const bar=$('seekBar');if(!bar)return;
    const duration=Number.isFinite(audio.duration)?audio.duration:0;
    bar.max=String(Math.max(1,Math.round(duration)));bar.value=String(Math.min(duration,audio.currentTime||0));bar.disabled=!duration||!this.current;
    const label=$('seekTime');if(label)label.textContent=formatTime(audio.currentTime)+' / '+formatTime(duration);
  }
  previous(){if($('audio').currentTime>3){$('audio').currentTime=0;this.savePosition();return;}const track=this.allTracks().get(previousTrackId(this.queue,this.current?.id,this.repeat));if(track)this.play(track);}
  savePosition(position){if(!this.current||!this.library.account)return;this.lastSavedAt=Date.now();const time=position===undefined?$('audio').currentTime:position;if(Number.isFinite(time))this.library.change({type:'music-position',track:this.current,position:Math.max(0,Math.min(86400,time))});}
  saveSettings(){if(!this.library.account)return;const rate=Number($('musicSpeed').value);$('audio').playbackRate=rate;this.library.change({type:'music-settings',shuffle:this.shuffle,repeat:this.repeat,rate});}
  saveQueue(known=this.allTracks()){if(!this.library.account)return;const tracks=this.queue.map(id=>known.get(id)).filter(Boolean).slice(0,2000);this.library.change({type:'music-queue',tracks});}
  openFullQueue(){
    let dialog=$('fullQueueDialog');if(!dialog){dialog=document.createElement('dialog');dialog.id='fullQueueDialog';document.body.append(dialog);}
    dialog.replaceChildren();dialog.classList.add('queue-sheet');const title=document.createElement('h2');title.textContent='Up next';dialog.append(title);
    const close=document.createElement('button');close.textContent='Close';close.onclick=()=>dialog.close();dialog.append(close);
    const list=document.createElement('ol');dialog.append(list);const tracks=this.allTracks();let offset=0,position=0;
    const more=document.createElement('button');more.textContent='Show more songs';
    const append=()=>{for(const id of this.queue.slice(offset,offset+200)){const track=tracks.get(id);if(!track)continue;position+=1;const row=document.createElement('li'),button=document.createElement('button');const marker=document.createElement('span');marker.className='queue-index';marker.textContent=id===this.current?.id?'♪':String(position);const label=document.createElement('span');label.className='queue-name';label.textContent=track.name;if(id===this.current?.id){row.classList.add('is-current');button.classList.add('is-current');}button.append(marker,label);button.onclick=()=>{this.play(track);dialog.close();};row.append(button);list.append(row);}offset+=200;more.hidden=offset>=this.queue.length;};
    more.onclick=append;dialog.append(more);append();if(!this.queue.length){const message=document.createElement('p');message.textContent='Play a song or playlist to start a queue.';dialog.append(message);}if(!dialog.open)dialog.showModal();
  }
  nativeState(force=false){
    if(!window.SAI_ANDROID||typeof window.SaiNative?.mediaState!=='function')return;
    if(!force&&Date.now()-(this.nativeSentAt||0)<1000)return;this.nativeSentAt=Date.now();
    const audio=$('audio'),all=this.allTracks(),start=Math.max(0,this.queue.indexOf(this.current?.id)-10);
    const queue=this.queue.slice(start,start+50).map((id,offset)=>({id,title:all.get(id)?.name||'Song',index:start+offset}));
    try{window.SaiNative.mediaState(JSON.stringify({id:this.current?.id||'',title:this.current?.name||'',playing:!audio.paused,position:Math.round((audio.currentTime||0)*1000),duration:Number.isFinite(audio.duration)?Math.round(audio.duration*1000):0,speed:audio.playbackRate,queue}));}catch{}
  }
  playerUI(){
    this.nativeState(true);
    const audio=$('audio');const meta=this.library.meta;const has=Boolean(this.current);$('player').hidden=!has;$('miniToggleMusic').textContent=audio.paused?'▶':'Ⅱ';
    $('toggleMusic').textContent=audio.paused?'▶':'Ⅱ';$('toggleMusic').disabled=!this.library.account||(!has&&!this.tracks().length&&!meta.musicResume);
    $('previousSong').disabled=!has;$('nextSong').disabled=!has||!this.hasNextTrack();
    const mini=$('miniPlayer');
    if(mini){mini.hidden=!has||this.fullscreen||!$('musicPanel').hidden||$('player')?.classList.contains('is-fullscreen');}
    if(has){$('miniPlay').textContent=audio.paused?'▶':'Ⅱ';$('miniPrev').disabled=false;$('miniNext').disabled=!this.hasNextTrack();$('miniTitle').textContent=this.current.name;$('miniArt').textContent=(this.current.name||'♪').trim().slice(0,1).toUpperCase()||'♪';$('playerHeading').textContent=this.current.name;}
    this.seekUI();
    $('shuffleMusic').setAttribute('aria-pressed',String(this.shuffle));$('repeatMusic').textContent='Repeat: '+({off:'Off',all:'All',one:'One'})[this.repeat];
    $('shuffleMusic').disabled=!this.library.account;$('repeatMusic').disabled=!this.library.account;$('musicSpeed').disabled=!this.library.account;
    $('addCurrentPlaylist').disabled=!has;
    $('deleteMusic').disabled=!has||Boolean(this.deleting);
    $('likeCurrentSong').disabled=!has;$('likeCurrentSong').textContent=meta.musicLikes[this.current?.id]?'♥':'♡';$('likeCurrentSong').setAttribute('aria-pressed',String(Boolean(meta.musicLikes[this.current?.id])));
    $('likeCurrentSong').setAttribute('aria-label',meta.musicLikes[this.current?.id]?'Unlike current song':'Like current song');
    $('muteMusic').textContent=audio.muted?'Unmute':'Mute';$('muteMusic').setAttribute('aria-pressed',String(audio.muted));
    $('cacheMusic').disabled=!has||(has&&this.downloadBusy.has(this.current.id));$('cacheMusic').textContent=has&&this.downloadBusy.has(this.current.id)?'Downloading…':has&&this.downloads.get(this.current.id)?.version===this.current.version?'Downloaded on device':'Download offline';
    $('sleepMusic').disabled=!has;this.sleepUI();
    const saved=meta.musicResume;$('resumeMusic').hidden=has||!saved;$('resumeMusic').textContent='Resume '+(saved?.track.name||'');
  }
  queueUI(){
    const all=this.allTracks();const index=this.queue.indexOf(this.current?.id);const next=this.queue.slice(Math.max(0,index+1));$('queueList').replaceChildren();
    $('queueCount').textContent=next.length?'· '+next.length:'';$('queueHint').hidden=Boolean(next.length);
    $('queueHint').textContent=this.queue.length?'End of queue. Use Play next or Repeat to keep listening.':'Play a song to start a queue.';
    next.slice(0,40).forEach((id,position)=>{const track=all.get(id);if(!track)return;const li=document.createElement('li');const button=document.createElement('button');const number=document.createElement('span');number.className='queue-index';number.textContent=String(position+1);const label=document.createElement('span');label.className='queue-name';label.textContent=track.name;button.append(number,label);button.onclick=()=>this.play(track);li.append(button);$('queueList').append(li);});
  }
  cacheKey(track){return `${this.account}-${track.id}-${track.version}`;}
  async warmCache(items){
    const account=this.account;const generation=this.generation;if(!account)return;
    for(const track of items){const key=this.cacheKey(track);if(this.cachedURLs.has(key)||this.cacheChecks.has(key))continue;this.cacheChecks.add(key);
      try{const url=await downloadedSong(account,track)||await cachedImage(account,track,'audio',true);if(!url)continue;if(this.account!==account||this.deletedIDs.has(track.id)||this.cachedURLs.has(key)){URL.revokeObjectURL(url);continue;}this.cachedURLs.set(key,url);}catch{}
    }
    if(generation===this.generation)this.playerUI();
  }
  cacheCurrent(){if(this.current&&this.downloads.get(this.current.id)?.version!==this.current.version)return this.downloadTrack(this.current);}
  async cachePlayed(item,account){if(this.downloadBusy.has(item.id))return;this.downloadBusy.add(item.id);try{const url=await downloadSong(account,item);if(this.account!==account||this.deletedIDs.has(item.id)){URL.revokeObjectURL(url);return;}const key=this.cacheKey(item);if(this.cachedURLs.has(key))URL.revokeObjectURL(url);else this.cachedURLs.set(key,url);this.downloads.set(item.id,item);}catch{/* Auto-cache is best-effort; streaming continues. */}finally{this.downloadBusy.delete(item.id);}}
  deviceID(){let id;try{id=localStorage.getItem('sai-music-device');}catch{}if(!/^[a-f0-9-]{36}$/.test(id||'')){id=newID();try{localStorage.setItem('sai-music-device',id);}catch{}}return this.deviceId ||= id;}
  async refreshDownloads(){const account=this.account;if(!account)return;try{const tracks=await listDownloadedSongs(account);if(this.account!==account)return;this.downloads=new Map(tracks.filter(track=>!this.deletedIDs.has(track.id)).map(track=>[track.id,track]));this.renderApp();}catch{$('musicDownloadStatus').textContent='Device storage is unavailable. Downloads cannot be saved.';}}
  async downloadTrack(track){
    if(!this.account||this.downloadBusy.has(track.id))return;const account=this.account;const item=normalizeTrack(track);this.downloadBusy.add(item.id);this.renderApp();$('musicDownloadStatus').textContent='Saving download record in pCloud…';
    try{
      try{await this.library.changeCloud({type:'music-download',track:item,deviceId:this.deviceID(),value:true});}catch{throw new Error('Could not save the download record in pCloud. Download not started. Check your connection and pCloud write permissions.');}
      if(this.account!==account||this.deletedIDs.has(item.id))return;
      $('musicDownloadStatus').textContent='Downloading '+item.name+' to this device…';
      if(navigator.storage?.persist)try{await navigator.storage.persist();}catch{}
      const url=await downloadSong(account,item);
      if(this.account!==account||this.deletedIDs.has(item.id)){URL.revokeObjectURL(url);return;}
      const key=this.cacheKey(item);if(this.cachedURLs.has(key))URL.revokeObjectURL(url);else this.cachedURLs.set(key,url);
      this.downloads.set(item.id,item);this.renderApp();$('musicDownloadStatus').textContent='';
      if(this.current?.id===item.id){const audio=$('audio');const position=audio.currentTime;const playing=!audio.paused;this.switching=true;audio.src=this.cachedURLs.get(key);audio.addEventListener('loadedmetadata',()=>{if(this.current?.id!==item.id)return;audio.currentTime=Math.min(position,Math.max(0,audio.duration-1));this.switching=false;if(playing)audio.play().catch(()=>{});},{once:true});audio.load();}
    }catch(error){if(this.account===account)$('musicDownloadStatus').textContent=error.message||'Download failed. Check pCloud permissions and device storage.';}
    finally{this.downloadBusy.delete(item.id);if(this.account===account){this.renderApp();}}
  }
  async removeDownload(track){const account=this.account;if(!account)return;try{await forgetPhotoImages(account,track.id);this.downloads.delete(track.id);const key=this.cacheKey(track);const url=this.cachedURLs.get(key);if(this.current?.id!==track.id&&url){URL.revokeObjectURL(url);this.cachedURLs.delete(key);}this.library.change({type:'music-download',track,deviceId:this.deviceID(),value:false});this.renderApp();$('musicDownloadStatus').textContent='Removed device download. Original song stays in pCloud.';}catch{$('musicDownloadStatus').textContent='Could not remove the device download.';}}
  sleepKey(){return 'sai-music-sleep-'+this.account;}
  restoreSleep(){try{const saved=JSON.parse(localStorage.getItem(this.sleepKey())||'null');if(saved&&Number.isFinite(saved.until)&&saved.until>Date.now()&&saved.until<Date.now()+90*60000){this.sleepUntil=saved.until;$('sleepMusic').value=String(saved.minutes);}}catch{}this.sleepUI();}
  setSleep(minutes){if(!Number.isInteger(minutes)||minutes<0||minutes>180)return;this.sleepUntil=sleepDeadline(minutes);try{localStorage.setItem(this.sleepKey(),JSON.stringify({until:this.sleepUntil,minutes}));}catch{}try{if(this.library.account)this.library.change({type:'music-sleep',minutes});}catch{}if([0,5,10,15,30,45,60,90].includes(minutes))$('sleepMusic').value=String(minutes);this.sleepUI();}
  stopSleep(){this.sleepUntil=0;if(this.account)try{localStorage.removeItem(this.sleepKey());}catch{}$('sleepMusic').value='0';this.sleepUI();}
  checkSleep(){if(this.sleepUntil&&sleepRemaining(this.sleepUntil)===0){this.stopSleep();$('audio').pause();$('musicPlaybackStatus').textContent='Sleep timer finished.';return true;}this.sleepUI();return false;}
  sleepUI(){const remaining=sleepRemaining(this.sleepUntil);$('sleepMusicStatus').textContent=remaining?'Stops in '+Math.ceil(remaining/60000)+' min · keep the app open for reliable timing':'';}
}
