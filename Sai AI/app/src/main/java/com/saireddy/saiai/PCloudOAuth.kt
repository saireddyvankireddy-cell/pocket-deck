package com.saireddy.saiai

import android.content.Context
import android.net.Uri
import android.util.Base64
import org.json.JSONObject
import java.security.SecureRandom

/** Public-client token flow: credentials never cross into WebView JavaScript. */
class PCloudOAuth(context: Context) {
    private val prefs=context.getSharedPreferences("pcloud-oauth-pending",Context.MODE_PRIVATE)
    companion object {
        const val CLIENT_ID="3fjclnorUY"
        const val REDIRECT="pcloud-oauth://com.saiphotos"
        fun isCallback(uri:Uri?)=uri?.scheme=="pcloud-oauth" && uri.host=="com.saiphotos" && uri.path.orEmpty().isEmpty()
    }
    @Synchronized fun start():Uri {
        val bytes=ByteArray(32);SecureRandom().nextBytes(bytes)
        val state=Base64.encodeToString(bytes,Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        prefs.edit().putString("state",state).putLong("started",System.currentTimeMillis()).commit()
        return Uri.parse("https://my.pcloud.com/oauth2/authorize").buildUpon()
            .appendQueryParameter("client_id",CLIENT_ID).appendQueryParameter("response_type","token")
            .appendQueryParameter("redirect_uri",REDIRECT).appendQueryParameter("state",state).build()
    }
    @Synchronized fun clear(){prefs.edit().clear().commit()}
    @Synchronized fun consume(uri:Uri):JSONObject {
        if(!isCallback(uri))throw CloudError(400,"Invalid pCloud callback address.")
        val values=Uri.parse("https://callback.invalid/?"+(uri.encodedFragment?:uri.encodedQuery.orEmpty()))
        val expected=prefs.getString("state",null)
        if(expected==null||expected!=values.getQueryParameter("state")||System.currentTimeMillis()-prefs.getLong("started",0) !in 0..600000)
            throw CloudError(400,"pCloud login expired or did not match this device. Tap Connect pCloud again.")
        clear()
        if(values.getQueryParameter("error")!=null)throw CloudError(400,"pCloud authorization was cancelled or rejected. Try again or connect with a token.")
        val host=values.getQueryParameter("hostname")
        val token=values.getQueryParameter("access_token").orEmpty()
        if(host !in setOf("api.pcloud.com","eapi.pcloud.com")||!Regex("[!-~]{1,512}").matches(token))
            throw CloudError(400,"pCloud did not return a valid token and region. Check the registered callback address.")
        return JSONObject().put("host",host).put("tokenType","access_token").put("token",token)
    }
}
