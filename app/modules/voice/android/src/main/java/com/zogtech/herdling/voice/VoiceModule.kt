package com.zogtech.herdling.voice

import android.Manifest
import android.content.Context
import expo.modules.interfaces.permissions.PermissionsResponseListener
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class DictationOptions : Record {
  @Field val locale: String? = null
}

class RecordingOptions : Record {
  /** Also run live recognition (the system recognizer). */
  @Field val live: Boolean = false
  @Field val locale: String? = null
}

private fun coded(e: Throwable): CodedException = when (e) {
  is CodedException -> e
  is DictationError -> CodedException(e.code, e.message, null)
  else -> CodedException("failed", e.message ?: e.toString(), e)
}

/**
 * The Android side of `modules/voice`: the same JS API, events and error codes as the iOS
 * module. Live recognition is the system SpeechRecognizer. There is no on-device summary model.
 */
class VoiceModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private var engineOrNull: VoiceEngine? = null

  /** Made on first use, on the main thread. */
  private val engine: VoiceEngine
    get() = engineOrNull ?: VoiceEngine(
      context,
      onPartial = { text -> sendEvent("onPartial", mapOf("text" to text)) },
      onError = { e -> sendEvent("onDictationError", mapOf("code" to e.code, "message" to e.message)) },
      onLevel = { level -> sendEvent("onLevel", mapOf("level" to level)) },
      onHalt = { reason -> sendEvent("onRecordingHalted", mapOf("reason" to reason)) },
    ).also { engineOrNull = it }

  override fun definition() = ModuleDefinition {
    Name("VoiceModule")

    Events("onPartial", "onDictationError", "onLevel", "onRecordingHalted")

    // Android has no separate speech recognition permission: the microphone is enough.
    AsyncFunction("requestPermission") { promise: Promise -> askMic(promise) }

    AsyncFunction("requestMicPermission") { promise: Promise -> askMic(promise) }

    AsyncFunction("startDictation") Coroutine { opts: DictationOptions? ->
      onMain { engine.startDictation(opts?.locale) }
    }

    AsyncFunction("stopDictation") Coroutine { ->
      onMain { engine.stop() }
    }

    AsyncFunction("cancelDictation") Coroutine { ->
      onMain { engine.cancel() }
    }

    AsyncFunction("setSpeechAudio") Coroutine { ->
      onMain { engine.activateSpeech() }
    }

    AsyncFunction("releaseAudio") Coroutine { ->
      onMain { engine.releaseSpeech() }
    }

    AsyncFunction("startRecording") Coroutine { opts: RecordingOptions? ->
      onMain { engine.startRecording(opts?.live ?: false, opts?.locale) }
    }

    AsyncFunction("stopRecording") Coroutine { ->
      onMain {
        val r = engine.stopRecording()
        val out = mutableMapOf<String, Any>("uri" to r.uri, "durationMs" to r.durationMs)
        r.text?.let { out["text"] = it }
        out
      }
    }

    AsyncFunction("cancelRecording") Coroutine { ->
      onMain { engine.cancel() }
    }

    AsyncFunction("localSummaryAvailable") { -> false }

    AsyncFunction("summarizeLocal") { _: String, _: String -> noSummary() }

    OnDestroy {
      val e = engineOrNull ?: return@OnDestroy
      android.os.Handler(android.os.Looper.getMainLooper()).post { e.cancel() }
    }
  }

  private fun noSummary(): String = throw CodedException("unavailable", "Android has no on-device summary model.", null)

  private suspend fun <T> onMain(block: suspend () -> T): T = withContext(Dispatchers.Main) {
    try {
      block()
    } catch (e: Throwable) {
      throw coded(e)
    }
  }

  private fun askMic(promise: Promise) {
    val permissions = appContext.permissions
    if (permissions == null) {
      promise.resolve("denied")
      return
    }
    permissions.askForPermissions(
      PermissionsResponseListener { result ->
        val granted = result[Manifest.permission.RECORD_AUDIO]?.status == PermissionsStatus.GRANTED
        promise.resolve(if (granted) "granted" else "denied")
      },
      Manifest.permission.RECORD_AUDIO,
    )
  }
}
