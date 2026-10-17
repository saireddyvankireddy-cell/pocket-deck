package com.saireddy.saiai

import android.content.Context
import org.json.JSONObject

/** Placeholder for the on-device AI index. Sai AI searches pCloud live; semantic indexing lands in a later release. */
class LocalAI(@Suppress("UNUSED_PARAMETER") api:Any) {
    fun stopAll(){}
    fun shutdown(){}
    fun handle(music:Boolean,method:String,body:JSONObject):JSONObject=throw CloudError(501,"Local AI indexing is not available in Sai AI yet.")
}
