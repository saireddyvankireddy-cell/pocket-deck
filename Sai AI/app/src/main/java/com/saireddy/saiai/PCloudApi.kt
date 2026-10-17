package com.saireddy.saiai

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceResponse
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.time.Instant
import java.util.concurrent.TimeUnit

class CloudError(val status: Int, message: String, val code: Int? = null) : Exception(message)
class PCloudApi(val context: Context, clientOverride:OkHttpClient?=null) {
    private val testClient = clientOverride != null
    val credentials = Credentials(context)
    val client = clientOverride ?: OkHttpClient.Builder().connectTimeout(20, TimeUnit.SECONDS).readTimeout(60, TimeUnit.SECONDS).followRedirects(false).build()
    private val boundedClient=client.newBuilder().callTimeout(120,TimeUnit.SECONDS).build()
    val ai by lazy { LocalAI(this) }
    private val root = "/Sai Photos/Web/v1/Operations"
    // Resolve the journal folder once per authenticated session, not four RPCs per photo.
    private val journalListings=java.util.concurrent.ConcurrentHashMap<String,Pair<Long,String>>()
    private val journalFolders=mutableMapOf<String,Pair<String,Long>>()
    // pCloud keeps per-account collections; the official apps' Favourites is a system collection the client fills.
    private val favoritesListings=java.util.concurrent.ConcurrentHashMap<String,Pair<Long,JSONObject?>>()
    private fun journalKey(a:JSONObject)=a.getString("host")+":"+a.getString("uid")+":"+a.getString("tokenType")+":"+a.getString("token")
    private fun journalFolder(a:JSONObject):String {
        val key=journalKey(a);val now=android.os.SystemClock.elapsedRealtime()
        journalFolders[key]?.let{if(now-it.second<300_000)return it.first}
        var folder="0";for(name in listOf("Sai Photos","Web","v1","Operations"))folder=call("createfolderifnotexists",mapOf("folderid" to folder,"name" to name)).getJSONObject("metadata").get("folderid").toString()
        journalFolders.clear();journalFolders[key]=folder to now
        return folder
    }
    private val requestAccount=ThreadLocal<JSONObject?>()
    fun <T> withSession(block:()->T):T { val previous=requestAccount.get();requestAccount.set(credentials.read());try{return block()}finally{if(previous==null)requestAccount.remove() else requestAccount.set(previous)} }
    fun account(): JSONObject = requestAccount.get() ?: credentials.read() ?: throw CloudError(401, "Connect with your pCloud token first.")
    fun connected(): Boolean = try { credentials.read() != null } catch (_: Exception) { false }
    fun disconnect() { journalListings.clear(); favoritesListings.clear(); credentials.clear() }
    fun call(method: String, params: Map<String, String> = emptyMap()): JSONObject {
        val a = account()
        return callAs(a, method, params)
    }
    fun callAs(a: JSONObject, method: String, params: Map<String, String> = emptyMap(), timeoutSeconds:Long=120): JSONObject {
        if(!testClient){val cm=context.getSystemService(Context.CONNECTIVITY_SERVICE) as android.net.ConnectivityManager;if(cm.activeNetwork==null)throw CloudError(503,"Offline. Previously cached previews may still open; cloud changes retry when internet returns.")}
        require(a.getString("host") in setOf("api.pcloud.com", "eapi.pcloud.com"))
        require(Regex("[a-z0-9_]+").matches(method))
        val form = FormBody.Builder().add(a.getString("tokenType"), a.getString("token"))
        params.forEach { (k,v) -> form.add(k,v) }
        boundedClient.newBuilder().callTimeout(timeoutSeconds,TimeUnit.SECONDS).build().newCall(Request.Builder().url("https://${a.getString("host")}/$method").post(form.build()).build()).execute().use { response ->
            val data = JSONObject(response.body?.string() ?: "{}")
            val code = data.optInt("result", -1)
            if (!response.isSuccessful || code != 0) {
                val expired=code in setOf(1000,2000,2094)
                val message=if(expired)"pCloud login was rejected (code $code). Reconnect with the correct token type and account region. Saved records remain on this device." else if(code==2003)"pCloud denied permission for $method (code $code). Check this token's access to the selected folder." else "pCloud $method failed (code $code). Check connection and retry."
                throw CloudError(if(expired)401 else if(code==2003)403 else 502,message,code)
            }
            return data
        }
    }
    fun verifyAndSaveToken(host:String,tokenType:String,token:String):JSONObject {
        if(host !in setOf("api.pcloud.com","eapi.pcloud.com") || tokenType !in setOf("auth","access_token") || !Regex("[!-~]{1,512}").matches(token)) throw CloudError(400,"pCloud did not return a valid token and region.")
        val checked=callAs(JSONObject().put("host",host).put("tokenType",tokenType).put("token",token),"userinfo",timeoutSeconds=30)
        val uid=checked.optString("userid")
        if(!Regex("[0-9]+").matches(uid))throw CloudError(502,"pCloud account was not confirmed.")
        ai.stopAll();journalListings.clear();favoritesListings.clear();credentials.save(JSONObject().put("host",host).put("tokenType",tokenType).put("token",token).put("uid",uid))
        return JSONObject().put("connected",true)
    }
    fun handle(path: String, method: String, body: String): JSONObject {
        val uri = Uri.parse("https://appassets.androidplatform.net$path")
        val endpoint = uri.lastPathSegment
        val action = uri.getQueryParameter("action") ?: "status"
        val data = if(body.isBlank()) JSONObject() else JSONObject(body)
        if(endpoint == "pcloud-auth") {
            if(action == "status") { val a=credentials.read(); return JSONObject().put("configured",true).put("tokenConfigured",true).put("connected",a!=null).put("accountId",a?.getString("uid") ?: JSONObject.NULL) }
            if(method != "POST") throw CloudError(405,"Method not allowed.")
            if(action == "logout") { ai.stopAll(); journalListings.clear();favoritesListings.clear();credentials.clear(); return JSONObject().put("connected",false) }
            if(action == "token") {
                val host=data.optString("host"); val tokenType=data.optString("tokenType");val token=data.optString("token")
                if(host !in setOf("api.pcloud.com","eapi.pcloud.com") || tokenType !in setOf("auth","access_token") || !Regex("[!-~]{1,512}").matches(token)) throw CloudError(400,"Enter a valid token and region.")
                return verifyAndSaveToken(host,tokenType,token)
            }
            throw CloudError(400,"Android uses Connect with token. No client secret is embedded in the APK.")
        }
        account()
        return when(endpoint) {
            "device-offline" -> {if(method=="GET")offlineList()else if(method=="POST")offlineAction(data)else throw CloudError(405,"Method not allowed.")}
            "account-info" -> {val info=call("userinfo");JSONObject().put("quota",info.optLong("quota")).put("used",info.optLong("usedquota"))}
            "device-export" -> {
                if(method!="POST"||data.optString("format")!="sai-photos-record-export-v1"||body.length>1800000)throw CloudError(400,"Invalid record export.")
                if(android.os.Build.VERSION.SDK_INT<29)throw CloudError(409,"Record export requires Android 10 or newer. Records remain in pCloud.")
                val filename="Sai-Photos-records-${System.currentTimeMillis()}-${data.optInt("page")}.json"
                val values=android.content.ContentValues().apply{put(android.provider.MediaStore.Downloads.DISPLAY_NAME,filename);put(android.provider.MediaStore.Downloads.MIME_TYPE,"application/json");put(android.provider.MediaStore.Downloads.RELATIVE_PATH,"Download/Sai Photos");put(android.provider.MediaStore.Downloads.IS_PENDING,1)}
                val resolver=context.contentResolver;val target=resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,values)?:throw CloudError(503,"Could not create export file.")
                try{resolver.openOutputStream(target)?.use{it.write(body.toByteArray())}?:throw CloudError(503,"Could not write export file.");val done=android.content.ContentValues().apply{put(android.provider.MediaStore.Downloads.IS_PENDING,0)};resolver.update(target,done,null,null)}catch(e:Exception){resolver.delete(target,null,null);throw e}
                JSONObject().put("name",filename)
            }
            "photo-trash" -> {
                if(method=="GET"){
                    val root=call("trash_list",mapOf("folderid" to "0","recursive" to "1")).getJSONObject("metadata");val found=JSONArray();var count=0
                    fun visit(folder:JSONObject){for(item in objects(folder.optJSONArray("contents"))){if(item.optBoolean("isfolder")){visit(item);continue};if(MediaRules.kind(item.optString("name")) !in setOf("photo","video"))continue;count++;if(found.length()<1500)found.put(JSONObject().put("id","pc-${item.get("fileid")}").put("fileName",item.optString("name")).put("size",item.optLong("size")).put("originalFolderId",item.optString("origparentfolderid")))}}
                    visit(root);JSONObject().put("items",found).put("total",count).put("limited",count>found.length())
                }else if(method=="POST"&&data.optBoolean("confirmed")&&MediaRules.validId(data.optString("id"))){
                    val id=data.getString("id");call("trash_restore",mapOf("fileid" to id.removePrefix("pc-")))
                    val a=account();java.io.File(context.cacheDir,"catalog/${a.getString("host")}/${a.getString("uid")}").listFiles()?.forEach{it.delete()}
                    JSONObject().put("restored",true).put("id",id)
                }else throw CloudError(400,"Confirm restoring a specific photo.")
            }

            "device-cache" -> {val a=account();val dir=java.io.File(context.cacheDir,"previews/${a.getString("host")}/${a.getString("uid")}");if(method=="POST"){if(!data.optBoolean("confirmed"))throw CloudError(400,"Confirm clearing device previews.");if(dir.exists()&&!dir.deleteRecursively())throw CloudError(503,"Could not clear device preview cache.")}else if(method!="GET")throw CloudError(405,"Method not allowed.");JSONObject().put("bytes",dir.walkTopDown().filter{it.isFile}.sumOf{it.length()})}

            "media-list" -> { if(method!="GET")throw CloudError(405,"Method not allowed.");val kind=uri.getQueryParameter("kind")?:"";val folder=uri.getQueryParameter("folderid");val cache=catalogFile(kind,folder);if(uri.getQueryParameter("cached")=="1"){if(cache.exists())JSONObject(cache.readText()).put("cached",true)else JSONObject().put("items",JSONArray()).put("cached",true)}else{val result=listMedia(kind,folder);try{val text=result.toString();if(text.length<=20000000){val temp=java.io.File(cache.path+".partial");temp.writeText(text);if(!temp.renameTo(cache))temp.delete()}}catch(_:Exception){};result} }
            "folders" -> {
                val id=uri.getQueryParameter("folderid") ?: "0";if(!Regex("[0-9]{1,20}").matches(id))throw CloudError(400,"Invalid folder.")
                val folder=call("listfolder",mapOf("folderid" to id)).getJSONObject("metadata");val out=JSONArray()
                for(item in objects(folder.optJSONArray("contents")))if(item.optBoolean("isfolder"))out.put(JSONObject().put("id",item.get("folderid").toString()).put("name",item.optString("name")))
                JSONObject().put("id",id).put("name",folder.optString("name","pCloud")).put("folders",out)
            }
            "photo-metadata" -> { if(method!="POST")throw CloudError(405,"Method not allowed."); if(action=="sync")sync(data) else if(action=="write")JSONObject().put("operation",write(data.getJSONObject("operation"))) else throw CloudError(400,"Invalid metadata action.") }
            "photo-delete", "music-delete" -> { if(method!="POST")throw CloudError(405,"Method not allowed.");delete(data,if(endpoint=="photo-delete")"photo" else "audio") }
            "photos-delete" -> {
                if(method!="POST"||!data.optBoolean("confirmed"))throw CloudError(400,"Confirm selected deletion.")
                val items=objects(data.optJSONArray("items"));if(items.isEmpty()||items.size>25||items.map{it.optString("id")}.distinct().size!=items.size)throw CloudError(400,"Invalid deletion batch.")
                val results=JSONArray();for(item in items)try { results.put(delete(JSONObject(item.toString()).put("confirmed",true),"photo")) } catch(e:Exception) { results.put(JSONObject().put("id",item.optString("id")).put("deleted",false).put("error",e.message)) };JSONObject().put("results",results)
            }
            "photos-transfer" -> {
                if(method!="POST"||!data.optBoolean("confirmed"))throw CloudError(400,"Confirm the copy or move.")
                val action=data.optString("action");if(action!="copy"&&action!="move")throw CloudError(400,"Choose copy or move.")
                val target=data.optString("targetFolderId");if(!Regex("[0-9]{1,20}").matches(target))throw CloudError(400,"Choose a destination folder.")
                val items=objects(data.optJSONArray("items"));if(items.isEmpty()||items.size>25||items.map{it.optString("id")}.distinct().size!=items.size)throw CloudError(400,"Invalid transfer batch.")
                val results=JSONArray()
                for(item in items){val id=item.optString("id");try{
                    if(!Regex("pc-\\d{1,20}").matches(id))throw CloudError(400,"Invalid photo.")
                    val name=item.optString("fileName");if(name.isBlank()||name.length>1024)throw CloudError(400,"Invalid file name.")
                    call(if(action=="move")"renamefile" else "copyfile",mapOf("fileid" to id.removePrefix("pc-"),"topath" to target,"toname" to name))
                    results.put(if(action=="move")JSONObject().put("id",id).put("moved",true) else JSONObject().put("id",id).put("copied",true))
                }catch(e:Exception){results.put(JSONObject().put("id",id).put("error",e.message?:"Could not "+action+" this photo."))}}
                JSONObject().put("results",results)
            }
            "favorite-sync" -> favoriteSync(method,data,action)
            "photo-analysis", "music-analysis" -> ai.handle(endpoint=="music-analysis",method,data)
            else -> throw CloudError(404,"Unknown app endpoint.")
        }
    }
    private fun catalogFile(kind:String,folder:String?):java.io.File {
        if(kind !in setOf("photo","audio")||folder!=null&&!Regex("[0-9]{1,20}").matches(folder))throw CloudError(400,"Invalid catalog.")
        val a=account();val dir=java.io.File(context.cacheDir,"catalog/${a.getString("host")}/${a.getString("uid")}").apply{mkdirs()};return java.io.File(dir,"$kind-${folder?:"default"}.json")
    }
    fun listMedia(kind: String, folderId: String?): JSONObject {
        if(kind !in setOf("photo","audio") || folderId!=null&&!Regex("[0-9]{1,20}").matches(folderId))throw CloudError(400,"Invalid library folder.")
        val targets=if(folderId!=null)listOf(mapOf("folderid" to folderId)) else if(kind=="photo")listOf("/Pictures","/Automatic Upload","/Automatic Folder").map{mapOf("path" to it)} else listOf("/Music","/My Music","/Relax Music").map{mapOf("path" to it)}
        val items=linkedMapOf<String,JSONObject>();val scanned=mutableSetOf<String>();val missing=JSONArray();val unavailable=JSONArray()
        fun visit(folder:JSONObject,path:String) {
            for(item in objects(folder.optJSONArray("contents"))) {
                if(item.optBoolean("isfolder")) { visit(item,path.trimEnd('/')+"/"+item.optString("name"));continue }
                val id=item.get("fileid").toString();scanned.add(id);val fileName=item.optString("name");val mediaType=MediaRules.kind(fileName);if(mediaType!=kind&&!(kind=="photo"&&mediaType=="video"))continue
                val date=item.optString("created",item.optString("modified"));val added=MediaRules.photoDate(date)
                items[id]=JSONObject().put("id","pc-$id").put("mediaType",mediaType).put("name",fileName.substringBeforeLast('.')).put("fileName",fileName).put("size",item.optLong("size")).put("folderName",folder.optString("name","pCloud")).put("folderPath",path.ifBlank{"/"}).put("folderId",folder.get("folderid").toString()).put("addedAt",added).put("version",item.optString("hash",item.optString("modified"))).put("contentHash",item.optString("hash")).put("width",item.optInt("width")).put("height",item.optInt("height"))
            }
        }
        for(target in targets)try{
            if(folderId=="0"){
                val queue=java.util.ArrayDeque<Pair<String,String>>();queue.add("0" to "/");val seen=mutableSetOf<String>();val deadline=System.currentTimeMillis()+110000
                val snapshot=JSONObject(account().toString());val pool=java.util.concurrent.Executors.newFixedThreadPool(4)
                try { while(queue.isNotEmpty()) {
                    if(System.currentTimeMillis()>deadline||seen.size>=20000){unavailable.put("Scan paused before all folders were read. Refresh or choose a smaller folder");break}
                    val batch=mutableListOf<Pair<String,String>>()
                    while(queue.isNotEmpty()&&batch.size<4){val next=queue.removeFirst();if(seen.add(next.first))batch.add(next)}
                    val jobs=batch.map { (id,_) -> java.util.concurrent.Callable<JSONObject>{callAs(snapshot,"listfolder",mapOf("folderid" to id,"recursive" to "0"),20).getJSONObject("metadata")} }
                    val tasks=pool.invokeAll(jobs,25,TimeUnit.SECONDS)
                    for((index,task)in tasks.withIndex()) {
                        val (id,path)=batch[index]
                        val folder=try { task.get() }catch(e:Exception){val cause=e.cause?:e;if(id=="0")throw (cause as? CloudError?:CloudError(502,"Could not read pCloud folders. Check connection and retry."));unavailable.put(path);continue}
                        val files=JSONArray();for(item in objects(folder.optJSONArray("contents"))){if(item.optBoolean("isfolder"))queue.add(item.get("folderid").toString() to path.trimEnd('/')+"/"+item.optString("name"))else files.put(item)}
                        folder.put("contents",files);visit(folder,path)
                    }
                } } finally {pool.shutdownNow()}

            }else{val folder=call("listfolder",target+mapOf("recursive" to "1")).getJSONObject("metadata");visit(folder,target["path"] ?: folder.optString("path",folder.optString("name")))}
        }catch(e:CloudError){if(folderId==null&&e.code in setOf(2002,2005,2055))missing.put(target["path"])else throw e}
        return JSONObject().put("items",JSONArray(items.values.sortedByDescending{it.optLong("addedAt")})).put("scan",JSONObject().put("totalFiles",scanned.size).put("otherFiles",scanned.size-items.size).put("missingPaths",missing).put("unavailableFolders",unavailable).put("complete",unavailable.length()==0))
    }
    fun link(fileId: String,video:Boolean=false): String {
        val data=call(if(video)"getvideolink" else "getfilelink",mapOf("fileid" to fileId));val host=data.getJSONArray("hosts").getString(0);val path=data.getString("path")
        if(!MediaRules.trustedDownload(host)||!path.startsWith("/")||path.startsWith("//"))throw CloudError(502,"Untrusted download link.")
        return "https://$host$path"
    }
    fun readRecord(fileId: String, fresh:Boolean=false): JSONObject {
        if(!Regex("[0-9]{1,20}").matches(fileId))throw CloudError(400,"Invalid record ID.")
        val a=account();val dir=java.io.File(context.cacheDir,"records/${a.getString("host")}/${a.getString("uid")}").apply{mkdirs()};val file=java.io.File(dir,"$fileId.json")
        if(!fresh&&file.exists())try{return JSONObject(file.readText())}catch(_:Exception){file.delete()}
        var address=link(fileId)
        val recordClient=boundedClient.newBuilder().callTimeout(20,TimeUnit.SECONDS).build()
        repeat(4) { hop ->
            recordClient.newCall(Request.Builder().url(address).build()).execute().use { response ->
                if(response.code in setOf(301,302,303,307,308)) {
                    val destination=response.request.url.resolve(response.header("Location")?:"")?:throw CloudError(502,"Record redirect is invalid.")
                    if(hop==3||destination.scheme!="https"||!MediaRules.trustedDownload(destination.host))throw CloudError(502,"Record redirect is not trusted.")
                    address=destination.toString()
                } else {
                    if(!response.isSuccessful)throw CloudError(502,"Could not restore app record (HTTP ${response.code}, file $fileId).")
                    val stream=response.body?.byteStream()?:throw CloudError(502,"Empty app record.")
                    val bytes=stream.use { input -> val output=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192);while(output.size()<=1_000_000){val count=input.read(buffer);if(count<0)break;output.write(buffer,0,count)};output.toByteArray() }
                    if(bytes.size>1_000_000)throw CloudError(502,"App record is too large (file $fileId).")
                    val text=bytes.toString(Charsets.UTF_8);val record=try{JSONObject(text)}catch(_:Exception){throw CloudError(502,"Unreadable app record (file $fileId).")}
                    val temp=java.io.File(dir,"$fileId-${java.util.UUID.randomUUID()}.partial")
                    try{temp.writeText(text);temp.renameTo(file)}catch(_:Exception){}finally{temp.delete()}
                    return record
                }
            }
        }
        throw CloudError(502,"Record redirect limit exceeded.")
    }

    @Synchronized fun write(input: JSONObject): JSONObject {
        val id=input.optString("id");if(!Regex("[a-f0-9-]{36}").matches(id)||input.toString().length>1_000_000)throw CloudError(400,"Invalid app record.")
        try{return readRecord(call("stat",mapOf("path" to "$root/$id.json")).getJSONObject("metadata").get("fileid").toString())}catch(e:CloudError){if(e.code !in setOf(2002,2005,2009,2055))throw e}
        val folder=journalFolder(account())
        val operation=JSONObject(input.toString()).put("at",System.currentTimeMillis())
        val a=account();journalListings.remove(journalKey(a));val payload=MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart(a.getString("tokenType"),a.getString("token")).addFormDataPart("folderid",folder).addFormDataPart("nopartial","1").addFormDataPart("file","$id.json",operation.toString().toRequestBody("application/json".toMediaType())).build()
        val saved=boundedClient.newCall(Request.Builder().url("https://${a.getString("host")}/uploadfile?folderid=$folder&nopartial=1").post(payload).build()).execute().use{r->JSONObject(r.body?.string()?:"{}")}
        if(saved.optInt("result",-1)!=0){journalFolders.remove(journalKey(a));throw CloudError(502,"Could not save app record (pCloud code ${saved.optInt("result")}). Pending changes are retained.",saved.optInt("result"))}
        val verified=readRecord(saved.getJSONArray("metadata").getJSONObject(0).get("fileid").toString(),true)
        if(!sameJson(operation,verified))throw CloudError(502,"Saved record verification failed.")
        return verified
    }
    private fun sync(data:JSONObject):JSONObject {
        val known= data.optJSONArray("known")?:throw CloudError(400,"Invalid sync request.");if(known.length()>90000)throw CloudError(400,"Too many records.")
        val ids=(0 until known.length()).map{known.getString(it)}.toSet();val folder=try{
            val key=journalKey(account());val now=android.os.SystemClock.elapsedRealtime();val cached=journalListings[key]
            if(cached!=null&&now-cached.first<30_000)JSONObject(cached.second) else {
                val fresh=call("listfolder",mapOf("path" to root)).getJSONObject("metadata")
                journalListings[key]=now to fresh.toString();fresh
            }
        }catch(e:CloudError){if(e.code in setOf(2002,2005,2055))return JSONObject().put("operations",JSONArray()) else throw e}
        val missing=objects(folder.optJSONArray("contents")).filter{!it.optBoolean("isfolder")&&Regex("[a-f0-9-]{36}\\.json").matches(it.optString("name"))&&it.getString("name").removeSuffix(".json") !in ids}
        val operations=JSONArray();val skipped=JSONArray();val errors=linkedSetOf<String>()
        val snapshot=JSONObject(account().toString());val pool=java.util.concurrent.Executors.newFixedThreadPool(4)
        try {
            val page=missing.take(24)
            val jobs=page.map { file -> java.util.concurrent.Callable<JSONObject> {
                val previous=requestAccount.get();requestAccount.set(snapshot)
                try { val op=readRecord(file.get("fileid").toString());if(op.optString("id")!=file.getString("name").removeSuffix(".json"))throw CloudError(502,"Record mismatch.");op }
                finally { if(previous==null)requestAccount.remove()else requestAccount.set(previous) }
            } }
            // Return successful records even when another download stalls. Stay below the WebView bridge deadline.
            val tasks=pool.invokeAll(jobs,75,TimeUnit.SECONDS)
            for((index,task)in tasks.withIndex())try { operations.put(task.get()) }catch(e:Exception){skipped.put(page[index].getString("name").removeSuffix(".json"));val cause=e.cause?:e;errors.add(if(cause is CloudError)cause.message?:"Record download failed." else "A record download timed out or could not be read.")}
        } finally { pool.shutdownNow() }
        return JSONObject().put("operations",operations).put("skipped",skipped).put("more",missing.size>24).put("error",errors.take(3).joinToString(" "))
    }

    private fun delete(data:JSONObject,kind:String):JSONObject {
        val id=data.optString("id");if(!MediaRules.validId(id)||!data.optBoolean("confirmed")||data.optString("fileName").isBlank())throw CloudError(400,"Confirm this file before deleting.")
        val current=try{call("stat",mapOf("fileid" to id.removePrefix("pc-"))).getJSONObject("metadata")}catch(e:CloudError){if(e.code in setOf(2009,2055))return JSONObject().put("id",id).put("deleted",true).put("alreadyDeleted",true) else throw e}
        if(current.optBoolean("isfolder")||(MediaRules.kind(current.optString("name"))!=kind&&!(kind=="photo"&&MediaRules.kind(current.optString("name"))=="video")))throw CloudError(400,"Unsupported deletion.")
        if(current.optString("name")!=data.getString("fileName") || data.has("version")&&!MediaRules.sameFileVersion(data.getString("version"),current.optString("hash",current.optString("modified"))))throw CloudError(409,"File changed. Refresh and review again.")
        if(current.has("candelete")&&!current.optBoolean("candelete"))throw CloudError(403,"Shared folder does not grant delete permission.")
        val removed=call("deletefile",mapOf("fileid" to id.removePrefix("pc-"))).getJSONObject("metadata")
        if(!removed.optBoolean("isdeleted")||removed.get("fileid").toString()!=id.removePrefix("pc-"))throw CloudError(502,"Deletion was not confirmed.")
        try{val a=account();java.io.File(context.cacheDir,"catalog/${a.getString("host")}/${a.getString("uid")}").listFiles()?.forEach{it.delete()};java.io.File(context.cacheDir,"previews/${a.getString("host")}/${a.getString("uid")}").listFiles()?.filter{it.name.startsWith(id.removePrefix("pc-")+"-")}?.forEach{it.delete()}}catch(_:Exception){}
        return JSONObject().put("id",id).put("deleted",true)
    }
    // pCloud generates a system collection for Favourites; clients fill it with collection_linkfiles.
    private fun favoritesCollection(withFiles:Boolean):JSONObject? {
        val a=account();val key=journalKey(a);val now=android.os.SystemClock.elapsedRealtime()
        if(!withFiles)favoritesListings[key]?.takeIf{now-it.first<300_000}?.let{return it.second}
        val params=if(withFiles)mapOf("showfiles" to "1","pagesize" to "5000") else emptyMap()
        val match=objects(call("collection_list",params).optJSONArray("collections")).firstOrNull{it.optBoolean("system")&&Regex("(?i)favou?rites?").containsMatchIn(it.optString("name"))}
        if(!withFiles)favoritesListings[key]=now to match
        return match
    }
    private fun favoritesNotFound()=CloudError(404,"pCloud Favourites was not found on this account yet. In pCloud’s own app, tap the star on any photo once, then sync again.")
    private fun favoriteSync(method:String,data:JSONObject,queryAction:String):JSONObject {
        if(method=="GET"){
            val collection=favoritesCollection(true)?:return JSONObject().put("found",false)
            val fileIds=JSONArray();for(item in objects(collection.optJSONArray("contents")))if(!item.optBoolean("isfolder")&&item.has("fileid"))fileIds.put("pc-"+item.get("fileid"))
            val items=collection.optInt("items",fileIds.length())
            return JSONObject().put("found",true).put("collectionId",collection.opt("id")).put("name",collection.optString("name","Favorites")).put("items",items).put("fileIds",fileIds).put("truncated",fileIds.length()<items)
        }
        if(method!="POST")throw CloudError(405,"Method not allowed.")
        val action=if(data.has("action"))data.optString("action") else queryAction
        if(action=="link"||action=="unlink"){
            val id=data.optString("photoId");if(!Regex("pc-\\d{1,20}").matches(id))throw CloudError(400,"Choose a photo first.")
            val collection=favoritesCollection(false)?:throw favoritesNotFound()
            val fileId=id.removePrefix("pc-")
            try{
                if(action=="link")call("collection_linkfiles",mapOf("collectionid" to collection.get("id").toString(),"fileids" to fileId,"noitems" to "1"))
                else call("collection_unlinkfiles",mapOf("collectionid" to collection.get("id").toString(),"fileids" to fileId))
                return JSONObject().put("synced",true).put("photoId",id)
            }catch(e:CloudError){
                val already=if(action=="link")e.code==2072 else e.code==2009
                if(already)return JSONObject().put("synced",true).put("photoId",id).put("already",true)
                throw e
            }
        }
        if(action=="update"){
            val add=(0 until (data.optJSONArray("add")?.length()?:0)).map{data.getJSONArray("add").optString(it)}
            val remove=(0 until (data.optJSONArray("remove")?.length()?:0)).map{data.getJSONArray("remove").optString(it)}
            if(add.size+remove.size>2000)throw CloudError(400,"Too many favourites in one sync.")
            for(id in add+remove)if(!Regex("pc-\\d{1,20}").matches(id))throw CloudError(400,"Choose valid photos.")
            val collection=favoritesCollection(false)?:throw favoritesNotFound()
            val collectionId=collection.get("id").toString();var linked=0;var unlinked=0
            for(chunk in add.chunked(100)){call("collection_linkfiles",mapOf("collectionid" to collectionId,"fileids" to chunk.map{it.removePrefix("pc-")}.joinToString(","),"noitems" to "1"));linked+=chunk.size}
            for(chunk in remove.chunked(100)){call("collection_unlinkfiles",mapOf("collectionid" to collectionId,"fileids" to chunk.map{it.removePrefix("pc-")}.joinToString(",")));unlinked+=chunk.size}
            favoritesListings.remove(journalKey(account()))
            return JSONObject().put("linked",linked).put("unlinked",unlinked)
        }
        throw CloudError(400,"Invalid favourites action.")
    }
    fun previewBytes(fileId:String,version:String,preview:Boolean):ByteArray {
        if(!Regex("[0-9]{1,20}").matches(fileId)||version.length>199)throw CloudError(400,"Invalid preview.")
        val a=account();val dir=java.io.File(context.cacheDir,"previews/${a.getString("host")}/${a.getString("uid")}").apply{mkdirs()}
        val signature=java.security.MessageDigest.getInstance("SHA-256").digest((version+":"+preview).toByteArray()).joinToString(""){"%02x".format(it)};val cache=java.io.File(dir,"$fileId-$signature.jpg")
        if(cache.exists())try{cache.setLastModified(System.currentTimeMillis());return cache.readBytes()}catch(_:Exception){cache.delete()}
        val url=HttpUrl.Builder().scheme("https").host(a.getString("host")).addPathSegment("getthumb").addQueryParameter(a.getString("tokenType"),a.getString("token")).addQueryParameter("fileid",fileId).addQueryParameter("size",if(preview)"640x480" else "320x320").addQueryParameter("crop",if(preview)"0" else "1").build()
        val bytes=boundedClient.newCall(Request.Builder().url(url).build()).execute().use{r->if(!r.isSuccessful||r.header("Content-Type")?.startsWith("image/")!=true)throw CloudError(502,"Preview unavailable.");val body=r.body?:throw CloudError(502,"Preview unavailable.");body.byteStream().use{stream->val out=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192);while(true){val count=stream.read(buffer);if(count<0)break;if(out.size()+count>5*1024*1024)throw CloudError(502,"Preview exceeds memory limit.");out.write(buffer,0,count)};out.toByteArray()}}
        try{val temp=java.io.File(dir,cache.name+".partial");temp.writeBytes(bytes);if(!temp.renameTo(cache))temp.delete();val files=dir.listFiles()?.filter{it.extension=="jpg"}?.sortedBy{it.lastModified()}?:emptyList();var size=files.sumOf{it.length()};for(file in files){if(size<=128L*1024*1024)break;val length=file.length();if(file.delete())size-=length}}catch(_:Exception){}
        return bytes
    }
    fun uploadPhoto(uri:Uri,folderId:String?,owner:String):JSONObject {
        val a=account();if(a.getString("host")+":"+a.getString("uid")!=owner)throw CloudError(409,"Account changed. Upload paused.")
        if(uri.scheme!="content")throw CloudError(400,"Choose photos using Android’s file picker.")
        var name="";var size=-1L;context.contentResolver.query(uri,arrayOf(android.provider.OpenableColumns.DISPLAY_NAME,android.provider.OpenableColumns.SIZE),null,null,null)?.use{cursor->if(cursor.moveToFirst()){name=cursor.getString(0)?:"";if(!cursor.isNull(1))size=cursor.getLong(1)}}
        if(MediaRules.kind(name)!="photo"||name.length>255||size>100L*1024*1024)throw CloudError(413,"Choose a supported photo smaller than 100 MB.")
        var target=folderId;if(target!=null&&!Regex("[0-9]{1,20}").matches(target))throw CloudError(400,"Invalid upload folder.")
        if(target==null){var id="0";for(part in listOf("Pictures","Sai Photos Uploads"))id=call("createfolderifnotexists",mapOf("folderid" to id,"name" to part)).getJSONObject("metadata").get("folderid").toString();target=id}
        val fileBody=object:RequestBody(){override fun contentType()="application/octet-stream".toMediaType();override fun contentLength()=size;override fun writeTo(sink:okio.BufferedSink){context.contentResolver.openInputStream(uri)?.use{input->val buffer=ByteArray(65536);var copied=0L;while(true){if(Thread.currentThread().isInterrupted)throw java.io.IOException("Upload interrupted.");val count=input.read(buffer);if(count<0)break;copied+=count;if(copied>100L*1024*1024)throw java.io.IOException("Photo exceeds 100 MB.");sink.write(buffer,0,count)};if(size>=0&&copied!=size)throw java.io.IOException("Photo size changed.")}?:throw java.io.IOException("Photo could not be read.")}}
        val payload=MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart(a.getString("tokenType"),a.getString("token")).addFormDataPart("folderid",target).addFormDataPart("renameifexists","1").addFormDataPart("nopartial","1").addFormDataPart("file",name,fileBody).build()
        val saved=boundedClient.newCall(Request.Builder().url("https://${a.getString("host")}/uploadfile").post(payload).build()).execute().use{r->if(!r.isSuccessful)throw CloudError(502,"Photo upload failed.");JSONObject(r.body?.string()?:"{}")}
        if(saved.optInt("result",-1)!=0)throw CloudError(502,"pCloud upload failed (code ${saved.optInt("result")}).",saved.optInt("result"))
        val meta=saved.getJSONArray("metadata").getJSONObject(0);if(meta.optBoolean("isfolder")||MediaRules.kind(meta.optString("name"))!="photo"||size>=0&&meta.optLong("size")!=size)throw CloudError(502,"pCloud did not confirm the photo upload.")
        return JSONObject().put("id","pc-${meta.get("fileid")}").put("name",meta.optString("name"))
    }

    fun uploadBytes(bytes:ByteArray,name:String,folderId:String?,owner:String):JSONObject {
        val a=account();if(a.getString("host")+":"+a.getString("uid")!=owner)throw CloudError(409,"Account changed. Upload paused.")
        if(MediaRules.kind(name)!="photo"||name.length>255||bytes.size>100*1024*1024)throw CloudError(413,"Edited photo must be a supported image smaller than 100 MB.")
        var target=folderId;if(target!=null&&!Regex("[0-9]{1,20}").matches(target))throw CloudError(400,"Invalid upload folder.")
        if(target==null){var id="0";for(part in listOf("Pictures","Sai Photos Uploads"))id=call("createfolderifnotexists",mapOf("folderid" to id,"name" to part)).getJSONObject("metadata").get("folderid").toString();target=id}
        val fileBody=bytes.toRequestBody("application/octet-stream".toMediaType())
        val payload=MultipartBody.Builder().setType(MultipartBody.FORM).addFormDataPart(a.getString("tokenType"),a.getString("token")).addFormDataPart("folderid",target).addFormDataPart("renameifexists","1").addFormDataPart("nopartial","1").addFormDataPart("file",name,fileBody).build()
        val saved=boundedClient.newCall(Request.Builder().url("https://${a.getString("host")}/uploadfile").post(payload).build()).execute().use{r->if(!r.isSuccessful)throw CloudError(502,"Edited photo upload failed.");JSONObject(r.body?.string()?:"{}")}
        if(saved.optInt("result",-1)!=0)throw CloudError(502,"pCloud upload failed (code ${saved.optInt("result")}).",saved.optInt("result"))
        val meta=saved.getJSONArray("metadata").getJSONObject(0);if(meta.optBoolean("isfolder")||MediaRules.kind(meta.optString("name"))!="photo")throw CloudError(502,"pCloud did not confirm the edited photo upload.")
        return JSONObject().put("id","pc-${meta.get("fileid")}").put("name",meta.optString("name")).put("size",meta.optLong("size"))
    }
    fun downloadFile(fileId:String):ByteArray {
        val data=call("getfilelink",mapOf("fileid" to fileId));val host=data.getJSONArray("hosts").getString(0);val path=data.getString("path")
        val request=Request.Builder().url("https://$host$path").build()
        client.newCall(request).execute().use { response ->
            if(!response.isSuccessful)throw CloudError(502,"Download failed. Check your connection and retry.")
            val body=response.body?:throw CloudError(502,"Download failed. Check your connection and retry.")
            val bytes=body.bytes();if(bytes.size>80_000_000)throw CloudError(413,"This file is too large to copy to the device (limit 80 MB).")
            return bytes
        }
    }
    fun batteryCharging():Boolean = try{(context.getSystemService(Context.BATTERY_SERVICE) as? android.os.BatteryManager)?.isCharging?:false}catch(_:Exception){false}
    fun batteryLow():Boolean = try{
        val manager=context.getSystemService(Context.BATTERY_SERVICE) as? android.os.BatteryManager
        val level=manager?.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY)?:-1
        val charging=manager?.isCharging?:false
        level in 0..14&&!charging
    }catch(_:Exception){false}
    private fun offlineDir():java.io.File {val a=account();return java.io.File(context.filesDir,"offline-photos/${a.getString("host")}/${a.getString("uid")}").apply{mkdirs()}}
    private fun offlineKey(id:String,version:String):String=id.removePrefix("pc-")+"-"+java.security.MessageDigest.getInstance("SHA-256").digest(version.toByteArray()).joinToString(""){"%02x".format(it)}
    private fun offlineList():JSONObject {val dir=offlineDir();val items=JSONArray();for(file in dir.listFiles()?:emptyArray()){if(file.extension!="json")continue;try{val item=JSONObject(file.readText());if(java.io.File(dir,file.nameWithoutExtension+".bin").exists())items.put(item)}catch(_:Exception){}};return JSONObject().put("items",items).put("bytes",dir.listFiles()?.filter{it.extension=="bin"}?.sumOf{it.length()}?:0).put("limit",512L*1024*1024)}
    @Synchronized private fun offlineAction(data:JSONObject):JSONObject {
        val dir=offlineDir();val action=data.optString("action");if(action=="clear"&&data.optBoolean("confirmed")){if(!dir.deleteRecursively())throw CloudError(503,"Could not clear offline photos.");return JSONObject().put("cleared",true)}
        val id=data.optString("id");if(!MediaRules.validId(id))throw CloudError(400,"Invalid offline photo ID.")
        if(action=="remove"){dir.listFiles()?.filter{it.name.startsWith(id.removePrefix("pc-")+"-")}?.forEach{it.delete()};return JSONObject().put("removed",true)}
        val version=data.optString("version");if(action!="download"||version.length>200)throw CloudError(400,"Invalid offline request.")
        val key=offlineKey(id,version);val output=java.io.File(dir,"$key.bin");if(output.exists())return JSONObject().put("saved",true).put("bytes",output.length())
        val item=call("stat",mapOf("fileid" to id.removePrefix("pc-"))).getJSONObject("metadata");if(item.optBoolean("isfolder")||MediaRules.kind(item.optString("name"))!="photo"||!MediaRules.sameFileVersion(version,item.optString("hash",item.optString("modified"))))throw CloudError(409,"Photo changed. Refresh before downloading.")
        val size=item.optLong("size");if(size<=0||size>100L*1024*1024)throw CloudError(413,"Offline photos must be smaller than 100 MB.")
        val used=dir.listFiles()?.filter{it.extension=="bin"}?.sumOf{it.length()}?:0;if(used+size>512L*1024*1024||dir.usableSpace<size+64L*1024*1024)throw CloudError(413,"Offline photo storage is full. Remove copies in Settings.")
        val partial=java.io.File(dir,"$key.partial");try{client.newCall(Request.Builder().url(link(id.removePrefix("pc-"))).build()).execute().use{response->if(!response.isSuccessful)throw CloudError(502,"Could not download original.");val input=response.body?.byteStream()?:throw CloudError(502,"Original unavailable.");partial.outputStream().use{out->val buffer=ByteArray(65536);var copied=0L;while(true){val count=input.read(buffer);if(count<0)break;copied+=count;if(copied>size)throw CloudError(502,"Original size changed.");out.write(buffer,0,count)};if(copied!=size)throw CloudError(502,"Original download was incomplete.")}};if(!partial.renameTo(output))throw CloudError(503,"Could not save offline original.")
            java.io.File(dir,"$key.json").writeText(JSONObject().put("id",id).put("version",version).put("name",item.optString("name")).put("size",size).toString())
            return JSONObject().put("saved",true).put("bytes",size)
        }catch(e:Exception){partial.delete();output.delete();throw e}
    }

    fun binary(uri:Uri,headers:Map<String,String>):WebResourceResponse {
        val id=uri.getQueryParameter("id") ?: "";if(!MediaRules.validId(id))throw CloudError(400,"Invalid media ID.")
        val fileId=id.removePrefix("pc-");val preview=uri.getQueryParameter("preview")=="1";val thumb=uri.getQueryParameter("thumbnail")=="1"
        if(preview||thumb){val bytes=previewBytes(fileId,uri.getQueryParameter("version")?:"",preview);return WebResourceResponse("image/jpeg",null,200,"OK",mapOf("Cache-Control" to "no-store"),ByteArrayInputStream(bytes))}
        val offline=java.io.File(offlineDir(),offlineKey(id,uri.getQueryParameter("version")?:"")+".bin")
        if(offline.exists()){val meta=JSONObject(java.io.File(offline.parentFile,offline.nameWithoutExtension+".json").readText());val mime=when(meta.optString("name").substringAfterLast('.').lowercase()){ "png"->"image/png";"gif"->"image/gif";"webp"->"image/webp";"heic","heif"->"image/heic";else->"image/jpeg"};return WebResourceResponse(mime,null,200,"OK",mapOf("Cache-Control" to "no-store","Content-Length" to offline.length().toString()),offline.inputStream())}
        val request=if(preview||thumb){
            val a=account();val url=HttpUrl.Builder().scheme("https").host(a.getString("host")).addPathSegment("getthumb").addQueryParameter(a.getString("tokenType"),a.getString("token")).addQueryParameter("fileid",fileId).addQueryParameter("size",if(preview)"640x480" else "320x320").addQueryParameter("crop",if(preview)"0" else "1").build();Request.Builder().url(url).build()
        }else Request.Builder().url(link(fileId,uri.getQueryParameter("video")=="1")).apply{headers.entries.find{it.key.equals("range",true)}?.let{header("Range",it.value)}}.build()
        val r=client.newCall(request).execute();val body=r.body?:run{r.close();throw CloudError(502,"Media unavailable.")}
        if(r.code !in setOf(200,206,416)){r.close();throw CloudError(502,"Media unavailable.")}
        val out=mutableMapOf("Cache-Control" to "no-store");for(name in listOf("Content-Range","Accept-Ranges","Content-Length"))r.header(name)?.let{out[name]=it}
        val stream=object:java.io.FilterInputStream(body.byteStream()){override fun close(){super.close();r.close()}}
        return WebResourceResponse(r.header("Content-Type","application/octet-stream")!!.substringBefore(';'),null,r.code,if(r.code==206)"Partial Content" else if(r.code==416)"Range Not Satisfiable" else "OK",out,stream)
    }
    companion object {
        fun objects(array:JSONArray?)=(0 until (array?.length()?:0)).map{array!!.getJSONObject(it)}
        fun sameJson(a:Any?,b:Any?):Boolean=when {a is Number&&b is Number -> java.math.BigDecimal(a.toString()).compareTo(java.math.BigDecimal(b.toString()))==0;a is JSONObject&&b is JSONObject -> a.keys().asSequence().toSet()==b.keys().asSequence().toSet()&&a.keys().asSequence().all{sameJson(a.get(it),b.get(it))};a is JSONArray&&b is JSONArray -> a.length()==b.length()&&(0 until a.length()).all{sameJson(a.get(it),b.get(it))};else->a==b}
    }
}
