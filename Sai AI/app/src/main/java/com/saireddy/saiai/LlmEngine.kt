package com.saireddy.saiai

import android.content.Context
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.LogSeverity
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.MessageCallback
import org.json.JSONObject
import java.util.concurrent.Executors

// Wraps the on-device LiteRT-LM runtime. All heavy work happens on a single worker thread.
object LlmEngine {
    private val worker = Executors.newSingleThreadExecutor()
    @Volatile private var engine: Engine? = null
    @Volatile private var conversation: Conversation? = null
    @Volatile private var loadedId: String? = null
    @Volatile private var loading = false
    @Volatile private var busy = false
    @Volatile private var lastError: String? = null
    @Volatile private var systemPrompt: String = ModelStore.DEFAULT_SYSTEM

    fun statusJson(): JSONObject = JSONObject()
        .put("loaded", engine != null)
        .put("modelId", loadedId ?: JSONObject.NULL)
        .put("loading", loading)
        .put("busy", busy)
        .put("error", lastError ?: JSONObject.NULL)

    fun updateSystem(prompt: String) { systemPrompt = prompt }

    fun load(context: Context, id: String, system: String, onResult: (String?) -> Unit) {
        loading = true; lastError = null
        worker.execute {
            try {
                closeInternal()
                systemPrompt = system
                val path = ModelStore.fileFor(context, id).absolutePath
                try { Engine.setNativeMinLogSeverity(LogSeverity.ERROR) } catch (_: Throwable) {}
                val config = EngineConfig(modelPath = path, backend = Backend.CPU(), cacheDir = context.cacheDir.path)
                val e = Engine(config)
                e.initialize()
                val conv = e.createConversation(ConversationConfig(systemInstruction = Contents.of(system)))
                engine = e; conversation = conv; loadedId = id
                onResult(null)
            } catch (t: Throwable) {
                lastError = t.message ?: "Model could not be loaded."
                try { closeInternal() } catch (_: Throwable) {}
                onResult(lastError)
            } finally { loading = false }
        }
    }

    fun ensureLoaded(context: Context, system: String, onResult: (String?) -> Unit) {
        val id = ModelStore.activeId(context) ?: run { onResult("No model selected."); return }
        if (engine != null && loadedId == id) { onResult(null); return }
        load(context, id, system, onResult)
    }

    fun reset(system: String, onDone: (String?) -> Unit) {
        systemPrompt = system
        worker.execute {
            try {
                val e = engine ?: run { onDone("No model loaded."); return@execute }
                try { conversation?.close() } catch (_: Throwable) {}
                conversation = e.createConversation(ConversationConfig(systemInstruction = Contents.of(system)))
                onDone(null)
            } catch (t: Throwable) { onDone(t.message ?: "Could not reset the chat.") }
        }
    }

    fun chat(prompt: String, onChunk: (String) -> Unit, onDone: () -> Unit, onError: (String) -> Unit) {
        val conv = conversation ?: run { onError("No model is loaded yet."); return }
        if (busy) { onError("Sai is still answering — give it a moment."); return }
        busy = true
        val callback = object : MessageCallback {
            override fun onMessage(message: Message) { try { onChunk(message.contents.toString()) } catch (_: Throwable) {} }
            override fun onDone() { busy = false; onDone() }
            override fun onError(error: Throwable) { busy = false; onError(error.message ?: "Generation failed.") }
        }
        try { conv.sendMessageAsync(prompt, callback) } catch (t: Throwable) { busy = false; onError(t.message ?: "Generation failed.") }
    }

    fun unload() { worker.execute { closeInternal() } }

    private fun closeInternal() {
        try { conversation?.close() } catch (_: Throwable) {}
        try { engine?.close() } catch (_: Throwable) {}
        conversation = null; engine = null; loadedId = null; busy = false
    }
}
