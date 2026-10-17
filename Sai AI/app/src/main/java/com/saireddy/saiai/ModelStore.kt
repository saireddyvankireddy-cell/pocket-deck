package com.saireddy.saiai

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class Model(val id: String, val name: String, val note: String, val url: String, val sizeBytes: Long, val license: String, val gated: Boolean)

object ModelStore {
    const val PREFS = "sai-ai"
    fun prefs(c: Context) = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    fun dir(c: Context): File = File(c.filesDir, "models").apply { if (!exists()) mkdirs() }
    fun fileFor(c: Context, id: String): File = File(dir(c), "$id.litertlm")
    fun partFor(c: Context, id: String): File = File(dir(c), "$id.part")

    val CATALOG: List<Model> = listOf(
        Model("qwen3-0.6b", "Qwen 3 0.6B", "Fast and small. Works on almost any phone.", "https://huggingface.co/litert-community/Qwen3-0.6B/resolve/main/qwen3_0_6b_mixed_int4.litertlm", 497_516_544L, "Apache-2.0", false),
        Model("qwen2.5-1.5b", "Qwen 2.5 1.5B", "Smarter, needs ~3 GB free RAM.", "https://huggingface.co/litert-community/Qwen2.5-1.5B-Instruct/resolve/main/Qwen2.5-1.5B-Instruct_multi-prefill-seq_q8_ekv4096.litertlm", 1_597_913_616L, "Apache-2.0", false),
        Model("gemma3-1b", "Gemma 3 1B", "Google Gemma. Needs a free Hugging Face token once.", "https://huggingface.co/litert-community/Gemma3-1B-IT/resolve/main/Gemma3-1B-IT_multi-prefill-seq_q4_ekv4096.litertlm", 584_000_000L, "Gemma Terms", true),
        Model("gemma4-e2b", "Gemma 4 E2B", "Newest Gemma, larger download.", "https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/main/gemma-4-E2B-it.litertlm", 2_588_000_000L, "Gemma Terms", false)
    )

    fun model(id: String): Model? = CATALOG.firstOrNull { it.id == id }
    fun localBytes(c: Context, id: String): Long { val f = fileFor(c, id); return if (f.exists()) f.length() else 0L }
    fun downloaded(c: Context, id: String): Boolean {
        val m = model(id) ?: return false
        val f = fileFor(c, id)
        return f.exists() && f.length() > m.sizeBytes / 2
    }
    fun downloadedIds(c: Context): List<String> = CATALOG.filter { downloaded(c, it.id) }.map { it.id }

    fun activeId(c: Context): String? = prefs(c).getString("active-model", null)?.takeIf { downloaded(c, it) || File(dir(c), "$it.litertlm").exists() }
    fun setActive(c: Context, id: String) { prefs(c).edit().putString("active-model", id).apply() }

    fun downloadState(c: Context, id: String): JSONObject = try { JSONObject(prefs(c).getString("dl-$id", "{}")) } catch (_: Exception) { JSONObject() }
    fun setDownloadState(c: Context, id: String, state: JSONObject) { prefs(c).edit().putString("dl-$id", state.toString()).apply() }

    // Provider / agent config
    fun systemPrompt(c: Context) = prefs(c).getString("system-prompt", DEFAULT_SYSTEM) ?: DEFAULT_SYSTEM
    fun temperature(c: Context) = prefs(c).getFloat("temperature", 0.7f)
    fun provider(c: Context): JSONObject = try { JSONObject(prefs(c).getString("provider", "{}")) } catch (_: Exception) { JSONObject() }
    fun hfToken(c: Context) = prefs(c).getString("hf-token", "") ?: ""
    const val DEFAULT_SYSTEM = "You are Sai, a warm and concise personal assistant living on this phone. You can chat on-device and, when online, control the user's photos through tools. Prefer short answers unless asked for detail."

    fun stateJson(c: Context): JSONObject {
        val arr = JSONArray()
        val active = activeId(c)
        for (m in CATALOG) {
            val dl = downloadState(c, m.id)
            arr.put(JSONObject()
                .put("id", m.id).put("name", m.name).put("note", m.note).put("url", m.url)
                .put("sizeBytes", m.sizeBytes).put("license", m.license).put("gated", m.gated)
                .put("downloaded", downloaded(c, m.id)).put("localBytes", localBytes(c, m.id))
                .put("active", m.id == active)
                .put("download", dl))
        }
        val p = provider(c)
        return JSONObject()
            .put("models", arr)
            .put("active", active ?: JSONObject.NULL)
            .put("systemPrompt", systemPrompt(c))
            .put("temperature", temperature(c).toDouble())
            .put("hasHfToken", hfToken(c).isNotEmpty())
            .put("provider", JSONObject()
                .put("baseUrl", p.optString("baseUrl", "https://openrouter.ai/api/v1"))
                .put("model", p.optString("model", "deepseek/deepseek-v4-flash:free"))
                .put("hasKey", p.optString("apiKey", "").isNotEmpty()))
            .put("engine", LlmEngine.statusJson())
    }
}
