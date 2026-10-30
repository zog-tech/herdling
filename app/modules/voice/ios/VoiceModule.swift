import ExpoModulesCore
import Foundation

struct DictationOptions: Record {
  @Field var locale: String?
}

public class VoiceModule: Module {
  private lazy var recognizer = Recognizer(
    onPartial: { [weak self] text in self?.sendEvent("onPartial", ["text": text]) },
    onError: { [weak self] code, message in self?.sendEvent("onDictationError", ["code": code, "message": message]) }
  )

  public func definition() -> ModuleDefinition {
    Name("VoiceModule")

    Events("onPartial", "onDictationError")

    AsyncFunction("requestPermission") { () async -> String in
      await Recognizer.requestPermission() ? "granted" : "denied"
    }

    AsyncFunction("startDictation") { (opts: DictationOptions?) async throws in
      do {
        try await self.recognizer.start(localeId: opts?.locale)
      } catch let e as DictationError {
        throw Exception(name: "DictationError", description: e.message, code: e.code)
      }
    }

    AsyncFunction("stopDictation") { () async throws -> String in
      do {
        return try await self.recognizer.stop()
      } catch let e as DictationError {
        throw Exception(name: "DictationError", description: e.message, code: e.code)
      }
    }

    AsyncFunction("cancelDictation") { () async in
      await self.recognizer.cancel()
    }

    AsyncFunction("setSpeechAudio") { () async throws in
      if await self.recognizer.isBusy {
        throw Exception(name: "DictationError", description: "Dictation is running", code: "busy")
      }
      try AudioSession.activateForSpeech()
    }

    AsyncFunction("releaseAudio") { () async in
      if await self.recognizer.isBusy { return }
      AudioSession.deactivate()
    }

    OnDestroy {
      let recognizer = self.recognizer
      Task { await recognizer.cancel() }
    }
  }
}
