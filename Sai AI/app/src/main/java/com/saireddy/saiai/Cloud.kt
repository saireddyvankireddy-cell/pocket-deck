package com.saireddy.saiai

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

// Thin OpenAI-compatible client used for DeepSeek V4.1 Flash (free via OpenRouter) and similar.
object Cloud {
    private val JSON = "application/json; charset=utf-8".toMediaType()
    private val client = OkHttpClient.Builder().connectTimeout(30, TimeUnit.SECONDS).readTimeout(180, TimeUnit.SECONDS).build()

    class CloudError(message: String) : Exception(message)

    // Returns { content: String, toolCalls: [{ id, name, args }] }
    fun chat(context: Context, messages: JSONArray, tools: JSONArray?, temperature: Double): JSONObject {
        val provider = ModelStore.provider(context)
        val baseUrl = provider.optString("baseUrl", "https://openrouter.ai/api/v1").trimEnd('/')
        val apiKey = provider.optString("apiKey", "")
        val model = provider.optString("model", "deepseek/deepseek-v4-flash:free")
        if (apiKey.isEmpty()) throw CloudError("Add an API key in Settings to use the cloud model.")
        val body = JSONObject().put("model", model).put("messages", messages).put("temperature", temperature).put("stream", false)
        if (tools != null && tools.length() > 0) { body.put("tools", tools); body.put("tool_choice", "auto") }
        val request = Request.Builder().url("$baseUrl/chat/completions")
            .header("Authorization", "Bearer $apiKey").header("Content-Type", "application/json")
            .header("HTTP-Referer", "https://github.com/saireddyvankireddy-cell").header("X-Title", "Sai AI")
            .post(body.toString().toRequestBody(JSON)).build()
        client.newCall(request).execute().use { response ->
            val text = response.body?.string() ?: ""
            if (!response.isSuccessful) {
                val message = try { JSONObject(text).optJSONObject("error")?.optString("message") } catch (_: Exception) { null }
                throw CloudError(message?.takeIf { it.isNotBlank() } ?: "Cloud request failed (${response.code}).")
            }
            val root = try { JSONObject(text) } catch (_: Exception) { throw CloudError("The cloud service sent an unexpected reply.") }
            val choice = root.optJSONArray("choices")?.optJSONObject(0) ?: throw CloudError("The cloud service returned no answer.")
            val message = choice.optJSONObject("message") ?: JSONObject()
            val calls = JSONArray()
            message.optJSONArray("tool_calls")?.let { arr ->
                for (i in 0 until arr.length()) {
                    val c = arr.optJSONObject(i) ?: continue
                    val fn = c.optJSONObject("function") ?: continue
                    val args = try { JSONObject(fn.optString("arguments", "{}")) } catch (_: Exception) { JSONObject() }
                    calls.put(JSONObject().put("id", c.optString("id")).put("name", fn.optString("name")).put("args", args))
                }
            }
            return JSONObject().put("content", message.optString("content", "")).put("toolCalls", calls)
        }
    }

    fun test(context: Context): JSONObject {
        val messages = JSONArray().put(JSONObject().put("role", "user").put("content", "Reply with the single word: ready"))
        val result = chat(context, messages, null, 0.0)
        return JSONObject().put("reply", result.optString("content").trim().take(60))
    }
}
