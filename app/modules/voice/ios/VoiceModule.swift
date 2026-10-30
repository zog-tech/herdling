import ExpoModulesCore
import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

struct DictationOptions: Record {
  @Field var locale: String?
}

struct RecordingOptions: Record {
  /// Also run live recognition (the Apple engine).
  @Field var live: Bool = false
  @Field var locale: String?
}

private func exception(_ e: Error) -> Exception {
  if let e = e as? DictationError { return Exception(name: "DictationError", description: e.message, code: e.code) }
  return Exception(name: "VoiceError", description: e.localizedDescription, code: "failed")
}

public class VoiceModule: Module {
  private lazy var recognizer = Recognizer(
    onPartial: { [weak self] text in self?.sendEvent("onPartial", ["text": text]) },
    onError: { [weak self] code, message in self?.sendEvent("onDictationError", ["code": code, "message": message]) },
    onLevel: { [weak self] level in self?.sendEvent("onLevel", ["level": level]) },
    onHalt: { [weak self] reason in self?.sendEvent("onRecordingHalted", ["reason": reason]) }
  )

  public func definition() -> ModuleDefinition {
    Name("VoiceModule")

    Events("onPartial", "onDictationError", "onLevel", "onRecordingHalted")

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
      do {
        try await self.recognizer.activateSpeech()
      } catch let e as DictationError {
        throw Exception(name: "DictationError", description: e.message, code: e.code)
      }
    }

    AsyncFunction("releaseAudio") { () async in
      await self.recognizer.releaseSpeech()
    }

    AsyncFunction("requestMicPermission") { () async -> String in
      await Recognizer.requestMicPermission() ? "granted" : "denied"
    }

    AsyncFunction("startRecording") { (opts: RecordingOptions?) async throws in
      do {
        try await self.recognizer.startRecording(live: opts?.live ?? false, localeId: opts?.locale)
      } catch {
        throw exception(error)
      }
    }

    AsyncFunction("stopRecording") { () async throws -> [String: Any] in
      do {
        let r = try await self.recognizer.stopRecording()
        var out: [String: Any] = ["uri": r.uri, "durationMs": r.durationMs]
        if let text = r.text { out["text"] = text }
        return out
      } catch {
        throw exception(error)
      }
    }

    AsyncFunction("cancelRecording") { () async in
      await self.recognizer.cancel()
    }

    AsyncFunction("localSummaryAvailable") { () -> Bool in
      LocalSummary.available()
    }

    AsyncFunction("summarizeLocal") { (text: String, instructions: String) async throws -> String in
      do {
        return try await LocalSummary.summarize(text, instructions: instructions)
      } catch let e as SummaryError {
        throw Exception(name: "SummaryError", description: e.message, code: e.code)
      } catch {
        throw Exception(name: "SummaryError", description: error.localizedDescription, code: "failed")
      }
    }

    OnDestroy {
      let recognizer = self.recognizer
      Task { await recognizer.cancel() }
    }
  }
}

struct SummaryError: Error {
  let code: String
  let message: String
}

/// Apple Intelligence's on-device model (FoundationModels, iOS 26+). Not there on older systems,
/// unsupported devices, or with Apple Intelligence off or still downloading.
enum LocalSummary {
  static func available() -> Bool {
    #if canImport(FoundationModels)
    if #available(iOS 26, *) {
      if case .available = SystemLanguageModel.default.availability { return true }
    }
    #endif
    return false
  }

  /// One fresh session per call, so replies never share context.
  static func summarize(_ text: String, instructions: String) async throws -> String {
    #if canImport(FoundationModels)
    if #available(iOS 26, *) {
      guard case .available = SystemLanguageModel.default.availability else {
        throw SummaryError(code: "unavailable", message: "The on-device model is not available.")
      }
      let session = LanguageModelSession(instructions: instructions)
      return try await session.respond(to: text).content
    }
    #endif
    throw SummaryError(code: "unavailable", message: "The on-device model needs iOS 26.")
  }
}
