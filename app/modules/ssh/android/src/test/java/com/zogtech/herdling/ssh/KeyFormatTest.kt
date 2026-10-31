package com.zogtech.herdling.ssh

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class KeyFormatTest {
  // A test key made with `ssh-keygen -t ed25519`; the expected values are what OpenSSH prints.
  private val publicKey = hex("fe45ba0f77e586055f91668e78b55d7db01c1e4df3075da0cac7b27c2cec713c")
  private val blob = "AAAAC3NzaC1lZDI1NTE5AAAAIP5Fug935YYFX5Fmjni1XX2wHB5N8wddoMrHsnws7HE8"

  @Test
  fun publicKeyLineMatchesOpenSsh() {
    assertEquals("ssh-ed25519 $blob herdling:Pixel-8", KeyFormat.openSshPublicKey(publicKey, "Pixel 8"))
  }

  @Test
  fun fingerprintMatchesSshKeygen() {
    val fp = KeyFormat.fingerprint(KeyFormat.ed25519WireBlob(publicKey))
    assertEquals("SHA256:sKnlp8tqwNsYQnAybPJI0m9TQh35RCMuVN2+yywc5ZU", fp)
  }

  @Test
  fun commentKeepsSafeCharacters() {
    assertEquals("herdling:Jane-s-Pixel", KeyFormat.comment("Jane’s Pixel"))
    assertEquals("herdling:a.b_c-d", KeyFormat.comment("a.b_c-d"))
    assertEquals("herdling:x-y", KeyFormat.comment("  x  🙂 y  "))
    assertEquals("herdling", KeyFormat.comment("🙂🙂"))
    assertEquals("herdling", KeyFormat.comment(""))
  }

  @Test
  fun utf8CarryKeepsSplitSequences() {
    val bytes = "aé🙂".toByteArray(Charsets.UTF_8) // 1 + 2 + 4 bytes
    val carry = Utf8Carry()
    assertEquals("a", carry.decode(bytes.copyOfRange(0, 2)))
    assertEquals("é", carry.decode(bytes.copyOfRange(2, 4)))
    assertNull(carry.decode(bytes.copyOfRange(4, 6)))
    assertEquals("🙂", carry.decode(bytes.copyOfRange(6, 7)))
    assertNull(carry.flush())
  }

  @Test
  fun utf8CarryFlushesAnIncompleteTail() {
    val carry = Utf8Carry()
    assertNull(carry.decode(byteArrayOf(0xE2.toByte(), 0x82.toByte())))
    assertEquals("�", carry.flush())
  }

  private fun hex(s: String) = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
}
