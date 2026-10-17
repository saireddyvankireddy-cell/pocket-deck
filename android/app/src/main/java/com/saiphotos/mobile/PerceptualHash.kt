package com.saiphotos.mobile

import kotlin.math.PI
import kotlin.math.cos

/** Same 32x32 DCT fingerprint, with precomputed bases and a separable transform. */
object PerceptualHash {
    private val basis=Array(8){frequency->DoubleArray(32){position->cos((2*position+1)*frequency*PI/64)}}
    fun compute(gray:DoubleArray):String {
        require(gray.size==1024)
        val rows=Array(32){DoubleArray(8)}
        for(y in 0..31)for(u in 0..7){var sum=0.0;for(x in 0..31)sum+=gray[y*32+x]*basis[u][x];rows[y][u]=sum}
        val dct=DoubleArray(64)
        for(v in 0..7)for(u in 0..7){var sum=0.0;for(y in 0..31)sum+=rows[y][u]*basis[v][y];dct[v*8+u]=sum}
        val median=dct.drop(1).sorted()[31]
        return buildString{for(i in 0..63 step 4){var digit=0;for(j in 0..3)digit=(digit shl 1) or if(dct[i+j]>median)1 else 0;append(digit.toString(16))}}
    }
}
