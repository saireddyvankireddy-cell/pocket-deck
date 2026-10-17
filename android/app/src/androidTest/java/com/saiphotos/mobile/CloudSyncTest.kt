package com.saiphotos.mobile
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*
import java.util.UUID
class CloudSyncTest {
 @Test fun nativeRecordsWriteVerifyAndRestoreWithoutPersonalAccount(){
  val records=mutableMapOf<String,JSONObject>();var deletes=0;var folderRequests=0;var journalReads=0
  val client=OkHttpClient.Builder().addInterceptor { chain ->
   val request=chain.request();val method=request.url.pathSegments.last();val result=when {
    request.url.host=="c123.pcloud.com" -> records.getValue(method).toString()
    method=="userinfo" -> "{\"result\":0,\"userid\":123456789}"
    method=="stat" -> "{\"result\":2055}"
    method=="createfolderifnotexists" -> {folderRequests++;"{\"result\":0,\"metadata\":{\"folderid\":123}}"}
    method=="uploadfile" -> {val form=request.body as MultipartBody;val part=form.parts.first{it.body.contentType()?.toString()?.startsWith("application/json")==true};val buffer=Buffer();part.body.writeTo(buffer);records["101"]=JSONObject(buffer.readUtf8());"{\"result\":0,\"metadata\":[{\"fileid\":101}]}"}
    method=="getfilelink" -> "{\"result\":0,\"hosts\":[\"c123.pcloud.com\"],\"path\":\"/101\"}"
    method=="listfolder" -> {journalReads++;JSONObject().put("result",0).put("metadata",JSONObject().put("folderid",123).put("contents",JSONArray().put(JSONObject().put("fileid",101).put("name",records.getValue("101").getString("id")+".json").put("isfolder",false)))).toString()}
    method=="deletefile" -> {deletes++;"{\"result\":0}"}
    else -> throw AssertionError("Unexpected mocked request: $method")
   };Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("OK").body(result.toResponseBody("application/json".toMediaType())).build()
  }.build()
  val api=PCloudApi(InstrumentationRegistry.getInstrumentation().targetContext,client)
  try {
   api.handle("/.netlify/functions/pcloud-auth?action=token","POST",JSONObject().put("host","api.pcloud.com").put("tokenType","auth").put("token","test-only-not-a-real-token").toString())
   val op=JSONObject().put("id",UUID.randomUUID().toString()).put("at",1).put("type","favorite").put("photoId","pc-42").put("value",true)
   val saved=api.write(op);assertTrue(saved.getBoolean("value"));assertTrue(saved.getLong("at")>1)
   val restored=api.handle("/.netlify/functions/photo-metadata?action=sync","POST","{\"known\":[]}").getJSONArray("operations")
   assertEquals(1,restored.length());assertEquals(saved.getString("id"),restored.getJSONObject(0).getString("id"));assertEquals(0,deletes)
   api.handle("/.netlify/functions/photo-metadata?action=sync","POST","{\"known\":[]}")
   assertEquals("Consecutive sync pages reuse the journal directory",1,journalReads)
   try{api.handle("/.netlify/functions/photo-delete","POST","{\"id\":\"pc-42\",\"confirmed\":false,\"fileName\":\"test.jpg\"}");fail("Unconfirmed deletion must fail")}catch(e:CloudError){assertEquals(400,e.status)}
   assertEquals(0,deletes)
   api.write(JSONObject().put("id",UUID.randomUUID().toString()).put("type","favorite").put("photoId","pc-43").put("value",true))
   assertEquals("Journal folder should be resolved only once",4,folderRequests)
  }finally{api.credentials.clear();api.ai.shutdown()}
 }
}
