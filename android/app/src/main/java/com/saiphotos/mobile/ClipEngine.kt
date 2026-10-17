package com.saiphotos.mobile

import ai.onnxruntime.*
import android.graphics.Bitmap
import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.FloatBuffer
import java.nio.LongBuffer
import java.text.Normalizer
import kotlin.math.*

class ClipEngine(private val api:PCloudApi) : AutoCloseable {
    private val env=OrtEnvironment.getEnvironment()
    private var session:OrtSession?=null
    private var loaded=""
    private val tokenizer by lazy { JSONObject(api.context.assets.open("ai/tokenizer.json").bufferedReader().use{it.readText()}) }
    private val vocab by lazy { tokenizer.getJSONObject("model").getJSONObject("vocab") }
    private val ranks by lazy { val merges=tokenizer.getJSONObject("model").getJSONArray("merges");(0 until merges.length()).associate{merges.getString(it) to it} }
    private val bytesMap by lazy {
        val bs=((33..126)+(161..172)+(174..255)).toMutableList();val cs=bs.toMutableList();var n=0
        for(b in 0..255)if(b !in bs){bs.add(b);cs.add(256+n++)}
        bs.indices.associate{bs[it] to cs[it].toChar().toString()}
    }
    private fun open(name:String):OrtSession {
        if(loaded==name)return session!!
        close();val file=File(api.context.filesDir,"ai/$name.onnx");file.parentFile!!.mkdirs()
        if(!file.exists()) { val temp=File(file.path+".partial");api.context.assets.open("ai/${name}_model_quantized.onnx").use{input->temp.outputStream().use{input.copyTo(it)}};val manifest=JSONObject(api.context.assets.open("ai/manifest.json").bufferedReader().use{it.readText()}).getJSONArray("files");val expected=(0 until manifest.length()).map{manifest.getJSONObject(it)}.first{it.getString("file")=="${name}_model_quantized.onnx"}.getString("sha256");val digest=java.security.MessageDigest.getInstance("SHA-256");temp.inputStream().use{stream->val buffer=ByteArray(65536);while(true){val n=stream.read(buffer);if(n<0)break;digest.update(buffer,0,n)}};if(digest.digest().joinToString(""){"%02x".format(it)}!=expected){temp.delete();throw Exception("AI model verification failed.")};if(!temp.renameTo(file))throw Exception("Could not prepare AI model.") }
        val options=OrtSession.SessionOptions().apply{setIntraOpNumThreads(Runtime.getRuntime().availableProcessors().coerceIn(2,4));setInterOpNumThreads(1)}
        try{session=env.createSession(file.path,options)}finally{options.close()};loaded=name;return session!!
    }
    fun tokens(prompt:String):LongArray {
        val normalized=Normalizer.normalize(prompt,Normalizer.Form.NFC).lowercase().replace(Regex("\\s+")," ").trim()
        val pattern=Regex("<\\|startoftext\\|>|<\\|endoftext\\|>|'s|'t|'re|'ve|'m|'ll|'d|[\\p{L}]+|[\\p{N}]|[^\\s\\p{L}\\p{N}]+")
        val result=mutableListOf<Long>(49406)
        for(match in pattern.findAll(normalized)) {
            var pieces=match.value.toByteArray(Charsets.UTF_8).map{bytesMap[it.toInt() and 255]!!}.toMutableList()
            if(pieces.isEmpty())continue;pieces[pieces.lastIndex]+="</w>"
            while(pieces.size>1) {
                var best=-1;var score=Int.MAX_VALUE
                for(i in 0 until pieces.size-1){val rank=ranks[pieces[i]+" "+pieces[i+1]]?:continue;if(rank<score){best=i;score=rank}}
                if(best<0)break
                val first=pieces[best];val second=pieces[best+1];val next=mutableListOf<String>();var i=0
                while(i<pieces.size){if(i+1<pieces.size&&pieces[i]==first&&pieces[i+1]==second){next.add(first+second);i+=2}else next.add(pieces[i++])};pieces=next
            }
            for(piece in pieces)result.add(vocab.optLong(piece,49407))
        }
        return (result.take(76)+49407L).toLongArray()
    }
    fun text(query:String,music:Boolean):FloatArray {
        val prompt=if(music)"music title: "+query.lowercase() else "a photo of "+query.lowercase().replace(Regex("\\bsarees?\\b"),"sari clothing").replace(Regex("\\broses?\\b"),"rose flowers")
        val model=open("text");val ids=tokens(prompt)
        OnnxTensor.createTensor(env,LongBuffer.wrap(ids),longArrayOf(1,ids.size.toLong())).use { input ->
            val feeds=mutableMapOf("input_ids" to input)
            var mask:OnnxTensor?=null
            if("attention_mask" in model.inputNames){mask=OnnxTensor.createTensor(env,LongBuffer.wrap(LongArray(ids.size){1}),longArrayOf(1,ids.size.toLong()));feeds["attention_mask"]=mask}
            try{model.run(feeds).use{return extract(it,"text_embeds")}}finally{mask?.close()}
        }
    }
    private fun extract(result:OrtSession.Result,name:String):FloatArray {
        val tensor=result.get(name).orElse(result[0]) as OnnxTensor
        val buffer=tensor.floatBuffer;val values=FloatArray(buffer.remaining());buffer.get(values)
        if(values.size!=512)throw Exception("Unexpected AI output.")
        val norm=sqrt(values.sumOf{it.toDouble()*it});if(norm==0.0||!norm.isFinite())throw Exception("Invalid AI output.")
        return values.map{(it/norm).toFloat()}.toFloatArray()
    }
    fun visual(bitmap:Bitmap,photo:JSONObject):JSONObject {
        val side=min(bitmap.width,bitmap.height)
        val square=Bitmap.createBitmap(bitmap,(bitmap.width-side)/2,(bitmap.height-side)/2,side,side)
        val crop=Bitmap.createScaledBitmap(square,224,224,true)
        val pixels=IntArray(224*224);crop.getPixels(pixels,0,224,0,0,224,224)
        val values=FloatArray(3*224*224);val mean=floatArrayOf(.48145466f,.4578275f,.40821073f);val std=floatArrayOf(.26862954f,.26130258f,.27577711f)
        for(i in pixels.indices)for(c in 0..2)values[c*pixels.size+i]=(((pixels[i] shr (16-c*8)) and 255)/255f-mean[c])/std[c]
        if(crop!==square&&crop!==bitmap)crop.recycle();if(square!==bitmap)square.recycle()
        val embedding=OnnxTensor.createTensor(env,FloatBuffer.wrap(values),longArrayOf(1,3,224,224)).use{input->open("vision").run(mapOf("pixel_values" to input)).use{extract(it,"image_embeds")}}
        val tiny=Bitmap.createScaledBitmap(bitmap,32,32,true);val sample=IntArray(1024);tiny.getPixels(sample,0,32,0,0,32,32);if(tiny!==bitmap)tiny.recycle()
        val gray=sample.map{((it shr 16 and 255)*.2126+(it shr 8 and 255)*.7152+(it and 255)*.0722)}
        val hash=PerceptualHash.compute(gray.toDoubleArray())
        val color=JSONArray();for(c in 0..2)color.put(sample.sumOf{((it shr(16-c*8)) and 255)/255.0}/sample.size)
        val avg=gray.average();val contrast=sqrt(gray.sumOf{(it-avg).pow(2)}/gray.size)/255
        return JSONObject().put("model","clip-base32-q8-v1").put("embedding",pack(embedding)).put("phash",hash.toString()).put("color",color).put("contrast",contrast).put("width",photo.optInt("width").takeIf{it>0}?:bitmap.width).put("height",photo.optInt("height").takeIf{it>0}?:bitmap.height)
    }
    override fun close(){session?.close();session=null;loaded=""}
    companion object {fun pack(values:FloatArray)=Base64.encodeToString(values.map{(floor(it*127.0+.5).toInt()+128).coerceIn(1,255).toByte()}.toByteArray(),Base64.NO_WRAP)}
}
