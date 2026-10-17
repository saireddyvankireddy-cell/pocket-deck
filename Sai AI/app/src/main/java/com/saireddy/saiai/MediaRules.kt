package com.saireddy.saiai
object MediaRules {
    fun photoDate(value:String):Long = try{java.time.Instant.parse(value).toEpochMilli()}catch(_:Exception){try{java.time.ZonedDateTime.parse(value,java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME).toInstant().toEpochMilli()}catch(_:Exception){0L}}

    fun sameFileVersion(a:String,b:String):Boolean {
        if(a==b)return true
        val numeric=Regex("[0-9]+(?:\\.[0-9]+)?(?:[eE]\\+?[0-9]+)?")
        if(!numeric.matches(a)||!numeric.matches(b))return false
        val x=a.toDoubleOrNull();val y=b.toDoubleOrNull();return x!=null&&y!=null&&x.isFinite()&&y.isFinite()&&x>=1e14&&x==y
    }

    fun kind(name: String): String? = when (name.substringAfterLast('.').lowercase()) {
        "mp4", "mov", "m4v", "3gp", "avi", "mkv" -> "video"
        "jpg", "jpeg", "png", "webp", "gif", "heic", "heif" -> "photo"
        "mp3", "m4a", "aac", "wav", "ogg", "oga", "opus", "flac", "webm" -> "audio"
        else -> null
    }
    fun validId(id: String) = Regex("pc-[0-9]{1,20}").matches(id)
    fun trustedDownload(host: String) = Regex("[a-zA-Z0-9-]+\\.pcloud\\.com").matches(host)
}
