package com.zogtech.herdling.ssh

import java.io.ByteArrayOutputStream

/**
 * Decodes a byte stream into strings at UTF-8 sequence boundaries.
 * Bytes of an incomplete trailing sequence are kept for the next chunk.
 */
class Utf8Carry {
  private var pending = ByteArray(0)

  /** Returns the text for all complete sequences so far, or null when there is none. */
  fun decode(chunk: ByteArray, length: Int = chunk.size): String? {
    val all = ByteArrayOutputStream(pending.size + length).apply {
      write(pending)
      write(chunk, 0, length)
    }.toByteArray()
    val cut = completePrefixLength(all)
    if (cut == 0) {
      pending = all
      return null
    }
    pending = all.copyOfRange(cut, all.size)
    return String(all, 0, cut, Charsets.UTF_8)
  }

  /** Returns what is left (decoded lossily), for the end of the stream. */
  fun flush(): String? {
    if (pending.isEmpty()) return null
    val text = String(pending, Charsets.UTF_8)
    pending = ByteArray(0)
    return text
  }

  companion object {
    /** Length of the longest prefix that does not end inside a multi-byte sequence. */
    fun completePrefixLength(bytes: ByteArray): Int {
      val n = bytes.size
      // A sequence is at most 4 bytes, so only the last 3 bytes can start an incomplete one.
      var i = n - 1
      while (i >= 0 && i >= n - 3) {
        val b = bytes[i].toInt() and 0xFF
        if (b and 0xC0 == 0x80) {
          i -= 1
          continue
        }
        val need = when {
          b and 0x80 == 0 -> 1
          b and 0xE0 == 0xC0 -> 2
          b and 0xF0 == 0xE0 -> 3
          b and 0xF8 == 0xF0 -> 4
          else -> return n // invalid lead byte: let the decoder replace it
        }
        return if (n - i >= need) n else i
      }
      return n // only continuation bytes at the end (invalid or complete): decode as-is
    }
  }
}
