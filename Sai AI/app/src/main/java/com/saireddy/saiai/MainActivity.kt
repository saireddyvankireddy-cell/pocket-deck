package com.saireddy.saiai

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.util.concurrent.Executors

class MainActivity : Activity() {
    private lateinit var web: WebView
    private val workers = Executors.newFixedThreadPool(4)
    private val origin = "https://appassets.androidplatform.net"
    private var notificationAsked = false
    private var dlReceiver: BroadcastReceiver? = null
    private lateinit var cloud: PCloudApi
    private lateinit var pcloudOauth: PCloudOAuth

    private fun reply(id: String, status: Int, data: Any) {
        val payload = JSONObject().put("status", status).put("data", data).toString()
        if (!isFinishing && !isDestroyed) web.evaluateJavascript("window.saiNativeReply($id,${JSONObject.quote(payload)})", null)
    }
    private fun emit(event: JSONObject) { if (!isFinishing && !isDestroyed) web.evaluateJavascript("window.saiAIEvent?.(${JSONObject.quote(event.toString())})", null) }

    private fun stateJson(): JSONObject {
        val s = ModelStore.stateJson(this)
        s.put("photoPermission", PhotoTools.hasPermission(this))
        s.put("saiphotos", packageManager.getLaunchIntentForPackage("com.saiphotos.mobile") != null)
        s.put("pcloud", cloud.connected())
        s.put("version", BuildConfig.VERSION_NAME)
        return s
    }

    override fun onCreate(state: Bundle?) {
        super.onCreate(state)
        cloud = PCloudApi(applicationContext)
        pcloudOauth = PCloudOAuth(applicationContext)
        web = WebView(this)
        WebView.setWebContentsDebuggingEnabled(true)
        if (Build.VERSION.SDK_INT >= 30) window.setDecorFitsSystemWindows(false)
        // A WebView ignores its own padding for page rendering, so insets are applied to a wrapper.
        val root = android.widget.FrameLayout(this)
        root.addView(web, android.widget.FrameLayout.LayoutParams(android.view.ViewGroup.LayoutParams.MATCH_PARENT, android.view.ViewGroup.LayoutParams.MATCH_PARENT))
        root.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val bars = insets.getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.displayCutout())
                v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            } else {
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
        setContentView(root)
        root.post { root.requestApplyInsets() }
        web.settings.apply {
            javaScriptEnabled = true; domStorageEnabled = true; allowFileAccess = false; allowContentAccess = false
            setAllowFileAccessFromFileURLs(false); setAllowUniversalAccessFromFileURLs(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW; mediaPlaybackRequiresUserGesture = false
            userAgentString += " SaiAIAndroid/1.0.1"
        }
        web.addJavascriptInterface(Bridge(), "SaiNative")
        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(m: ConsoleMessage): Boolean { if (m.messageLevel() == ConsoleMessage.MessageLevel.ERROR) android.util.Log.w("SaiAIUI", m.message().take(500)); return true }
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = request.url.scheme != "https" || request.url.host != "appassets.androidplatform.net"
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                val uri = request.url
                if (uri.scheme in setOf("data", "blob")) return null
                if (uri.scheme != "https" || uri.host != "appassets.androidplatform.net") return error(403, "External navigation is disabled.")
                return try {
                    val path = uri.path ?: "/"
                    val asset = if (path == "/") "index.html" else path.removePrefix("/")
                    if (asset.contains("..") || asset.contains('\\')) return error(403, "Invalid asset path.")
                    val mime = when (asset.substringAfterLast('.')) { "js", "mjs" -> "text/javascript"; "html" -> "text/html"; "css" -> "text/css"; "json" -> "application/json"; "svg" -> "image/svg+xml"; else -> "application/octet-stream" }
                    WebResourceResponse(mime, if (mime.startsWith("text") || mime == "application/json") "UTF-8" else null, 200, "OK",
                        mapOf("Cache-Control" to "no-cache", "Content-Security-Policy" to "default-src 'self' blob: data:; script-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'self'"), openAsset(asset))
                } catch (_: Exception) { error(404, "Not found.") }
            }
        }
        dlReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val payload = intent.getStringExtra("payload") ?: return
                emit(JSONObject().put("type", "download").put("payload", JSONObject(payload)))
            }
        }
        val filter = IntentFilter(DownloadService.EVENT)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(dlReceiver, filter, RECEIVER_NOT_EXPORTED) else @Suppress("UnspecifiedRegisterReceiverFlag") registerReceiver(dlReceiver, filter)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED && !notificationAsked) {
            notificationAsked = true; requestPermissions(arrayOf("android.permission.POST_NOTIFICATIONS"), 20)
        }
        web.loadUrl("$origin/")
        handlePcloudCallback(intent?.data)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handlePcloudCallback(intent.data)
    }

    private fun handlePcloudCallback(uri: Uri?) {
        if (!PCloudOAuth.isCallback(uri)) return
        val callback = uri ?: return
        workers.execute {
            try {
                val auth = pcloudOauth.consume(callback)
                cloud.verifyAndSaveToken(auth.getString("host"), auth.getString("tokenType"), auth.getString("token"))
                runOnUiThread { emit(JSONObject().put("type", "pcloud").put("state", "connected")) }
            } catch (e: Exception) {
                runOnUiThread { emit(JSONObject().put("type", "pcloud").put("state", "error").put("error", e.message ?: "pCloud login could not be completed.")) }
            }
        }
    }

    private fun connectPcloudToken(token: String): JSONObject {
        val clean = token.trim()
        if (!Regex("[!-~]{1,512}").matches(clean)) throw CloudError(400, "That does not look like a valid pCloud token.")
        var last: Exception? = null
        for (host in listOf("api.pcloud.com", "eapi.pcloud.com")) {
            try { cloud.verifyAndSaveToken(host, "access_token", clean); return accountJson() } catch (e: Exception) { last = e }
        }
        throw (last ?: CloudError(502, "pCloud did not accept that token."))
    }

    private fun accountJson(): JSONObject {
        val info = cloud.call("userinfo")
        return JSONObject().put("connected", true).put("email", info.optString("email")).put("quota", info.optLong("quota")).put("used", info.optLong("usedquota"))
    }

    private fun deepLinkToSaiPhotos(view: String? = null, q: String? = null, album: String? = null, person: String? = null, photo: String? = null): Boolean {
        val builder = Uri.parse("saiphotos://open").buildUpon()
        if (!view.isNullOrBlank()) builder.appendQueryParameter("view", view.take(40))
        if (!q.isNullOrBlank()) builder.appendQueryParameter("q", q.take(200))
        if (!album.isNullOrBlank()) builder.appendQueryParameter("album", album.take(120))
        if (!person.isNullOrBlank()) builder.appendQueryParameter("person", person.take(120))
        if (!photo.isNullOrBlank()) builder.appendQueryParameter("photo", photo.take(40))
        val base = Intent(Intent.ACTION_VIEW, builder.build())
        return try { startActivity(Intent(base).setPackage("com.saiphotos.mobile")); true }
        catch (_: Exception) { try { startActivity(base); true } catch (_: Exception) { false } }
    }

    private fun photoPermission(): String = if (Build.VERSION.SDK_INT >= 33) "android.permission.READ_MEDIA_IMAGES" else android.Manifest.permission.READ_EXTERNAL_STORAGE

    private fun runTool(name: String, args: JSONObject): JSONObject {
        fun ids(): List<Long> { val a = args.optJSONArray("ids") ?: return emptyList(); return (0 until a.length()).mapNotNull { a.opt(it).toString().toLongOrNull() } }
        fun oneId(): Long = args.opt("id").toString().toLongOrNull() ?: -1L
        return when (name) {
            "list_photos" -> PhotoTools.list(this, args.optString("query").takeIf { it.isNotBlank() }, args.optString("album").takeIf { it.isNotBlank() }, args.optInt("limit", 20))
            "photo_info" -> PhotoTools.info(this, oneId())
            "list_albums" -> PhotoTools.albums(this)
            "open_photo" -> PhotoTools.open(this, oneId())
            "share_photo" -> PhotoTools.share(this, oneId())
            "set_wallpaper" -> PhotoTools.setWallpaper(this, oneId())
            "delete_photos" -> PhotoTools.delete(this, ids())
            "copy_photos_to_album" -> PhotoTools.copyToAlbum(this, ids(), args.optString("album"))
            "open_sai_photos" -> PhotoTools.openSaiPhotos(this)
            else -> JSONObject().put("error", "Unknown tool: $name")
        }
    }

    inner class Bridge {
        @JavascriptInterface fun ready() {}
        @JavascriptInterface fun request(id: String, action: String, body: String) {
            if (!Regex("[0-9]{1,12}").matches(id) || action.length > 40 || body.length > 2_000_000) return
            val payload = try { if (body.isBlank()) JSONObject() else JSONObject(body) } catch (_: Exception) { JSONObject() }
            when (action) {
                "state" -> workers.execute { runOnUiThread { reply(id, 200, stateJson()) } }
                "engine-status" -> runOnUiThread { reply(id, 200, LlmEngine.statusJson()) }
                "save-config" -> runOnUiThread {
                    ModelStore.prefs(this@MainActivity).edit().putString("system-prompt", payload.optString("systemPrompt", ModelStore.DEFAULT_SYSTEM))
                        .putFloat("temperature", payload.optDouble("temperature", 0.7).toFloat()).apply()
                    LlmEngine.updateSystem(payload.optString("systemPrompt", ModelStore.DEFAULT_SYSTEM))
                    reply(id, 200, stateJson())
                }
                "provider-save" -> runOnUiThread {
                    val current = ModelStore.provider(this@MainActivity)
                    val key = payload.optString("apiKey", "").ifBlank { current.optString("apiKey", "") }
                    ModelStore.prefs(this@MainActivity).edit().putString("provider", JSONObject()
                        .put("baseUrl", payload.optString("baseUrl", "https://openrouter.ai/api/v1"))
                        .put("model", payload.optString("model", "deepseek/deepseek-v4-flash:free"))
                        .put("apiKey", key).toString()).apply()
                    reply(id, 200, stateJson())
                }
                "provider-clear" -> runOnUiThread { ModelStore.prefs(this@MainActivity).edit().remove("provider").apply(); reply(id, 200, stateJson()) }
                "hf-token-save" -> runOnUiThread { ModelStore.prefs(this@MainActivity).edit().putString("hf-token", payload.optString("token", "")).apply(); reply(id, 200, stateJson()) }
                "cloud-test" -> workers.execute {
                    val data = try { Cloud.test(this@MainActivity) } catch (e: Cloud.CloudError) { JSONObject().put("error", e.message ?: "Cloud test failed.") } catch (e: Exception) { JSONObject().put("error", e.message ?: "Cloud test failed.") }
                    runOnUiThread { reply(id, 200, data) }
                }
                "cloud-chat" -> {
                    val messages = payload.optJSONArray("messages") ?: JSONArray()
                    val tools = payload.optJSONArray("tools")
                    val temp = payload.optDouble("temperature", ModelStore.temperature(this@MainActivity).toDouble())
                    workers.execute {
                        val data = try { Cloud.chat(this@MainActivity, messages, tools, temp) } catch (e: Cloud.CloudError) { JSONObject().put("error", e.message ?: "Cloud request failed.") } catch (e: Exception) { JSONObject().put("error", e.message ?: "Cloud request failed.") }
                        runOnUiThread { reply(id, 200, data) }
                    }
                }
                "tool-run" -> runOnUiThread { reply(id, 200, runTool(payload.optString("name"), payload.optJSONObject("args") ?: JSONObject())) }
                "request-photo-permission" -> runOnUiThread {
                    if (PhotoTools.hasPermission(this@MainActivity)) reply(id, 200, JSONObject().put("granted", true))
                    else { requestPermissions(arrayOf(photoPermission()), 21); reply(id, 200, JSONObject().put("pending", true)) }
                }
                "download" -> runOnUiThread {
                    val modelId = payload.optString("id")
                    if (ModelStore.model(modelId) == null && payload.optString("url").isBlank()) { reply(id, 400, JSONObject().put("error", "Unknown model.")); return@runOnUiThread }
                    DownloadService.start(this@MainActivity, modelId); reply(id, 200, JSONObject().put("started", true))
                }
                "cancel-download" -> runOnUiThread { DownloadService.cancel(this@MainActivity, payload.optString("id")); reply(id, 200, JSONObject().put("cancelled", true)) }
                "delete-model" -> workers.execute {
                    val modelId = payload.optString("id")
                    ModelStore.fileFor(this@MainActivity, modelId).delete(); ModelStore.partFor(this@MainActivity, modelId).delete()
                    ModelStore.prefs(this@MainActivity).edit().remove("dl-$modelId").apply()
                    if (ModelStore.activeId(this@MainActivity) == null) LlmEngine.unload()
                    runOnUiThread { reply(id, 200, stateJson()) }
                }
                "activate" -> {
                    val modelId = payload.optString("id")
                    runOnUiThread {
                        if (!ModelStore.downloaded(this@MainActivity, modelId)) { reply(id, 400, JSONObject().put("error", "Download the model first.")); return@runOnUiThread }
                        ModelStore.setActive(this@MainActivity, modelId)
                        reply(id, 200, JSONObject().put("loading", true).put("id", modelId))
                        emit(JSONObject().put("type", "engine").put("state", "loading").put("id", modelId))
                        LlmEngine.load(this@MainActivity, modelId, ModelStore.systemPrompt(this@MainActivity)) { err ->
                            runOnUiThread { emit(JSONObject().put("type", "engine").put("state", if (err == null) "ready" else "error").put("id", modelId).put("error", err ?: JSONObject.NULL)) }
                        }
                    }
                }
                "load" -> runOnUiThread {
                    val modelId = payload.optString("id").takeIf { it.isNotBlank() } ?: ModelStore.activeId(this@MainActivity)
                    if (modelId == null) { reply(id, 400, JSONObject().put("error", "No model selected.")); return@runOnUiThread }
                    reply(id, 200, JSONObject().put("loading", true).put("id", modelId))
                    LlmEngine.load(this@MainActivity, modelId, ModelStore.systemPrompt(this@MainActivity)) { err ->
                        runOnUiThread { emit(JSONObject().put("type", "engine").put("state", if (err == null) "ready" else "error").put("id", modelId).put("error", err ?: JSONObject.NULL)) }
                    }
                }
                "unload" -> runOnUiThread { LlmEngine.unload(); reply(id, 200, JSONObject().put("unloaded", true)) }
                "chat" -> runOnUiThread {
                    val prompt = payload.optString("prompt")
                    reply(id, 200, JSONObject().put("started", true))
                    LlmEngine.ensureLoaded(this@MainActivity, ModelStore.systemPrompt(this@MainActivity)) { err ->
                        if (err != null) { runOnUiThread { emit(JSONObject().put("type", "chat-error").put("error", err)) } ; return@ensureLoaded }
                        LlmEngine.chat(prompt,
                            onChunk = { chunk -> runOnUiThread { emit(JSONObject().put("type", "chat-chunk").put("text", chunk)) } },
                            onDone = { runOnUiThread { emit(JSONObject().put("type", "chat-done")) } },
                            onError = { err -> runOnUiThread { emit(JSONObject().put("type", "chat-error").put("error", err)) } })
                    }
                }
                "reset-chat" -> runOnUiThread {
                    LlmEngine.reset(ModelStore.systemPrompt(this@MainActivity)) { err -> reply(id, 200, JSONObject().put("reset", err == null).put("error", err ?: JSONObject.NULL)) }
                }
                "open-url" -> runOnUiThread {
                    val url = payload.optString("url")
                    if (!url.startsWith("https://")) { reply(id, 400, JSONObject().put("error", "Only https links can be opened.")); return@runOnUiThread }
                    try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)); reply(id, 200, JSONObject().put("opened", true)) }
                    catch (e: Exception) { reply(id, 400, JSONObject().put("error", "No browser could open this link.")) }
                }
                "pcloud-start" -> runOnUiThread {
                    try { reply(id, 200, JSONObject().put("url", pcloudOauth.start().toString())) }
                    catch (e: Exception) { reply(id, 400, JSONObject().put("error", "Could not start pCloud login.")) }
                }
                "pcloud-token" -> workers.execute {
                    val data = try { connectPcloudToken(payload.optString("token")) }
                    catch (e: CloudError) { JSONObject().put("error", e.message ?: "pCloud login failed.") }
                    catch (e: Exception) { JSONObject().put("error", e.message ?: "pCloud login failed.") }
                    runOnUiThread { reply(id, 200, data) }
                }
                "pcloud-status" -> workers.execute {
                    val data = try { if (cloud.connected()) accountJson() else JSONObject().put("connected", false) }
                    catch (e: Exception) { JSONObject().put("connected", cloud.connected()).put("error", e.message ?: "pCloud is not reachable.") }
                    runOnUiThread { reply(id, 200, data) }
                }
                "pcloud-disconnect" -> runOnUiThread { cloud.disconnect(); reply(id, 200, JSONObject().put("connected", false)) }
                "pcloud-library" -> workers.execute {
                    val data = try {
                        val lib = cloud.listMedia("photo", payload.optString("folderId").takeIf { it.isNotBlank() })
                        JSONObject().put("connected", true).put("items", lib.optJSONArray("items") ?: JSONArray()).put("scan", lib.optJSONObject("scan") ?: JSONObject())
                    } catch (e: CloudError) { JSONObject().put("error", e.message ?: "Could not read your pCloud photos.") }
                    catch (e: Exception) { JSONObject().put("error", e.message ?: "Could not read your pCloud photos.") }
                    runOnUiThread { reply(id, 200, data) }
                }
                "pcloud-thumb" -> {
                    val fileId = payload.optString("id").removePrefix("pc-")
                    val version = payload.optString("version")
                    workers.execute {
                        val data = try {
                            val bytes = cloud.previewBytes(fileId, version, false)
                            when { bytes.size > 900_000 -> JSONObject().put("error", "Thumbnail is too large.")
                                else -> JSONObject().put("data", "data:image/jpeg;base64," + android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)) }
                        } catch (e: Exception) { JSONObject().put("error", e.message ?: "Thumbnail unavailable.") }
                        runOnUiThread { reply(id, 200, data) }
                    }
                }
                "pcloud-tool" -> {
                    val tool = payload.optString("name"); val args = payload.optJSONObject("args") ?: JSONObject()
                    when (tool) {
                        "search_pcloud_photos" -> workers.execute {
                            val data = try {
                                val items = cloud.listMedia("photo", null).optJSONArray("items") ?: JSONArray()
                                val q = args.optString("query").trim().lowercase()
                                val limit = args.optInt("limit", 30).coerceIn(1, 200)
                                val all = (0 until items.length()).map { items.getJSONObject(it) }
                                val filtered = all.filter { q.isEmpty() || it.optString("fileName").lowercase().contains(q) || it.optString("folderPath").lowercase().contains(q) }
                                val out = JSONArray()
                                for (i in 0 until minOf(limit, filtered.size)) { val row = filtered[i]; out.put(JSONObject().put("id", row.optString("id")).put("name", row.optString("fileName")).put("folder", row.optString("folderPath")).put("size", row.optLong("size")).put("addedAt", row.optLong("addedAt"))) }
                                JSONObject().put("count", filtered.size).put("items", out)
                            } catch (e: Exception) { JSONObject().put("error", e.message ?: "Could not search pCloud.") }
                            runOnUiThread { reply(id, 200, data) }
                        }
                        "open_in_saiphotos" -> runOnUiThread {
                            val opened = deepLinkToSaiPhotos(args.optString("view").takeIf { it.isNotBlank() }, args.optString("q").takeIf { it.isNotBlank() }, args.optString("album").takeIf { it.isNotBlank() }, args.optString("person").takeIf { it.isNotBlank() }, args.optString("photo").takeIf { it.isNotBlank() })
                            reply(id, 200, JSONObject().put("opened", opened))
                        }
                        else -> runOnUiThread { reply(id, 400, JSONObject().put("error", "Unknown pCloud tool.")) }
                    }
                }
                "open-in-saiphotos" -> runOnUiThread {
                    val opened = deepLinkToSaiPhotos(payload.optString("view").takeIf { it.isNotBlank() }, payload.optString("q").takeIf { it.isNotBlank() }, payload.optString("album").takeIf { it.isNotBlank() }, payload.optString("person").takeIf { it.isNotBlank() }, payload.optString("photo").takeIf { it.isNotBlank() })
                    reply(id, 200, JSONObject().put("opened", opened))
                }
                else -> runOnUiThread { reply(id, 400, JSONObject().put("error", "Unknown request.")) }
            }
        }
    }

    private fun openAsset(path: String): java.io.InputStream = try { assets.open(path) } catch (e: java.io.FileNotFoundException) { if (path.endsWith(".gz")) assets.open(path.removeSuffix(".gz")) else throw e }
    private fun error(status: Int, message: String) = WebResourceResponse("application/json", "UTF-8", status, "Error", mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(JSONObject().put("error", message).toString().toByteArray()))

    @Deprecated("Deprecated in Java") override fun onBackPressed() {
        web.evaluateJavascript("(()=>{const d=[...document.querySelectorAll('dialog[open]')],C=d.at(-1);if(C){C.close();return true;}return window.saiBack?.()||false;})()") { result -> if (result != "true") moveTaskToBack(true) }
    }

    override fun onDestroy() {
        try { dlReceiver?.let { unregisterReceiver(it) } } catch (_: Exception) {}
        workers.shutdownNow()
        web.removeJavascriptInterface("SaiNative"); web.destroy(); super.onDestroy()
    }
}
