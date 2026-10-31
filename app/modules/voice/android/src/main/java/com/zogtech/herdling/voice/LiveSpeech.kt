package com.zogtech.herdling.voice

import android.content.Context
import android.content.Intent
import android.media.AudioFormat
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.ParcelFileDescriptor
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import kotlinx.coroutines.CompletableDeferred
import java.io.IOException
import java.io.OutputStream

/** Rejection codes the JS side sees: "busy", "denied", "unavailable", "recognition_failed", "timeout", "cancelled", "not_recording". */
class DictationError(val code: String, override val message: String) : Exception(message) {
  companion object {
    fun busy() = DictationError("busy", "Dictation is already running")
    fun cancelled() = DictationError("cancelled", "Dictation was cancelled")
    fun timeout() = DictationError("timeout", "Speech recognition did not finish in time")
    fun denied(message: String) = DictationError("denied", message)
    fun unavailable(message: String) = DictationError("unavailable", message)
    fun failed(message: String) = DictationError("recognition_failed", message)
  }
}

/** Joins two transcript parts with one space. */
fun joinText(a: String, b: String): String {
  val x = a.trim()
  val y = b.trim()
  return when {
    x.isEmpty() -> y
    y.isEmpty() -> x
    else -> "$x $y"
  }
}

/**
 * One live recognition run of the system SpeechRecognizer. Lives on the main thread.
 *
 * Microphone mode: the recognizer opens the microphone itself. It ends a turn after a pause, so
 * while the run goes on, each final result is kept and a new turn starts.
 * Pipe mode (Android 13+): the app records and feeds PCM16 through `feed`; the recognizer
 * reads it as a segmented session until the pipe closes.
 */
class LiveSpeech(
  private val context: Context,
  private val locale: String?,
  private val pipeMode: Boolean,
  private val onPartial: (String) -> Unit,
  /** A failure while the run goes on (not after `finish` or `cancel`). */
  private val onError: (DictationError) -> Unit,
  /** Microphone mode only: the recognizer's input level, 0 to 1. */
  private val onLevel: (Double) -> Unit,
) {
  private val main = Handler(Looper.getMainLooper())
  private var recognizer: SpeechRecognizer? = null
  private var finalText = ""
  private var partial = ""
  private var stopping = false
  private var ended = false
  private var failure: DictationError? = null
  private var waiter: CompletableDeferred<String>? = null

  @Volatile private var pipe: OutputStream? = null

  companion object {
    fun available(context: Context): Boolean = SpeechRecognizer.isRecognitionAvailable(context)

    /** Pipe mode needs `EXTRA_AUDIO_SOURCE` and segmented sessions (Android 13). */
    val pipeSupported: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
  }

  /** Starts listening. Main thread. */
  fun start() {
    val r = SpeechRecognizer.createSpeechRecognizer(context)
    r.setRecognitionListener(listener)
    recognizer = r
    listen()
  }

  /** Feeds PCM16 (16 kHz mono) in pipe mode. Any thread. */
  fun feed(pcm: ByteArray, length: Int) {
    val out = pipe ?: return
    try {
      out.write(pcm, 0, length)
    } catch (_: IOException) {
      // The recognizer stopped reading: its listener reports the end.
      pipe = null
    }
  }

  /** Stops listening and waits for the final text. Main thread. */
  fun finish(): CompletableDeferred<String> {
    val w = CompletableDeferred<String>()
    waiter = w
    stopping = true
    when {
      ended -> settle()
      failure != null -> settle()
      else -> {
        closePipe()
        try {
          recognizer?.stopListening()
        } catch (_: Exception) {
        }
      }
    }
    return w
  }

  /** The text so far, for a finish that timed out. */
  fun textSoFar(): String = joinText(finalText, partial)

  /** Drops the run. Main thread. */
  fun cancel() {
    stopping = true
    ended = true
    closePipe()
    try {
      recognizer?.cancel()
      recognizer?.destroy()
    } catch (_: Exception) {
    }
    recognizer = null
    waiter?.completeExceptionally(DictationError.cancelled())
    waiter = null
  }

  private fun listen() {
    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
      if (!locale.isNullOrEmpty()) putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
    }
    if (pipeMode && pipeSupported) {
      val (read, write) = ParcelFileDescriptor.createPipe()
      pipe = ParcelFileDescriptor.AutoCloseOutputStream(write)
      intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE, read)
      intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_CHANNEL_COUNT, 1)
      intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
      intent.putExtra(RecognizerIntent.EXTRA_AUDIO_SOURCE_SAMPLING_RATE, WavWriter.SAMPLE_RATE)
      intent.putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_AUDIO_SOURCE)
    }
    recognizer?.startListening(intent)
  }

  private fun closePipe() {
    val out = pipe
    pipe = null
    try {
      out?.close()
    } catch (_: IOException) {
    }
  }

  private fun firstResult(b: Bundle?): String =
    b?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()

  /** The turn ended with a final text. Keeps it, then ends or starts a new turn. */
  private fun turnEnded(text: String) {
    finalText = joinText(finalText, text)
    partial = ""
    if (stopping) {
      ended = true
      settle()
    } else if (pipeMode) {
      // The recognizer ended the session early: open a new pipe and go on.
      closePipe()
      listen()
    } else {
      listen()
    }
  }

  private fun settle() {
    val w = waiter ?: return
    waiter = null
    val f = failure
    if (f != null && finalText.isEmpty()) w.completeExceptionally(f) else w.complete(finalText)
    try {
      recognizer?.destroy()
    } catch (_: Exception) {
    }
    recognizer = null
  }

  private val listener = object : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) {}
    override fun onBeginningOfSpeech() {}
    override fun onBufferReceived(buffer: ByteArray?) {}
    override fun onEndOfSpeech() {}
    override fun onEvent(eventType: Int, params: Bundle?) {}

    override fun onRmsChanged(rmsdB: Float) {
      // The recognizer reports about -2 dB (silence) to 10 dB (loud).
      if (!pipeMode) onLevel(((rmsdB + 2f) / 12f).coerceIn(0f, 1f).toDouble())
    }

    override fun onPartialResults(partialResults: Bundle?) {
      if (ended) return
      val text = firstResult(partialResults)
      if (text.isEmpty()) return
      partial = text
      onPartial(textSoFar())
    }

    override fun onSegmentResults(segmentResults: Bundle) {
      if (ended) return
      finalText = joinText(finalText, firstResult(segmentResults))
      partial = ""
      onPartial(finalText)
    }

    override fun onEndOfSegmentedSession() {
      if (ended) return
      turnEnded("")
    }

    override fun onResults(results: Bundle?) {
      if (ended) return
      turnEnded(firstResult(results))
    }

    override fun onError(error: Int) {
      if (ended) return
      when (error) {
        // Nothing was said in this turn: not a failure.
        SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> turnEnded(partial)
        else -> {
          val e = mapError(error)
          failure = e
          ended = true
          closePipe()
          if (stopping) settle() else onError(e)
        }
      }
    }
  }

  private fun mapError(code: Int): DictationError = when (code) {
    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ->
      DictationError.denied("Microphone access is off. Turn it on in Settings.")
    SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ->
      DictationError.unavailable("Speech recognition does not support this language")
    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> DictationError.busy()
    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_SERVER ->
      DictationError.failed("Speech recognition needs a network connection (error $code)")
    else -> DictationError.failed("Speech recognition failed (error $code)")
  }
}
