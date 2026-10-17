package com.saiphotos.mobile

import android.app.*
import android.content.Intent
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.*
import org.json.JSONObject

object PlaybackBridge { @Volatile var state=JSONObject();var action:((String,Long)->Unit)?=null }
class PlaybackService:Service() {
    lateinit var session:MediaSession
    override fun onCreate(){super.onCreate();val manager=getSystemService(NotificationManager::class.java);manager.createNotificationChannel(NotificationChannel("music","Music playback",NotificationManager.IMPORTANCE_LOW));session=MediaSession(this,"Sai Photos").apply{
        setCallback(object:MediaSession.Callback(){override fun onPlay(){PlaybackBridge.action?.invoke("play",0)};override fun onPause(){PlaybackBridge.action?.invoke("pause",0)};override fun onSkipToNext(){PlaybackBridge.action?.invoke("next",0)};override fun onSkipToPrevious(){PlaybackBridge.action?.invoke("previous",0)};override fun onSeekTo(pos:Long){PlaybackBridge.action?.invoke("seek",pos)};override fun onSkipToQueueItem(id:Long){PlaybackBridge.action?.invoke("queueitem",id)}})
        isActive=true
    }}
    override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int {
        intent?.getStringExtra("action")?.let{PlaybackBridge.action?.invoke(it,0)}
        val s=PlaybackBridge.state;if(s.optString("id").isBlank()){stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();return START_NOT_STICKY}
        update(s);return START_NOT_STICKY
    }
    fun update(s:JSONObject){
        val playing=s.optBoolean("playing");val position=s.optLong("position");val duration=s.optLong("duration");val title=s.optString("title").take(512)
        session.setMetadata(MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE,title).putString(MediaMetadata.METADATA_KEY_ARTIST,"Sai Photos · pCloud").putLong(MediaMetadata.METADATA_KEY_DURATION,duration).build())
        session.setPlaybackState(PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS or PlaybackState.ACTION_SEEK_TO or PlaybackState.ACTION_SKIP_TO_QUEUE_ITEM).setState(if(playing)PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,position,if(playing)s.optDouble("speed",1.0).toFloat() else 0f,SystemClock.elapsedRealtime()).build())
        val queue=s.optJSONArray("queue");session.setQueue((0 until minOf(queue?.length()?:0,50)).map{index->val item=queue!!.getJSONObject(index);MediaSession.QueueItem(android.media.MediaDescription.Builder().setMediaId(item.optString("id")).setTitle(item.optString("title").take(256)).build(),item.optLong("index"))})
        fun control(action:String)=PendingIntent.getService(this,action.hashCode(),Intent(this,PlaybackService::class.java).putExtra("action",action),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val open=PendingIntent.getActivity(this,1,Intent(this,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val openQueue=PendingIntent.getActivity(this,2,Intent(this,MainActivity::class.java).putExtra("showQueue",true).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        session.setSessionActivity(openQueue)
        val icon=android.R.drawable.ic_media_play
        val notification=Notification.Builder(this,"music").setSmallIcon(icon).setContentTitle(title).setContentText(if(playing)"Playing · Sai Photos" else "Paused · Sai Photos").setContentIntent(open).setVisibility(Notification.VISIBILITY_PUBLIC).setOnlyAlertOnce(true).setOngoing(playing)
            .addAction(Notification.Action.Builder(android.R.drawable.ic_media_previous,"Previous",control("previous")).build())
            .addAction(Notification.Action.Builder(if(playing)android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,if(playing)"Pause" else "Play",control(if(playing)"pause" else "play")).build())
            .addAction(Notification.Action.Builder(android.R.drawable.ic_media_next,"Next",control("next")).build())
            .addAction(Notification.Action.Builder(android.R.drawable.ic_menu_agenda,"Queue",openQueue).build())
            .setStyle(Notification.MediaStyle().setMediaSession(session.sessionToken).setShowActionsInCompactView(0,1,2)).build()
        startForeground(7,notification)
    }
    override fun onBind(intent:Intent?):IBinder?=null
    override fun onDestroy(){session.isActive=false;session.release();super.onDestroy()}
}
