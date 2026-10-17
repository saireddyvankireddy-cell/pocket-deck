package com.saiphotos.mobile
import android.content.Intent
import android.webkit.WebView
import android.os.SystemClock
import android.view.MotionEvent
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.json.JSONTokener
import org.junit.Test
import org.junit.Assert.*
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
class GalleryTouchTest {
 @Test fun longPressAndFingerDragSelectSixPhotos(){
  val inst=InstrumentationRegistry.getInstrumentation();val activity=inst.startActivitySync(Intent(inst.targetContext,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK));lateinit var web:WebView
  fun evaluate(script:String):String {val latch=CountDownLatch(1);var result="";inst.runOnMainSync{web=activity.findViewById<android.view.ViewGroup>(android.R.id.content).getChildAt(0) as WebView;web.evaluateJavascript(script){result=it;latch.countDown()}};assertTrue(latch.await(5,TimeUnit.SECONDS));return result}
  try{for(i in 0..40){if(evaluate("document.readyState").contains("complete"))break;Thread.sleep(150)}
   evaluate("window.touchSmoke='loading';(async()=>{const {GallerySelection}=await import('https://appassets.androidplatform.net/gallery-controls.mjs');const grid=document.createElement('div');grid.id='touchFixture';Object.assign(grid.style,{position:'fixed',left:'20px',top:'210px',width:'300px',height:'200px',display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'4px',zIndex:'999',background:'#ddd'});for(let i=0;i<6;i++){const card=document.createElement('div');card.dataset.photoId='test-'+i;card.textContent='Test photo '+i;card.style.background='#86ac92';grid.append(card);}document.body.append(grid);document.body.style.minHeight='4000px';window.touchSelection=new GallerySelection({change(){window.touchSmoke=String(window.touchSelection.selected.size)}});window.touchSelection.attach(grid);window.touchEvents=[];for(const type of ['pointerdown','pointercancel','touchstart','touchmove','touchend','touchcancel'])grid.addEventListener(type,e=>window.touchEvents.push([type,e.target.dataset.photoId,e.pointerType]));window.touchSmoke='ready';})();")
   for(i in 0..40){if(evaluate("window.touchSmoke").contains("ready"))break;Thread.sleep(150)}
    val encoded=evaluate("JSON.stringify({width:innerWidth,height:innerHeight,first:(()=>{const r=document.querySelector('#touchFixture [data-photo-id=\"test-0\"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})(),last:(()=>{const r=document.querySelector('#touchFixture [data-photo-id=\"test-5\"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()})")
    val values=JSONObject(JSONTokener(encoded).nextValue().toString());val location=IntArray(2);var width=0;inst.runOnMainSync{web.getLocationOnScreen(location);width=web.width};val scale=width/values.getDouble("width");val first=values.getJSONObject("first");val last=values.getJSONObject("last");val x1=(location[0]+first.getDouble("x")*scale).toFloat();val y1=(location[1]+first.getDouble("y")*scale).toFloat();val x2=(location[0]+last.getDouble("x")*scale).toFloat();val y2=(location[1]+last.getDouble("y")*scale).toFloat();var down=SystemClock.uptimeMillis()
   fun touch(action:Int,x:Float,y:Float){if(action==MotionEvent.ACTION_DOWN)down=SystemClock.uptimeMillis();val props=MotionEvent.PointerProperties().apply{id=0;toolType=MotionEvent.TOOL_TYPE_FINGER};val coords=MotionEvent.PointerCoords().apply{this.x=x;this.y=y;pressure=1f;size=1f};val event=MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,1,arrayOf(props),arrayOf(coords),0,0,1f,1f,0,0,android.view.InputDevice.SOURCE_TOUCHSCREEN,0);event.source=android.view.InputDevice.SOURCE_TOUCHSCREEN;inst.sendPointerSync(event);event.recycle()}
   touch(MotionEvent.ACTION_DOWN,x1,y1);Thread.sleep(600);for(i in 1..6){touch(MotionEvent.ACTION_MOVE,x1+(x2-x1)*i/6,y1+(y2-y1)*i/6);Thread.sleep(40)};touch(MotionEvent.ACTION_UP,x2,y2);Thread.sleep(200)
    assertEquals("Finger range must select all six photos: "+evaluate("JSON.stringify({selected:[...touchSelection.selected],anchor:touchSelection.anchor,x:touchSelection.x,y:touchSelection.y})"),"\"6\"",evaluate("window.touchSmoke"))
   // A regular swipe in selection mode must scroll without changing the six IDs.
   down=SystemClock.uptimeMillis();touch(MotionEvent.ACTION_DOWN,x2,y2);for(i in 1..10){touch(MotionEvent.ACTION_MOVE,x2,y2-(y2-y1)*i/10);Thread.sleep(20)};touch(MotionEvent.ACTION_UP,x2,y1);Thread.sleep(500)
   assertTrue("Selection mode must allow a normal vertical swipe: "+evaluate("JSON.stringify({y:scrollY,h:document.body.scrollHeight,v:innerHeight,drag:touchSelection.drag,moved:touchSelection.moved,events:touchEvents})"),evaluate("scrollY>20")=="true")
   assertEquals("Scrolling must preserve selected photos","\"6\"",evaluate("String(touchSelection.selected.size)"))
   touch(MotionEvent.ACTION_DOWN,x1,y1);Thread.sleep(60);touch(MotionEvent.ACTION_UP,x1,y1);Thread.sleep(100)
   assertEquals("Tap must deselect exactly one photo","\"5\"",evaluate("String(touchSelection.selected.size)"))
   touch(MotionEvent.ACTION_DOWN,x1,y1);Thread.sleep(60);touch(MotionEvent.ACTION_UP,x1,y1);Thread.sleep(100)
   assertEquals("Tap must reselect without opening a photo","\"6\"",evaluate("String(touchSelection.selected.size)"))
   evaluate("scrollTo(0,0)");Thread.sleep(100)
    val edgeY=(location[1]+(values.getDouble("height")-40)*scale).toFloat()
   touch(MotionEvent.ACTION_DOWN,x2,y2);Thread.sleep(600);touch(MotionEvent.ACTION_MOVE,x2,edgeY);Thread.sleep(250);touch(MotionEvent.ACTION_UP,x2,edgeY)
   assertTrue("Held range selection must scroll at the lower edge",evaluate("scrollY>20")=="true")

  }finally{inst.runOnMainSync{activity.finish()}}
 }
}
