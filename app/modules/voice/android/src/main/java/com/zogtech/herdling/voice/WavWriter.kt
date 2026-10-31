package com.zogtech.herdling.voice

import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Writes microphone samples to a WAV file: 16 kHz, mono, PCM 16-bit. Speech engines
 * (the host `stt_command`) read this format. All calls are thread-safe.
 */
class WavWriter(val file: File, maxSeconds: Double = MAX_SECONDS) {
  companion object {
    const val SAMPLE_RATE = 16_000
    /** The safety cap of one recording. */
    const val MAX_SECONDS = 10.0 * 60

    /** The 44-byte RIFF header for 16 kHz mono PCM16 with `dataBytes` of samples. */
    fun header(dataBytes: Int): ByteArray {
      val b = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
      b.put("RIFF".toByteArray(Charsets.US_ASCII))
      b.putInt(36 + dataBytes)
      b.put("WAVEfmt ".toByteArray(Charsets.US_ASCII))
      b.putInt(16)
      b.putShort(1) // PCM
      b.putShort(1) // mono
      b.putInt(SAMPLE_RATE)
      b.putInt(SAMPLE_RATE * 2) // bytes per second
      b.putShort(2) // bytes per frame
      b.putShort(16) // bits per sample
      b.put("data".toByteArray(Charsets.US_ASCII))
      b.putInt(dataBytes)
      return b.array()
    }
  }

  private val out = RandomAccessFile(file, "rw")
  private val maxFrames = (maxSeconds * SAMPLE_RATE).toLong()
  private var frames = 0L
  private var closed = false

  init {
    out.setLength(0)
    out.write(header(0))
  }

  /**
   * Appends `length` bytes of little-endian PCM16 samples. Returns true when the recording
   * reached its cap. Samples after the cap are dropped.
   */
  @Synchronized
  fun append(pcm: ByteArray, length: Int): Boolean {
    if (closed || frames >= maxFrames) return frames >= maxFrames
    val n = min(length / 2L, maxFrames - frames).toInt()
    out.write(pcm, 0, n * 2)
    frames += n
    return frames >= maxFrames
  }

  /** Ends the file (sets the sizes in the header) and returns its length in ms. */
  @Synchronized
  fun finish(): Int {
    if (!closed) {
      closed = true
      try {
        out.seek(0)
        out.write(header((frames * 2).toInt()))
        out.close()
      } catch (_: Exception) {
      }
    }
    return (frames * 1000 / SAMPLE_RATE).toInt()
  }

  /** Ends the file and deletes it. */
  fun discard() {
    finish()
    file.delete()
  }
}

/** Turns PCM16 samples into a level from 0 to 1, about 20 times a second. */
class LevelMeter(private val sampleRate: Int, private val emit: (Double) -> Unit) {
  companion object {
    /** One level for each this many seconds of audio. */
    const val INTERVAL = 0.05
    /** dB at level 0. Quieter input shows as silence. */
    const val FLOOR_DB = -55.0

    /** RMS (0...1) to 0...1 on a dB scale from `FLOOR_DB` to 0 dB. */
    fun level(rms: Double): Double {
      val db = 20 * log10(max(rms, 1e-7))
      return max(0.0, min(1.0, (db - FLOOR_DB) / -FLOOR_DB))
    }
  }

  private val every = (sampleRate * INTERVAL).toInt()
  private var sum = 0.0
  private var count = 0

  /** Feeds `length` bytes of little-endian PCM16. */
  fun feed(pcm: ByteArray, length: Int) {
    var i = 0
    while (i + 1 < length) {
      val s = ((pcm[i + 1].toInt() shl 8) or (pcm[i].toInt() and 0xFF)).toShort() / 32768.0
      sum += s * s
      count++
      if (count >= every) {
        emit(level(sqrt(sum / count)))
        sum = 0.0
        count = 0
      }
      i += 2
    }
  }
}
