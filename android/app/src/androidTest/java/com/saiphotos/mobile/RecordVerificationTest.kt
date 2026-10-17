package com.saiphotos.mobile
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*
class RecordVerificationTest {
 @Test fun numericFormattingDoesNotRejectAnUploadedRecord(){
  val input=JSONObject().put("at",123L).put("score",1.0).put("zero",0.0)
  val downloaded=JSONObject("""{"at":123,"score":1,"zero":0}""")
  assertTrue("Equivalent JSON numbers must verify",PCloudApi.sameJson(input,downloaded))
  assertFalse(PCloudApi.sameJson(input,JSONObject("""{"at":123,"score":2,"zero":0}""")))
 }
}
