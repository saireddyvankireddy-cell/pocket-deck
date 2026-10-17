package com.saireddy.saiai

import android.app.Activity
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import org.json.JSONArray
import org.json.JSONObject

// The agent's hands: real device-gallery actions through MediaStore and intents.
object PhotoTools {
    private const val DELETE_REQUEST = 74
    private fun collection() = MediaStore.Images.Media.EXTERNAL_CONTENT_URI
    private fun uriFor(id: Long): Uri = ContentUris.withAppendedId(collection(), id)

    fun hasPermission(c: Context): Boolean {
        val perm = if (Build.VERSION.SDK_INT >= 33) "android.permission.READ_MEDIA_IMAGES" else "android.permission.READ_EXTERNAL_STORAGE"
        return c.checkSelfPermission(perm) == android.content.pm.PackageManager.PERMISSION_GRANTED
    }

    private fun projection() = arrayOf(
        MediaStore.Images.Media._ID, MediaStore.Images.Media.DISPLAY_NAME, MediaStore.Images.Media.DATE_ADDED,
        MediaStore.Images.Media.SIZE, MediaStore.Images.Media.MIME_TYPE, MediaStore.Images.Media.BUCKET_DISPLAY_NAME
    )

    private fun row(cursor: android.database.Cursor): JSONObject = JSONObject()
        .put("id", cursor.getLong(0)).put("name", cursor.getString(1) ?: "Photo")
        .put("date", cursor.getLong(2) * 1000).put("size", cursor.getLong(3))
        .put("mime", cursor.getString(4) ?: "image/jpeg").put("album", cursor.getString(5) ?: "Camera")

    fun list(c: Context, query: String?, album: String?, limit: Int): JSONObject {
        if (!hasPermission(c)) return JSONObject().put("error", "Photo permission is needed. Grant it in Sai AI settings.")
        val cap = limit.coerceIn(1, 200)
        val sel = StringBuilder(); val args = mutableListOf<String>()
        if (!query.isNullOrBlank()) { sel.append("${MediaStore.Images.Media.DISPLAY_NAME} LIKE ?"); args.add("%$query%") }
        if (!album.isNullOrBlank()) { if (sel.isNotEmpty()) sel.append(" AND "); sel.append("${MediaStore.Images.Media.BUCKET_DISPLAY_NAME} = ?"); args.add(album) }
        val items = JSONArray()
        c.contentResolver.query(collection(), projection(), sel.toString().ifEmpty { null }, args.toTypedArray().ifEmpty { null }, "${MediaStore.Images.Media.DATE_ADDED} DESC")?.use { cur ->
            while (cur.moveToNext() && items.length() < cap) items.put(row(cur))
        }
        return JSONObject().put("count", items.length()).put("items", items)
    }

    fun info(c: Context, id: Long): JSONObject {
        if (!hasPermission(c)) return JSONObject().put("error", "Photo permission is needed.")
        c.contentResolver.query(uriFor(id), projection(), null, null, null)?.use { cur -> if (cur.moveToFirst()) return row(cur) }
        return JSONObject().put("error", "That photo was not found.")
    }

    fun albums(c: Context): JSONObject {
        if (!hasPermission(c)) return JSONObject().put("error", "Photo permission is needed.")
        val counts = HashMap<String, Int>()
        c.contentResolver.query(collection(), arrayOf(MediaStore.Images.Media.BUCKET_DISPLAY_NAME), null, null, null)?.use { cur ->
            while (cur.moveToNext()) { val name = cur.getString(0) ?: "Camera"; counts[name] = (counts[name] ?: 0) + 1 }
        }
        val arr = JSONArray(); counts.entries.sortedByDescending { it.value }.forEach { arr.put(JSONObject().put("album", it.key).put("count", it.value)) }
        return JSONObject().put("albums", arr)
    }

    fun open(activity: Activity, id: Long): JSONObject = try {
        val mime = activity.contentResolver.getType(uriFor(id)) ?: "image/*"
        activity.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uriFor(id), mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        JSONObject().put("opened", true)
    } catch (e: Exception) { JSONObject().put("error", "No gallery app could open that photo.") }

    fun share(activity: Activity, id: Long): JSONObject = try {
        val mime = activity.contentResolver.getType(uriFor(id)) ?: "image/*"
        val send = Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uriFor(id)).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        activity.startActivity(Intent.createChooser(send, "Share photo"))
        JSONObject().put("shared", true)
    } catch (e: Exception) { JSONObject().put("error", "No app could share that photo.") }

    fun setWallpaper(c: Context, id: Long): JSONObject = try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        c.contentResolver.openInputStream(uriFor(id))?.use { BitmapFactory.decodeStream(it, null, bounds) }
        val target = 2048
        var sample = 1; while (bounds.outWidth / sample > target) sample *= 2
        val opts = BitmapFactory.Options().apply { inSampleSize = sample }
        val bitmap = c.contentResolver.openInputStream(uriFor(id))?.use { BitmapFactory.decodeStream(it, null, opts) } ?: throw IllegalStateException()
        val wm = android.app.WallpaperManager.getInstance(c)
        if (Build.VERSION.SDK_INT >= 24) wm.setBitmap(bitmap, null, true, android.app.WallpaperManager.FLAG_SYSTEM) else @Suppress("DEPRECATION") wm.setBitmap(bitmap)
        bitmap.recycle()
        JSONObject().put("wallpaper", true)
    } catch (e: Exception) { JSONObject().put("error", "Could not set the wallpaper: ${e.message ?: "unknown error"}.") }

    // Deletion of media owned by other apps needs Android's own confirmation on Android 10+.
    fun delete(activity: Activity, ids: List<Long>): JSONObject {
        if (ids.isEmpty()) return JSONObject().put("error", "No photos were named.")
        val uris = ids.map { uriFor(it) }
        return if (Build.VERSION.SDK_INT >= 30) {
            try {
                val pending = MediaStore.createDeleteRequest(activity.contentResolver, uris)
                activity.startIntentSenderForResult(pending.intentSender, DELETE_REQUEST, null, 0, 0, 0)
                JSONObject().put("confirm", true).put("count", uris.size)
            } catch (e: Exception) { JSONObject().put("error", "Android would not start the delete request.") }
        } else {
            var deleted = 0
            for (u in uris) { try { if (activity.contentResolver.delete(u, null, null) > 0) deleted++ } catch (_: Exception) {} }
            JSONObject().put("deleted", deleted)
        }
    }

    fun copyToAlbum(c: Context, ids: List<Long>, album: String): JSONObject {
        if (album.isBlank()) return JSONObject().put("error", "Name the album first.")
        var copied = 0
        for (id in ids) {
            try {
                val name = info(c, id).optString("name", "photo.jpg")
                val mime = info(c, id).optString("mime", "image/jpeg")
                val values = android.content.ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                    put(MediaStore.MediaColumns.MIME_TYPE, mime)
                    put(MediaStore.MediaColumns.RELATIVE_PATH, "Pictures/$album")
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val target = c.contentResolver.insert(collection(), values) ?: continue
                c.contentResolver.openInputStream(uriFor(id))?.use { input -> c.contentResolver.openOutputStream(target)?.use { output -> input.copyTo(output) } }
                c.contentResolver.update(target, android.content.ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
                copied++
            } catch (_: Exception) {}
        }
        return JSONObject().put("copied", copied).put("album", album)
    }

    fun openSaiPhotos(activity: Activity): JSONObject = try {
        val intent = activity.packageManager.getLaunchIntentForPackage("com.saiphotos.mobile")
            ?: return JSONObject().put("error", "Sai Photos is not installed on this phone.")
        activity.startActivity(intent); JSONObject().put("opened", true)
    } catch (e: Exception) { JSONObject().put("error", "Could not open Sai Photos.") }
}
