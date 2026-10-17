package com.saiphotos.mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class MemoryNotifier : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val prefs = context.getSharedPreferences("sai-photos", Context.MODE_PRIVATE)
        val enabled = prefs.getBoolean("memory-enabled", false); val count = prefs.getInt("memory-count", 0)
        android.util.Log.i("SaiPhotosUI", "MemoryNotifier received: enabled=$enabled count=$count")
        if (!enabled) return
        if (count < 1) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        manager.createNotificationChannel(
            NotificationChannel("memories", "Memory notifications", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Daily reminders about photos from this day in past years."
            }
        )
        val open = PendingIntent.getActivity(
            context, 0, Intent(context, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notification = Notification.Builder(context, "memories")
            .setSmallIcon(android.R.drawable.ic_menu_gallery)
            .setContentTitle("Your memories today")
            .setContentText("$count photos from this day in past years. Tap to relive them.")
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        try { manager.notify(7, notification); android.util.Log.i("SaiPhotosUI", "Memory notification posted: count=$count") } catch (e: Exception) { android.util.Log.w("SaiPhotosUI", "Memory notification failed: ${e.message}") }
    }
}
