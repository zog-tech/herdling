package com.zogtech.herdling.voice

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

class WavWriterTest {
  @Test
  fun writesA16kMonoPcm16File() {
    val file = File.createTempFile("wav", ".wav")
    val w = WavWriter(file)
    val pcm = ByteArray(3200) { (it % 7).toByte() } // 100 ms
    assertFalse(w.append(pcm, pcm.size))
    assertEquals(100, w.finish())
    val bytes = file.readBytes()
    assertEquals(44 + 3200, bytes.size)
    assertArrayEquals(WavWriter.header(3200), bytes.copyOfRange(0, 44))
    val h = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    assertEquals(36 + 3200, h.getInt(4))
    assertEquals(16_000, h.getInt(24))
    assertEquals(3200, h.getInt(40))
    file.delete()
  }

  @Test
  fun stopsAtTheCap() {
    val file = File.createTempFile("wav", ".wav")
    val w = WavWriter(file, maxSeconds = 0.01) // 160 frames
    assertTrue(w.append(ByteArray(400), 400))
    assertEquals(10, w.finish())
    assertEquals(44 + 320, file.length().toInt())
    w.discard()
    assertFalse(file.exists())
  }

  @Test
  fun levelIsOnADbScale() {
    assertEquals(0.0, LevelMeter.level(0.0), 1e-9)
    assertEquals(1.0, LevelMeter.level(1.0), 1e-9)
    assertEquals(35.0 / 55.0, LevelMeter.level(0.1), 1e-6) // -20 dB
  }

  @Test
  fun joinsTranscriptParts() {
    assertEquals("a b", joinText(" a ", "b"))
    assertEquals("b", joinText("", "b"))
    assertEquals("a", joinText("a", "  "))
  }
}
