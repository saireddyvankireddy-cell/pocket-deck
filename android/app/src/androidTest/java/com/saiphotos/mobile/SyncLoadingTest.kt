package com.saiphotos.mobile
import android.content.Intent
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.Assert.*
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
class SyncLoadingTest {
 @Test fun galleryLoadsWhileCloudSyncIsStalledAndSurvivesFailure(){
  val inst=InstrumentationRegistry.getInstrumentation();val activity=inst.startActivitySync(Intent(inst.targetContext,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK));lateinit var web:WebView
  fun eval(s:String):String{val latch=CountDownLatch(1);var r="";inst.runOnMainSync{web=activity.findViewById<android.view.ViewGroup>(android.R.id.content).getChildAt(0) as WebView;web.evaluateJavascript(s){r=it;latch.countDown()}};assertTrue(latch.await(5,TimeUnit.SECONDS));return r}
  try{for(i in 0..50){if(eval("document.readyState").contains("complete"))break;Thread.sleep(100)}
   eval("""
    window.fixtureOps=[{id:'00000000-0000-4000-8000-000000000001',at:1,type:'album',albumId:'00000000-0000-4000-8000-000000000002',name:'Family'}];
    const oldFetch=window.fetch;window.fetch=async(input,options={})=>{const path=typeof input==='string'?input:input.url;if(!path.includes('/.netlify/functions/'))return oldFetch(input,options);let data={};if(path.includes('pcloud-auth'))data={connected:true,accountId:'sync-recovery-fixture',tokenConfigured:true,configured:false};else if(path.includes('media-list'))data={items:[1,2,3].map(i=>({id:'pc-'+i,fileName:'test-'+i+'.jpg',name:'test-'+i,size:2000,addedAt:1700000000000,version:'unchanged',folderPath:'/Test'})),scan:{totalFiles:3,otherFiles:0,missingPaths:[],unavailableFolders:[],complete:true}};else if(path.includes('photo-metadata')){await new Promise((resolve,reject)=>{window.rejectFixtureSync=()=>reject(new Error('Fixture pCloud sync failed'));});if(path.includes('write')){const op=JSON.parse(options.body).operation;fixtureOps.push(op);data={operation:op};}else data={operations:fixtureOps,more:false};}else if(path.includes('media-content'))return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>',{headers:{'Content-Type':'image/svg+xml'}});return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});};
    document.getElementById('navPhotos').click();document.getElementById('connectToken').click();document.getElementById('pcloudToken').value='test-only-not-a-real-token';document.getElementById('submitToken').click();
   """)
   for(i in 0..70){if(eval("document.querySelectorAll('#photoGrid [data-photo-id]').length")=="3")break;Thread.sleep(100)}
   assertEquals("Mock library must load","3",eval("document.querySelectorAll('#photoGrid [data-photo-id]').length"))
   for(i in 0..70){if(eval("[...document.querySelectorAll('#photoGrid img')].filter(i=>i.naturalWidth>0).length")=="3")break;Thread.sleep(100)}
   assertEquals("Thumbnails must decode, not just create empty cards","3",eval("[...document.querySelectorAll('#photoGrid img')].filter(i=>i.naturalWidth>0).length"))
   assertEquals("Sync must remain in progress while photos are visible","true",eval("document.getElementById('cloudSyncBadge').textContent==='Syncing…'"))
   eval("window.rejectFixtureSync();")
   for(i in 0..50){if(eval("document.getElementById('cloudSyncBadge').textContent").contains("Sync issue"))break;Thread.sleep(100)}
   assertEquals("Cloud failure is visible","true",eval("document.getElementById('cloudSyncBadge').textContent==='Sync issue'"))
   assertEquals("Sync failure must not empty the gallery","3",eval("document.querySelectorAll('#photoGrid [data-photo-id]').length"))
   eval("const workingFetch=window.fetch;window.fetch=async(input,options)=>{const path=typeof input==='string'?input:input.url;if(path.includes('media-list'))throw new Error('Fixture folder refresh failed');return workingFetch(input,options);};document.getElementById('refresh').click();")
   for(i in 0..70){if(eval("document.getElementById('refresh').disabled")=="false")break;Thread.sleep(100)}
   assertEquals("A failed refresh preserves already visible photos","3",eval("document.querySelectorAll('#photoGrid [data-photo-id]').length"))
   assertEquals("The failed scan reports its reason","true",eval("document.getElementById('photoFolderSummary').textContent.includes('Fixture folder refresh failed')"))

  }finally{inst.runOnMainSync{activity.finish()}}
 }
}
