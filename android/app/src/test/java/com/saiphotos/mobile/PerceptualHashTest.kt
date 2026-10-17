package com.saiphotos.mobile
import org.junit.Assert.*
import org.junit.Test
import kotlin.math.*
class PerceptualHashTest {
    private fun reference(gray:DoubleArray):String {
        val dct=ArrayList<Double>()
        for(v in 0..7)for(u in 0..7){var sum=0.0;for(y in 0..31)for(x in 0..31)sum+=gray[y*32+x]*cos((2*x+1)*u*PI/64)*cos((2*y+1)*v*PI/64);dct.add(sum)}
        val median=dct.drop(1).sorted()[31]
        return buildString{for(i in 0..63 step 4){var digit=0;for(j in 0..3)digit=(digit shl 1) or if(dct[i+j]>median)1 else 0;append(digit.toString(16))}}
    }
    @Test fun fingerprintsMatchExistingIndexes(){
        val random=java.util.Random(42)
        repeat(40){val gray=DoubleArray(1024){random.nextDouble()*255};assertEquals(reference(gray),PerceptualHash.compute(gray))}
    }
    @Test fun duplicatesRemainStable(){val gray=DoubleArray(1024){(it*17%251).toDouble()};assertEquals(PerceptualHash.compute(gray),PerceptualHash.compute(gray.copyOf()));assertEquals(16,PerceptualHash.compute(gray).length)}
}
