package com.saiphotos.mobile
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*
class PhotoIndexTest {
 @Test fun nativeIndexReusesMacVersionsWithoutInferenceOrUploads(){
  var uploads=0;val contents=JSONArray();val known=JSONArray()
  for(i in 1..3){val version=(5380817599554757000L+i*10000L).toString();contents.put(JSONObject().put("fileid",i).put("name","test$i.jpg").put("hash",version).put("size",1000));known.put(JSONObject().put("id","pc-$i").put("version",version.toDouble().toString()))}
  val client=OkHttpClient.Builder().addInterceptor{chain->val request=chain.request();val method=request.url.pathSegments.last();val data=when(method){"userinfo"->"{\"result\":0,\"userid\":999777}";"listfolder"->JSONObject().put("result",0).put("metadata",JSONObject().put("folderid",0).put("name","pCloud").put("contents",contents)).toString();else->{uploads++;throw AssertionError("Unchanged photos must not request $method")}};Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("OK").body(data.toResponseBody("application/json".toMediaType())).build()}.build()
  val api=PCloudApi(InstrumentationRegistry.getInstrumentation().targetContext,client)
  try{api.handle("/.netlify/functions/pcloud-auth?action=token","POST","{\"host\":\"api.pcloud.com\",\"tokenType\":\"auth\",\"token\":\"test-only-not-a-real-token\"}")
   val fresh=api.handle("/.netlify/functions/media-list?kind=photo&folderid=0","GET","");assertEquals(3,fresh.getJSONArray("items").length());val cached=api.handle("/.netlify/functions/media-list?kind=photo&folderid=0&cached=1","GET","");assertTrue(cached.getBoolean("cached"));assertEquals(3,cached.getJSONArray("items").length())
   api.ai.handle(false,"POST",JSONObject().put("action","start").put("folderId","0").put("known",known).put("checksums",JSONArray()));var status=JSONObject()
   for(i in 0..100){status=api.ai.handle(false,"GET",JSONObject());if(!status.optBoolean("running"))break;Thread.sleep(50)}
   assertFalse(status.getBoolean("running"));assertEquals("Already completed",status.getString("phase"));assertEquals(3,status.getInt("libraryTotal"));assertEquals(3,status.getInt("alreadyIndexed"));assertEquals(0,status.getInt("completed"));assertEquals(0,uploads)
  }finally{api.credentials.clear();api.ai.shutdown()}
 }
 @Test fun changedPhotoIsNotReportedAsCompleted(){
  val client=OkHttpClient.Builder().addInterceptor{chain->val request=chain.request();val data=when(request.url.pathSegments.last()){
   "userinfo"->"{\"result\":0,\"userid\":999779}"
   "listfolder"->"{\"result\":0,\"metadata\":{\"folderid\":0,\"name\":\"pCloud\",\"contents\":[{\"fileid\":44,\"name\":\"test.jpg\",\"hash\":\"first\",\"size\":1000}]}}"
   "stat"->"{\"result\":0,\"metadata\":{\"hash\":\"changed\"}}"
   else->throw AssertionError("Changed photo must not upload or infer")
  };Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("OK").body(data.toResponseBody("application/json".toMediaType())).build()}.build()
  val api=PCloudApi(InstrumentationRegistry.getInstrumentation().targetContext,client)
  try{api.handle("/.netlify/functions/pcloud-auth?action=token","POST","{\"host\":\"api.pcloud.com\",\"tokenType\":\"auth\",\"token\":\"test-only-not-a-real-token\"}")
   api.ai.handle(false,"POST",JSONObject().put("action","start").put("folderId","0").put("known",JSONArray()).put("checksums",JSONArray()));var status=JSONObject()
   for(i in 0..100){status=api.ai.handle(false,"GET",JSONObject());if(!status.optBoolean("running"))break;Thread.sleep(50)}
   assertFalse(status.getBoolean("running"));assertEquals(0,status.getInt("completed"));assertEquals(1,status.getInt("changed"));assertEquals("Finished with incomplete photos",status.getString("phase"))
  }finally{api.credentials.clear();api.ai.shutdown()}
 }
 @Test fun cachedPreviewsAreReusedAndChangedVersionsAreFetched(){
  var previews=0;val fileId=(1000000000L+System.nanoTime()%1000000000L).toString()
  val client=OkHttpClient.Builder().addInterceptor{chain->val request=chain.request();val preview=request.url.pathSegments.last()=="getthumb";val data=if(preview){previews++;"test-preview"}else "{\"result\":0,\"userid\":999778}";Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("OK").header("Content-Type",if(preview)"image/jpeg" else "application/json").body(data.toResponseBody((if(preview)"image/jpeg" else "application/json").toMediaType())).build()}.build()
  val api=PCloudApi(InstrumentationRegistry.getInstrumentation().targetContext,client)
  try{api.handle("/.netlify/functions/pcloud-auth?action=token","POST","{\"host\":\"api.pcloud.com\",\"tokenType\":\"auth\",\"token\":\"test-only-not-a-real-token\"}");assertArrayEquals(api.previewBytes(fileId,"first",true),api.previewBytes(fileId,"first",true));assertEquals(1,previews);api.previewBytes(fileId,"changed",true);assertEquals(2,previews)}finally{api.credentials.clear();api.ai.shutdown()}
 }
}
