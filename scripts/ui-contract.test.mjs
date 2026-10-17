import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('..',import.meta.url);
const read=file=>readFileSync(new URL(file,root),'utf8');

test('bottom bar is Library, Albums, Music, Search and AI — no Favorites tab',()=>{
  const smart=read('smart-features.mjs');
  assert.ok(!smart.includes("favorites.id='navFavorites'"),'smart-features must not create the Favorites tab');
  assert.ok(!smart.includes("['navFavorites'"),'no navFavorites references may remain');
  const app=read('app.js');
  assert.ok(app.includes("nav.insertBefore(music,$('navSearch'))"),'Music tab must sit between Albums and Search');
  assert.ok(!app.includes("nav.insertBefore(music,$('navFavorites'))"),'Music tab must not reference the removed Favorites tab');
});

test('AI ask bar sits at the top of the AI screen',()=>{
  const html=read('index.html');
  const form=html.indexOf('id="aiAskForm"');
  const head=html.indexOf('class="ai-head"');
  const log=html.indexOf('id="aiChatLog"');
  assert.ok(form>0&&head>form&&log>form,'ask form must come before the header and the chat log');
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
  assert.ok(html.includes('id="aiAskMic"'),'ask bar must include the microphone button');
  const form=html.indexOf('id="aiAskForm"');
  const mic=html.indexOf('id="aiAskMic"');
  const send=html.indexOf('id="aiAskSend"');
  assert.ok(form>0&&mic>form&&send>mic,'mic button must sit inside the ask form before Ask');
  const app=read('app.js');
  assert.ok(app.includes("api('device-speech'"),'app must call the device-speech bridge');
  const manifest=read('android/app/src/main/AndroidManifest.xml');
  assert.ok(manifest.includes('android.permission.RECORD_AUDIO'),'RECORD_AUDIO permission must be declared');
  const activity=read('android/app/src/main/java/com/saiphotos/mobile/MainActivity.kt');
  assert.ok(activity.includes('/.netlify/functions/device-speech'),'MainActivity must serve device-speech');
  assert.ok(activity.includes('SpeechRecognizer.createSpeechRecognizer'),'MainActivity must create a SpeechRecognizer');
});

test('AI header stays a single short line',()=>{
  const html=read('index.html');
  const head=html.slice(html.indexOf('class="ai-head"'),html.indexOf('id="aiToolbar"')>0?html.indexOf('id="aiToolbar"'):undefined);
  const text=head.match(/<p class="settings-muted">([^<]+)<\/p>/);
  assert.ok(text,'ai-head must keep one description line');
  
  assert.ok(text[1].length<=60,'description must stay short enough to fit one line');
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
