package com.saiphotos.mobile

import android.graphics.BitmapFactory
import org.json.JSONObject
import org.json.JSONArray
import okhttp3.Request
import okhttp3.HttpUrl
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.Future

class LocalAI(private val api:PCloudApi) {
    private val worker=Executors.newSingleThreadExecutor()
    private val previewer=java.util.concurrent.ThreadPoolExecutor(1,1,30L,java.util.concurrent.TimeUnit.SECONDS,java.util.concurrent.LinkedBlockingQueue<Runnable>()).apply{allowCoreThreadTimeOut(true)}
    private val engine=ClipEngine(api)
    private val jobs=mutableMapOf<Boolean,Job>()
    private var stopped=false
    class Job(val folder:String?) {
        @Volatile var libraryTotal=0;@Volatile var alreadyIndexed=0;@Volatile var updatedAt=System.currentTimeMillis();@Volatile var currentPhoto="";val known=java.util.concurrent.ConcurrentHashMap<String,String>();val checksums=java.util.concurrent.ConcurrentHashMap<String,String>();
        val startedAt=System.currentTimeMillis();@Volatile var changed=0;@Volatile var checksumTotal=0;@Volatile var checksumCompleted=0;
        @Volatile var running=true;@Volatile var stop=false;@Volatile var total=0;@Volatile var completed=0;@Volatile var failed=0;@Volatile var phase="Starting";@Volatile var message=""
        fun json()=JSONObject().put("running",running).put("total",total).put("completed",completed).put("failed",failed).put("phase",phase).put("message",message).put("folderId",folder?:JSONObject.NULL).put("libraryTotal",libraryTotal).put("alreadyIndexed",alreadyIndexed).put("updatedAt",updatedAt).put("currentPhoto",currentPhoto).put("startedAt",startedAt).put("changed",changed).put("checksumTotal",checksumTotal).put("checksumCompleted",checksumCompleted)
    }
    fun shutdown(){stopAll();worker.shutdown();previewer.shutdownNow()}
    @Synchronized fun stopAll(){jobs.values.forEach{it.stop=true};stopped=true}
    @Synchronized fun handle(music:Boolean,method:String,body:JSONObject):JSONObject {
        if(method=="GET")return jobs[music]?.json()?:JSONObject().put("running",false).put("total",0)
        if(method!="POST")throw CloudError(405,"Method not allowed.")
        when(body.optString("action")) {
            "known"->{val job=jobs[music]?:return JSONObject().put("running",false);for(item in PCloudApi.objects(body.optJSONArray("known"))){val id=item.optString("id");val version=item.optString("version");if(!MediaRules.validId(id)||version.length>=200)throw CloudError(400,"Invalid saved index.");job.known[id]=version};for(item in PCloudApi.objects(body.optJSONArray("checksums")))if(MediaRules.validId(item.optString("id")))job.checksums[item.getString("id")]=item.optString("version");return job.json()}
            "stop"->{jobs[music]?.stop=true;return jobs[music]?.json()?:JSONObject().put("running",false)}
            "text"->{val query=body.optString("query");if(query.isBlank()||query.length>300)throw CloudError(400,"Invalid search.")
                // Search waits for the current image only; queued work yields between images.
                val values=synchronized(engine){engine.text(query,music)}
                return JSONObject().put("embedding",JSONArray(values.map{it.toDouble()})).put("model",if(music)"clip-music-title-q8-v1" else "clip-base32-q8-v1")
            }
            "start"->{
                val known=body.optJSONArray("known")?:throw CloudError(400,"Invalid index request.");if(known.length()>90000)throw CloudError(400,"Too many records.")
                val folder=if(body.isNull("folderId"))null else body.optString("folderId").takeIf{it.isNotEmpty()};if(folder!=null&&!Regex("[0-9]{1,20}").matches(folder))throw CloudError(400,"Invalid folder.")
                val old=jobs[music];if(old?.running==true){if(old.stop||old.folder!=folder)throw CloudError(409,"Previous indexing is stopping. Wait and start again.");return old.json()}
                stopped=false;val job=Job(folder);jobs[music]=job;val identity=api.account().getString("host")+":"+api.account().getString("uid");worker.execute{api.withSession { run(music,job,body,identity) }};return job.json()
            }
            else->throw CloudError(400,"Unknown indexing action.")
        }
    }
    private fun run(music:Boolean,job:Job,body:JSONObject,identity:String) {
        fun active()=!job.stop&&!stopped&&api.credentials.read()?.let{it.optString("host")+":"+it.optString("uid")}==identity
        try{
            if(!active()){job.phase="Paused";return}
            job.phase="Loading pCloud library"
            val listing=api.listMedia(if(music)"audio" else "photo",job.folder);if(listing.getJSONObject("scan").optBoolean("complete",true)==false)throw CloudError(409,"Some folders cannot be read. Choose an accessible folder before indexing.");val allMedia=PCloudApi.objects(listing.getJSONArray("items"));val photos=allMedia.filter{it.optString("mediaType")!="video"};job.libraryTotal=photos.size
            val known=PCloudApi.objects(body.getJSONArray("known")).associate{it.getString("id") to it.getString("version")}
            job.known.putAll(known);val pending=photos.filter{!MediaRules.sameFileVersion(known[it.getString("id")]?:"",it.getString("version"))};job.total=pending.size;job.alreadyIndexed=photos.size-pending.size
            var prefetchId:String?=null;var prefetchBytes:Future<ByteArray>?=null
            for(i in pending.indices){val photo=pending[i];if(!active())break;if(api.batteryLow()){job.message="Paused to protect battery: charge the phone, then start indexing again. Saved results are kept.";job.stop=true;break};if(MediaRules.sameFileVersion(job.known[photo.getString("id")]?:"",photo.getString("version"))){job.alreadyIndexed++;job.total--;continue};job.currentPhoto=photo.getString("id");job.updatedAt=System.currentTimeMillis();job.phase=if(music)"Indexing song titles on this phone" else "Indexing visual search on this phone"
                try{
                    val stat=api.call("stat",mapOf("fileid" to photo.getString("id").removePrefix("pc-"))).getJSONObject("metadata")
                    if(!MediaRules.sameFileVersion(stat.optString("hash",stat.optString("modified")),photo.getString("version"))){job.changed++;continue}
                    val operation=if(music){val vector=synchronized(engine){engine.text(photo.getString("name"),true)};JSONObject().put("type","music-index").put("track",photo).put("model","clip-music-title-q8-v1").put("embedding",ClipEngine.pack(vector))}else{
                        job.phase="Downloading preview";job.updatedAt=System.currentTimeMillis()
                        val pendingFuture=prefetchBytes;prefetchBytes=null
                        val prefetched=if(pendingFuture!=null&&prefetchId==photo.getString("id"))try{pendingFuture.get()}catch(e:Exception){null}else null
                        val bytes=prefetched?:api.previewBytes(photo.getString("id").removePrefix("pc-"),photo.getString("version"),true)
                        val bounds=BitmapFactory.Options().apply{inJustDecodeBounds=true};BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
                        val opts=BitmapFactory.Options().apply{inSampleSize=1;while(bounds.outWidth/inSampleSize>1024||bounds.outHeight/inSampleSize>1024)inSampleSize*=2}
                        val bitmap=BitmapFactory.decodeByteArray(bytes,0,bytes.size,opts)?:throw Exception("Could not decode preview")
                        if(active()&&i+1<pending.size){val next=pending[i+1];if(!MediaRules.sameFileVersion(job.known[next.getString("id")]?:"",next.getString("version"))){prefetchId=next.getString("id");prefetchBytes=previewer.submit<ByteArray>{api.previewBytes(next.getString("id").removePrefix("pc-"),next.getString("version"),true)}}}
                        job.phase="Running on-device AI";job.updatedAt=System.currentTimeMillis()
                        try{synchronized(engine){engine.visual(bitmap,photo)}.put("type","visual-index").put("photoId",photo.getString("id")).put("version",photo.getString("version"))}finally{bitmap.recycle()}
                    }
                    if(!active())break;job.phase="Saving result in pCloud";job.updatedAt=System.currentTimeMillis();save(operation,identity);job.completed++;job.known[photo.getString("id")]=photo.getString("version");job.updatedAt=System.currentTimeMillis()
                }catch(e:CloudError){job.failed++;throw e}catch(_:OutOfMemoryError){job.failed++;job.stop=true;job.message="Memory limit reached. Saved indexes are retained; reopen and index a smaller folder.";break}catch(_:Exception){job.failed++;job.message="Some photos could not be analyzed. Start indexing again to retry incomplete photos."}
            }
            if(!music&&active()){job.phase="Checking exact duplicates";val checked=PCloudApi.objects(body.optJSONArray("checksums")).associate{it.getString("id") to it.getString("version")}
                job.checksums.putAll(checked);val candidates=allMedia.filter{it.optString("contentHash").isNotEmpty()}.groupBy{it.getString("contentHash")+":"+it.getLong("size")}.values.filter{it.size>1}.flatten()
                job.checksumTotal=candidates.size
                for(photo in candidates){if(!active())break;if(MediaRules.sameFileVersion(job.checksums[photo.getString("id")]?:"",photo.getString("version"))){job.checksumCompleted++;continue};job.currentPhoto=photo.getString("id");job.updatedAt=System.currentTimeMillis();job.phase="Checking exact duplicates ${job.checksumCompleted+1} / ${job.checksumTotal}"
                    val sum=api.call("checksumfile",mapOf("fileid" to photo.getString("id").removePrefix("pc-")));val current=sum.optJSONObject("metadata")
                    if(current!=null&&!MediaRules.sameFileVersion(current.optString("hash",current.optString("modified")),photo.getString("version")))continue
                    if(Regex("[a-fA-F0-9]{40}").matches(sum.optString("sha1"))){save(JSONObject().put("type","content-index").put("photoId",photo.getString("id")).put("version",photo.getString("version")).put("sha1",sum.getString("sha1").lowercase()),identity);job.checksums[photo.getString("id")]=photo.getString("version")};job.checksumCompleted++;job.updatedAt=System.currentTimeMillis()
                }
            }
            job.phase=if(job.stop||stopped)"Paused" else if(job.failed>0||job.changed>0)"Finished with incomplete photos" else if(pending.isEmpty()&&job.checksumTotal==0)"Already completed" else "Finished"
        }catch(e:Exception){job.phase="Stopped";job.message=e.message?:"Indexing failed. Retry on a smaller folder."}finally{synchronized(engine){engine.close()};job.running=false}
    }
    private fun save(op:JSONObject,identity:String){if(api.account().getString("host")+":"+api.account().getString("uid")!=identity)throw CloudError(401,"Account changed. Indexing paused.");api.write(op.put("id",UUID.randomUUID().toString()).put("at",System.currentTimeMillis()))}
}
