package com.saireddy.saiai

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class DownloadService : Service() {
    companion object {
        const val ACTION_START = "com.saireddy.saiai.DL_START"
        const val ACTION_CANCEL = "com.saireddy.saiai.DL_CANCEL"
        const val EVENT = "com.saireddy.saiai.DL_EVENT"
        const val CHANNEL = "sai-ai-download"
        const val NOTI = 61
        fun start(c: Context, id: String) { c.startForegroundService(Intent(c, DownloadService::class.java).setAction(ACTION_START).putExtra("id", id)) }
        fun cancel(c: Context, id: String) { c.startService(Intent(c, DownloadService::class.java).setAction(ACTION_CANCEL).putExtra("id", id)) }
    }

    private val worker = Executors.newSingleThreadExecutor()
    private val client = OkHttpClient.Builder().connectTimeout(30, TimeUnit.SECONDS).readTimeout(2, TimeUnit.MINUTES).build()
    @Volatile private var currentId: String? = null
    @Volatile private var cancelled = false

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) nm.createNotificationChannel(NotificationChannel(CHANNEL, "Model downloads", NotificationManager.IMPORTANCE_LOW))
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val id = intent?.getStringExtra("id") ?: return START_NOT_STICKY
        when (intent.action) {
            ACTION_CANCEL -> { cancelled = true; if (currentId == id) stopSelf(); return START_NOT_STICKY }
            ACTION_START -> {
                if (currentId == id) return START_STICKY
                cancelled = true
                currentId = id; cancelled = false
                startForeground(NOTI, buildNotification(id, 0, 0, "Starting…"))
                worker.execute { runDownload(id) }
            }
        }
        return START_STICKY
    }

    private fun runDownload(id: String) {
        val model = ModelStore.model(id)
        val part = ModelStore.partFor(this, id)
        val final = ModelStore.fileFor(this, id)
        val url = model?.url ?: run { fail(id, "Unknown model."); return }
        try {
            if (final.exists()) final.delete()
            if (part.exists()) part.delete()
            val builder = Request.Builder().url(url).header("User-Agent", "SaiAIAndroid/1.0")
            val token = ModelStore.hfToken(this)
            if (token.isNotEmpty()) builder.header("Authorization", "Bearer $token")
            client.newCall(builder.build()).execute().use { resp ->
                if (!resp.isSuccessful) throw IllegalStateException("Server replied ${resp.code}. ${if (model?.gated == true && token.isEmpty()) "This model needs a Hugging Face token." else ""}".trim())
                val total = resp.body?.contentLength()?.takeIf { it > 0 } ?: (model?.sizeBytes ?: 0L)
                resp.body?.byteStream()?.use { input ->
                    part.outputStream().use { output ->
                        val buf = ByteArray(1 shl 16); var read: Int; var got = 0L; var lastTick = 0L
                        while (input.read(buf).also { read = it } >= 0) {
                            if (cancelled) throw InterruptedException("cancelled")
                            output.write(buf, 0, read); got += read
                            val now = System.currentTimeMillis()
                            if (now - lastTick > 400) { lastTick = now; report(id, got, total, true, null) }
                        }
                    }
                }
            }
            if (!part.renameTo(final)) { part.copyTo(final, true); part.delete() }
            ModelStore.setDownloadState(this, id, JSONObject().put("running", false).put("done", true).put("bytes", final.length()).put("total", final.length()))
            broadcast(id, false, true, null)
            notifyDone(id, model?.name ?: id)
        } catch (e: Exception) {
            try { part.delete() } catch (_: Exception) {}
            if (cancelled) { ModelStore.setDownloadState(this, id, JSONObject().put("running", false).put("done", false).put("cancelled", true)); broadcast(id, false, false, "cancelled") }
            else fail(id, e.message ?: "Download failed.")
        } finally {
            currentId = null
            stopForeground(true); stopSelf()
        }
    }

    private fun fail(id: String, message: String) {
        ModelStore.setDownloadState(this, id, JSONObject().put("running", false).put("done", false).put("error", message))
        broadcast(id, false, false, message)
    }

    private fun report(id: String, got: Long, total: Long, running: Boolean, error: String?) {
        ModelStore.setDownloadState(this, id, JSONObject().put("running", running).put("done", false).put("bytes", got).put("total", total).put("error", error ?: JSONObject.NULL))
        broadcast(id, running, false, error)
        getSystemService(NotificationManager::class.java).notify(NOTI, buildNotification(id, got, total, null))
    }

    private fun broadcast(id: String, running: Boolean, done: Boolean, error: String?) {
        val payload = JSONObject().put("id", id).put("running", running).put("done", done).put("bytes", ModelStore.localBytes(this, id)).put("state", ModelStore.downloadState(this, id)).toString()
        sendBroadcast(Intent(EVENT).setPackage(packageName).putExtra("payload", payload))
    }

    private fun buildNotification(id: String, got: Long, total: Long, note: String?): Notification {
        val pct = if (total > 0) ((got * 100) / total).toInt() else 0
        val text = note ?: "$pct%  •  ${"%.0f".format(got / 1e6)} / ${"%.0f".format(total / 1e6)} MB"
        return Notification.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("Downloading ${ModelStore.model(id)?.name ?: id}").setContentText(text)
            .setProgress(100, pct, total <= 0).setOngoing(true).setOnlyAlertOnce(true).build()
    }

    private fun notifyDone(id: String, name: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTI + 1, Notification.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("$name is ready").setContentText("Open Sai AI to start chatting offline.").setAutoCancel(true).build())
    }

    override fun onDestroy() { cancelled = true; worker.shutdownNow(); super.onDestroy() }
    override fun onBind(intent: Intent?): IBinder? = null
}
