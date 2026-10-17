package com.saiphotos.mobile

import android.content.Context
import android.graphics.Bitmap
import ai.onnxruntime.OnnxJavaType
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import java.nio.ByteBuffer
import java.nio.ByteOrder

class EraseEngine(private val context:Context){
    private val env=OrtEnvironment.getEnvironment()
    @Volatile private var session:OrtSession?=null
    private fun session():OrtSession{
        session?.let{return it}
        synchronized(this){
            session?.let{return it}
            val bytes=context.assets.open("ai/migan_pipeline_v2.onnx").use{it.readBytes()}
            val options=OrtSession.SessionOptions()
            options.setIntraOpNumThreads(Runtime.getRuntime().availableProcessors().coerceIn(2,4))
            val created=env.createSession(bytes,options)
            session=created
            return created
        }
    }
    fun run(image:Bitmap,mask:Bitmap):Bitmap{
        val maxEdge=1024
        val scale=Math.min(1f,maxEdge.toFloat()/Math.max(image.width,image.height))
        val workW=Math.max(16,Math.round(image.width*scale));val workH=Math.max(16,Math.round(image.height*scale))
        val workImage=if(workW!=image.width||workH!=image.height)Bitmap.createScaledBitmap(image,workW,workH,true) else image
        val workMask=if(workW!=mask.width||workH!=mask.height)Bitmap.createScaledBitmap(mask,workW,workH,true) else mask
        val pixels=IntArray(workW*workH);workImage.getPixels(pixels,0,workW,0,0,workW,workH)
        val maskPixels=IntArray(workW*workH);workMask.getPixels(maskPixels,0,workW,0,0,workW,workH)
        val imageBuffer=ByteBuffer.allocateDirect(3*workW*workH).order(ByteOrder.nativeOrder())
        val maskBuffer=ByteBuffer.allocateDirect(workW*workH).order(ByteOrder.nativeOrder())
        for(index in pixels.indices){
            val pixel=pixels[index]
            imageBuffer.put(((pixel shr 16) and 0xFF).toByte())
            imageBuffer.put(((pixel shr 8) and 0xFF).toByte())
            imageBuffer.put((pixel and 0xFF).toByte())
            maskBuffer.put(if(((maskPixels[index] shr 16) and 0xFF)>127)255.toByte() else 0.toByte())
        }
        imageBuffer.rewind();maskBuffer.rewind()
        val output=ByteBuffer.allocateDirect(3*workW*workH).order(ByteOrder.nativeOrder())
        val reference=session().run(mapOf(
            "image" to OnnxTensor.createTensor(env,imageBuffer,longArrayOf(1,3,workH.toLong(),workW.toLong()),OnnxJavaType.UINT8),
            "mask" to OnnxTensor.createTensor(env,maskBuffer,longArrayOf(1,1,workH.toLong(),workW.toLong()),OnnxJavaType.UINT8)
        )).use{result->
            val value=result.get("result")?:throw CloudError(500,"Erase model returned no result.")
            val tensor=value as OnnxTensor
            tensor.getByteBuffer().also{tensor.close()}
        }
        output.rewind()
        val outPixels=IntArray(workW*workH)
        for(index in outPixels.indices){
            val r=output.get().toInt() and 0xFF;val g=output.get().toInt() and 0xFF;val b=output.get().toInt() and 0xFF
            outPixels[index]=(0xFF shl 24) or (r shl 16) or (g shl 8) or b
        }
        val result=Bitmap.createBitmap(outPixels,workW,workH,Bitmap.Config.ARGB_8888)
        if(workImage!==image)workImage.recycle()
        if(workMask!==mask)workMask.recycle()
        return if(result.width!=image.width||result.height!=image.height){
            val scaled=Bitmap.createScaledBitmap(result,image.width,image.height,true)
            result.recycle();scaled
        }else result
    }
    fun shutdown(){synchronized(this){session?.close();session=null}}
}
