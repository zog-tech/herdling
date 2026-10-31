package com.zogtech.herdling.voice

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaRecorder
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import java.util.UUID
import kotlin.concurrent.thread

/** What `stopRecording` gives back: the WAV file, its length, and the live text (null when it did not run or failed). */
class Recorded(val uri: String, val durationMs: Int, val text: String?)

/**
 * Dictation and recording: one run at a time, like the iOS Recognizer. All state lives on the
 * main thread (the SpeechRecognizer needs it). The audio focus is held only while a run is.
 *
 * A dictation run feeds live recognition only. A recording run writes a WAV file and can also
 * feed live recognition (Android 13+: the same audio goes to the recognizer through a pipe;
 * older versions: the recognizer has the microphone and the file stays empty). Both emit a level.
 */
class VoiceEngine(
  private val context: Context,
  private val onPartial: (String) -> Unit,
  private val onError: (DictationError) -> Unit,
  private val onLevel: (Double) -> Unit,
  private val onHalt: (String) -> Unit,
) {
  private class Run(
    val live: LiveSpeech?,
    val recorder: PcmRecorder?,
    val writer: WavWriter?,
    val startedAt: Long,
    /** True when a failure of live recognition ends the run (dictation); false for a recording. */
    val reportsErrors: Boolean,
  )

  companion object {
    /** Wait for the final text at most this long after the microphone stops. */
    private const val FINISH_TIMEOUT_MS = 5_000L
  }

  private val main = Handler(Looper.getMainLooper())
  private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private var active: Run? = null
  private var finishing = false
  private var halted = false
  private var focus: AudioFocusRequest? = null
  private var speechFocus: AudioFocusRequest? = null

  /** True while dictation or a recording owns the microphone. */
  val isBusy: Boolean get() = active != null || finishing

  fun micGranted(): Boolean =
    context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

  /** Starts live dictation. Main thread. */
  fun startDictation(locale: String?) {
    begin(live = true, record = false, locale = locale)
  }

  /** Starts a recording to a WAV file. `live`: also run live recognition. Main thread. */
  fun startRecording(live: Boolean, locale: String?) {
    begin(live = live, record = true, locale = locale)
  }

  private fun begin(live: Boolean, record: Boolean, locale: String?) {
    if (isBusy) throw DictationError.busy()
    if (!micGranted()) throw DictationError.denied("Microphone access is off. Turn it on in Settings.")
    halted = false
    val canLive = LiveSpeech.available(context)
    if (live && !record && !canLive) {
      throw DictationError.unavailable("Speech recognition is not available on this device")
    }
    // A recording without a recognizer still makes the file: another engine reads it.
    val useLive = live && canLive
    val pipe = record && useLive && LiveSpeech.pipeSupported
    // Before Android 13 the recognizer needs the microphone itself, so the app cannot record too.
    val recordAudio = record && (!useLive || pipe)

    var writer: WavWriter? = null
    var recorder: PcmRecorder? = null
    var liveSpeech: LiveSpeech? = null
    try {
      requestFocus()
      if (record) {
        writer = WavWriter(File(context.cacheDir, "herdling-rec-${UUID.randomUUID().toString().uppercase()}.wav"))
      }
      if (useLive) {
        liveSpeech = LiveSpeech(
          context,
          locale,
          pipeMode = pipe,
          onPartial = onPartial,
          onError = { e -> liveFailed(e) },
          onLevel = onLevel,
        )
        liveSpeech.start()
      }
      if (recordAudio) {
        val w = writer!!
        val meter = LevelMeter(WavWriter.SAMPLE_RATE, onLevel)
        val l = liveSpeech
        recorder = PcmRecorder { pcm, n ->
          meter.feed(pcm, n)
          l?.feed(pcm, n)
          if (w.append(pcm, n)) main.post { halt("limit") }
        }
        recorder.start()
      }
    } catch (e: Exception) {
      recorder?.stop()
      liveSpeech?.cancel()
      writer?.discard()
      abandonFocus()
      throw e as? DictationError ?: DictationError.failed(e.message ?: e.toString())
    }
    active = Run(liveSpeech, recorder, writer, SystemClock.elapsedRealtime(), reportsErrors = !record)
  }

  /** Live recognition failed while the run goes on. A dictation reports it; a recording keeps its file. */
  private fun liveFailed(e: DictationError) {
    val r = active ?: return
    if (r.reportsErrors) onError(e)
  }

  /** Stops the microphone but keeps the run, so a later stop still returns the text and the file. */
  private fun halt(reason: String) {
    val r = active ?: return
    if (halted) return
    halted = true
    r.recorder?.stop()
    if (r.recorder == null) r.live?.finish()
    onHalt(reason)
  }

  /** Stops the microphone and returns the final text. Returns "" when nothing runs. Main thread. */
  suspend fun stop(): String {
    val r = active ?: return ""
    // A recording run that JS stops with the dictation call: drop its file.
    r.writer?.discard()
    val live = r.live
    if (live == null) {
      end(r)
      return ""
    }
    return finishLive(r, live) ?: throw DictationError.timeout()
  }

  /** Stops a recording and returns its file. Main thread. */
  suspend fun stopRecording(): Recorded {
    val r = active
    val writer = r?.writer ?: throw DictationError("not_recording", "No recording runs")
    r.recorder?.stop()
    var durationMs = writer.finish()
    if (r.recorder == null) durationMs = (SystemClock.elapsedRealtime() - r.startedAt).toInt()
    val live = r.live
    val text = if (live != null) {
      try {
        finishLive(r, live)
      } catch (_: Exception) {
        null
      }
    } else {
      end(r)
      null
    }
    return Recorded(Uri.fromFile(writer.file).toString(), durationMs, text)
  }

  /** Ends the run and waits for the final text. Null on timeout with no text so far. */
  private suspend fun finishLive(r: Run, live: LiveSpeech): String? {
    active = null
    finishing = true
    r.recorder?.stop()
    try {
      val pending = live.finish()
      val text = withTimeoutOrNull(FINISH_TIMEOUT_MS) { pending.await() }
      if (text != null) return text
      // A timed-out finish may still wait on the recognizer: drop it, keep what came so far.
      val soFar = live.textSoFar()
      live.cancel()
      return soFar.ifEmpty { null }
    } finally {
      finishing = false
      abandonFocus()
    }
  }

  private fun end(r: Run) {
    active = null
    r.recorder?.stop()
    r.live?.cancel()
    abandonFocus()
  }

  /** Stops the microphone and drops the transcript and the file. Main thread. */
  fun cancel() {
    val r = active ?: return
    active = null
    r.recorder?.stop()
    r.live?.cancel()
    r.writer?.discard()
    abandonFocus()
  }

  /** Takes the audio focus for speech output (ducks other audio) unless a run owns the microphone. */
  fun activateSpeech() {
    if (isBusy) throw DictationError.busy()
    if (speechFocus != null) return
    val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ASSISTANT)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build(),
      )
      .build()
    audio.requestAudioFocus(req)
    speechFocus = req
  }

  /** Gives the speech audio focus back unless a run owns the microphone. */
  fun releaseSpeech() {
    if (isBusy) return
    speechFocus?.let { audio.abandonAudioFocusRequest(it) }
    speechFocus = null
  }

  /** A call or another app takes the audio: stop the microphone and keep what was recorded. */
  private fun requestFocus() {
    val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
      .setAudioAttributes(
        AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
          .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
          .build(),
      )
      .setOnAudioFocusChangeListener({ change ->
        if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) {
          halt("interrupted")
        }
      }, main)
      .build()
    audio.requestAudioFocus(req)
    focus = req
  }

  private fun abandonFocus() {
    focus?.let { audio.abandonAudioFocusRequest(it) }
    focus = null
  }
}

/** Reads 16 kHz mono PCM16 from the microphone on its own thread. */
class PcmRecorder(private val onPcm: (ByteArray, Int) -> Unit) {
  @Volatile private var running = false
  private var record: AudioRecord? = null
  private var worker: Thread? = null

  @SuppressLint("MissingPermission") // The engine checks RECORD_AUDIO first.
  fun start() {
    val rate = WavWriter.SAMPLE_RATE
    val minSize = AudioRecord.getMinBufferSize(rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (minSize <= 0) throw DictationError.unavailable("No microphone input")
    val size = maxOf(minSize, rate / 5 * 2) // at least 200 ms
    val r = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, rate, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, size)
    if (r.state != AudioRecord.STATE_INITIALIZED) {
      r.release()
      throw DictationError.unavailable("No microphone input")
    }
    r.startRecording()
    record = r
    running = true
    worker = thread(name = "herdling-mic") {
      val buffer = ByteArray(rate / 20 * 2) // 50 ms
      while (running) {
        val n = r.read(buffer, 0, buffer.size)
        if (n > 0) onPcm(buffer, n) else if (n < 0) break
      }
    }
  }

  /** Stops the microphone. Safe to call more than once. */
  fun stop() {
    if (!running && record == null) return
    running = false
    worker?.join(500)
    worker = null
    record?.let {
      try {
        it.stop()
      } catch (_: Exception) {
      }
      it.release()
    }
    record = null
  }
}
