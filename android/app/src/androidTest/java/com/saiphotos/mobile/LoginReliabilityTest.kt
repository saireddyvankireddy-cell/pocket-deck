package com.saiphotos.mobile
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Test
import org.junit.Assert.*
class LoginReliabilityTest {
 @Test fun rejectedReplacementKeepsExistingEncryptedLogin(){
  val context=InstrumentationRegistry.getInstrumentation().targetContext
  val client=OkHttpClient.Builder().addInterceptor { chain ->
   val request=chain.request();val form=request.body as FormBody
   val token=(0 until form.size).firstOrNull{form.name(it)=="access_token"}?.let{form.value(it)}
   val result=if(token=="valid-fixture")"""{"result":0,"userid":555123}""" else """{"result":2094}"""
   Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("OK").body(result.toResponseBody("application/json".toMediaType())).build()
  }.build()
  val api=PCloudApi(context,client)
  try {
   fun login(token:String)=api.handle("/.netlify/functions/pcloud-auth?action=token","POST","""{"host":"api.pcloud.com","tokenType":"access_token","token":"$token"}""")
   login("valid-fixture")
   assertEquals("555123",Credentials(context).read()!!.getString("uid"))
   try{login("rejected-fixture");fail("Rejected token must fail")}catch(e:CloudError){assertEquals(401,e.status);assertEquals(2094,e.code);assertTrue(e.message!!.contains("Reconnect"))}
   assertEquals("valid-fixture",Credentials(context).read()!!.getString("token"))
   assertTrue(api.handle("/.netlify/functions/pcloud-auth?action=status","GET","").getBoolean("connected"))
  }finally{api.credentials.clear();api.ai.shutdown()}
 }
}
