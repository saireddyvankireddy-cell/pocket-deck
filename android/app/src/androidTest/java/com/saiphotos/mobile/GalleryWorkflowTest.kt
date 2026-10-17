package com.saiphotos.mobile
import android.content.Intent
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.Assert.*
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
class GalleryWorkflowTest {
 @Test fun selectedPhotosEnableBulkAlbumAndPreserveCloudMembership(){
  val inst=InstrumentationRegistry.getInstrumentation();val activity=inst.startActivitySync(Intent(inst.targetContext,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK));lateinit var web:WebView
  fun eval(s:String):String{val latch=CountDownLatch(1);var r="";inst.runOnMainSync{web=activity.findViewById<android.view.ViewGroup>(android.R.id.content).getChildAt(0) as WebView;web.evaluateJavascript(s){r=it;latch.countDown()}};assertTrue(latch.await(5,TimeUnit.SECONDS));return r}
  try{for(i in 0..50){if(eval("document.readyState").contains("complete"))break;Thread.sleep(100)}
   eval("""
    window.fixtureDeletes=0;window.fixtureOps=[{id:'00000000-0000-4000-8000-000000000001',at:1,type:'album',albumId:'00000000-0000-4000-8000-000000000002',name:'Family'}];
    const oldFetch=window.fetch;window.fetch=async(input,options={})=>{const path=typeof input==='string'?input:input.url;if(!path.includes('/.netlify/functions/'))return oldFetch(input,options);let data={};if(path.includes('photo-delete')||path.includes('photos-delete')){fixtureDeletes++;throw new Error('Unexpected original deletion');}if(path.includes('pcloud-auth'))data={connected:true,accountId:'ui-smoke-account',tokenConfigured:true,configured:false};else if(path.includes('media-list'))data={items:[1,2,3].map(i=>({id:'pc-'+i,fileName:'test-'+i+'.jpg',name:'test-'+i,size:2000,addedAt:1700000000000,version:'unchanged',folderPath:'/Test'})),scan:{totalFiles:3,otherFiles:0,missingPaths:[],unavailableFolders:[],complete:true}};else if(path.includes('photo-metadata')){if(path.includes('write')){const op=JSON.parse(options.body).operation;fixtureOps.push(op);data={operation:op};}else data={operations:fixtureOps,more:false};}else if(path.includes('media-content'))return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>',{headers:{'Content-Type':'image/svg+xml'}});return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});};
    document.getElementById('navPhotos').click();document.getElementById('connectToken').click();document.getElementById('pcloudToken').value='test-only-not-a-real-token';document.getElementById('submitToken').click();
   """)
   for(i in 0..70){if(eval("document.querySelectorAll('#photoGrid [data-photo-id]').length")=="3")break;Thread.sleep(100)}
   assertEquals("Mock library must load","3",eval("document.querySelectorAll('#photoGrid [data-photo-id]').length"))
   assertEquals("Navigation labels must remain visible and accessible","true",eval("[['Library','Library'],['Albums','Albums'],['Music','Music'],['Search','Search']].every(([aria,text])=>[...document.querySelectorAll('#photoNavigation button:not([hidden])')].some(b=>b.getAttribute('aria-label')===aria&&b.textContent===text&&getComputedStyle(b.querySelector('span')).display!=='none'))"))
   assertEquals("Bottom bar shows exactly four tabs, no heart tab and no AI tab","true",eval("[...document.querySelectorAll('#photoNavigation button')].filter(b=>!b.hidden).length===4&&!document.getElementById('navFavorites')&&!document.getElementById('navAi')"))
   assertEquals("Microphone sits in the search bar","true",eval("document.querySelector('.tools').contains(document.getElementById('aiAskMic'))"))
   assertEquals("Now-playing card lives inside the Music tab","true",eval("document.getElementById('musicPanel').contains(document.getElementById('miniPlayer'))&&getComputedStyle(document.getElementById('miniPlayer')).position!=='fixed'"))
   assertEquals("Greetings answer inside the Search view","true",eval("(()=>{const input=document.getElementById('search');input.value='hi';input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));return true})()"))
   for(i in 0..40){if(eval("(document.querySelector('#aiChatLog .ai-bubble.assistant:last-of-type p')?.textContent||'').startsWith('Hi')")=="true")break;Thread.sleep(100)}
   assertEquals("Greeting reply starts with a friendly hello","true",eval("(document.querySelector('#aiChatLog .ai-bubble.assistant:last-of-type p')?.textContent||'').startsWith('Hi')"))
   assertEquals("Greeting answers render inside the Search view","true",eval("!document.getElementById('aiSearchExtras').hidden"))
   eval("document.getElementById('navSearch').click();")
   assertEquals("Search navigation opens discovery","Search",eval("document.getElementById('galleryPageTitle').textContent").trim('"'))
   eval("document.getElementById('navPhotos').click();")
   val preview=inst.uiAutomation.takeScreenshot()
   java.io.File(inst.targetContext.filesDir,"gallery-v1.11.0.png").outputStream().use{preview.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)};preview.recycle()
   eval("document.getElementById('selectPhotos').click();document.getElementById('selectLoadedPhotos').click();")
   assertEquals("Bulk album must enable immediately after selecting photos","false",eval("document.getElementById('bulkAddToAlbum').disabled"))
   eval("document.getElementById('bulkAddToAlbum').click();[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='Add selected').click();")
   for(i in 0..70){if(eval("fixtureOps.filter(o=>o.type==='membership'&&o.value).length")=="3")break;Thread.sleep(100)}
   assertEquals("All selected photos must save memberships","3",eval("fixtureOps.filter(o=>o.type==='membership'&&o.value).length"))
   assertEquals("Each membership uses the chosen album","true",eval("fixtureOps.filter(o=>o.type==='membership').every(o=>o.albumId==='00000000-0000-4000-8000-000000000002')"))
   eval("document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.getElementById('navAlbums').click();")
   assertEquals("Three album cards fit in one row","3",eval("String(getComputedStyle(document.getElementById('collectionCards')).gridTemplateColumns.split(' ').length)").trim('"'))
   assertEquals("Album cards keep no Hide or Delete buttons","true",eval("[...document.querySelectorAll('#collectionCards button')].every(b=>!['Hide','Delete'].includes(b.textContent.trim()))"))
   eval("document.querySelector('#collectionCards .collection-card').click();")
   assertEquals("Opened album offers Hide and Delete","true",eval("['Hide album','Delete album'].every(t=>[...document.querySelectorAll('button')].some(b=>b.textContent===t&&!b.hidden))"))
   eval("[...document.querySelectorAll('button')].find(b=>b.textContent==='Delete album').click();[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='Delete album').click();")
   for(i in 0..70){if(eval("fixtureOps.some(o=>o.type==='album-delete')")=="true")break;Thread.sleep(100)}
   assertEquals("Album deletion must save a shared tombstone","true",eval("fixtureOps.some(o=>o.type==='album-delete')"))
   assertEquals("Album deletion must never call original-file deletion","0",eval("fixtureDeletes"))
   eval("document.querySelectorAll('dialog[open]').forEach(d=>d.close());document.getElementById('navPhotos').click();")
   assertEquals("All originals remain visible after deleting album","3",eval("document.querySelectorAll('#photoGrid [data-photo-id]').length"))
  }finally{inst.runOnMainSync{activity.finish()}}
 }
}
