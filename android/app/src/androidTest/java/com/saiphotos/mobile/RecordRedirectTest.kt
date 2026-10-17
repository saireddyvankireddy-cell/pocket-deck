package com.saiphotos.mobile
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Test
import org.junit.Assert.*
class RecordRedirectTest {
 @Test fun trustedRecordRedirectRestoresAndExternalRedirectIsRejected(){
  var external=false
  val client=OkHttpClient.Builder().followRedirects(false).addInterceptor { chain ->
   val req=chain.request();val response=Response.Builder().request(req).protocol(Protocol.HTTP_1_1).message("OK")
   val body=when {
    req.url.host=="c123.pcloud.com"->{response.code(302).header("Location",if(external)"https://example.com/stolen" else "https://c456.pcloud.com/record");""}
    req.url.host=="c456.pcloud.com"->{assertNull(req.header("Authorization"));assertNull(req.url.queryParameter("access_token"));response.code(200);"""{"id":"00000000-0000-4000-8000-000000000001","type":"favorite","photoId":"pc-1","value":true,"at":1}"""}
    req.url.pathSegments.last()=="userinfo"->{response.code(200);"""{"result":0,"userid":555124}"""}
    req.url.pathSegments.last()=="getfilelink"->{response.code(200);"""{"result":0,"hosts":["c123.pcloud.com"],"path":"/record"}"""}
    else->throw AssertionError("Unexpected host/request")
   };response.body(body.toResponseBody("application/json".toMediaType())).build()
  }.build()
  val api=PCloudApi(InstrumentationRegistry.getInstrumentation().targetContext,client)
  try{
   api.handle("/.netlify/functions/pcloud-auth?action=token","POST","""{"host":"api.pcloud.com","tokenType":"access_token","token":"fixture-token"}""")
   assertTrue(api.readRecord("8111",true).getBoolean("value"));external=true
   try{api.readRecord("8112",true);fail("External redirect must fail")}catch(e:CloudError){assertTrue(e.message!!.contains("not trusted"))}
  }finally{api.credentials.clear();api.ai.shutdown()}
 }
}
