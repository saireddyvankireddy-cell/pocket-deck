package com.saiphotos.mobile
import android.content.Intent
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.Assert.*
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
class GallerySecurityTest {
 @Test fun unavailableScreenLockCannotEnableAppLock(){
  val inst=InstrumentationRegistry.getInstrumentation();val secure=(inst.targetContext.getSystemService(android.content.Context.KEYGUARD_SERVICE) as android.app.KeyguardManager).isDeviceSecure
  org.junit.Assume.assumeFalse("This check uses an emulator without a device PIN",secure)
  val activity=inst.startActivitySync(Intent(inst.targetContext,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK));lateinit var web:WebView
  fun eval(s:String):String{val latch=CountDownLatch(1);var r="";inst.runOnMainSync{web=activity.findViewById<android.view.ViewGroup>(android.R.id.content).getChildAt(0) as WebView;web.evaluateJavascript(s){r=it;latch.countDown()}};assertTrue(latch.await(5,TimeUnit.SECONDS));return r}
  try{for(i in 0..50){if(eval("document.readyState").contains("complete"))break;Thread.sleep(100)}
   eval("window.lockSmoke='waiting';(async()=>{const r=await fetch('/.netlify/functions/device-lock',{method:'POST',body:JSON.stringify({enabled:true})});window.lockSmoke=JSON.stringify({status:r.status,data:await r.json()});})();")
   var result="";for(i in 0..50){result=eval("window.lockSmoke");if(result.contains("409"))break;Thread.sleep(100)};assertTrue("A secure device credential is required: $result",result.contains("409"));assertFalse(inst.targetContext.getSharedPreferences("gallery-security",android.content.Context.MODE_PRIVATE).getBoolean("app-lock",false))
  }finally{inst.runOnMainSync{activity.finish()}}
 }
}
