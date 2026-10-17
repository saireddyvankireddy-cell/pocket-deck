package com.saiphotos.mobile
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*

class LibraryRecoveryTest {
 @Test fun authenticatedLibrarySurvivesAnUnreadableChildFolderAndSyncFailure(){
  val client=OkHttpClient.Builder().addInterceptor { chain ->
   val request=chain.request();val form=request.body as FormBody
   val params=(0 until form.size).associate { form.name(it) to form.value(it) }
   val body=when(request.url.pathSegments.last()){
    "userinfo" -> """{"result":0,"userid":987654321}"""
    "listfolder" -> when {
     params["path"]!=null -> """{"result":2003}"""
     params["folderid"]=="0" -> """{"result":0,"metadata":{"folderid":0,"name":"pCloud","contents":[{"isfolder":true,"folderid":1,"name":"Photos"},{"isfolder":true,"folderid":2,"name":"Unavailable"}]}}"""
     params["folderid"]=="1" -> """{"result":0,"metadata":{"folderid":1,"name":"Photos","contents":[{"fileid":42,"name":"test.jpg","size":100,"hash":"123","created":"2026-10-14T00:00:00Z"}]}}"""
     else -> """{"result":2003}"""
    }
    else -> throw AssertionError("Unexpected API")
   }
   Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("OK").body(body.toResponseBody("application/json".toMediaType())).build()
  }.build()
  val api=PCloudApi(InstrumentationRegistry.getInstrumentation().targetContext,client)
  try {
   api.handle("/.netlify/functions/pcloud-auth?action=token","POST","""{"host":"api.pcloud.com","tokenType":"access_token","token":"fixture-token"}""")
   try{api.handle("/.netlify/functions/photo-metadata?action=sync","POST","""{"known":[]}""");fail("Expected sync permission failure")}catch(e:CloudError){assertEquals(2003,e.code)}
   val result=api.withSession{api.handle("/.netlify/functions/media-list?kind=photo&folderid=0","GET","")}
   assertEquals("pc-42",result.getJSONArray("items").getJSONObject(0).getString("id"))
   assertFalse(result.getJSONObject("scan").getBoolean("complete"))
   assertEquals("/Unavailable",result.getJSONObject("scan").getJSONArray("unavailableFolders").getString(0))
   assertEquals(1,api.handle("/.netlify/functions/media-list?kind=photo&folderid=0&cached=1","GET","").getJSONArray("items").length())
  } finally {api.credentials.clear();api.ai.shutdown()}
 }
}
