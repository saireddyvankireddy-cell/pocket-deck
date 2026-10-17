package com.saiphotos.mobile
import android.net.Uri
import android.graphics.Bitmap
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*
import java.io.ByteArrayOutputStream
class GalleryCloudToolsTest {
 @Test fun offlineOriginalReopensWithoutNetworkAndRemovalKeepsCloudOriginal(){
  val context=InstrumentationRegistry.getInstrumentation().targetContext
  val bytes=ByteArrayOutputStream().also{out->val b=Bitmap.createBitmap(8,8,Bitmap.Config.ARGB_8888);b.eraseColor(android.graphics.Color.BLUE);b.compress(Bitmap.CompressFormat.PNG,100,out);b.recycle()}.toByteArray()
  var network=true;var deletes=0;var reads=0
  val client=OkHttpClient.Builder().addInterceptor{chain->val r=chain.request();if(!network)throw java.io.IOException("Test network disconnected");val name=r.url.pathSegments.last();val body=if(r.url.host=="c601.pcloud.com"){reads++;bytes.toResponseBody("image/png".toMediaType())}else{val text=when(name){"userinfo"->"{\"result\":0,\"userid\":990601}";"stat"->"{\"result\":0,\"metadata\":{\"fileid\":90000601,\"name\":\"image.png\",\"hash\":\"version-a\",\"size\":${bytes.size}}}";"getfilelink"->"{\"result\":0,\"hosts\":[\"c601.pcloud.com\"],\"path\":\"/image.png\"}";"deletefile"->{deletes++;throw AssertionError("Removing a download must never delete an original")};else->throw AssertionError(name)};text.toResponseBody("application/json".toMediaType())};Response.Builder().request(r).protocol(Protocol.HTTP_1_1).code(200).message("OK").body(body).build()}.build()
  val api=PCloudApi(context,client)
  try{api.handle("/.netlify/functions/pcloud-auth?action=token","POST","{\"host\":\"api.pcloud.com\",\"tokenType\":\"auth\",\"token\":\"test-only-not-a-real-token\"}")
   api.handle("/.netlify/functions/device-offline","POST","{\"action\":\"remove\",\"id\":\"pc-90000601\"}")
   val saved=api.handle("/.netlify/functions/device-offline","POST","{\"action\":\"download\",\"id\":\"pc-90000601\",\"version\":\"version-a\"}");assertTrue(saved.getBoolean("saved"));assertEquals(1,reads)
   network=false;val response=api.binary(Uri.parse("https://appassets.androidplatform.net/.netlify/functions/media-content?id=pc-90000601&version=version-a"),emptyMap());response.data.use{assertArrayEquals(bytes,it.readBytes())};assertEquals("image/png",response.mimeType)
   assertEquals(1,api.handle("/.netlify/functions/device-offline","GET","").getJSONArray("items").length());api.handle("/.netlify/functions/device-offline","POST","{\"action\":\"remove\",\"id\":\"pc-90000601\"}");assertEquals(0,api.handle("/.netlify/functions/device-offline","GET","").getJSONArray("items").length());assertEquals(0,deletes)
  }finally{api.credentials.clear();api.ai.shutdown()}
 }
 @Test fun trashRestoresOnlyConfirmedSpecificFiles(){
  var restores=0
  val client=OkHttpClient.Builder().addInterceptor{chain->val r=chain.request();val text=when(r.url.pathSegments.last()){ "userinfo"->"{\"result\":0,\"userid\":990602,\"quota\":1000,\"usedquota\":250}";"trash_list"->"{\"result\":0,\"metadata\":{\"contents\":[{\"fileid\":901,\"name\":\"picture.jpg\",\"size\":500,\"origparentfolderid\":42}]}}";"trash_restore"->{val form=r.body as FormBody;val fields=(0 until form.size).associate{form.name(it) to form.value(it)};assertEquals("901",fields["fileid"]);assertNull(fields["folderid"]);restores++;"{\"result\":0,\"restored\":[{\"fileid\":901}]}"};else->throw AssertionError(r.url.pathSegments.last())};Response.Builder().request(r).protocol(Protocol.HTTP_1_1).code(200).message("OK").body(text.toResponseBody("application/json".toMediaType())).build()}.build()
  val api=PCloudApi(InstrumentationRegistry.getInstrumentation().targetContext,client)
  try{api.handle("/.netlify/functions/pcloud-auth?action=token","POST","{\"host\":\"api.pcloud.com\",\"tokenType\":\"auth\",\"token\":\"test-only-not-a-real-token\"}");val info=api.handle("/.netlify/functions/account-info","GET","");assertEquals(1000,info.getInt("quota"));assertEquals(250,info.getInt("used"));assertFalse(info.has("token"));assertEquals(1,api.handle("/.netlify/functions/photo-trash","GET","").getJSONArray("items").length())
   try{api.handle("/.netlify/functions/photo-trash","POST","{\"id\":\"pc-901\",\"confirmed\":false}");fail("Restore must require a confirmed file")}catch(e:CloudError){assertEquals(400,e.status)}
   val restored=api.handle("/.netlify/functions/photo-trash","POST","{\"id\":\"pc-901\",\"confirmed\":true}");assertTrue(restored.getBoolean("restored"));assertEquals(1,restores)
  }finally{api.credentials.clear();api.ai.shutdown()}
 }
 @Test fun androidRecordExportContainsNoAuthFields(){
  val client=OkHttpClient.Builder().addInterceptor{chain->val r=chain.request();Response.Builder().request(r).protocol(Protocol.HTTP_1_1).code(200).message("OK").body("{\"result\":0,\"userid\":990603}".toResponseBody("application/json".toMediaType())).build()}.build()
  val context=InstrumentationRegistry.getInstrumentation().targetContext;val api=PCloudApi(context,client)
  try{api.handle("/.netlify/functions/pcloud-auth?action=token","POST","{\"host\":\"api.pcloud.com\",\"tokenType\":\"auth\",\"token\":\"test-only-not-a-real-token\"}");val result=api.handle("/.netlify/functions/device-export","POST","{\"format\":\"sai-photos-record-export-v1\",\"account\":\"test\",\"page\":1,\"operations\":[]}");val name=result.getString("name");context.contentResolver.query(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,arrayOf(android.provider.MediaStore.Downloads._ID),android.provider.MediaStore.Downloads.DISPLAY_NAME+"=?",arrayOf(name),null)?.use{c->assertTrue(c.moveToFirst());val uri=android.content.ContentUris.withAppendedId(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,c.getLong(0));val text=context.contentResolver.openInputStream(uri)!!.bufferedReader().use{it.readText()};assertFalse(text.contains("token"));assertTrue(text.contains("operations"));context.contentResolver.delete(uri,null,null)}
  }finally{api.credentials.clear();api.ai.shutdown()}
 }
 @Test fun photoUploadStreamsSelectedContentAndRenamesConflicts(){
  val context=InstrumentationRegistry.getInstrumentation().targetContext;val resolver=context.contentResolver
  val bytes=ByteArrayOutputStream().also{out->val b=Bitmap.createBitmap(4,4,Bitmap.Config.ARGB_8888);b.eraseColor(android.graphics.Color.GREEN);b.compress(Bitmap.CompressFormat.PNG,100,out);b.recycle()}.toByteArray()
  val values=android.content.ContentValues().apply{put(android.provider.MediaStore.Images.Media.DISPLAY_NAME,"sai-upload-test.png");put(android.provider.MediaStore.Images.Media.MIME_TYPE,"image/png")}
  val uri=resolver.insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,values)!!;resolver.openOutputStream(uri)!!.use{it.write(bytes)}
  var uploaded=0
  val client=OkHttpClient.Builder().addInterceptor{chain->val r=chain.request();val text=when(r.url.pathSegments.last()){ "userinfo"->"{\"result\":0,\"userid\":990604}";"uploadfile"->{val form=r.body as MultipartBody;assertTrue(form.parts.any{it.headers?.get("Content-Disposition")?.contains("renameifexists")==true&&okio.Buffer().also{b->it.body.writeTo(b)}.readUtf8()=="1"});val file=form.parts.last();val buffer=okio.Buffer();file.body.writeTo(buffer);assertArrayEquals(bytes,buffer.readByteArray());uploaded++;"{\"result\":0,\"metadata\":[{\"fileid\":777,\"name\":\"sai-upload-test (1).png\",\"size\":${bytes.size}}]}"};else->throw AssertionError(r.url.pathSegments.last())};Response.Builder().request(r).protocol(Protocol.HTTP_1_1).code(200).message("OK").body(text.toResponseBody("application/json".toMediaType())).build()}.build()
  val api=PCloudApi(context,client)
  try{api.handle("/.netlify/functions/pcloud-auth?action=token","POST","{\"host\":\"api.pcloud.com\",\"tokenType\":\"auth\",\"token\":\"test-only-not-a-real-token\"}");val result=api.withSession{api.uploadPhoto(uri,"42","api.pcloud.com:990604")};assertEquals("pc-777",result.getString("id"));assertTrue(result.getString("name").contains("(1)"));assertEquals(1,uploaded)
   try{api.withSession{api.uploadPhoto(uri,"42","api.pcloud.com:other-owner")};fail("An account switch must stop uploads")}catch(e:CloudError){assertEquals(409,e.status)};assertEquals(1,uploaded)
  }finally{resolver.delete(uri,null,null);api.credentials.clear();api.ai.shutdown()}
 }

}
