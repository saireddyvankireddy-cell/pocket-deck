package com.saiphotos.mobile
import org.junit.Assert.*
import org.junit.Test
class MediaRulesTest {
 @Test fun pcloudDatesAcceptIsoAndRfc(){assertEquals(MediaRules.photoDate("2026-10-14T10:00:00Z"),MediaRules.photoDate("Wed, 14 Oct 2026 10:00:00 GMT"));assertTrue(MediaRules.photoDate("Wed, 14 Oct 2026 10:00:00 GMT")>0);assertEquals(0,MediaRules.photoDate("bad date"))}

 @Test fun cloudVersionsMatchMacNumericSerialization(){assertTrue(MediaRules.sameFileVersion("5380817599554757000","5.380817599554757E18"));assertFalse(MediaRules.sameFileVersion("5380817599554757000","5380817599554000000"));assertFalse(MediaRules.sameFileVersion("old","new"))}

 @Test fun onlySupportedMedia(){assertEquals("photo",MediaRules.kind("Family.HEIC"));assertEquals("audio",MediaRules.kind("song.FLAC"));assertNull(MediaRules.kind("private.pdf"));assertEquals("video",MediaRules.kind("video.mp4"))}
 @Test fun deletionAndDownloadGuard(){assertTrue(MediaRules.validId("pc-123"));assertFalse(MediaRules.validId("pc-1&auth=other"));assertTrue(MediaRules.trustedDownload("c123.pcloud.com"));assertFalse(MediaRules.trustedDownload("pcloud.com.evil.example"));assertFalse(MediaRules.trustedDownload("evil.example"))}
}
