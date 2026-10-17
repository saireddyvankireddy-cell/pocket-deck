package com.saiphotos.mobile
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.webkit.WebView
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.Assert.*
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONObject
class AppSmokeTest {
 @Test fun packagedAppLaunchesWithoutMac(){
  val inst=InstrumentationRegistry.getInstrumentation()
  val activity=inst.startActivitySync(Intent(inst.targetContext,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
  try{var result="";val ready=CountDownLatch(1)
   for(i in 0..30){inst.runOnMainSync{val web=activity.findViewById<android.view.ViewGroup>(android.R.id.content).getChildAt(0) as WebView;web.evaluateJavascript("(Boolean(document.getElementById('photoNavigation')&&document.getElementById('openMenu')&&document.getElementById('settingsDialog')&&document.getElementById('viewer'))?'shell:ok':'shell:missing')+'|'+document.body.innerText"){result=it;ready.countDown()}};ready.await(2,TimeUnit.SECONDS);if(result.contains("Connect your pCloud")&&result.contains("shell:ok"))break;Thread.sleep(300)}
   assertTrue("Bundled UI must load: $result",result.contains("shell:ok"));assertTrue("Native auth status must work: $result",result.contains("Connect your pCloud"))
  }finally{inst.runOnMainSync{activity.finish()}}
 }
 @Test fun faceAndOcrCanRunTwiceWithoutClosingApp(){
  val inst=InstrumentationRegistry.getInstrumentation()
  val activity=inst.startActivitySync(Intent(inst.targetContext,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK))
  try{var loaded="";for(i in 0..40){val ready=CountDownLatch(1);inst.runOnMainSync{val web=activity.findViewById<android.view.ViewGroup>(android.R.id.content).getChildAt(0) as WebView;web.evaluateJavascript("document.readyState+' '+location.href"){loaded=it;ready.countDown()}};ready.await(3,TimeUnit.SECONDS);if(loaded.contains("complete https://appassets.androidplatform.net"))break;Thread.sleep(300)};assertTrue("App must load before AI test: $loaded",loaded.contains("complete https://appassets.androidplatform.net"));val started=CountDownLatch(1)
   inst.runOnMainSync{val web=activity.findViewById<android.view.ViewGroup>(android.R.id.content).getChildAt(0) as WebView
    web.evaluateJavascript("window.aiSmoke='running'; (async()=>{try{const {analyzePhoto}=await import('https://appassets.androidplatform.net/photo-ai.mjs');const canvas=document.createElement('canvas');canvas.width=320;canvas.height=240;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,320,240);const image=new Image();image.src=canvas.toDataURL();await image.decode();for(let i=0;i<2;i++){const result=await analyzePhoto(image);if(!Array.isArray(result.faces)||typeof result.text!=='string')throw new Error('Invalid AI output');}window.aiSmoke='passed';}catch(e){window.aiSmoke='failed:'+e.message;}})();"){started.countDown()}}
   started.await(5,TimeUnit.SECONDS);var result=""
   for(i in 0..180){val latch=CountDownLatch(1);inst.runOnMainSync{val web=activity.findViewById<android.view.ViewGroup>(android.R.id.content).getChildAt(0) as WebView;web.evaluateJavascript("window.aiSmoke"){result=it;latch.countDown()}};latch.await(3,TimeUnit.SECONDS);if(result.contains("passed")||result.contains("failed:"))break;Thread.sleep(500)}
   assertEquals("Face/OCR should run twice: $result","\"passed\"",result)
  }finally{inst.runOnMainSync{activity.finish()}}
 }
 @Test fun localTextAndVisionModelsRunWithoutMac(){
  val context=InstrumentationRegistry.getInstrumentation().targetContext
  ClipEngine(PCloudApi(context)).use { engine ->
   val reference=JSONObject(InstrumentationRegistry.getInstrumentation().context.assets.open("ai-reference.json").bufferedReader().use{it.readText()});
   val vector=engine.text("rose",false);assertEquals(512,vector.size);assertTrue(vector.all{it.isFinite()});assertEquals(1.0,vector.sumOf{it.toDouble()*it},.001)
   val expected=reference.getJSONArray("text");val similarity=vector.indices.sumOf{vector[it]*expected.getDouble(it)};assertTrue("Android and Mac embeddings must agree: $similarity",similarity>.999);
   val music=engine.text("Night rose melody",true);assertEquals(512,music.size);assertTrue(music.all{it.isFinite()})
   val bitmap=Bitmap.createBitmap(320,240,Bitmap.Config.ARGB_8888).apply{eraseColor(Color.RED)}
   try{val visual=engine.visual(bitmap,JSONObject());assertEquals(684,visual.getString("embedding").length);assertEquals(16,visual.getString("phash").length);assertEquals("clip-base32-q8-v1",visual.getString("model"));val actual=android.util.Base64.decode(visual.getString("embedding"),android.util.Base64.NO_WRAP);val expectedImage=android.util.Base64.decode(reference.getString("visual"),android.util.Base64.NO_WRAP);var dot=0.0;var aa=0.0;var bb=0.0;for(i in actual.indices){val a=((actual[i].toInt() and 255)-128)/127.0;val b=((expectedImage[i].toInt() and 255)-128)/127.0;dot+=a*b;aa+=a*a;bb+=b*b};assertTrue("Android/Mac image vectors must be compatible",dot/kotlin.math.sqrt(aa*bb)>.99)}finally{bitmap.recycle()}
  }
 }
}
