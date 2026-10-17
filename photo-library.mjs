import { matchesGalleryFilter,activeDeletedPhotoIds,photoAlbumMatches } from './smart-features.mjs';
import { PhotoCleanup } from './photo-cleanup.mjs';
import { PhotoEditor } from './photo-editor.mjs';
import {sharedIndexProgress,sharedIndexLabel,cosine,unpackEmbedding,VISUAL_MODEL,formatSize,withIndexDeadline,confidentVisualScores} from './photo-tools.mjs';
import { syncRecords, sameOperation } from './cloud-sync.mjs';
import { emptyPhotoState, replayOperations, groupFaces, collectPeople, faceGroupName, normalizePersonName, matchNamedFaces } from './photo-state.mjs';
import { readAccount, saveAccount, cachedImage, forgetPhotoImages } from './photo-cache.mjs';
import { addFavoriteRetry, settleFavoriteRetries, pendingFavoriteRetries } from './favorite-queue.mjs';
const $ = id => document.getElementById(id);
function uuid() {
  // randomUUID is unavailable on the temporary HTTP Wi-Fi preview.
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const h = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export class PhotoLibrary {
  constructor({ api, photos, render, onDelete, photoFolder }) {
    this.api = api; this.photos = photos; this.photoFolder = photoFolder || (() => null); this.scopeLoading = false; this.scanError=''; this.render = render; this.account = null;
    this.onDelete = onDelete; this.deleting = false;
    this.data = { operations: [], pending: [] }; this.meta = emptyPhotoState(); this.view = 'library'; this.focus = null; this.filters={};
    this.groups = []; this.people = []; this.groupedVersions = {}; this.urls = new Set(); this.viewerVersion = 0;     this.renderVersion = 0; this.zoom = 1; this.current = null;
    this.thumbnailURLs=new Map();this.tileItems=new WeakMap();this.tileObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){this.tileObserver.unobserve(entry.target);const item=this.tileItems.get(entry.target);if(item)this.loadTileNow(item,entry.target);}},{rootMargin:'900px'});this.cleanup=new PhotoCleanup(this);this.appliedDeletes=new Set();this.semanticScores=null;this.searchQuery='';this.panX=0;this.panY=0;this.zoom=1;
    this.batchSize = 50; this.loadedCount = 0; this.sortedPhotos = [];
    this.selectedPhotos = new Set();
    this.isSelecting = false;
    this.selectionStartX = 0;
    this.selectionStartY = 0;
    this.selectionTimer = null;
    this.autoScrollTimer = null;
    this.nameMatchStamp = ''; this.autoLabeling = false; this.syncing = false; this.restoring = false; this.cloudError = ''; this.restoreError = ''; this.syncPromise = null; this.writeJobs = new Map(); this.indexing = false; this.stop = false; this.syncRetryDelay = 8000; this.syncRetryTimer = null; this.autoResuming = false; this.lastIndexAttempt = 0;
    for (const view of ['library', 'favorites', 'albums', 'people']) $(view + 'Section').onclick = () => { this.view = view; this.focus = null; this.render(); };
    this.wireFavoriteRetry();
    $('backCollections').onclick = () => { this.focus = null; this.render(); window.scrollTo({top:0,behavior:'smooth'}); };
    $('newAlbum').onclick = async () => {
      const name = await this.askName('Album name'); if (!name?.trim()) return;
      this.change({ type: 'album', albumId: uuid(), name: name.trim().slice(0, 80) }); this.view = 'albums'; this.focus = null; this.render();
    };
    $('newSmartAlbum').onclick=()=>{$('smartAlbumName').value='';$('smartAlbumQuery').value='';$('smartAlbumStatus').textContent='';$('smartAlbumDialog').showModal();};
    $('cancelSmartAlbum').onclick=()=>$('smartAlbumDialog').close();$('smartAlbumDialog').addEventListener('cancel',event=>{if(this.savingSmartAlbum)event.preventDefault();});
    $('smartAlbumForm').onsubmit=event=>{event.preventDefault();this.createSmartAlbum();};
    $('indexPhotos').onclick = () => this.beginIndexing(); $('stopIndex').onclick = () => {this.stop=true;this.api('photo-analysis',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'stop'})}).catch(()=>{});$('indexStatus').textContent='Stopping after the current photo…';};
    setInterval(()=>{if(this.account&&document.visibilityState==='visible'&&(this.visualJob?.running||Date.now()-(this.lastProgressPoll||0)>30000)){this.lastProgressPoll=Date.now();this.visualProgress();}},4000);
    setInterval(()=>{void this.preloadOriginals();},45000);
    $('loadOriginal').onclick=()=>this.loadOriginal();
    $('closeViewer').onclick = () => $('viewer').close();
    $('viewer').addEventListener('close', () => { this.viewerVersion++; this.current = null; $('viewerDetails').hidden = true; this.releaseViewer(); });
    $('viewerFavorite').onclick = () => this.current && this.toggleFavorite(this.current.id);
    $('viewerHide').onclick = () => this.current && this.toggleHidden(this.current.id);
    $('deletePhoto').onclick = () => this.deleteCurrentPhoto();
    $('previousImage').onclick = () => this.relative(-1); $('nextImage').onclick = () => this.relative(1);
    $('zoomIn').onclick = () => this.setZoom(this.zoom + .5); $('zoomOut').onclick = () => this.setZoom(this.zoom - .5); $('resetZoom').onclick = () => this.setZoom(1);
    $('viewerInfo').onclick = () => { const details = $('viewerDetails'); details.hidden = !details.hidden; if (!details.hidden) this.fillDetails(); };
    this.editor = new PhotoEditor(this);
    $('editPhoto').onclick = () => { if (this.current) this.editor.open(this.current); };
    for (const [id, busy, endpoint] of [['savePhoto', 'Saving to Pictures/Sai Photos…', 'device-save'], ['sharePhoto', 'Preparing to share…', 'device-share']]) {
      const button = $(id); if (!button) continue;
      button.onclick = async () => {
        const photo = this.current; if (!photo || photo.mediaType === 'video') return;
        const account = this.account; button.disabled = true; $('viewerStatus').textContent = busy;
        try {
          const result = await this.api(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: photo.id, fileName: photo.fileName }) });
          if (this.account !== account) return;
          $('viewerStatus').textContent = result.shared ? 'Pick an app to share…' : 'Saved to Pictures/Sai Photos.';
        } catch (error) { if (this.account === account) $('viewerStatus').textContent = error.message || 'Could not finish.'; }
        finally { button.disabled = false; }
      };
    }
    $('addToAlbum').onchange = async event => {
      if (!this.current || !event.target.value) return;
      const albumId = event.target.value; event.target.value = '';
      await this.change({ type: 'membership', albumId, photoId: this.current.id, value: true });
      $('viewerStatus').textContent = `Added to ${this.meta.albums[albumId]?.name || 'album'}`;
    };
    window.addEventListener('keydown', event => { if (!$('viewer').open || $('deletePhotoDialog').open || this.deleting) return; if (event.key === 'ArrowLeft') this.relative(-1); if (event.key === 'ArrowRight') this.relative(1); });
    window.addEventListener('resize', () => { if (this.current && this.current.mediaType !== 'video') this.applyTransform(); });
    const viewerMenu=$('viewerMenu');
    $('viewerMenuButton').onclick = event => { event.stopPropagation(); viewerMenu.hidden = !viewerMenu.hidden; $('viewerMenuButton').setAttribute('aria-expanded', String(!viewerMenu.hidden)); };
    viewerMenu.addEventListener('click', event => { const button = event.target.closest('button'); if (button && ['viewerInfo','loadOriginal','editPhoto','savePhoto','sharePhoto','deletePhoto'].includes(button.id)) viewerMenu.hidden = true; });
    const pointers = new Map(); let startX = 0; let startY = 0; let startTime = 0; let pinchDistance = 0; let pinchZoom = 1; let pinchFocus = { x: 0, y: 0 }; let pinchPan = { x: 0, y: 0 }; let hadPinch = false; let moved = false; let lastTap = 0; let lastTapX = 0; let lastTapY = 0;
    const stage = $('imageStage');
    stage.onpointerdown = event => {
      if(event.target.closest('video'))return;
      stage.setPointerCapture(event.pointerId); pointers.set(event.pointerId, [event.clientX, event.clientY]);
      if (pointers.size === 1) { startX = event.clientX; startY = event.clientY; startTime = performance.now(); hadPinch = false; moved = false; }
      if (pointers.size === 2) { const [a,b] = [...pointers.values()]; pinchDistance = Math.max(1, Math.hypot(a[0]-b[0], a[1]-b[1])); pinchZoom = this.zoom || 1; pinchPan = { x: this.panX || 0, y: this.panY || 0 }; const rect = stage.getBoundingClientRect(); pinchFocus = { x: (a[0]+b[0])/2 - (rect.left + rect.width/2), y: (a[1]+b[1])/2 - (rect.top + rect.height/2) }; hadPinch = true; }
    };
    stage.onpointermove = event => {
      const previous = pointers.get(event.pointerId); if (!previous) return;
      const dx = event.clientX - previous[0]; const dy = event.clientY - previous[1];
      pointers.set(event.pointerId, [event.clientX, event.clientY]);
      if (Math.abs(event.clientX-startX) > 10 || Math.abs(event.clientY-startY) > 10) moved = true;
      if (pointers.size === 2) {
        const [a,b] = [...pointers.values()];
        const nextZoom = Math.max(1, Math.min(8, pinchZoom * Math.hypot(a[0]-b[0], a[1]-b[1]) / pinchDistance));
        const factor = nextZoom / pinchZoom;
        this.panX = pinchFocus.x - (pinchFocus.x - pinchPan.x) * factor;
        this.panY = pinchFocus.y - (pinchFocus.y - pinchPan.y) * factor;
        this.zoom = nextZoom; this.applyTransform(true);
      } else if (this.zoom > 1) { this.panX = (this.panX || 0) + dx; this.panY = (this.panY || 0) + dy; this.applyTransform(true); }
    };
    stage.onpointerup = event => {
      pointers.delete(event.pointerId); if(this.current?.mediaType==='video')return; if (pointers.size) return;
      const tap = !moved && !hadPinch && performance.now() - startTime < 400;
      if (tap) {
        const now = performance.now();
        if (now - lastTap < 320 && Math.hypot(event.clientX-lastTapX, event.clientY-lastTapY) < 48) { lastTap = 0; this.zoomTo(this.zoom > 1.05 ? 1 : 2.5, event.clientX, event.clientY); return; }
        lastTap = now; lastTapX = event.clientX; lastTapY = event.clientY;
        viewerMenu.hidden = true; $('viewer').classList.toggle('chrome-hidden');
        return;
      }
      if (!hadPinch && this.zoom === 1 && Math.abs(event.clientX-startX) > 60 && Math.abs(event.clientX-startX) > Math.abs(event.clientY-startY) * 1.2) { this.relative(event.clientX > startX ? -1 : 1); return; }
      this.applyTransform();
    };
    stage.onpointercancel = event => pointers.delete(event.pointerId);
    stage.addEventListener('dblclick', event => event.preventDefault());
    stage.addEventListener('wheel', event => { if (!$('viewer').open || this.current?.mediaType === 'video') return; event.preventDefault(); this.zoomTo(this.zoom * (event.deltaY < 0 ? 1.15 : 0.87), event.clientX, event.clientY); }, { passive: false });
    window.addEventListener('online', () => { this.sync(); this.ensureIndexing(); });
    window.addEventListener('focus', () => this.sync());
    setInterval(() => { if(document.visibilityState==='visible')this.sync(); }, 15000);
    setInterval(() => this.ensureIndexing(), 60000);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){this.sync();this.ensureIndexing();}});
    window.addEventListener('pageshow',()=>{this.sync();this.ensureIndexing();});
  }
  setSyncStatus(text) { $('photoSync').textContent = text; $('musicSync').textContent = text; this.cloudStatus(); }
  cloudStatus(){
    $('cloudSyncPanel').hidden=!this.account;
    const pending=this.data.pending.length;
    const warning=Boolean(this.cloudError);
    $('cloudSyncPanel').classList.toggle('sync-warning',warning);
    $('cloudSyncStatus').textContent=warning?`${pending?pending+(pending===1?' change is waiting to save in pCloud. ':' changes are waiting to save in pCloud. '):''}${this.cloudError} Automatic sync will retry when the connection is available.${this.syncRetryTimer?' Retry already scheduled.':''}`:this.syncing?`${pending?'Saving '+pending+' changes to pCloud…':('Restoring likes, favorites, playlists and indexes from pCloud… '+this.data.operations.length.toLocaleString()+' records available on this device.')}`:pending?pending+' changes are saved only on this device; pCloud upload is pending.':(typeof window!=='undefined'&&window.SAI_PHOTOS_ONLY?'Synced to pCloud · shared with your other devices':'App records saved in pCloud · other devices can restore them.');
  }
  async askName(title, current = '') {
    $('nameDialogTitle').textContent = title; $('nameInput').value = current; $('nameDialog').returnValue = '';
    const contactsButton = $('pickContactName');
    if (contactsButton) contactsButton.hidden = !/person/i.test(title) || !window.SAI_ANDROID;
    const suggestions=$('nameSuggestions');if(suggestions&&$('nameInput')){suggestions.replaceChildren();if(/person/i.test(title))for(const row of this.people||[])if(row.name){const option=document.createElement('option');option.value=row.name;suggestions.append(option);}}
    const result = new Promise(resolve => {
      const onClose = () => { if (contactsButton) contactsButton.onclick = null; resolve($('nameDialog').returnValue === 'save' ? $('nameInput').value.trim() : null); };
      $('nameDialog').addEventListener('close', onClose, { once: true });
    });
    if (contactsButton) contactsButton.onclick = async () => { const name = await this.pickContact(); if (name) $('nameInput').value = name; };
    $('nameDialog').showModal(); $('nameInput').focus(); return result;
  }
  async pickContact() {
    const dialog = $('contactPicker'); if (!dialog) return null;
    $('contactSearch').value = ''; $('contactList').innerHTML = ''; $('contactStatus').textContent = 'Loading contacts…';
    $('closeContactPicker').onclick = () => dialog.close();
    const choice = new Promise(resolve => dialog.addEventListener('close', () => resolve(String(dialog.returnValue || '').startsWith('name:') ? dialog.returnValue.slice(5) : null), { once: true }));
    dialog.showModal();
    const load = async (attempt = 0) => {
      try {
        const data = await this.api('device-contacts');
        if (data.pendingPermission) {
          $('contactStatus').textContent = 'Waiting for the Contacts permission — tap “Allow” on the phone prompt…';
          if (attempt < 12) setTimeout(() => load(attempt + 1), 900);
          else $('contactStatus').textContent = 'Contacts permission was not granted. Type the name instead.';
          return;
        }
        const names = (data.names || []).map(name => String(name || '').trim()).filter(Boolean);
        $('contactStatus').textContent = names.length ? names.length + ' contacts — tap one to use the name.' : 'No contact names were found. Type the name instead.';
        const renderNames = filter => {
          const list = $('contactList'); list.innerHTML = '';
          const needle = filter.trim().toLowerCase();
          for (const name of names.filter(item => item.toLowerCase().includes(needle)).slice(0, 300)) {
            const item = document.createElement('li'); const button = document.createElement('button');
            button.type = 'button'; button.textContent = name;
            button.onclick = () => { dialog.returnValue = 'name:' + name; dialog.close(); };
            item.append(button); list.append(item);
          }
        };
        renderNames('');
        $('contactSearch').oninput = () => renderNames($('contactSearch').value);
      } catch (error) { $('contactStatus').textContent = error.message || 'Contacts are unavailable.'; }
    };
    void load();
    return choice;
  }
  async resetPeople() {
    const account = this.account; if (!account) throw new Error('Connect pCloud first.');
    const dialog = $('peopleResetDialog'); if (!dialog) return false;
    const choice = new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
    dialog.showModal();
    if (await choice !== 'reset' || this.account !== account) return false;
    await this.change({ type: 'people-reset' });
    $('indexStatus').textContent = 'People groups were reset. Name people again to rebuild them — with the lock on, the app never renames on its own.';
    return true;
  }
  setPeopleLock(value) { return this.change({ type: 'people-lock', value: value === true }); }
  async createAlbumByName(name) {
    if (!this.account || !name?.trim()) return false;
    await this.change({ type: 'album', albumId: uuid(), name: name.trim().slice(0, 80) });
    this.view = 'albums'; this.focus = null; this.render();
    return true;
  }
  async connect(account) {
    if (this.account === account) return;
    this.account = account; this.nameMatchStamp=''; this.semanticScores=null;this.appliedDeletes.clear();this.stop = true; this.groups = []; this.people = []; this.groupedVersions = {};
    try { this.data = await readAccount(account); } catch { this.data = { operations: [], pending: [] }; this.setSyncStatus('Local storage unavailable. Keep this window open until sync completes.'); }
    this.replay(); this.render(); void this.sync(); setTimeout(()=>this.ensureIndexing(),8000);
  }
  disconnect() {
    this.account = null; this.nameMatchStamp=''; this.stop = true; this.data = { operations: [], pending: [] }; this.meta = emptyPhotoState(); this.groups = []; this.people = []; this.groupedVersions = {}; this.focus = null; this.view = 'library';
    this.cloudError='';this.restoreError='';this.visualJob=null;this.visualStatusError='';this.restoring=false;this.syncRetryDelay=8000;if(this.syncRetryTimer){clearTimeout(this.syncRetryTimer);this.syncRetryTimer=null;}this.releaseGrid(); this.releaseViewer();for(const url of this.thumbnailURLs.values())URL.revokeObjectURL(url);this.thumbnailURLs.clear();this.semanticScores=null;this.setSyncStatus(''); $('indexStatus').textContent = ''; this.render();
  }
  replay() {
    this.meta = replayOperations([...this.data.operations, ...this.data.pending]);
    const deleted=activeDeletedPhotoIds([...this.data.operations,...this.data.pending]);for(const id of deleted)if(!this.appliedDeletes.has(id)&&this.photos().some(photo=>photo.id===id))this.onDelete(id);this.appliedDeletes=deleted;
    const entries = Object.entries(this.meta.indexes);
    const changed = Object.keys(this.groupedVersions).some(id => !this.meta.indexes[id]) || entries.some(([id, index]) => this.groupedVersions[id] !== undefined && this.groupedVersions[id] !== index.version);
    const added = Object.fromEntries(entries.filter(([id]) => this.groupedVersions[id] === undefined));
    this.groups = changed ? groupFaces(this.meta.indexes) : groupFaces(added, this.groups);
    this.groupedVersions = Object.fromEntries(entries.map(([id, index]) => [id, index.version]));
    this.people = collectPeople(this.groups, this.meta.peopleNames, this.meta.peopleNameTimes);
    const relevant=[...this.data.operations,...this.data.pending].filter(op=>['index','person-name','person-label','photo-delete','photos-delete'].includes(op.type));
    const stamp=relevant.length+':'+JSON.stringify(this.meta.peopleNameTimes)+':'+entries.length;
    if(stamp!==this.nameMatchStamp||changed){this.nameMatchStamp=stamp;this.scheduleNamedMatches();}
  }
  async persist() {
    if (this.account) try { await saveAccount(this.account, this.data); return true; } catch { this.setSyncStatus('Safari storage is full. Keep this page open until changes sync to pCloud.'); }
    return false;
  }
  writeRecord(operation){
    const key=this.account+':'+operation.id;if(this.writeJobs.has(key))return this.writeJobs.get(key);
    const job=this.api('photo-metadata?action=write',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation})}).finally(()=>{if(this.writeJobs.get(key)===job)this.writeJobs.delete(key);});
    this.writeJobs.set(key,job);return job;
  }
  async changeCloud(fields) {
    if(!this.account)throw new Error('Connect pCloud first.');
    const account=this.account;const data=this.data;const existing=data.pending.find(pending=>sameOperation(pending,{...fields,id:pending.id,at:pending.at}));const op=existing||{id:uuid(),at:Date.now(),...fields};
    if(!existing)data.pending.push(op);await this.persist();this.setSyncStatus('Saving in pCloud…');
    try{
      if(this.account!==account||this.data!==data)throw new Error('Account changed. Please retry.');
      const result=await this.writeRecord(op);
      if(this.account!==account||this.data!==data)throw new Error('Account changed. Please retry.');
      if(!sameOperation(result.operation,op))throw new Error('pCloud did not confirm the saved record.');
      data.operations=data.operations.filter(old=>old.id!==op.id);data.operations.push(result.operation);data.pending=data.pending.filter(old=>old.id!==op.id);this.replay();await this.persist();if(!(result.operation?.type==='favorite'&&this.view!=='favorites'))this.render();this.updateViewer();if(!data.pending.length)this.cloudError=this.restoreError||'';this.setSyncStatus(this.cloudError?'pCloud sync needs attention · see warning above':data.pending.length?'pCloud save pending':'Saved in pCloud');return result.operation;
    }catch(error){if(this.account===account&&this.data===data){this.cloudError=error.message||'pCloud save failed.';this.setSyncStatus('pCloud save pending · see warning above');}throw error;}
  }
  async change(fields,options={}) {
    if(!this.account)return;
    const account=this.account;const data=this.data;const op={id:uuid(),at:Date.now(),...fields};
    data.pending.push(op);this.replay();if(options.quiet!==true)this.render();this.updateViewer();this.setSyncStatus('Saving in pCloud…');await this.persist();
    if(this.account!==account||this.data!==data)return false;
    await this.sync();
    if(this.account===account&&this.data===data&&data.pending.some(pending=>pending.id===op.id)&&!this.cloudError)await this.sync();
    return !data.pending.some(pending=>pending.id===op.id);
  }
  sync(){
    if(!this.account)return Promise.resolve(false);
    if(this.syncPromise)return this.syncPromise;
    const account=this.account;const data=this.data;const before=data.operations.length;this.syncing=true;this.restoring=true;this.cloudError='';this.cloudStatus();let success=false;
    this.syncPromise=syncRecords({data,current:()=>this.account===account&&this.data===data,
      write:operation=>this.writeRecord(operation),
      read:known=>this.api('photo-metadata?action=sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({known})}),
      persist:()=>this.persist(),onPhase:()=>this.cloudStatus(),
      onPage:()=>{if(this.account===account&&this.data===data){this.replay();this.render();this.updateViewer();this.cloudStatus();}}
    }).then(result=>{
      if(this.account!==account||this.data!==data)return false;
      this.restoreError=[result.readError?.message,result.skipped.length?result.skipped.length+' pCloud records could not be read.':null].filter(Boolean).join(' ');
      const problems=[result.writeError?.message,this.restoreError].filter(Boolean);
      this.cloudError=problems.join(' ');this.restoring=false;if(data.operations.length!==before){this.replay();this.render();this.updateViewer();if(this.searchQuery)this.aiSearch(this.searchQuery);}success=result.saved&&!problems.length;if(success){this.syncRetryDelay=8000;if(this.syncRetryTimer){clearTimeout(this.syncRetryTimer);this.syncRetryTimer=null;}}this.setSyncStatus(success?'Saved in pCloud':data.pending.length?'pCloud save pending · see warning above':'pCloud restore incomplete · see warning above');return success;
    }).catch(error=>{if(this.account===account&&this.data===data){this.cloudError=error.message||'pCloud sync failed.';this.cloudStatus();}return false;}).finally(()=>{
      this.syncing=false;this.restoring=false;this.syncPromise=null;this.cloudStatus();
      if(this.account&&(this.account!==account||this.data!==data||success&&data.pending.length))queueMicrotask(()=>this.sync());
      else if(this.account&&this.data===data&&(this.cloudError||data.pending.length))this.scheduleSyncRetry();
    });
    return this.syncPromise;
  }
  scheduleSyncRetry(){
    if(!this.account||this.syncRetryTimer)return;
    const delay=this.syncRetryDelay||8000;this.syncRetryDelay=Math.min(240000,Math.round(delay*1.7));
    this.syncRetryTimer=setTimeout(()=>{this.syncRetryTimer=null;if(this.account&&(this.cloudError||this.data.pending.length)&&!this.syncing)void this.sync();},delay);
  }
  async createSmartAlbum(){
    if(this.savingSmartAlbum||!this.account)return;const account=this.account;const name=$('smartAlbumName').value.trim();const query=$('smartAlbumQuery').value.trim();if(!name||!query)return;
    this.savingSmartAlbum=true;$('saveSmartAlbum').disabled=true;$('cancelSmartAlbum').disabled=true;$('smartAlbumStatus').textContent='Preparing your smart album…';
    try{const embedding=null;
      if(this.account!==account)return;const pending=this.data.pending.find(op=>op.type==='smart-album'&&op.name===name&&op.query===query);await this.changeCloud({type:'smart-album',albumId:pending?.albumId||uuid(),name:name.slice(0,80),query:query.slice(0,300),embedding});if(this.account!==account)return;$('smartAlbumDialog').close();this.view='albums';this.focus=null;this.render();
    }catch(error){if(this.account===account)$('smartAlbumStatus').textContent=error.message;}finally{this.savingSmartAlbum=false;$('saveSmartAlbum').disabled=false;$('cancelSmartAlbum').disabled=false;}
  }
  personRemoval(photo){
    const person=this.view==='people'&&this.people.find(person=>person.id===this.focus);if(!person?.name)return null;
    const button=document.createElement('button');button.className='person-remove';button.textContent='Not '+person.name;button.onclick=async()=>{
      const account=this.account;const ids=[...person.faces].filter(id=>id.startsWith(photo.id+'-face-'));if(!ids.length)return;
      $('personRemoveText').textContent='Remove this face from '+person.name+'? The original photo stays in pCloud. You can name the face again from People.';
      const dialog=$('personRemoveDialog');dialog.returnValue='';dialog.showModal();const result=await new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue),{once:true}));if(result!=='remove'||this.account!==account)return;
      try{await this.changeCloud({type:'person-label',faceIds:ids,name:'',inferred:false});if(this.account===account){if(!this.people.some(row=>row.id===this.focus))this.focus=null;this.render();}}catch(error){$('indexStatus').textContent=error.message;}
    };return button;
  }
  async deleteAlbum(collection) {
    const account = this.account;
    if (!account || collection.virtual || collection.person) return;
    if (!this.meta.albums[collection.id]) return;
    const existing = new Map(this.photos().filter(photo => !this.meta.hidden[photo.id]).map(photo => [photo.id, photo]));
    const files = (collection.photos || []).map(id => existing.get(id)).filter(Boolean);
    $('albumDeleteText').textContent = 'Delete “' + collection.name + '”? The album is removed from Sai Photos and pCloud on every device. Its ' + files.length + ' ' + (files.length === 1 ? 'file' : 'files') + ' stay safely in pCloud.';
    const box = $('albumDeleteFiles'); const warning = $('albumDeleteWarning'); const danger = $('albumDeleteDanger');
    box.checked = false; danger.disabled = true; warning.hidden = true; warning.textContent = '';
    danger.textContent = 'Delete album and ' + files.length + ' ' + (files.length === 1 ? 'file' : 'files');
    box.onchange = () => {
      danger.disabled = !box.checked || !files.length;
      warning.hidden = !box.checked || !files.length;
      warning.textContent = files.length ? files.length + ' ' + (files.length === 1 ? 'file' : 'files') + ' will move to pCloud Trash. Recovery is through pCloud, within your account’s retention period.' : 'This album has no files on pCloud right now.';
    };
    const dialog = $('albumDeleteDialog'); dialog.returnValue = ''; dialog.showModal();
    const result = await new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
    if (this.account !== account || !result || result === 'cancel') return;
    try {
      await this.change({ type: 'album-delete', albumId: collection.id });
      if (result === 'files' && files.length) {
        const deleted = []; let failure = '';
        for (let offset = 0; offset < files.length && !failure; offset += 25) {
          const response = await this.api('photos-delete', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmed: true, items: files.slice(offset, offset + 25).map(item => ({ id: item.id, fileName: item.fileName, version: item.version })) }) });
          const rows = Array.isArray(response?.results) ? response.results : [];
          for (const row of rows) if (row.deleted) deleted.push(row.id);
          const failed = rows.filter(row => !row.deleted);
          if (failed.length) failure = failed[0].error || 'Some files could not be deleted.';
        }
        if (deleted.length) await this.change({ type: 'photos-delete', photoIds: deleted });
        $('indexStatus').textContent = failure ? 'Album deleted, but ' + failure : 'Album deleted. ' + deleted.length + ' ' + (deleted.length === 1 ? 'file' : 'files') + ' moved to pCloud Trash.';
      } else {
        $('indexStatus').textContent = 'Album deleted. Photos and videos stayed in pCloud.';
      }
      if (this.account === account) { if (this.focus === collection.id) this.focus = null; this.render(); }
    } catch (error) { $('indexStatus').textContent = error.message; }
  }
  toggleFavorite(id) { const value = !this.meta.favorites[id]; const result = this.change({ type: 'favorite', photoId: id, value }, { quiet: this.view !== 'favorites' }); this.syncFavoriteToPcloud(id, value); return result; }
  favoriteQueueKey() { return 'sai-fav-retry-' + (this.account || ''); }
  favoriteQueue() { try { const list = JSON.parse(localStorage.getItem(this.favoriteQueueKey()) || '[]'); return Array.isArray(list) ? list : []; } catch { return []; } }
  saveFavoriteQueue(list) { try { localStorage.setItem(this.favoriteQueueKey(), JSON.stringify(list.slice(-200))); } catch {} }
  wireFavoriteRetry() {
    if (this.favRetryWired) return; this.favRetryWired = true;
    const flush = () => { if (document.visibilityState === 'visible') setTimeout(() => this.flushFavoriteRetries(), 400); };
    window.addEventListener('online', flush); document.addEventListener('visibilitychange', flush);
  }
  syncFavoriteToPcloud(photoId, value) {
    if (!this.account) return;
    this.api('favorite-sync?action=' + (value ? 'link' : 'unlink'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ photoId }) })
      .then(() => { this.saveFavoriteQueue(settleFavoriteRetries(this.favoriteQueue(), [photoId])); setTimeout(() => this.flushFavoriteRetries(), 600); })
      .catch(error => {
        this.saveFavoriteQueue(addFavoriteRetry(this.favoriteQueue(), { photoId, value, at: Date.now() }));
        const message = String(error?.message || '');
        if (/was not found on this account/i.test(message)) {
          const status = document.getElementById('viewerStatus');
          if (status && this.current?.id === photoId) status.textContent = 'Heart saved on this phone. To mirror it to pCloud’s own app, tap the star on any photo once inside pCloud’s app, then use Settings → Account → Sync now.';
        }
      });
  }
  async flushFavoriteRetries() {
    if (!this.account || this.favRetrying) return;
    const account = this.account; const queue = pendingFavoriteRetries(this.favoriteQueue());
    if (!queue.length) return;
    this.favRetrying = true;
    try {
      let remaining = queue;
      for (const item of queue) {
        if (this.account !== account) return;
        try {
          await this.api('favorite-sync?action=' + (item.value ? 'link' : 'unlink'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ photoId: item.photoId }) });
          remaining = remaining.filter(entry => entry.photoId !== item.photoId);
          this.saveFavoriteQueue(remaining);
        } catch { break; }
      }
    } finally { this.favRetrying = false; }
  }
  async syncPcloudFavorites() {
    if (!this.account) throw new Error('Connect pCloud first.');
    const account = this.account;
    const note = text => { const element = document.getElementById('pcloudFavoritesStatus'); if (element) element.textContent = text; };
    const status = await this.api('favorite-sync?action=status');
    if (!status.found) throw new Error('pCloud Favourites was not found on this account yet. In pCloud’s own app, tap the star on any photo once, then try again.');
    const cloudIds = new Set(status.fileIds || []);
    const inLibrary = new Set(this.photos().map(photo => photo.id));
    const mine = Object.entries(this.meta.favorites).filter(([, value]) => value).map(([id]) => id);
    const mineSet = new Set(mine);
    const pendingImport = [...cloudIds].filter(id => !mineSet.has(id) && inLibrary.has(id));
    const importIds = pendingImport.slice(0, 500);
    const pushIds = mine.filter(id => !cloudIds.has(id));
    let imported = 0;
    if (importIds.length) {
      note('Importing ' + importIds.length + ' star' + (importIds.length === 1 ? '' : 's') + ' from pCloud…');
      for (const id of importIds) { this.data.pending.push({ id: uuid(), at: Date.now(), type: 'favorite', photoId: id, value: true }); imported++; }
      this.replay(); this.render(); await this.persist(); await this.sync();
    }
    let pushed = 0, failed = 0; const succeeded = [];
    for (let offset = 0; offset < pushIds.length; offset += 200) {
      if (this.account !== account) throw new Error('Account changed. Please retry.');
      const chunk = pushIds.slice(offset, offset + 200);
      note('Sending hearts to pCloud Favourites · ' + (offset + chunk.length) + ' of ' + pushIds.length + '…');
      try { const result = await this.api('favorite-sync?action=update', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ add: chunk, remove: [] }) }); pushed += result.linked ?? chunk.length; succeeded.push(...chunk); }
      catch { failed += chunk.length; }
    }
    this.saveFavoriteQueue(settleFavoriteRetries(this.favoriteQueue(), succeeded));
    setTimeout(() => this.flushFavoriteRetries(), 800);
    return { imported, pushed, failed, cloud: status.items || 0, remaining: Math.max(0, pendingImport.length - importIds.length) };
  }
  setHidden(id,value){ return this.change({ type:'hidden', photoId:id, value }, {}); }
  toggleHidden(id){
    const now=!this.meta.hidden[id]; const result=this.setHidden(id,now);
    const status=$('viewerStatus'); if(status)status.textContent=now?'Hidden. It stays in pCloud and only Sai Photos hides it. Restore any time in Settings → Hidden.':'Visible again in Sai Photos.';
    return result;
  }
  setAlbumHidden(id,value){ return this.change({ type:'album-hidden', albumId:id, value }, {}); }
  hiddenPhotos(){ return Object.entries(this.meta.hidden).filter(([,on])=>on).map(([id])=>({ id, name:(this.photos().find(photo=>photo.id===id)||{}).fileName||('Photo '+id.slice(3)) })); }
  hiddenAlbums(){ return Object.entries(this.meta.hiddenAlbums).filter(([,on])=>on).map(([id])=>({ id, name:this.meta.albums[id]?.name||'Album' })); }
  async deleteCurrentPhoto() {
    if (!this.current || !this.account || this.deleting) return;
    const item = this.current; const account = this.account;
    $('deletePhotoName').textContent = item.fileName+' · '+formatSize(item.size); $('deletePhotoDialog').returnValue = '';
    const answer = new Promise(resolve => $('deletePhotoDialog').addEventListener('close', () => resolve($('deletePhotoDialog').returnValue === 'delete'), { once:true }));
    $('deletePhotoDialog').showModal();
    if (!await answer || this.current?.id !== item.id || this.account !== account) return;
    this.deleting = true; this.viewerVersion++; this.updateViewer(); $('viewerStatus').textContent = 'Deleting original from pCloud…';
    let deleted = false; let next; let sequence;
    try {
      const result = await this.api('photo-delete', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ id:item.id, fileName:item.fileName, confirmed:true }) });
      if (result.deleted !== true || result.id !== item.id) throw new Error('Deletion was not confirmed. Refresh your library to check.');
      if (this.account !== account) return;
      deleted = true;
      const index = this.sequence.findIndex(photo => photo.id === item.id);
      sequence = this.sequence.filter(photo => photo.id !== item.id); next = sequence[Math.min(index, sequence.length - 1)];
      this.onDelete(item.id);
      await this.change({ type:'photo-delete', photoId:item.id });
      try { await forgetPhotoImages(account,item.id); } catch { /* Cloud deletion succeeded even if Safari cache cleanup is unavailable. */ }
      $('status').textContent = 'Photo deleted from pCloud.';
    } catch (error) { if (this.account === account) $('viewerStatus').textContent = error.message || 'Deletion could not be confirmed. Refresh to check.'; }
    finally { this.deleting = false; this.updateViewer(); }
    if (deleted && this.account === account && $('viewer').open) {
      if (next) this.open(next,sequence);
      else $('viewer').close();
    }
  }
  updateSelectionUI() {
    const toolbar = $('selectionToolbar');
    const count = $('selectedPhotoCount');
    toolbar.hidden = !this.isSelecting || this.selectedPhotos.size === 0;
    count.textContent = `${this.selectedPhotos.size} photo${this.selectedPhotos.size === 1 ? '' : 's'} selected`;
  }

  sortPhotos(photos) {
    const sort = $('sortPhotos')?.value || 'date';
    if (sort === 'date') return [...photos].sort((a, b) => b.addedAt - a.addedAt);
    if (sort === 'size') return [...photos].sort((a, b) => b.size - a.size);
    if (sort === 'name') return [...photos].sort((a, b) => a.fileName.localeCompare(b.fileName));
    return photos;
  }

  virtualCollections(existing) {
    const items = [];
    const add = (id, name, picks) => { const members = picks.filter(photo => existing.has(photo.id)); if (members.length) items.push({ id, name, photos: members.map(photo => photo.id), virtual: true }); };
    add('virtual-screenshots', 'Screenshots', [...existing.values()].filter(photo => photo.mediaType !== 'video' && (/screen[-_ ]?shot/i.test(photo.fileName || '') || /screenshot/i.test(photo.folderPath || ''))));
    add('virtual-whatsapp', 'WhatsApp', [...existing.values()].filter(photo => /whatsapp/i.test(photo.folderPath || '')));
    return items;
  }
  render() {
    this.renderVersion++;
    this.loadedCount = 0;
    this.replay();
    const photos = this.sortPhotos(this.photos());
    this.sortedPhotos = photos;
    this.sections();
    if (this.view === 'library' && !this.focus) {
      this.renderBatch();
    }
  }

  renderBatch() {
    const grid = $('photoGrid');
    if (!grid) return;
    const slice = this.sortedPhotos.slice(this.loadedCount, this.loadedCount + this.batchSize);
    slice.forEach(photo => {
      const card = document.createElement('div');
      card.className = 'photo-card' + (this.selectedPhotos.has(photo.id) ? ' is-selected' : '');
      card.innerHTML = `<div class="photo-tile"><img alt="${photo.fileName}"><span>${photo.fileName}</span></div>`;
      card.onclick = (e) => this.handleTileInteraction(e, photo.id);
      grid.append(card);
      this.loadTile(photo, card.querySelector('img'));
    });
    this.loadedCount += slice.length;
  }
  personName(group) { return group?.name ?? faceGroupName(group, this.meta.peopleNames, this.meta.peopleNameTimes); }
  async namePerson(person) {
    const account = this.account;
    const name = await this.askName('Name this person · use an existing name to merge', person.name || '');
    if (!name?.trim() || this.account !== account) return;
    const label = name.normalize('NFKC').trim().replace(/\s+/g, ' ').slice(0, 80);
    const existing = (this.people||[]).find(row => row.id !== person.id && row.name && normalizePersonName(row.name) === normalizePersonName(label));
    const faces = [...person.faces];
    for (let offset = 0; offset < faces.length; offset += 50000) {
      if(this.account !== account) return;
      await this.change({type:'person-label',faceIds:faces.slice(offset, offset+50000),name:label});
    }
    if (existing) { try { window.dispatchEvent(new CustomEvent('sai-toast', { detail: { message: 'Merged with “' + existing.name + '” — one group now.' } })); } catch {} }
    this.scheduleNamedMatches();
  }
  scheduleNamedMatches() {
    if(this.autoLabeling||!this.account)return;
    this.autoLabeling=true; const account=this.account; const stamp=this.nameMatchStamp;
    queueMicrotask(async()=>{
      try { if(this.account===account)await this.labelMatchedFaces(); }
      finally {this.autoLabeling=false;if(this.account&&(this.account!==account||this.nameMatchStamp!==stamp))this.scheduleNamedMatches();}
    });
  }
  async labelMatchedFaces(photoId=null) {
    if(this.meta.peopleLocked)return true;
    const account=this.account;
    const matches=matchNamedFaces(this.meta.indexes,this.meta.peopleNames,this.meta.peopleNameInferred,photoId);
    const byName=new Map();for(const match of matches){const ids=byName.get(match.name)||[];ids.push(match.faceId);byName.set(match.name,ids);}
    for(const [name,faceIds]of byName) for(let offset=0;offset<faceIds.length;offset+=1000){
      if(this.account!==account)return false;
      const ids=faceIds.slice(offset,offset+1000).filter(id=>this.meta.peopleNames[id]===undefined);
      if(ids.length&&!await this.change({type:'person-label',faceIds:ids,name,inferred:true}))return false;
    }
    return true;
  }
  facePreview(person, members, existing, image) {
    let selected;
    for(const faceId of person.faces){const parts=faceId.match(/^(pc-\d+)-face-(\d+)$/);if(parts&&existing.has(parts[1])){const face=this.meta.indexes[parts[1]]?.faces[Number(parts[2])];if(face){selected={photo:existing.get(parts[1]),box:face.box};break;}}}
    if(!selected){this.loadTile(existing.get(members[0]),image);return;}
    image.onload=()=>{
      const [x,y,w,h]=selected.box; const W=image.naturalWidth,H=image.naturalHeight;if(!W||!H||!w||!h)return;
      const side=Math.min(W,H,Math.max(w*W,h*H)*1.5);
      const left=Math.max(0,Math.min(W-side,(x+w/2)*W-side/2));const top=Math.max(0,Math.min(H-side,(y+h/2)*H-side/2));
      Object.assign(image.style,{position:'absolute',maxWidth:'none',width:(W/side*100)+'%',height:(H/side*100)+'%',left:(-left/side*100)+'%',top:(-top/side*100)+'%',aspectRatio:'auto',objectFit:'fill'});
    };
    this.loadTile(selected.photo,image);
  }
  filter(items, query) {
    if(['duplicates','similar','large'].includes(this.view))return [];
    const matches=items.filter(item => {
      if(!matchesGalleryFilter(item,this.filters))return false;
      if(this.view!=='hidden'&&this.meta.hidden[item.id])return false;
      if (this.view === 'favorites' && !this.meta.favorites[item.id]) return false;
      if (this.view === 'albums' && !this.focus) return false;
      if (this.view === 'people' && !this.focus) return false;
      if (this.view === 'albums') { const album=this.meta.albums[this.focus]; if(!album||!(album.smart?photoAlbumMatches(item,album,this.meta,this.people):album.members[item.id]))return false; }
      if (this.view === 'people' && !this.people.find(person => person.id === this.focus)?.photos.has(item.id)) return false;
      const people = this.people.filter(person => person.photos.has(item.id)).map(person => person.name).join(' ');
      const albums = Object.values(this.meta.albums).filter(album => album.members[item.id]).map(album => album.name).join(' ');
      return `${item.fileName} ${this.meta.indexes[item.id]?.text || ''} ${people} ${albums}`.toLowerCase().includes(query)||(this.searchQuery===query&&this.semanticScores?.has(item.id));
    });
    return query&&this.semanticScores?matches.sort((a,b)=>(this.semanticScores.get(b.id)||0)-(this.semanticScores.get(a.id)||0)):matches;
  }
  sections() {
    const shared=$('sharedIndexStatus');if(shared&&this.account)shared.textContent=this.scopeLoading?'Scanning photo folders… Saved index counts will appear after the scan.':`Shared pCloud indexes · AI search: ${sharedIndexLabel(this)} · Faces & text: ${sharedIndexLabel(this,'faces')} · ${this.restoring?'Restoring saved records; counts may increase…':this.data.pending.length?'Changes waiting to save':'Mac ↔ pCloud ↔ Samsung'}`;
    const isPhoto = !$('photosPanel').hidden;
    $('newAlbum').disabled = !this.account; $('newSmartAlbum').disabled = !this.account; $('indexPhotos').disabled = !this.account || this.indexing || this.scopeLoading || this.preparingIndex || Boolean(this.scanError); $('indexAllPhotos').disabled = !this.account || this.indexing || this.scopeLoading || this.preparingIndex || Boolean(this.scanError);
    for (const view of ['library','favorites','albums','people','duplicates','similar','large']) $(view + 'Section').classList.toggle('active', view === this.view);
    this.cleanup.render();
    if(['duplicates','similar','large'].includes(this.view))return;
    const overview = !this.focus && ['albums','people'].includes(this.view);
    $('collectionCards').hidden = !overview; $('photoGrid').hidden = overview; $('collectionHeading').hidden = !this.focus;
    $('collectionCards').replaceChildren();
    if (this.focus) $('collectionTitle').textContent = this.view === 'albums' ? this.meta.albums[this.focus]?.name || 'Album' : this.personName(this.people.find(person => person.id === this.focus)) || 'Person';
    if (!overview || !isPhoto) return;
    const existing = new Map(this.photos().filter(photo=>!this.meta.hidden[photo.id]).map(photo => [photo.id, photo]));
    const collections = this.view === 'albums' ? [...this.virtualCollections(existing), ...Object.entries(this.meta.albums).filter(([id])=>!this.meta.hiddenAlbums[id]).map(([id, album]) => ({ id, name: album.name, photos: album.smart?this.photos().filter(photo=>photoAlbumMatches(photo,album,this.meta,this.people)).map(photo=>photo.id):Object.keys(album.members).filter(id => album.members[id]), smart:album.smart, query:album.query }))] : this.people.filter(person => [...person.photos].some(id => existing.has(id)) && (!this.searchQuery || normalizePersonName(person.name).includes(normalizePersonName(this.searchQuery)))).map(person => ({ id: person.id, name: person.name || 'Person', photos: [...person.photos], person }));
    $('count').textContent = `${collections.length} ${this.view === 'albums' ? collections.length===1?'album':'albums' : collections.length===1?'person':'people'}`;
    for (const collection of collections) {
      const members = collection.photos.filter(id => existing.has(id));
      const card = document.createElement('div'); const button = document.createElement('button'); button.className = 'collection-card';
      if (members.length) { const image = document.createElement('img'); image.alt = collection.name; if(collection.person){const frame=document.createElement('div');frame.className='person-face-preview';frame.append(image);this.facePreview(collection.person,members,existing,image);button.append(frame);}else{this.loadTile(existing.get(members[0]), image);button.append(image);} }
      const label = document.createElement('strong'); label.textContent = (collection.smart?'✦ ':'')+collection.name; const count = document.createElement('span'); count.textContent = `${members.length} ${members.length===1?'photo':'photos'}`; button.append(label,count);if(collection.smart){const rule=document.createElement('span');rule.textContent='Smart · '+collection.query;button.append(rule);}
      button.onclick = () => { if (collection.virtual) { this.view = 'library'; this.focus = null; this.filters = { ids: collection.photos }; this.filterTitle = collection.name; this.render(); window.scrollTo({ top: 0, behavior: 'smooth' }); } else { this.focus = collection.id; this.render(); window.scrollTo({ top: 0, behavior: 'smooth' }); } }; card.append(button);
      if (this.view === 'people') { const rename = document.createElement('button'); rename.textContent = collection.person.name ? 'Rename person' : 'Name person'; rename.setAttribute('aria-label',rename.textContent+(collection.person.name?' '+collection.person.name:'')); rename.onclick = () => this.namePerson(collection.person); card.append(rename); }
      $('collectionCards').append(card);
    }
    $('empty').hidden = collections.length > 0;
    if (!collections.length && this.account) { $('empty').querySelector('h2').textContent = this.view === 'albums' ? 'Create your first album' : 'Find people in your photos'; $('empty').querySelector('p').textContent = this.view === 'albums' ? 'Use New album, then add photos from the viewer.' : this.searchQuery ? 'No people match this name.' : 'Start indexing, then name a person. Use the same name on another group to combine their photos. Face matches are suggestions.'; }
  }
  releaseGrid(){this.renderVersion++;this.tileObserver.disconnect();}
  loadTile(item,image){const key=this.account+':'+item.id+':'+item.version;const cached=this.thumbnailURLs.get(key);if(cached){image.src=cached;return;}this.tileItems.set(image,item);this.tileObserver.observe(image);}
  async loadTileNow(item,image){const account=this.account;if(!account)return;const key=account+':'+item.id+':'+item.version;try{const url=await cachedImage(account,item);if(this.account!==account){URL.revokeObjectURL(url);return;}if(this.thumbnailURLs.has(key))URL.revokeObjectURL(url);else this.thumbnailURLs.set(key,url);if(image.isConnected)image.src=this.thumbnailURLs.get(key);if(this.thumbnailURLs.size>320&&Date.now()-(this.lastThumbSweep||0)>1500){this.lastThumbSweep=Date.now();const active=new Set([...document.images].map(img=>img.src));for(const [old,value]of this.thumbnailURLs){if(this.thumbnailURLs.size<=320)break;if(!active.has(value)){URL.revokeObjectURL(value);this.thumbnailURLs.delete(old);}}}}catch{if(image.isConnected)image.alt='Preview unavailable: '+item.fileName;}}
  releaseViewer(){const video=document.getElementById('viewerVideo');if(video){video.pause();video.removeAttribute('src');video.load();video.hidden=true;}for(const url of this.viewerURLs||[])URL.revokeObjectURL(url);this.viewerURLs=[];const original=$('original');original.removeAttribute('src');original.style.transform='';original.style.transition='none';original.style.width='';original.style.height='';this.panX=0;this.panY=0;this.zoom=1;const viewer=$('viewer');if(viewer)viewer.classList.remove('chrome-hidden');if($('viewerMenu'))$('viewerMenu').hidden=true;}
  async open(item,sequence){
    this.releaseViewer();this.current=item;this.sequence=sequence;this.zoom=1;this.panX=0;this.panY=0;this.viewerOriginalLoaded=false;const version=++this.viewerVersion;const account=this.account;
    const when=item.addedAt?new Date(item.addedAt).toLocaleString(undefined,{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'}):'';$('photoTitle').textContent=when||'Original size: '+formatSize(item.size);$('viewerStatus').textContent='Loading preview…';$('original').alt=item.fileName;$('loadOriginal').disabled=false;$('viewerDetails').hidden=true;
    if(item.mediaType==='video'){const video=$('viewerVideo');$('original').hidden=true;video.hidden=false;const account=this.account;let cachedURL=null;try{cachedURL=await cachedImage(account,item,'video',true);}catch{}if(cachedURL)this.viewerURLs.push(cachedURL);video.src=cachedURL||'/.netlify/functions/media-content?id='+encodeURIComponent(item.id)+'&video=1';$('loadOriginal').hidden=true;for(const id of ['zoomIn','zoomOut','resetZoom','downloadOfflinePhoto','editPhoto','savePhoto','sharePhoto'])if($(id))$(id).hidden=true;$('viewer').classList.remove('chrome-hidden');$('viewerMenu').hidden=true;if(!$('viewer').open)$('viewer').showModal();this.updateViewer();$('viewerStatus').textContent=cachedURL?'Video on this device':'Video from pCloud';video.onerror=()=>{$('viewerStatus').textContent='Video unavailable or codec unsupported. Check pCloud or retry.';};if(!cachedURL&&String(localStorage.getItem('sai-cache-videos')??'on')!=='off')void cachedImage(account,item,'video').then(url=>{if(url)URL.revokeObjectURL(url);}).catch(()=>{});return;}
    $('viewer').classList.add('chrome-hidden');$('viewerMenu').hidden=true;$('original').hidden=false;$('loadOriginal').hidden=false;for(const id of ['zoomIn','zoomOut','resetZoom','editPhoto'])$(id).hidden=false;for(const id of ['savePhoto','sharePhoto'])if($(id))$(id).hidden=!window.SAI_ANDROID;if($('downloadOfflinePhoto'))$('downloadOfflinePhoto').hidden=!window.SAI_ANDROID;
    const quick=this.thumbnailURLs.get(account+':'+item.id+':'+item.version);if(quick){$('original').src=quick;$('viewerStatus').textContent='Preview';}
    if(!$('viewer').open)$('viewer').showModal();this.updateViewer();
    try{const url=await cachedImage(account,item,'preview');if(version!==this.viewerVersion||account!==this.account){URL.revokeObjectURL(url);return;}if(this.viewerOriginalLoaded){URL.revokeObjectURL(url);return;}this.viewerURLs.push(url);$('original').src=url;await $('original').decode();if(version===this.viewerVersion){this.setZoom(1);$('viewerStatus').textContent='Preview · loading full quality…';if(!$('viewerDetails').hidden)this.fillDetails();}}
    catch{if(version===this.viewerVersion)$('viewerStatus').textContent=quick?'Thumbnail · larger preview unavailable':'Photo unavailable. Check your connection.';}
    if(version!==this.viewerVersion)return;if(!this.viewerOriginalLoaded&&this.autoFullQuality())void this.loadOriginal();const index=sequence.findIndex(photo=>photo.id===item.id);for(const next of [sequence[index-1],sequence[index+1]].filter(Boolean))cachedImage(account,next,'preview').then(url=>URL.revokeObjectURL(url)).catch(()=>{});
  }
  autoFullQuality(){try{return String(localStorage.getItem('sai-full-quality')??'on')!=='off';}catch{return true;}}
  async loadOriginal(){
    if(!this.current||this.viewerOriginalLoaded)return;
    const item=this.current;const version=this.viewerVersion;const account=this.account;
    this.viewerOriginalLoaded=true;$('loadOriginal').disabled=true;$('viewerStatus').textContent='Loading full quality…';
    try{const url=await cachedImage(account,item,'original');if(version!==this.viewerVersion||account!==this.account){URL.revokeObjectURL(url);return;}this.viewerURLs.push(url);$('original').src=url;await $('original').decode();if(version===this.viewerVersion){this.setZoom(this.zoom);$('viewerStatus').textContent='Full quality'+(String(item.size||0)>0?' · '+formatSize(item.size):'');}}
    catch{if(version===this.viewerVersion){this.viewerOriginalLoaded=false;$('viewerStatus').textContent='Full quality unavailable · preview kept';$('loadOriginal').disabled=false;}}
  }
  async preloadOriginals(){
    if(this.preloading)return;
    let enabled='off';try{enabled=String(localStorage.getItem('sai-preload-originals')??'off');}catch{}
    if(enabled!=='on')return;
    const account=this.account;if(!account||!navigator.onLine)return;
    const connection=navigator.connection;if(connection&&(connection.saveData||connection.type==='cellular'))return;
    if(window.SAI_ANDROID){try{const battery=await this.api('device-battery');if(!battery.charging)return;}catch{return;}}
    else{try{const battery=await navigator.getBattery?.();if(battery&&!battery.charging)return;}catch{}}
    const photos=this.photos().filter(photo=>photo.mediaType!=='video');if(!photos.length)return;
    this.preloading=true;
    try{
      let done=0;
      for(let index=((this.preloadCursor||0)%photos.length);index<photos.length&&done<3;index++){
        if(this.account!==account)break;
        const photo=photos[index];this.preloadCursor=index+1;
        let cached=null;try{cached=await cachedImage(account,photo,'original',true);}catch{}
        if(cached){URL.revokeObjectURL(cached);continue;}
        try{const url=await cachedImage(account,photo,'original');if(url)URL.revokeObjectURL(url);}catch{}
        done++;
      }
      if((this.preloadCursor||0)>=photos.length)this.preloadCursor=0;
      const status=document.getElementById('settingsPreloadInfo');
      if(status&&this.account===account)status.textContent='Full-quality preload running on this device · '+(this.preloadCursor||0)+' of '+photos.length+' photos checked so far. Cellular data is never used.';
    }finally{this.preloading=false;}
  }
  async aiSearch(query){
    query=query.trim().toLowerCase();if(query&&query!==this.searchQuery&&$('sortPhotos'))$('sortPhotos').value='relevance';this.searchQuery=query;this.semanticScores=null;if(!query||!this.account){$('photoSearchStatus').textContent='';return;}
    const account=this.account;const versions=new Map(this.photos().map(photo=>[photo.id,photo.version]));const indexed=Object.entries(this.meta.visuals).filter(([id,index])=>index.model===VISUAL_MODEL&&versions.get(id)===index.version);
    if(!indexed.length){$('photoSearchStatus').textContent='Search filenames and text. Start indexing on your Mac to enable visual searches such as saree or roses.';return;}
    $('photoSearchStatus').textContent='Searching '+indexed.length+' indexed photos…';
    try{const result=await this.api('photo-analysis',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'text',query})});if(this.account!==account||this.searchQuery!==query)return;this.semanticScores=confidentVisualScores(new Map(indexed.map(([id,index])=>[id,cosine(unpackEmbedding(index.embedding),result.embedding)])));this.render();$('photoSearchStatus').textContent='AI search · '+indexed.length+' of '+this.photos().length+' photos indexed. '+(this.semanticScores.size?'Stronger visual matches first; AI can still be wrong.':'No confident visual matches. Filename and text matches may still appear.')+' Unindexed photos are not searched visually.';}
    catch(error){if(this.account===account&&this.searchQuery===query)$('photoSearchStatus').textContent=error.message;}
  }
  autoIndexEnabled(){try{return localStorage.getItem('sai-auto-index')!=='off';}catch{return true;}}
  setAutoIndex(on){try{localStorage.setItem('sai-auto-index',on?'on':'off');}catch{}}
  ensureIndexing(){
    if(!this.account||document.visibilityState!=='visible')return;
    if(!this.autoIndexEnabled()||this.indexing||this.preparingIndex||this.scopeLoading||this.restoring||this.scanError)return;
    if(this.visualJob?.running)return;
    if(this.pendingIndexPhotos()<1)return;
    if(Date.now()-(this.lastIndexAttempt||0)<60000)return;
    this.lastIndexAttempt=Date.now();
    this.autoResuming=true;
    void this.autoResumeIndex().finally(()=>{this.autoResuming=false;});
  }
  pendingIndexPhotos(){if(!this.account)return 0;const photos=this.photos().filter(photo=>photo.mediaType!=='video');const current=(map,photo)=>map?.[photo.id]?.version===photo.version;return photos.filter(photo=>!(current(this.meta.visuals,photo)&&current(this.meta.indexes,photo)&&current(this.meta.checksums,photo))).length;}
  async autoResumeIndex(){
    try{
      if(!this.autoIndexEnabled()||!this.account||this.indexing||this.scopeLoading||this.preparingIndex||this.scanError||this.restoring)return false;
      if(this.pendingIndexPhotos()<1)return false;
      if(window.SAI_ANDROID){try{const battery=await this.api('device-battery');if(battery&&battery.low)return false;}catch{}}
      if(this.requireIndexReload){const {resetPhotoWorker}=await import('./photo-ai.mjs');resetPhotoWorker();this.requireIndexReload=false;}
      await this.beginIndexing();
      return true;
    }catch(error){return false;}
  }
  async beginIndexing(){
    if(!this.account||this.indexing||this.scopeLoading||this.preparingIndex)return;
    if(this.requireIndexReload){$('indexStatus').textContent='Face/OCR indexing stalled. Reload this page, then resume; saved photos are skipped.';return;}
    if(this.scanError){$('indexStatus').textContent='Indexing blocked: '+this.scanError;return;}
    const account=this.account;this.preparingIndex=true;$('indexPhotos').disabled=true;$('indexAllPhotos').disabled=true;
    $('indexStatus').textContent='Restoring saved pCloud indexes first. Unchanged, completed photos will be skipped…';
    try{
      if(!await this.sync()||this.account!==account){$('indexStatus').textContent='Indexing paused: saved pCloud records must finish syncing first. '+(this.cloudError||'Check your connection and try again.');return;}
      if(typeof window!=='undefined'&&window.SAI_ANDROID){
        if(!this.autoResuming)$('photoControls').open=true;
        const mode=$('indexMode')?.value||'visual';this.stop=false;
        if(mode==='faces'){await this.index();return;}
        if(!await this.startVisualIndex())return;
        if(mode==='all'){
          $('indexStatus').textContent='Step 1: AI search and duplicate analysis on Samsung. Faces/text run afterward to limit memory use.';
          while(this.account===account&&!this.stop){const job=await this.api('photo-analysis');if(!job.running){if(job.message||job.phase==='Stopped'||job.phase==='Paused'){throw new Error(job.message||'AI indexing paused. Saved results are retained.');}break;}await this.visualProgress();await new Promise(resolve=>setTimeout(resolve,2000));}
          if(!this.stop&&this.account===account&&await this.sync())await this.index();
        }
        return;
      }
      if(!await this.startVisualIndex())return;
      if(/iPhone|iPad|Android/i.test(navigator.userAgent)||navigator.maxTouchPoints>1){$('indexStatus').textContent='Visual AI runs on the Mac. For faces and English text, click this button in the Mac browser and keep it open.';return;}
      await this.index();
    }catch(error){$('indexStatus').textContent='Indexing paused: '+error.message;}finally{this.preparingIndex=false;this.sections();}
  }
  async startVisualIndex(attempt=0){if(!this.account||this.scopeLoading)return;try{const known=Object.entries(this.meta.visuals).filter(([id,index])=>index.model===VISUAL_MODEL&&!(this.data?.pending||[]).some(op=>op.type==='visual-index'&&op.photoId===id&&op.version===index.version)).map(([id,index])=>({id,version:index.version}));await this.api('photo-analysis',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'start',folderId:this.photoFolder()?.id||null,known,checksums:Object.entries(this.meta.checksums).map(([id,index])=>({id,version:index.version}))})});this.visualProgress();return true;}catch(error){if(attempt<1&&/previous indexing job is stopping/i.test(error.message)){$('visualIndexStatus').textContent='Waiting for the previous indexing job to stop…';await new Promise(resolve=>setTimeout(resolve,3000));return this.startVisualIndex(attempt+1);}$('visualIndexStatus').textContent=error.message;return false;}}
  async visualProgress(){
    if(!this.account)return;
    if(this.scopeLoading){$('visualIndexStatus').textContent='Scanning pCloud folders before indexing…';return;}
    if(this.scanError){$('visualIndexStatus').textContent='Indexing blocked: folder scan incomplete. Refresh to retry.';return;}
    try{
      const job=await this.api('photo-analysis');this.visualJob=job;this.visualStatusError='';
      if(job.running&&Date.now()-(this.lastSharedKnownAt||0)>15000){this.lastSharedKnownAt=Date.now();await this.api('photo-analysis',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'known',known:Object.entries(this.meta.visuals).filter(([id,index])=>index.model===VISUAL_MODEL&&!(this.data?.pending||[]).some(op=>op.type==='visual-index'&&op.photoId===id&&op.version===index.version)).map(([id,index])=>({id,version:index.version})),checksums:Object.entries(this.meta.checksums).map(([id,index])=>({id,version:index.version}))})});}
      if(job.message&&job.phase==='Stopped'){$('visualIndexStatus').textContent='Mac AI indexing stopped: '+job.message;return;}
      if(job.running&&!job.libraryTotal&&!job.total&&['Starting','Loading photo library','Loading pCloud library'].includes(job.phase)){$('visualIndexStatus').textContent='Mac AI index: '+job.phase+'…';return;}
      const total=job.libraryTotal??this.photos().length;
      if(job.phase&&!job.running&&total===0){$('visualIndexStatus').textContent='No supported photos found. Indexing not started.';return;}
      const already=job.alreadyIndexed??Math.max(0,total-(job.total||0));
      const phase=job.message&&!job.running&&job.phase==='Stopped'?'Stopped':job.phase&&!job.running&&job.total===0&&total>0?'Already completed':job.phase;
      $('visualIndexStatus').textContent=`AI search: ${sharedIndexLabel(this)} saved in pCloud · ${job.running?(phase||'Running'):phase||'Ready to resume'}${this.restoring?' · Restoring shared indexes…':''}${job.running?' · current job '+(job.completed||0)+' newly saved':''}${job.failed?' · '+job.failed+' failed; retry pending files':''}${job.message?' · '+job.message:''}`;
      if(job.running)$('stopIndex').hidden=false;
    }catch{this.visualStatusError='Cannot reach the indexing service.';$('visualIndexStatus').textContent='Cannot reach the Mac indexing service. Saved indexes are retained. Refresh to reconnect.';}
  }
  updateViewer() {
    if (!this.current) return;
    const favored = Boolean(this.meta.favorites[this.current.id]); (document.getElementById('viewerFavoriteGlyph')||$('viewerFavorite')).textContent = favored ? '♥' : '♡'; $('viewerFavorite').setAttribute('aria-pressed', String(favored)); $('viewerFavorite').setAttribute('aria-label', favored ? 'Remove from favorites' : 'Add to favorites'); const hiddenState=Boolean(this.meta.hidden[this.current.id]); const hideButton=$('viewerHide'); if(hideButton)hideButton.textContent=hiddenState?'Unhide':'Hide from library';
    const index = this.sequence.findIndex(photo => photo.id === this.current.id); $('photoPosition').textContent = `${index + 1} of ${this.sequence.length}`;
    $('previousImage').disabled = this.deleting || index <= 0; $('nextImage').disabled = this.deleting || index >= this.sequence.length - 1;
    $('deletePhoto').disabled = this.deleting; $('viewerFavorite').disabled = this.deleting; $('addToAlbum').disabled = this.deleting;
    $('addToAlbum').replaceChildren(new Option('Add to album…', ''));
    for (const [id, album] of Object.entries(this.meta.albums)) { const option = new Option(album.name + (album.members[this.current.id] ? ' ✓' : ''), id); option.disabled = Boolean(album.members[this.current.id]) || Boolean(album.smart); $('addToAlbum').append(option); }
    if (!$('viewerDetails').hidden) this.fillDetails();
  }
  fillDetails() {
    const item = this.current; if (!item) return;
    const img = $('original');
    const when = item.addedAt ? new Date(item.addedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Unavailable';
    const rows = [['Name', item.fileName], ['Size', formatSize(item.size)], ['Date', when], ['Dimensions', img && img.naturalWidth ? img.naturalWidth + ' × ' + img.naturalHeight : 'Loading…'], ['Folder', item.folderPath || item.folderName || 'Unavailable'], ['Type', item.mediaType === 'video' ? 'Video' : 'Photo']];
    $('viewerDetailsRows').replaceChildren();
    for (const [label, value] of rows) { const row = document.createElement('p'); row.className = 'viewer-detail-row'; const name = document.createElement('span'); name.textContent = label; const detail = document.createElement('span'); detail.textContent = value; row.append(name, detail); $('viewerDetailsRows').append(row); }
  }
  relative(delta) { if (this.deleting || $('deletePhotoDialog').open) return; const index = this.sequence?.findIndex(photo => photo.id === this.current?.id); const next = this.sequence?.[index + delta]; if (next) this.open(next, this.sequence); }
  setZoom(value) { this.zoomTo(value); }
  zoomTo(value, clientX, clientY) {
    const next = Math.max(1, Math.min(8, value)); const stage = $('imageStage'); const rect = stage.getBoundingClientRect();
    if (next <= 1.01) { this.panX = 0; this.panY = 0; }
    else if (clientX != null) {
      const fx = clientX - (rect.left + rect.width/2); const fy = clientY - (rect.top + rect.height/2); const factor = next / (this.zoom || 1);
      this.panX = fx - (fx - (this.panX || 0)) * factor; this.panY = fy - (fy - (this.panY || 0)) * factor;
    }
    this.zoom = Math.max(1, Math.min(8, next)); this.applyTransform();
  }
  applyTransform(instant) {
    const image = $('original'); const stage = $('imageStage'); if (!image || !image.naturalWidth) return;
    const rect = stage.getBoundingClientRect(); const baseW = image.offsetWidth || rect.width; const baseH = image.offsetHeight || rect.height;
    const maxX = Math.max(0, (baseW * this.zoom - rect.width) / 2); const maxY = Math.max(0, (baseH * this.zoom - rect.height) / 2);
    this.panX = Math.max(-maxX, Math.min(maxX, this.panX || 0)); this.panY = Math.max(-maxY, Math.min(maxY, this.panY || 0));
    if (this.zoom <= 1.01) { this.panX = 0; this.panY = 0; }
    image.style.transition = instant ? 'none' : 'transform .18s ease-out';
    image.style.transform = `translate3d(${this.panX}px, ${this.panY}px, 0) scale(${this.zoom})`;
  }
  async index() {
    if (this.indexing || !this.account || this.scopeLoading) return;
    const account = this.account; this.indexing = true; this.stop = false;
    $('indexPhotos').disabled = true; $('stopIndex').hidden = false;
    const pending = this.photos().filter(photo => photo.mediaType!=='video'&&this.meta.indexes[photo.id]?.version !== (photo.version || String(photo.addedAt)) && !this.data.pending.some(op=>op.type==='index'&&op.photoId===photo.id&&op.version===(photo.version||String(photo.addedAt))));
    const total=this.photos().filter(photo=>photo.mediaType!=='video').length;const already=total-pending.length;
    let completed = 0; let failed = 0; let received=0;let resetWorker=null;
    const resetEvery=(typeof window!=='undefined'&&window.SAI_ANDROID)?25:100;
    try {
      if(!pending.length){if(total===0){$('indexStatus').textContent='No supported photos found. Indexing not started.';return;}$('indexStatus').textContent=`Faces & text: Already completed · ${total.toLocaleString()} / ${total.toLocaleString()} photos. Unchanged photos skipped; no re-indexing needed.`;return;}
      const { analyzePhoto,resetPhotoWorker } = await import('./photo-ai.mjs');resetWorker=resetPhotoWorker;
      for (const photo of pending) {
        if (this.stop || this.account !== account) break;
        if (!this.photos().some(item => item.id === photo.id)) continue;
        if(this.meta.indexes[photo.id]?.version===(photo.version||String(photo.addedAt))){received++;continue;}
        $('indexStatus').textContent = `Faces & text: ${sharedIndexLabel(this,'faces')} · Indexing photo ${already + completed + failed + 1} · ${already} unchanged photos skipped. Keep this Mac tab open.`;
        let url;let stage='Loading preview';const stageStarted=Date.now();const showStage=()=>{$('indexStatus').textContent=`Faces & text: ${sharedIndexLabel(this,'faces')} saved · Photo ${already+completed+failed+1}: ${stage} · ${Math.floor((Date.now()-stageStarted)/1000)}s elapsed · ${already} unchanged photos skipped.`;};const heartbeat=setInterval(showStage,1000);showStage();
        let image;
        try {
          url = await withIndexDeadline(cachedImage(account, photo, 'preview'),45000,'Photo preview');image=new Image();image.src=url;stage='Decoding preview';await withIndexDeadline(image.decode(),15000,stage);
          stage='Analyzing faces and text';const index=await withIndexDeadline(analyzePhoto(image),90000,stage); if (this.stop || this.account !== account) break;
          if (!this.photos().some(item => item.id === photo.id)) continue;
          stage='Saving result to pCloud';const saved=await withIndexDeadline(this.change({ type: 'index', photoId: photo.id, version: photo.version || String(photo.addedAt), ...index }),120000,stage);if(saved) { if(!await withIndexDeadline(this.labelMatchedFaces(photo.id),120000,'Saving person assignments')) {this.stop=true;break;} } if(!saved){$('indexStatus').textContent='Index paused: pCloud save is pending. Automatic sync will retry.';this.stop=true;break;}completed++;
        } catch(error) {failed++;if(error.name==='IndexTimeout'){this.stop=true;this.requireIndexReload=true;this.indexPauseReason=error.message;if(resetWorker)resetWorker();}} finally {clearInterval(heartbeat);if (url) URL.revokeObjectURL(url);if(image){image.src='';} }
        if(resetWorker&&completed>0&&completed%resetEvery===0)resetWorker();
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      if (this.account === account) $('indexStatus').textContent = `Faces & text: ${this.stop ? 'Paused' : 'Finished'} · ${sharedIndexLabel(this,'faces')} · ${already} unchanged photos skipped · ${received} received from other devices · ${completed} newly indexed${failed ? ` · ${failed} failed; run again to retry` : ''}. Saved results are reused next time.${this.indexPauseReason?' '+this.indexPauseReason+' Reload to resume.':''}`;
    } finally { this.indexing = false; $('stopIndex').hidden = true; $('indexPhotos').disabled = !this.account; if(resetWorker){try{resetWorker();}catch{}} this.render(); }
  }
}
