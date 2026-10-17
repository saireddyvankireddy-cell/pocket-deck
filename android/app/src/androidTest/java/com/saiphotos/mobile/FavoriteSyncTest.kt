package com.saiphotos.mobile
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Test
import org.junit.Assert.*
class FavoriteSyncTest {
 private fun form(body:RequestBody?,name:String):String?= (body as? FormBody)?.let{form->(0 until form.size).firstOrNull{form.encodedName(it)==name}?.let{form.value(it)}}
 @Test fun favoritesCollectionIsFoundLinkedUnlinkedAndMerged(){
  val linkCalls=mutableListOf<String>();val unlinkCalls=mutableListOf<String>();var lastCollectionId:String?=null
  val client=OkHttpClient.Builder().followRedirects(false).addInterceptor { chain ->
   val req=chain.request();val method=req.url.pathSegments.last();val response=Response.Builder().request(req).protocol(Protocol.HTTP_1_1).code(200).message("OK")
   val body=when(method){
    "userinfo"->"""{"result":0,"userid":555124}"""
    "collection_list"->"""{"result":0,"collections":[{"id":38,"name":"Most Listened","system":true,"type":"audio"},{"id":40,"name":"my music","system":false,"type":"audio"},{"id":77,"name":"Favourites","system":true,"type":"generic","items":2,"contents":[{"fileid":101,"name":"a.jpg"},{"fileid":102,"name":"b.jpg"}]}]}"""
    "collection_linkfiles"->{lastCollectionId=form(req.body,"collectionid");val ids=form(req.body,"fileids")?:"";linkCalls.add(ids);if(ids=="103")"""{"result":2072,"error":"Already in collection."}""" else """{"result":0}"""}
    "collection_unlinkfiles"->{lastCollectionId=form(req.body,"collectionid");val ids=form(req.body,"fileids")?:"";unlinkCalls.add(ids);if(ids=="104")"""{"result":2009,"error":"File not found."}""" else """{"result":0}"""}
    else->throw AssertionError("Unexpected request "+req.url)
   }
   response.body(body.toResponseBody("application/json".toMediaType())).build()
  }.build()
  val api=PCloudApi(InstrumentationRegistry.getInstrumentation().targetContext,client)
  try{
   api.handle("/.netlify/functions/pcloud-auth?action=token","POST","""{"host":"api.pcloud.com","tokenType":"access_token","token":"fixture-token"}""")
   val status=api.handle("/.netlify/functions/favorite-sync?action=status","GET","")
   assertTrue(status.getBoolean("found"));assertEquals(77,status.getInt("collectionId"));assertEquals("Favourites",status.getString("name"));assertEquals(2,status.getInt("items"))
   val fileIds=status.getJSONArray("fileIds");assertEquals(2,fileIds.length());assertEquals("pc-101",fileIds.getString(0));assertEquals("pc-102",fileIds.getString(1));assertFalse(status.getBoolean("truncated"))
   assertTrue(api.handle("/.netlify/functions/favorite-sync?action=link","POST","""{"photoId":"pc-101"}""").getBoolean("synced"))
   assertEquals("77",lastCollectionId);assertTrue(linkCalls.contains("101"))
   assertTrue(api.handle("/.netlify/functions/favorite-sync?action=link","POST","""{"photoId":"pc-103"}""").optBoolean("already"))
   assertTrue(api.handle("/.netlify/functions/favorite-sync?action=unlink","POST","""{"photoId":"pc-102"}""").getBoolean("synced"));assertTrue(unlinkCalls.contains("102"))
   assertTrue(api.handle("/.netlify/functions/favorite-sync?action=unlink","POST","""{"photoId":"pc-104"}""").optBoolean("already"))
   try{api.handle("/.netlify/functions/favorite-sync?action=link","POST","""{"photoId":"not-a-photo"}""");fail("Invalid photo must be rejected")}catch(e:CloudError){assertEquals(400,e.status)}
   val merged=api.handle("/.netlify/functions/favorite-sync?action=update","POST","""{"add":["pc-201","pc-202"],"remove":["pc-101"]}""")
   assertEquals(2,merged.getInt("linked"));assertEquals(1,merged.getInt("unlinked"));assertTrue(linkCalls.contains("201,202"));assertTrue(unlinkCalls.contains("101"))
  }finally{api.credentials.clear();api.ai.shutdown()}
 }
}
