package com.saiphotos.mobile
import android.content.Intent
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.Assert.*
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
class PhotosNavigationTest {
 @Test fun photoAndMusicNavigationAndIndexChoicesLoad(){
  val inst=InstrumentationRegistry.getInstrumentation();val activity=inst.startActivitySync(Intent(inst.targetContext,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
  try{var result=""
   for(i in 0..50){val ready=CountDownLatch(1);inst.runOnMainSync{val web=activity.findViewById<android.view.ViewGroup>(android.R.id.content).getChildAt(0) as WebView;web.evaluateJavascript("JSON.stringify({only:window.SAI_PHOTOS_ONLY,musicEnabled:window.SAI_MUSIC_ENABLED,musicButton:!!document.getElementById('navMusic'),nav:!document.getElementById('photoNavigation')?.hidden,music:getComputedStyle(document.querySelector('.tabs')).display,choices:Array.from(document.getElementById('indexMode')?.options||[]).map(x=>x.value)})"){result=it;ready.countDown()}};ready.await(2,TimeUnit.SECONDS);if(result.contains("visual")&&result.contains("none"))break;Thread.sleep(200)}
   assertTrue("Gallery shell must be active: $result",result.contains("true"));assertTrue("Old top tabs stay hidden: $result",result.contains("none"));assertTrue("Sequential index mode must exist: $result",result.contains("all"))
  }finally{inst.runOnMainSync{activity.finish()}}
 }
}
