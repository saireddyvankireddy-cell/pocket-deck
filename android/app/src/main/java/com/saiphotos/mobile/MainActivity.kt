package com.saiphotos.mobile

import android.app.Activity
import android.app.AlertDialog
import android.os.Bundle
import android.webkit.*
import android.net.Uri
import android.view.View
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.concurrent.Executors

class MainActivity:Activity() {
    private lateinit var web:WebView
    private lateinit var api:PCloudApi
    private lateinit var oauth:PCloudOAuth
    private val workers=Executors.newFixedThreadPool(6)
    private var notificationAsked=false
    @Volatile private var uploadState=JSONObject().put("running",false).put("completed",0).put("failed",0)
    private var uploadFolder:String?=null
    private var uploadOwner=""
    private var eraser:EraseEngine?=null

    private var lockPending=false
    private var lockReply:String?=null
    private var requestedLock:Boolean?=null
    private var unlocked=false
    private val lockPrefs get()=getSharedPreferences("gallery-security",MODE_PRIVATE)
    private fun lockStatus()=JSONObject().put("enabled",lockPrefs.getBoolean("app-lock",false)).put("available",(getSystemService(KEYGUARD_SERVICE) as android.app.KeyguardManager).isDeviceSecure)
    private fun compareVersions(a:String,b:String):Int{val left=a.split('.').map{it.toIntOrNull()?:0};val right=b.split('.').map{it.toIntOrNull()?:0};for(i in 0 until maxOf(left.size,right.size)){val diff=(left.getOrElse(i){0})-(right.getOrElse(i){0});if(diff!=0)return diff};return 0}
    private fun reply(id:String,status:Int,data:JSONObject){if(!isFinishing&&!isDestroyed)web.evaluateJavascript("window.saiNativeReply($id,${JSONObject.quote(JSONObject().put("status",status).put("data",data).toString())})",null)}
    private fun deviceImageResponse(uri:Uri):WebResourceResponse{
        val mediaId=uri.getQueryParameter("id")?.toLongOrNull()?:return WebResourceResponse("text/plain","utf-8",400,"Bad Request",emptyMap(),ByteArrayInputStream(ByteArray(0)))
        val target=android.content.ContentUris.withAppendedId(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,mediaId)
        return try{
            if(uri.lastPathSegment=="device-photo-thumb"){
                val bitmap=if(android.os.Build.VERSION.SDK_INT>=29)contentResolver.loadThumbnail(target,android.util.Size(384,384),null) else @Suppress("DEPRECATION") android.provider.MediaStore.Images.Thumbnails.getThumbnail(contentResolver,mediaId,android.provider.MediaStore.Images.Thumbnails.MINI_KIND,null)
                val stream=java.io.ByteArrayOutputStream();bitmap.compress(android.graphics.Bitmap.CompressFormat.JPEG,80,stream);bitmap.recycle()
                WebResourceResponse("image/jpeg",null,200,"OK",mapOf("Cache-Control" to "max-age=604800"),ByteArrayInputStream(stream.toByteArray()))
            }else{
                val input=contentResolver.openInputStream(target)?:throw java.io.FileNotFoundException()
                WebResourceResponse(contentResolver.getType(target)?:"image/jpeg",null,200,"OK",mapOf("Cache-Control" to "max-age=86400"),input)
            }
        }catch(_:Exception){WebResourceResponse("text/plain","utf-8",404,"Not Found",emptyMap(),ByteArrayInputStream(ByteArray(0)))}
    }
    private fun mediaIdFrom(data:JSONObject):Long?{val raw=data.opt("id");return when(raw){is Number->raw.toLong();is String->raw.toLongOrNull();else->null}}
    @Suppress("DEPRECATION") private fun authenticateLock(){
        val intent=(getSystemService(KEYGUARD_SERVICE) as android.app.KeyguardManager).createConfirmDeviceCredentialIntent("Sai Photos","Unlock using your device screen lock")
        if(intent==null){lockReply?.let{reply(it,409,JSONObject().put("error","Set up a secure screen lock on your device first."))};lockReply=null;requestedLock=null;if(lockPrefs.getBoolean("app-lock",false))AlertDialog.Builder(this).setTitle("App lock").setMessage("Set up a secure Android screen lock before opening Sai Photos.").setPositiveButton("Close"){_,_->finish()}.setOnCancelListener{finish()}.show();return}
        lockPending=true;try{startActivityForResult(intent,91)}catch(_:Exception){lockPending=false;lockReply?.let{reply(it,503,JSONObject().put("error","Device authentication is unavailable."))};lockReply=null;requestedLock=null;if(lockPrefs.getBoolean("app-lock",false))finish()}
    }
    override fun onResume(){super.onResume();if(::web.isInitialized&&lockPrefs.getBoolean("app-lock",false)&&!unlocked&&!lockPending){web.visibility=View.INVISIBLE;window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);authenticateLock()}}
    override fun onStop(){if(::web.isInitialized&&lockPrefs.getBoolean("app-lock",false)&&!lockPending){unlocked=false;web.visibility=View.INVISIBLE};super.onStop()}
    override fun onTrimMemory(level:Int){super.onTrimMemory(level);if(level>=android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL&&::api.isInitialized){try{api.ai.stopAll()}catch(ignored:Exception){}}}
    @Deprecated("Deprecated in Java") override fun onActivityResult(requestCode:Int,resultCode:Int,data:android.content.Intent?){super.onActivityResult(requestCode,resultCode,data);if(requestCode==92){if(resultCode!=RESULT_OK||data==null){uploadState=JSONObject().put("running",false).put("message","Photo selection cancelled.");return};val uris=mutableListOf<Uri>();data.clipData?.let{for(i in 0 until it.itemCount)uris.add(it.getItemAt(i).uri)}?:data.data?.let{uris.add(it)};if(uris.size>50){uploadState=JSONObject().put("running",false).put("message","Choose at most 50 photos per upload.");return};uploadState=JSONObject().put("running",true).put("total",uris.size).put("completed",0).put("failed",0);val folder=uploadFolder;val owner=uploadOwner;workers.execute{var completed=0;var failed=0;val errors=mutableListOf<String>();for(uri in uris){try{api.withSession{api.uploadPhoto(uri,folder,owner)};completed++}catch(e:Exception){failed++;if(errors.size<5)errors.add(e.message?:"Upload failed.")};uploadState=JSONObject().put("running",true).put("total",uris.size).put("completed",completed).put("failed",failed).put("message",errors.joinToString(" "))};uploadState=JSONObject(uploadState.toString()).put("running",false)};return};if(requestCode!=91)return;lockPending=false;if(resultCode==RESULT_OK){requestedLock?.let{lockPrefs.edit().putBoolean("app-lock",it).apply()};unlocked=true;web.visibility=View.VISIBLE;if(lockPrefs.getBoolean("app-lock",false))window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)else window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE);lockReply?.let{reply(it,200,lockStatus())}}else{lockReply?.let{reply(it,403,JSONObject().put("error","Device authentication cancelled. App lock was not changed."))};if(lockPrefs.getBoolean("app-lock",false)&&!unlocked)finish()};lockReply=null;requestedLock=null}
    private val origin="https://appassets.androidplatform.net"
    private var rendererCrashes=0
    private fun bootPrefs()=getSharedPreferences("sai-photos",MODE_PRIVATE)
    private fun resetLocalWebStorage(){
        try{android.webkit.WebStorage.getInstance().deleteAllData()}catch(_:Exception){}
        try{val base=java.io.File(applicationInfo.dataDir,"app_webview/Default");for(folder in listOf("IndexedDB","Service Worker","Local Storage","Session Storage")){val target=java.io.File(base,folder);if(target.exists())target.deleteRecursively()}}catch(_:Exception){}
    }
    private fun installCrashReporter(){
        val previous=Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler{thread,error->try{bootPrefs().edit().putString("last-crash",error.toString()+"\n"+error.stackTrace.take(15).joinToString("\n")).putLong("last-crash-at",System.currentTimeMillis()).commit()}catch(_:Exception){};if(previous!=null)previous.uncaughtException(thread,error)else{android.os.Process.killProcess(android.os.Process.myPid())}}
    }
    override fun onCreate(state:Bundle?) {
        super.onCreate(state)
        installCrashReporter()
        val attempts=bootPrefs().getInt("boot-attempts",0)+1
        bootPrefs().edit().putInt("boot-attempts",attempts).commit()
        val recovered=attempts>=2
        if(recovered)resetLocalWebStorage()
        api=PCloudApi(applicationContext)
        oauth=PCloudOAuth(applicationContext)
        PlaybackBridge.action={action,value->runOnUiThread { if(!isFinishing&&!isDestroyed)web.evaluateJavascript("window.saiMediaAction?.(${JSONObject.quote(action)},$value)",null) }}
        web=WebView(this)
        android.webkit.WebView.setWebContentsDebuggingEnabled(true)
        web.setPadding(0,0,0,0)
        web.setOnApplyWindowInsetsListener { view,insets -> view.setPadding(insets.systemWindowInsetLeft,insets.systemWindowInsetTop,insets.systemWindowInsetRight,insets.systemWindowInsetBottom);insets }
        setContentView(web)
        web.settings.apply { javaScriptEnabled=true;domStorageEnabled=true;allowFileAccess=false;allowContentAccess=false;setAllowFileAccessFromFileURLs(false);setAllowUniversalAccessFromFileURLs(false);mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW;mediaPlaybackRequiresUserGesture=false;userAgentString += " SaiPhotosAndroid/1.28.0" }
        web.addJavascriptInterface(Bridge(),"SaiNative")
        web.webChromeClient=object:WebChromeClient(){override fun onConsoleMessage(message:ConsoleMessage):Boolean { if(message.messageLevel()==ConsoleMessage.MessageLevel.ERROR)android.util.Log.w("SaiPhotosUI",message.message().take(500));return true }}
        web.webViewClient=object:WebViewClient() {
            override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest):Boolean= request.url.scheme!="https"||request.url.host!="appassets.androidplatform.net"
            override fun shouldInterceptRequest(view:WebView,request:WebResourceRequest):WebResourceResponse? {
                val uri=request.url
                if(uri.scheme in setOf("data","blob"))return null
                if(uri.scheme!="https"||uri.host!="appassets.androidplatform.net")return errorResponse(403,"External navigation is disabled.")
                return try {
                    val path=uri.path ?: "/"
                    if(path.startsWith("/.netlify/functions/")) {
                        if(request.method!="GET")return errorResponse(405,"Use the app request bridge.")
                        if(uri.lastPathSegment=="media-content")return api.withSession { api.binary(uri,request.requestHeaders) }
                        if(uri.lastPathSegment=="device-photo"||uri.lastPathSegment=="device-photo-thumb")return deviceImageResponse(uri)
                        jsonResponse(200,api.withSession { api.handle(path+(uri.encodedQuery?.let{"?$it"}?:""),"GET","") })
                    }else {
                        val asset=if(path=="/")"index.html" else path.removePrefix("/")
                        if(asset.contains("..")||asset.contains('\\'))return errorResponse(403,"Invalid asset path.")
                        val mime=when(asset.substringAfterLast('.')) { "js","mjs"->"text/javascript";"html"->"text/html";"css"->"text/css";"json","webmanifest"->"application/json";"svg"->"image/svg+xml";"wasm"->"application/wasm";else->"application/octet-stream" }
                        WebResourceResponse(mime,if(mime.startsWith("text")||mime=="application/json")"UTF-8" else null,200,"OK",mapOf("Cache-Control" to "no-cache","Content-Security-Policy" to "default-src 'self' blob: data:; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' blob: data: https://generativelanguage.googleapis.com https://api.groq.com https://openrouter.ai https://api.mistral.ai https://integrate.api.nvidia.com https://api.llm7.io; style-src 'self' 'unsafe-inline'; frame-src 'none'; object-src 'none'; base-uri 'self'"),openAsset(asset))
                    }
                }catch(e:CloudError){errorResponse(e.status,e.message?:"pCloud request failed.")}catch(_:Exception){errorResponse(502,"Request failed. Check your internet and pCloud connection.")}
            }
            override fun onPageFinished(view:WebView,url:String){if(intent.getBooleanExtra("showQueue",false)){intent.removeExtra("showQueue");view.evaluateJavascript("window.saiMediaAction?.('queue',0)",null)}}
            override fun onRenderProcessGone(view:WebView,detail:RenderProcessGoneDetail):Boolean {
                rendererCrashes++
                try{api.ai.stopAll()}catch(_:Exception){}
                view.destroy()
                val repeat=rendererCrashes>=2
                AlertDialog.Builder(this@MainActivity).setTitle(if(repeat)"Restarting the photo screen with a clean cache" else "Restarting the photo screen").setMessage(if(repeat)"Android's WebView renderer kept stopping, so the local cache is being reset. Nothing in pCloud is affected: photos, music, albums and settings stay safe and previews rebuild automatically." else "Android stopped the photo renderer. Saved cloud indexes are kept. Tap Reopen to continue; if it happens again the app resets the local cache by itself.").setPositiveButton("Reopen"){_,_->if(repeat)resetLocalWebStorage();recreate()}.setNegativeButton("Close"){_,_->finish()}.show()
                return true
            }
        }
        if(lockPrefs.getBoolean("app-lock",false)){web.visibility=View.INVISIBLE;window.addFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE)}
        web.loadUrl(if(recovered)"$origin/?recovered=1" else "$origin/")
        handleAuthCallback(intent.data)
    }
    override fun onNewIntent(newIntent:android.content.Intent){super.onNewIntent(newIntent);intent=newIntent;if(newIntent.getBooleanExtra("showQueue",false))web.evaluateJavascript("window.saiMediaAction?.('queue',0)",null);handleAuthCallback(newIntent.data)}
    private fun handleAuthCallback(uri:Uri?){
        if(!PCloudOAuth.isCallback(uri))return
        val callback=uri?:return
        workers.execute{
            try{
                val auth=oauth.consume(callback)
                api.verifyAndSaveToken(auth.getString("host"),auth.getString("tokenType"),auth.getString("token"))
                runOnUiThread{if(!isFinishing&&!isDestroyed)web.evaluateJavascript("window.saiAuthChanged?.()",null)}
            }catch(e:Exception){
                runOnUiThread{if(!isFinishing&&!isDestroyed)web.evaluateJavascript("window.saiAuthError?.(${JSONObject.quote(e.message?:"pCloud login could not be completed. Tap Connect pCloud to try again.")})",null)}
            }
        }
    }
    inner class Bridge {
        @JavascriptInterface fun ready(){try{bootPrefs().edit().putInt("boot-attempts",0).apply()}catch(_:Exception){}}
        @JavascriptInterface fun mediaState(payload:String){if(payload.length>100000)return;try{val s=JSONObject(payload);if(s.optString("id").isNotEmpty()&&!MediaRules.validId(s.optString("id")))return;PlaybackBridge.state=s;runOnUiThread{if(s.optString("id").isEmpty())stopService(android.content.Intent(this@MainActivity,PlaybackService::class.java))else try{if(!notificationAsked&&android.os.Build.VERSION.SDK_INT>=33&&checkSelfPermission("android.permission.POST_NOTIFICATIONS")!=android.content.pm.PackageManager.PERMISSION_GRANTED&&!isFinishing){notificationAsked=true;requestPermissions(arrayOf("android.permission.POST_NOTIFICATIONS"),20)};startForegroundService(android.content.Intent(this@MainActivity,PlaybackService::class.java))}catch(_:Exception){}}}catch(_:Exception){}}
        @JavascriptInterface fun request(id:String,path:String,method:String,body:String) {
            if(!Regex("[0-9]{1,12}").matches(id)||!path.startsWith("/.netlify/functions/")||path.length>4096||body.length>8_000_000)return
            if(Uri.parse(path).path=="/.netlify/functions/device-upload"){runOnUiThread{if(method=="GET")reply(id,200,JSONObject(uploadState.toString()))else if(method=="POST"&&!uploadState.optBoolean("running")){try{val data=JSONObject(body);val folder=data.optString("folderId").takeIf{it.isNotBlank()};if(folder!=null&&!Regex("[0-9]{1,20}").matches(folder))throw IllegalArgumentException();val encoded=data.optString("file");if(encoded.isNotEmpty()){val name=data.optString("name");if(name.isBlank()||name.length>200)throw IllegalArgumentException();uploadState=JSONObject().put("running",true).put("message","Uploading edited photo…");workers.execute{try{val bytes=android.util.Base64.decode(encoded,android.util.Base64.DEFAULT);val a=api.account();val saved=api.withSession{api.uploadBytes(bytes,name,folder,a.getString("host")+":"+a.getString("uid"))};uploadState=JSONObject().put("running",false);runOnUiThread{reply(id,200,saved)}}catch(e:Exception){uploadState=JSONObject().put("running",false);runOnUiThread{reply(id,400,JSONObject().put("error",e.message?:"Edited photo upload failed."))}}}}else{val a=api.account();uploadOwner=a.getString("host")+":"+a.getString("uid");uploadFolder=folder;uploadState=JSONObject().put("running",true).put("choosing",true).put("message","Choose up to 50 photos.");startActivityForResult(android.content.Intent(android.content.Intent.ACTION_OPEN_DOCUMENT).apply{type="image/*";addCategory(android.content.Intent.CATEGORY_OPENABLE);putExtra(android.content.Intent.EXTRA_ALLOW_MULTIPLE,true);addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)},92);reply(id,200,JSONObject().put("choosing",true))}}catch(_:Exception){uploadState=JSONObject().put("running",false);reply(id,400,JSONObject().put("error","Connect pCloud and choose a valid destination first."))}}else reply(id,409,JSONObject().put("error","An upload is already in progress."))};return}
            if(Uri.parse(path).path=="/.netlify/functions/device-erase"){
                var failure:String?=if(method!="POST")"Method not allowed." else null
                var data:JSONObject?=null
                if(failure==null)try{data=JSONObject(body)}catch(_:Exception){failure="Invalid erase request."}
                val encodedImage=data?.optString("image")?:""
                val encodedMask=data?.optString("mask")?:""
                if(failure==null&&(encodedImage.isEmpty()||encodedMask.isEmpty()))failure="Invalid erase request."
                val problem=failure
                if(problem!=null){runOnUiThread{reply(id,400,JSONObject().put("error",problem))};return}
                if(eraser==null)eraser=EraseEngine(this@MainActivity)
                val imagePayload=encodedImage;val maskPayload=encodedMask
                workers.execute{
                    try{
                        val imageBytes=android.util.Base64.decode(imagePayload,android.util.Base64.DEFAULT)
                        val maskBytes=android.util.Base64.decode(maskPayload,android.util.Base64.DEFAULT)
                        val image=android.graphics.BitmapFactory.decodeByteArray(imageBytes,0,imageBytes.size)?:throw CloudError(400,"Photo could not be read.")
                        val mask=android.graphics.BitmapFactory.decodeByteArray(maskBytes,0,maskBytes.size)?:throw CloudError(400,"Mask could not be read.")
                        val result=eraser!!.run(image,mask)
                        val out=java.io.ByteArrayOutputStream()
                        result.compress(android.graphics.Bitmap.CompressFormat.JPEG,92,out)
                        result.recycle();image.recycle();mask.recycle()
                        val encoded=android.util.Base64.encodeToString(out.toByteArray(),android.util.Base64.NO_WRAP)
                        if(encoded.length>12_000_000)throw CloudError(500,"Erased photo is too large to return.")
                        runOnUiThread{reply(id,200,JSONObject().put("image",encoded))}
                    }catch(e:Exception){runOnUiThread{reply(id,500,JSONObject().put("error",e.message?:"Erase could not finish."))}}
                }
                return
            }
            if(Uri.parse(path).path=="/.netlify/functions/device-lock"){runOnUiThread{if(method=="GET")reply(id,200,lockStatus())else if(method=="POST"&&!lockPending){try{val data=JSONObject(body);if(!data.has("enabled"))throw IllegalArgumentException();lockReply=id;requestedLock=data.getBoolean("enabled");authenticateLock()}catch(_:Exception){reply(id,400,JSONObject().put("error","Invalid lock request."))}}else reply(id,409,JSONObject().put("error","Complete the device authentication first."))};return}
            if(Uri.parse(path).path=="/.netlify/functions/device-notify-prefs"){
                if(method=="GET"){runOnUiThread{val prefs=getSharedPreferences("sai-photos",MODE_PRIVATE);reply(id,200,JSONObject().put("enabled",prefs.getBoolean("memory-enabled",false)).put("count",prefs.getInt("memory-count",0)))};return}
                if(method!="POST"){runOnUiThread{reply(id,405,JSONObject().put("error","Method not allowed."))};return}
                var failure:String?=null;var payload:JSONObject?=null
                try{payload=JSONObject(body)}catch(_:Exception){failure="Invalid notification request."}
                val data=payload
                if(failure==null&&data==null)failure="Invalid notification request."
                val problem=failure
                if(problem!=null||data==null){runOnUiThread{reply(id,400,JSONObject().put("error",problem?:"Invalid notification request."))};return}
                val enabled=data.optBoolean("enabled");val count=data.optInt("count").coerceIn(0,9999);val hour=data.optInt("hour",20).coerceIn(0,23)
                getSharedPreferences("sai-photos",MODE_PRIVATE).edit().putBoolean("memory-enabled",enabled).putInt("memory-count",count).putInt("memory-hour",hour).apply()
                val alarm=getSystemService(android.content.Context.ALARM_SERVICE) as? android.app.AlarmManager
                val pending=android.app.PendingIntent.getBroadcast(this@MainActivity,7,android.content.Intent(this@MainActivity,MemoryNotifier::class.java),android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE)
                alarm?.cancel(pending)
                if(enabled){
                    if(android.os.Build.VERSION.SDK_INT>=33&&checkSelfPermission("android.permission.POST_NOTIFICATIONS")!=android.content.pm.PackageManager.PERMISSION_GRANTED&&!isFinishing)requestPermissions(arrayOf("android.permission.POST_NOTIFICATIONS"),21)
                    val calendar=java.util.Calendar.getInstance().apply{set(java.util.Calendar.HOUR_OF_DAY,hour);set(java.util.Calendar.MINUTE,0);set(java.util.Calendar.SECOND,0);set(java.util.Calendar.MILLISECOND,0);if(timeInMillis<=System.currentTimeMillis())add(java.util.Calendar.DAY_OF_YEAR,1)}
                    alarm?.setInexactRepeating(android.app.AlarmManager.RTC_WAKEUP,calendar.timeInMillis,android.app.AlarmManager.INTERVAL_DAY,pending)
                }
                runOnUiThread{reply(id,200,JSONObject().put("enabled",enabled).put("count",count))}
                return
            }
            if(Uri.parse(path).path=="/.netlify/functions/device-battery"){
                if(method!="GET"){runOnUiThread{reply(id,405,JSONObject().put("error","Method not allowed."))};return}
                runOnUiThread{reply(id,200,JSONObject().put("low",api.batteryLow()).put("charging",api.batteryCharging()))}
                return
            }
            if(Uri.parse(path).path=="/.netlify/functions/device-diagnostics"){
                if(method!="GET"){runOnUiThread{reply(id,405,JSONObject().put("error","Method not allowed."))};return}
                val prefs=bootPrefs()
                runOnUiThread{reply(id,200,JSONObject().put("bootAttempts",prefs.getInt("boot-attempts",0)).put("lastCrash",prefs.getString("last-crash","")?:"").put("lastCrashAt",prefs.getLong("last-crash-at",0)).put("rendererCrashes",rendererCrashes))}
                return
            }
            if(Uri.parse(path).path=="/.netlify/functions/device-update-check"){
                if(method!="GET"){runOnUiThread{reply(id,405,JSONObject().put("error","Method not allowed."))};return}
                workers.execute{
                    try{
                        val releases=api.withSession{api.call("listfolder",mapOf("path" to "/Sai Photos Ente/Android App/Releases","recursive" to "1"))}.getJSONObject("metadata")
                        var best="";var apkId=""
                        fun visit(folder:JSONObject){val contents=folder.optJSONArray("contents")?:return;for(i in 0 until contents.length()){val item=contents.optJSONObject(i)?:continue;if(item.optBoolean("isfolder")){visit(item);continue};val match=Regex("Sai-Photos-Android-v(\\d+\\.\\d+\\.\\d+)\\.apk").find(item.optString("name"))?:continue;val candidate=match.groupValues[1];if(compareVersions(candidate,best)>0){best=candidate;apkId=item.optString("fileid")}}}
                        visit(releases)
                        val current=BuildConfig.VERSION_NAME
                        val available=best.isNotEmpty()&&compareVersions(best,current)>0
                        val result=JSONObject().put("current",current).put("latest",best).put("available",available)
                        if(available)result.put("url",api.withSession{api.link(apkId)})
                        runOnUiThread{reply(id,200,result)}
                    }catch(e:Exception){runOnUiThread{reply(id,400,JSONObject().put("error",e.message?:"Update check failed. Connect pCloud first."))}}
                }
                return
            }
            if(Uri.parse(path).path=="/.netlify/functions/device-open-url"){
                var failure:String?=if(method!="POST")"Method not allowed." else null
                var targetUrl=""
                if(failure==null)try{targetUrl=JSONObject(body).optString("url")}catch(_:Exception){failure="Invalid link."}
                if(failure==null&&(!targetUrl.startsWith("https://")||targetUrl.length>2000))failure="Only https links can be opened."
                val problem=failure
                if(problem!=null){runOnUiThread{reply(id,400,JSONObject().put("error",problem))};return}
                runOnUiThread{try{startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW,Uri.parse(targetUrl)).addCategory(android.content.Intent.CATEGORY_BROWSABLE));reply(id,200,JSONObject().put("opened",true))}catch(e:Exception){reply(id,400,JSONObject().put("error","No browser could open this link."))}}
                return
            }
            if(Uri.parse(path).path=="/.netlify/functions/device-contacts"){
                if(method!="GET"){runOnUiThread{reply(id,405,JSONObject().put("error","Method not allowed."))};return}
                val permission=android.Manifest.permission.READ_CONTACTS
                if(checkSelfPermission(permission)!=android.content.pm.PackageManager.PERMISSION_GRANTED){
                    if(!isFinishing)requestPermissions(arrayOf(permission),23)
                    runOnUiThread{reply(id,200,JSONObject().put("names",org.json.JSONArray()).put("pendingPermission",true))}
                    return
                }
                workers.execute{
                    try{
                        val names=org.json.JSONArray();val seen=HashSet<String>()
                        contentResolver.query(android.provider.ContactsContract.CommonDataKinds.Phone.CONTENT_URI,arrayOf(android.provider.ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY),null,null,android.provider.ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME_PRIMARY+" ASC")?.use{cursor->
                            while(cursor.moveToNext()&&seen.size<1000){
                                val name=cursor.getString(0)?.trim()?:"";if(name.isEmpty()||name.length>80||!seen.add(name))continue;names.put(name)
                            }
                        }
                        runOnUiThread{reply(id,200,JSONObject().put("names",names))}
                    }catch(_:Exception){runOnUiThread{reply(id,500,JSONObject().put("error","Could not read contacts on this phone."))}}
                }
                return
            }
            if(Uri.parse(path).path=="/.netlify/functions/device-photos"){
                if(method!="GET"){runOnUiThread{reply(id,405,JSONObject().put("error","Method not allowed."))};return}
                val query=Uri.parse(path)
                val offset=query.getQueryParameter("offset")?.toIntOrNull()?.coerceIn(0,1_000_000)?:0
                val limit=(query.getQueryParameter("limit")?.toIntOrNull()?:60).coerceIn(1,120)
                val permission=if(android.os.Build.VERSION.SDK_INT>=33)"android.permission.READ_MEDIA_IMAGES" else android.Manifest.permission.READ_EXTERNAL_STORAGE
                if(checkSelfPermission(permission)!=android.content.pm.PackageManager.PERMISSION_GRANTED){
                    if(!isFinishing)requestPermissions(arrayOf(permission),22)
                    runOnUiThread{reply(id,200,JSONObject().put("items",org.json.JSONArray()).put("total",0).put("pendingPermission",true))}
                    return
                }
                workers.execute{
                    try{
                        val projection=arrayOf(android.provider.MediaStore.Images.Media._ID,android.provider.MediaStore.Images.Media.DISPLAY_NAME,android.provider.MediaStore.Images.Media.SIZE,android.provider.MediaStore.Images.Media.DATE_ADDED,android.provider.MediaStore.Images.Media.MIME_TYPE)
                        val items=org.json.JSONArray();var total=0
                        contentResolver.query(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,projection,null,null,"${android.provider.MediaStore.Images.Media.DATE_ADDED} DESC")?.use{cursor->
                            total=cursor.count;var index=0
                            while(cursor.moveToNext()){
                                if(index<offset){index++;continue}
                                if(items.length()>=limit)break
                                items.put(JSONObject().put("id",cursor.getLong(0)).put("name",cursor.getString(1)?:"Photo").put("size",cursor.getLong(2)).put("date",cursor.getLong(3)*1000).put("mimeType",cursor.getString(4)?:"image/jpeg"))
                                index++
                            }
                        }
                        runOnUiThread{reply(id,200,JSONObject().put("items",items).put("total",total))}
                    }catch(_:Exception){runOnUiThread{reply(id,500,JSONObject().put("error","Could not read this phone's photos."))}}
                }
                return
            }
            if(Uri.parse(path).path=="/.netlify/functions/device-photo-delete"){
                if(method!="POST"){runOnUiThread{reply(id,405,JSONObject().put("error","Method not allowed."))};return}
                var failure:String?=null;var payload:JSONObject?=null
                try{payload=JSONObject(body)}catch(_:Exception){failure="Invalid delete request."}
                val data=payload
                val mediaId=if(failure==null&&data!=null)mediaIdFrom(data) else null
                if(failure!=null||data==null||mediaId==null||mediaId<=0){runOnUiThread{reply(id,400,JSONObject().put("error",failure?:"Choose a photo first."))};return}
                val target=android.content.ContentUris.withAppendedId(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,mediaId)
                workers.execute{
                    try{
                        val deleted=contentResolver.delete(target,null,null)
                        runOnUiThread{reply(id,200,JSONObject().put("deleted",deleted>0))}
                    }catch(_:Exception){
                        if(android.os.Build.VERSION.SDK_INT>=30){
                            runOnUiThread{
                                try{
                                    val request=android.provider.MediaStore.createDeleteRequest(contentResolver,listOf(target)).intentSender
                                    startIntentSenderForResult(request,93,null,0,0,0)
                                    reply(id,200,JSONObject().put("confirm",true))
                                }catch(_:Exception){reply(id,403,JSONObject().put("error","Allow photo access for Sai Photos in Android settings, then retry."))}
                            }
                        }else runOnUiThread{reply(id,403,JSONObject().put("error","Delete this photo from the system Gallery on this Android version."))}
                    }
                }
                return
            }
            if(Uri.parse(path).path=="/.netlify/functions/device-share-photo"){
                if(method!="POST"){runOnUiThread{reply(id,405,JSONObject().put("error","Method not allowed."))};return}
                var failure:String?=null;var payload:JSONObject?=null
                try{payload=JSONObject(body)}catch(_:Exception){failure="Invalid share request."}
                val data=payload
                val mediaId=if(failure==null&&data!=null)mediaIdFrom(data) else null
                if(failure!=null||data==null||mediaId==null||mediaId<=0){runOnUiThread{reply(id,400,JSONObject().put("error",failure?:"Choose a photo first."))};return}
                val target=android.content.ContentUris.withAppendedId(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,mediaId)
                runOnUiThread{
                    try{
                        val mime=contentResolver.getType(target)?:"image/jpeg"
                        val send=android.content.Intent(android.content.Intent.ACTION_SEND).apply{type=mime;putExtra(android.content.Intent.EXTRA_STREAM,target);addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)}
                        startActivity(android.content.Intent.createChooser(send,"Share photo"))
                        reply(id,200,JSONObject().put("shared",true))
                    }catch(_:Exception){reply(id,500,JSONObject().put("error","No app is available to share this photo."))}
                }
                return
            }
            if(Uri.parse(path).path=="/.netlify/functions/device-notify-test"){
                if(method!="POST"){runOnUiThread{reply(id,405,JSONObject().put("error","Method not allowed."))};return}
                sendBroadcast(android.content.Intent(this@MainActivity,MemoryNotifier::class.java))
                runOnUiThread{reply(id,200,JSONObject().put("sent",true))}
                return
            }
            if(Uri.parse(path).path=="/.netlify/functions/device-save"||Uri.parse(path).path=="/.netlify/functions/device-share"){
                val sharing=Uri.parse(path).path=="/.netlify/functions/device-share"
                if(method!="POST"){runOnUiThread{reply(id,405,JSONObject().put("error","Method not allowed."))};return}
                var failure:String?=null;var payload:JSONObject?=null
                try{payload=JSONObject(body)}catch(_:Exception){failure="Invalid request."}
                val data=payload
                if(failure!=null||data==null){runOnUiThread{reply(id,400,JSONObject().put("error",failure?:"Invalid request."))};return}
                val mediaId=data.optString("id");val fileName=data.optString("fileName").replace('/','_')
                if(!Regex("pc-\\d{1,20}").matches(mediaId)||fileName.isBlank()||fileName.length>150){runOnUiThread{reply(id,400,JSONObject().put("error","Choose a photo first."))};return}
                if(android.os.Build.VERSION.SDK_INT<29){runOnUiThread{reply(id,400,JSONObject().put("error","Saving to the device needs Android 10 or newer."))};return}
                workers.execute{
                    try{
                        val bytes=api.withSession{api.downloadFile(mediaId.removePrefix("pc-"))}
                        val mime=when{fileName.lowercase().endsWith(".png")->"image/png";fileName.lowercase().endsWith(".webp")->"image/webp";fileName.lowercase().endsWith(".gif")->"image/gif";else->"image/jpeg"}
                        val values=android.content.ContentValues().apply{
                            put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME,fileName)
                            put(android.provider.MediaStore.MediaColumns.MIME_TYPE,mime)
                            put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH,if(sharing)"Pictures/Sai Photos/Shared" else "Pictures/Sai Photos")
                            put(android.provider.MediaStore.MediaColumns.IS_PENDING,1)
                        }
                        val uri=contentResolver.insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,values)?:throw CloudError(503,"Could not create the file in Pictures.")
                        try{contentResolver.openOutputStream(uri)?.use{stream->stream.write(bytes)}?:throw CloudError(503,"Could not write the file.")}catch(e:Exception){contentResolver.delete(uri,null,null);throw e}
                        val done=android.content.ContentValues().apply{put(android.provider.MediaStore.MediaColumns.IS_PENDING,0)}
                        contentResolver.update(uri,done,null,null)
                        if(!sharing){runOnUiThread{reply(id,200,JSONObject().put("saved",true).put("name",fileName))};return@execute}
                        runOnUiThread{
                            try{
                                val send=android.content.Intent(android.content.Intent.ACTION_SEND).apply{type=mime;putExtra(android.content.Intent.EXTRA_STREAM,uri);addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)}
                                startActivity(android.content.Intent.createChooser(send,"Share photo"))
                                reply(id,200,JSONObject().put("shared",true).put("name",fileName))
                            }catch(_:Exception){reply(id,500,JSONObject().put("error","No app is available to share this photo."))}
                        }
                    }catch(e:Exception){runOnUiThread{reply(id,500,JSONObject().put("error",e.message?:(if(sharing)"Could not share this photo." else "Could not save this photo.")))}}
                }
                return
            }
            if(path.startsWith("/.netlify/functions/pcloud-auth") && method=="POST" && Uri.parse(path).getQueryParameter("action")=="start"){
                runOnUiThread{
                    try{
                        val target=oauth.start()
                        startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW,target).addCategory(android.content.Intent.CATEGORY_BROWSABLE))
                        reply(id,200,JSONObject().put("status","launched"))
                    }catch(e:Exception){reply(id,503,JSONObject().put("error","Could not open pCloud sign-in in your browser. Try connecting with a token instead."))}
                }
                return
            }
            workers.execute {
                val result=try{JSONObject().put("status",200).put("data",api.withSession { api.handle(path,method,body) })}catch(e:CloudError){JSONObject().put("status",e.status).put("data",JSONObject().put("error",e.message))}catch(_:Exception){JSONObject().put("status",502).put("data",JSONObject().put("error","Request failed. Check your internet and pCloud token."))}
                runOnUiThread { if(!isFinishing&&!isDestroyed)web.evaluateJavascript("window.saiNativeReply($id,${JSONObject.quote(result.toString())})",null) }
            }
        }
    }
    private fun openAsset(path:String):java.io.InputStream = try {assets.open(path)}catch(e:java.io.FileNotFoundException){if(path.endsWith(".gz"))assets.open(path.removeSuffix(".gz"))else throw e}
    private fun jsonResponse(status:Int,data:JSONObject)=WebResourceResponse("application/json","UTF-8",status,if(status==200)"OK" else "Error",mapOf("Cache-Control" to "no-store"),ByteArrayInputStream(data.toString().toByteArray()))
    private fun errorResponse(status:Int,message:String)=jsonResponse(status,JSONObject().put("error",message))
    @Deprecated("Deprecated in Java") override fun onBackPressed(){web.evaluateJavascript("(()=>{const d=[...document.querySelectorAll('dialog[open]')],C=d.at(-1);if(C){if(C.id==='settingsDialog'&&!document.getElementById('settingsBack').hidden)document.getElementById('settingsBack').click();else C.close();return true;}return window.saiGalleryBack?.()||false;})()") { result -> if(result!="true")moveTaskToBack(true) }}
    override fun onDestroy(){PlaybackBridge.action=null;stopService(android.content.Intent(this,PlaybackService::class.java));eraser?.shutdown();api.ai.shutdown();workers.shutdownNow();web.removeJavascriptInterface("SaiNative");web.destroy();super.onDestroy()}
}
