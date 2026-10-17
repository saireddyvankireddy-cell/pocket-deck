package com.saiphotos.mobile
import android.content.Intent
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.Assert.*
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
class MusicWorkflowTest {
 private fun eval(inst:android.app.Instrumentation,activity:android.app.Activity,script:String):String{val latch=CountDownLatch(1);var result="";inst.runOnMainSync{val web=activity.findViewById<android.view.ViewGroup>(android.R.id.content).getChildAt(0) as WebView;web.evaluateJavascript(script){result=it;latch.countDown()}};assertTrue(latch.await(10,TimeUnit.SECONDS));return result}
 @Test fun musicIsBackWithSuggestionsAndAllLibraryViews(){
  val inst=InstrumentationRegistry.getInstrumentation();val activity=inst.startActivitySync(Intent(inst.targetContext,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
  try{
   var ready=""
   for(i in 0..60){ready=eval(inst,activity,"(document.readyState==='complete'&&window.SAI_MUSIC_ENABLED===true&&document.body.classList.contains('music-enabled')?'shell:ok':'shell:missing')");if(ready.contains("shell:ok"))break;Thread.sleep(200)}
   assertTrue("Bundled UI must load: $ready",ready.contains("shell:ok"))
   assertEquals("Music is enabled on the phone build","true",eval(inst,activity,"window.SAI_MUSIC_ENABLED===true&&document.body.classList.contains('music-enabled')"))
   assertEquals("Music button exists in the bottom navigation","true",eval(inst,activity,"Boolean(document.getElementById('navMusic'))"))
   eval(inst,activity,"document.getElementById('navMusic').click()")
   for(i in 0..50){if(eval(inst,activity,"!document.getElementById('musicPanel').hidden")=="true")break;Thread.sleep(100)}
   assertEquals("Music panel opens with every library view","true",eval(inst,activity,"!document.getElementById('musicPanel').hidden&&document.getElementById('photosPanel').hidden&&['allMusic','forYouMusic','mostPlayedMusic','likedMusic','recentMusic','downloadedMusic','playlistMusic'].every(id=>document.getElementById(id))"))
   assertEquals("Search switches to song search","\"Search songs\"",eval(inst,activity,"document.getElementById('search').placeholder"))
   assertEquals("Suggestions open the Music tab","true",eval(inst,activity,"document.getElementById('forYouMusic').getAttribute('aria-pressed')==='true'||document.getElementById('forYouMusic').classList.contains('active')"))
   eval(inst,activity,"document.getElementById('navPhotos').click()")
   for(i in 0..50){if(eval(inst,activity,"!document.getElementById('photosPanel').hidden")=="true")break;Thread.sleep(100)}
   assertEquals("Photos remain one tap away","true",eval(inst,activity,"!document.getElementById('photosPanel').hidden&&document.getElementById('musicPanel').hidden"))
  }finally{inst.runOnMainSync{activity.finish()}}
 }
}
