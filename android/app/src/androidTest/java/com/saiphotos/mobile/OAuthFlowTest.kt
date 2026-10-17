package com.saiphotos.mobile
import android.net.Uri
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.Assert.*
class OAuthFlowTest {
 private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
 private fun callback(state:String,host:String="eapi.pcloud.com")=Uri.parse(PCloudOAuth.REDIRECT+"#state=$state&access_token=fixture-token&hostname=$host&token_type=bearer")
 @Test fun browserUrlUsesPublicTokenFlowAndSurvivesRecreation(){
  val flow=PCloudOAuth(context);val url=flow.start()
  try{assertEquals("my.pcloud.com",url.host);assertEquals("token",url.getQueryParameter("response_type"));assertEquals(PCloudOAuth.REDIRECT,url.getQueryParameter("redirect_uri"));assertNull(url.getQueryParameter("client_secret"))
   val result=PCloudOAuth(context).consume(callback(url.getQueryParameter("state")!!))
   assertEquals("eapi.pcloud.com",result.getString("host"));assertEquals("access_token",result.getString("tokenType"))
   try{flow.consume(callback(url.getQueryParameter("state")!!));fail("Replayed callback accepted")}catch(_:CloudError){}
  }finally{flow.clear()}
 }
 @Test fun rejectsWrongStateHostExpiredAndCancelledCallbacks(){
  val flow=PCloudOAuth(context)
  fun reject(uri:Uri){try{flow.consume(uri);fail("Invalid callback accepted")}catch(_:CloudError){}}
  try{var state=flow.start().getQueryParameter("state")!!;reject(callback("wrong"));reject(callback(state,"attacker.invalid"))
   state=flow.start().getQueryParameter("state")!!
   context.getSharedPreferences("pcloud-oauth-pending",0).edit().putLong("started",1).commit();reject(callback(state))
   state=flow.start().getQueryParameter("state")!!;reject(Uri.parse(PCloudOAuth.REDIRECT+"#state=$state&error=access_denied"))
   assertFalse(PCloudOAuth.isCallback(Uri.parse("pcloud-oauth://attacker")))
  }finally{flow.clear()}
 }
 @Test fun connectButtonLaunchesBrowserThroughNativeBridge(){
  val inst=InstrumentationRegistry.getInstrumentation()
  val filter=android.content.IntentFilter(android.content.Intent.ACTION_VIEW).apply{addCategory(android.content.Intent.CATEGORY_BROWSABLE);addDataScheme("https")}
  val monitor=android.app.Instrumentation.ActivityMonitor(filter,android.app.Instrumentation.ActivityResult(android.app.Activity.RESULT_OK,null),true)
  inst.addMonitor(monitor)
  val activity=inst.startActivitySync(android.content.Intent(inst.targetContext,MainActivity::class.java).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK))
  fun eval(script:String):String{val latch=java.util.concurrent.CountDownLatch(1);var result="";inst.runOnMainSync{val web=activity.findViewById<android.view.ViewGroup>(android.R.id.content).getChildAt(0) as android.webkit.WebView;web.evaluateJavascript(script){result=it;latch.countDown()}};assertTrue(latch.await(30,java.util.concurrent.TimeUnit.SECONDS));return result}
  try{
   for(i in 0..100){if(eval("document.getElementById('connect')?.onclick!=null")=="true")break;Thread.sleep(100)}
   eval("document.getElementById('connect').click()")
   for(i in 0..50){if(monitor.hits>0)break;Thread.sleep(100)}
   assertEquals("Connect must launch an external browser",1,monitor.hits)
   for(i in 0..50){if(eval("document.getElementById('status').textContent").contains("Complete pCloud"))break;Thread.sleep(100)}
   assertTrue(eval("document.getElementById('status').textContent").contains("Complete pCloud"))
   assertTrue(PCloudOAuth.isCallback(android.net.Uri.parse(PCloudOAuth.REDIRECT)))
  }finally{inst.removeMonitor(monitor);PCloudOAuth(context).clear();inst.runOnMainSync{activity.finish()}}
 }
}
