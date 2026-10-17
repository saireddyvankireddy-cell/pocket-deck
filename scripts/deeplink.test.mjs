import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('..',import.meta.url);
const read=file=>readFileSync(new URL(file,root),'utf8');

test('Sai Photos exposes a saiphotos:// deep-link API for assistants',()=>{
  const manifest=read('android/app/src/main/AndroidManifest.xml');
  assert.ok(manifest.includes('android:scheme="saiphotos"'),'the manifest must register the saiphotos scheme');
  assert.ok(manifest.includes('android:host="open"'),'the manifest must register the open host');
  const activity=read('android/app/src/main/java/com/saiphotos/mobile/MainActivity.kt');
  assert.ok(activity.includes('fun handleDeepLink'),'MainActivity must parse incoming deep links');
  assert.ok(activity.includes('window.saiDeepLink'),'MainActivity must forward deep links to the web layer');
  assert.ok(activity.includes('handleDeepLink(intent.data)'),'onCreate must handle a launch deep link');
  assert.ok(activity.includes('handleDeepLink(newIntent.data)'),'onNewIntent must handle a re-launch deep link');
});

test('the deep-link handler understands views, albums, people, photos and search',()=>{
  const app=read('app.js');
  assert.ok(app.includes('window.saiDeepLink='),'app.js must define window.saiDeepLink');
  for(const key of ['link.view','link.album','link.person','link.photo','link.q']){
    assert.ok(app.includes(key),'the handler must read '+key);
  }
  assert.ok(app.includes("enteGallery.navigate('search')"),'search links must open the search view');
  assert.ok(app.includes('photoLibrary.open(item,[item])'),'photo links must open the viewer');
});

test('deep links arriving before the page loads are queued, not dropped',()=>{
  const activity=read('android/app/src/main/java/com/saiphotos/mobile/MainActivity.kt');
  assert.ok(activity.includes('pendingDeepLink'),'pre-load deep links must be queued');
  assert.ok(activity.includes('pageReady=true'),'onPageFinished must mark the page ready');
  assert.ok(activity.includes('pendingDeepLink?.let'),'the queued link must be dispatched once the page is ready');
});
