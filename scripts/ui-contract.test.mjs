import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('..',import.meta.url);
const read=file=>readFileSync(new URL(file,root),'utf8');

test('bottom bar is Library, Albums, Music, Search — no Favorites and no AI tab',()=>{
  const smart=read('smart-features.mjs');
  assert.ok(!smart.includes("favorites.id='navFavorites'"),'smart-features must not create the Favorites tab');
  assert.ok(!smart.includes("['navFavorites'"),'no navFavorites references may remain');
  const app=read('app.js');
  assert.ok(app.includes("nav.insertBefore(music,$('navSearch'))"),'Music tab must sit between Albums and Search');
  assert.ok(!app.includes("nav.insertBefore(music,$('navFavorites'))"),'Music tab must not reference the removed Favorites tab');
  assert.ok(!app.includes('navAi'),'the AI tab must be removed from app.js');
  assert.ok(!app.includes("setTab('ai')"),'no code may switch to a removed AI tab');
});

test('the assistant lives inside the Search view, not a separate screen',()=>{
  const html=read('index.html');
  assert.ok(!html.includes('id="aiPanel"'),'the standalone AI panel must be gone');
  const panel=html.indexOf('<section id="photosPanel"');
  const extras=html.indexOf('id="aiSearchExtras"');
  const toolbar=html.indexOf('id="galleryToolbar"');
  assert.ok(panel>0&&extras>panel&&toolbar>extras,'chat answers must live inside the photo panel before the results toolbar');
  const tools=html.indexOf('class="tools"');
  const mic=html.indexOf('id="aiAskMic"');
  assert.ok(tools>0&&mic>tools,'the mic button must live inside the tools row beside search');
  assert.ok(!html.includes('id="aiAskForm"')&&!html.includes('id="aiAskInput"'),'the old separate ask form must be gone');
  const app=read('app.js');
  assert.ok(app.includes("addEventListener('keydown'"),'pressing Enter in the search bar must ask the assistant');
  assert.ok(app.includes('renderSearchExtras'),'the search view must render people and music extras');
});

test('now-playing card lives inside the Music tab and is not fixed to the screen top',()=>{
  const html=read('index.html');
  const panel=html.indexOf('<section id="musicPanel"');
  const mini=html.indexOf('id="miniPlayer"');
  assert.ok(panel>0&&mini>panel,'mini player must be inside the music panel section');
  assert.ok(!html.includes('</main><div id="miniPlayer"'),'mini player must not float after the main content');
  const css=read('styles.css');
  assert.ok(!css.includes('.mini-player{position:fixed'),'mini player must not be fixed to the viewport');
});

test('now-playing card matches the dark Spotify-style music panel',()=>{
  const css=read('styles.css');
  assert.ok(css.includes('.mini-player{position:relative;display:flex;align-items:center;gap:10px;margin:10px 0 14px;padding:10px 12px 16px;border-radius:18px;background:#15231c'),'card must use the dark panel surface');
  assert.ok(css.includes('#miniPlay{background:#32c676'),'play button must use the panel green');
  assert.ok(css.includes('.mini-progress i{display:block;height:100%;width:0;background:#32c676'),'progress fill must use the panel green');
});

test('Outfit is the app font everywhere',()=>{
  const css=read('styles.css');
  assert.ok(css.includes("body{font-family:'Outfit Variable'"),'body font must lead with Outfit');
  assert.ok(css.includes('.photos-only{font-family:"Outfit Variable"'),'photos-only font must lead with Outfit');
  assert.ok(!css.includes("body{font-family:'Inter Variable'"),'Inter must not lead the body stack');
});

test('typography stays light (no heavy weights)',()=>{
  const css=read('styles.css');
  assert.ok(css.includes('h1,h2,h3,h4,h5,b,strong,summary{font-weight:600}'),'headings must cap at 600');
  assert.ok(css.includes('button,.primary,.nav-label'),'buttons must use the lighter weight rule');
});

test('app version strings agree across settings, package and release notes',()=>{
  const settings=read('settings.mjs');
  const appVersion=settings.match(/export const APP_VERSION = '([^']+)'/)[1];
  const releaseVersion=settings.match(/RELEASES = \[\s*\{version:'([^']+)'/)[1];
  const pkg=JSON.parse(read('package.json'));
  assert.equal(appVersion,pkg.version,'settings APP_VERSION must match package.json');
  assert.equal(releaseVersion,appVersion,'newest release notes version must match APP_VERSION');
});

test('AI ask bar offers voice input with a native speech bridge',()=>{
  const html=read('index.html');
  const tools=html.indexOf('class="tools"');
  const mic=html.indexOf('id="aiAskMic"');
  assert.ok(tools>0&&mic>tools,'the microphone button must sit in the search tools row');
  const app=read('app.js');
  assert.ok(app.includes("api('device-speech'"),'app must call the device-speech bridge');
  assert.ok(app.includes("openSearchView();const placeholder=input.placeholder"),'voice input must open the search view before listening');
  const manifest=read('android/app/src/main/AndroidManifest.xml');
  assert.ok(manifest.includes('android.permission.RECORD_AUDIO'),'RECORD_AUDIO permission must be declared');
  const activity=read('android/app/src/main/java/com/saiphotos/mobile/MainActivity.kt');
  assert.ok(activity.includes('/.netlify/functions/device-speech'),'MainActivity must serve device-speech');
  assert.ok(activity.includes('SpeechRecognizer.createSpeechRecognizer'),'MainActivity must create a SpeechRecognizer');
});

test('search covers people names, AI index results and music with liked and recent songs',()=>{
  const app=read('app.js');
  assert.ok(app.includes("addSection('People')"),'search must surface matching people names');
  assert.ok(app.includes("'Liked songs'")&&app.includes("'Recently played'"),'empty search must show liked and recently played songs');
  assert.ok(app.includes('musicLikes')&&app.includes('musicHistory'),'music search must use liked songs and play history');
  assert.ok(app.includes("'Music · song name matches'"),'search must match songs by name');
  const library=read('photo-library.mjs');
  assert.ok(library.includes('${people} ${albums}'),'photo search must keep matching indexed text, people names and albums');
  assert.ok(library.includes("photoSearchStatus').textContent='AI search · '"),'AI index search must report how many photos were searched');
});

test('album cards are compact — hide and delete live inside the opened album',()=>{
  const library=read('photo-library.mjs');
  assert.ok(!library.includes("hide.setAttribute('aria-label','Hide album '"),'album cards must not carry a Hide button');
  assert.ok(!library.includes("remove.setAttribute('aria-label','Delete album '"),'album cards must not carry a Delete button');
  const smart=read('smart-features.mjs');
  assert.ok(smart.includes("make('button','','Hide album')"),'the opened album must offer Hide album');
  assert.ok(smart.includes('library.setAlbumHidden(library.focus,true)'),'Hide album must hide the open album');
  const css=read('styles.css');
  assert.ok(css.includes('.photos-only .collection-cards{gap:10px;grid-template-columns:repeat(3,minmax(0,1fr))}'),'three album cards must fit per row');
});

test('the photo library looks like Apple Photos — photos first, controls in Settings',()=>{
  const app=read('app.js');
  assert.ok(!app.includes('if(!window.SAI_PHOTOS_ONLY){const controls='),'library controls must move into Settings on every build, not only the web app');
  assert.ok(app.includes("const controls=$('photoControlContent');for(const element of [$('choosePhotoFolder').closest('.music-folder'),$('photoFolderSummary'),$('indexModeWrap'),$('indexPhotos').closest('.photo-actions'),$('indexStatus'),$('visualIndexStatus')])if(element)controls.append(element);"),'the folder card, indexing actions and status lines belong in Settings');
  assert.ok(app.includes("$('aiAskMic').hidden=state.tab!=='photo'||$('search').hidden||"),'the microphone must only appear beside the visible search bar');
  const smart=read('smart-features.mjs');
  assert.ok(smart.includes("$('search').hidden=tab!=='search'&&!query;const mic=$('aiAskMic');if(mic)mic.hidden=mic.dataset.unavailable==='true'||$('search').hidden;"),'the home tab keeps a clean photo grid with no stray microphone');
  const css=read('styles.css');
  assert.ok(css.includes('#indexStatus:empty,#visualIndexStatus:empty,#sharedIndexStatus:empty,#photoSearchStatus:empty,#photoSync:empty,.music-folder:has(.photo-folder-hint:only-child:empty){display:none}'),'empty status lines and empty folder cards must not take space on the photo grid');
});

test('opening views starts at the top of the right page',()=>{
  const library=read('photo-library.mjs');
  assert.ok(library.includes("$('backCollections').onclick = () => { this.focus = null; this.render(); window.scrollTo({top:0,behavior:'smooth'}); };"),'Back from an album must scroll to the top');
  assert.ok(library.includes('this.focus = collection.id; this.render(); window.scrollTo({ top: 0, behavior: \'smooth\' });'),'opening an album must scroll to the top');
  const smart=read('smart-features.mjs');
  assert.ok(smart.includes("library.render();window.scrollTo({top:0,behavior:'smooth'});return true;}"),'hardware back must scroll to the top');
});

test('suggested albums show four at a time and refill after a click',()=>{
  const app=read('app.js');
  assert.ok(app.includes('.filter(suggestion=>!dismissed.includes(suggestion.query)).slice(0,4)'),'suggestions must be capped at four');
  const smart=read('smart-features.mjs');
  assert.ok(smart.includes("add('Recap · '+year,'year:'+year"),'year recaps must keep the pool refilling');
  assert.ok(smart.includes("'favorites year:'+topFavouriteYear[0]"),'yearly favourites must keep the pool refilling');
});

test('greetings and everyday questions get real answers',()=>{
  const assistant=read('assistant.mjs');
  assert.ok(assistant.includes("greeting ? 'greeting'"),'greeting intent must be classified');
  assert.ok(assistant.includes("intent.kind === 'greeting'"),'greeting must have its own reply');
  assert.ok(assistant.includes("intent.kind === 'general'"),'general questions must have a fallback reply');
  const app=read('app.js');
  assert.ok(app.includes("intent.kind==='general'&&cloudReady()"),'general questions must use the cloud model when ready');
  assert.ok(app.includes("const userContent=general?(intent.raw||intent.terms.join(' ')):factsDigest"),'general questions must send the raw question');
});

test('indexing no longer jumps away or stalls on deleted files',()=>{
  const library=read('photo-library.mjs');
  assert.ok(!library.includes("if(!this.autoResuming)$('settingsDialog').close()"),'starting an index must not close Settings');
  assert.ok(library.includes("/previous indexing job is stopping/i"),'a stopping previous job must be retried, not shown as an error');
  const analysis=read('netlify/functions/photo-analysis.mjs');
  assert.ok(analysis.includes('[2002,2003,2005,2055].includes(error.result)'),'deleted pCloud files must be skipped, not failed forever');
  assert.ok(analysis.includes('loadPhoto(photo,false)'),'preview fetches must retry once before failing');
});

test('merged people names show clear feedback and suggest existing names',()=>{
  const library=read('photo-library.mjs');
  assert.ok(library.includes("'sai-toast'"),'merging a name must raise a toast');
  assert.ok(library.includes("id('nameSuggestions')")||library.includes("$('nameSuggestions')"),'person naming must suggest existing names');
  const html=read('index.html');
  assert.ok(html.includes('id="nameSuggestions"'),'datalist for existing names must exist');
});

test('pCloud is the only photo source — switcher and device browser are gone',()=>{
  const html=read('index.html');
  assert.ok(!html.includes('id="photoSources"'),'the source switcher must be removed');
  assert.ok(!html.includes('id="sourceDevice"')&&!html.includes('id="sourcePcloud"'),'source buttons must be removed');
  assert.ok(!html.includes('id="devicePanel"')&&!html.includes('id="deviceViewer"')&&!html.includes('id="deviceDeleteDialog"'),'the device photo browser must be removed');
  const tools=html.indexOf('class="tools"');
  const pill=html.indexOf('id="aiStatusPill"');
  assert.ok(tools>0&&pill>tools,'the AI status pill must live inside the tools row');
  const app=read('app.js');
  assert.ok(!app.includes('device-photos.mjs'),'app must not import the device source module');
  assert.ok(!app.includes('switchSource')&&!app.includes('device-source'),'source switching must be removed');
  const sw=read('sw.js');
  assert.ok(!sw.includes('device-photos.mjs'),'the service worker must not cache a removed module');
  const build=read('scripts/build.mjs');
  assert.ok(!build.includes('device-photos.mjs'),'the build assets must not include a removed module');
});

test('the Mac indexing agent has a claim page, launch script and cookie-file support',()=>{
  const claim=read('netlify/functions/mac-index-claim.mjs');
  assert.ok(claim.includes("'localhost', '127.0.0.1', '::1'"),'claim page must only work from the Mac itself');
  assert.ok(claim.includes('.sai-index-session'),'claim page must save the session for the agent');
  const dev=read('scripts/dev.mjs');
  assert.ok(dev.includes("'mac-index-claim'"),'the dev server must allow the claim endpoint');
  const index=read('scripts/mac-index.mjs');
  assert.ok(index.includes('SAI_SESSION_COOKIE_FILE'),'mac indexer must read the claimed session file');
  const launch=read('scripts/mac-index-launch.sh');
  assert.ok(launch.includes('.sai-index-session'),'the launch wrapper must wait for the claimed session');
});

test('one unreadable photo never stops Samsung indexing again',()=>{
  const ai=read('android/app/src/main/java/com/saiphotos/mobile/LocalAI.kt');
  assert.ok(!ai.includes('catch(e:CloudError){job.failed++;throw e}'),'a CloudError on one photo must not abort the whole pass');
  assert.ok(ai.includes('if(e.status==401){job.stop=true;throw e}'),'only an expired sign-in may stop indexing');
  assert.ok(ai.includes('indexing continues and retries it later'),'skipped photos must be reported as retried later');
  assert.ok(ai.includes('indexing resumes by itself'),'the low-battery pause must promise automatic resume');
});

test('the dev server serves every service-worker asset',()=>{
  const sw=read('sw.js');
  const block=(sw.match(/const ASSETS = \[(.*?)\];/s)||[])[1]||'';
  const names=[...block.matchAll(/'\.\/([^']*)'/g)].map(m=>m[1]).filter(name=>name&&!name.startsWith('vendor/'));
  const dev=read('scripts/dev.mjs');
  const missing=names.filter(name=>!dev.includes("'"+name+"'"));
  assert.deepEqual(missing,[],'dev.mjs must list every sw.js asset: '+missing.join(', '));
});

test('completed pCloud indexes are skipped when folders change or return',()=>{
  const library=read('photo-library.mjs');
  assert.ok(library.includes('Unchanged, completed photos will be skipped'),'indexing must announce that saved indexes are restored and skipped');
  assert.ok(library.includes('saved pCloud indexes'),'folder switching must keep saved indexes');
  const start=library.slice(library.indexOf('async startVisualIndex'));
  assert.ok(start.includes('this.meta.visuals')&&start.includes('known'),'the index job must send every saved visual index as known so completed photos are skipped');
  assert.ok(library.includes('meta.visuals'),'visual indexes must persist per photo across folder changes');
});
