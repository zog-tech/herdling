import FluidAudio
import Foundation
import Network

/// On-device transcription with NVIDIA Parakeet TDT 0.6B (FluidAudio, Core ML).
/// The model downloads only on request, loads on first use and unloads on a memory warning
/// or in the background. The files live in the App Group container that other Zog Tech apps
/// share (`SharedModels.swift`), not in the iCloud backup.
actor Parakeet {
  /// "v2": English, best recall. "v3": 25 European languages.
  enum Model: String {
    case v2
    case v3

    var version: AsrModelVersion { self == .v2 ? .v2 : .v3 }
    /// The folder that holds this model's files.
    var dir: URL { SharedModels.directory(for: version) }
    var installed: Bool { SharedModels.isInstalled(version) }
  }

  typealias ProgressHandler = @Sendable (_ model: String, _ fraction: Double) -> Void

  private var manager: AsrManager?
  private var loaded: Model?
  private var running: (model: Model, task: Task<Void, Error>)?
  /// A download call is in progress (it can still be in its network check).
  private var claimed = false

  /// Installed state and bytes on disk of each model. `shared` is true when the files are
  /// in the App Group container, so a delete also removes them for other Zog Tech apps.
  func status() -> [String: [String: Any]] {
    var out: [String: [String: Any]] = [:]
    for m in [Model.v2, .v3] {
      out[m.rawValue] = [
        "installed": m.installed,
        "bytes": SharedModels.bytes(m.version),
        "downloading": running?.model == m,
        "shared": SharedModels.isShared,
      ]
    }
    return out
  }

  /// Downloads `model`. Without `allowCellular`, it runs only on a network that is not
  /// expensive (Wi-Fi, Ethernet) and stops when the phone moves to cellular.
  /// Rejects with "busy", "offline", "cellular", "cancelled" or "download_failed".
  /// "busy" also comes when another Zog Tech app downloads the same model.
  func download(_ model: Model, allowCellular: Bool, onProgress: @escaping ProgressHandler) async throws {
    // Claimed before the first await: the actor can take a second call while this one waits.
    guard running == nil, !claimed else { throw ParakeetError(code: "busy", message: "A model download already runs") }
    claimed = true
    defer { claimed = false }
    // Another app can have put the model into the shared folder.
    if model.installed { return }
    let path = await Self.currentPath()
    guard path.status == .satisfied else { throw ParakeetError(code: "offline", message: "No network connection") }
    if !allowCellular && path.isExpensive {
      throw ParakeetError(code: "cellular", message: "The model downloads on Wi-Fi only. Allow cellular in Settings.")
    }

    let task = Task {
      let step = Step()
      try await SharedModels.download(model.version) { fraction in
        if step.passes(fraction) { onProgress(model.rawValue, fraction) }
      }
    }
    running = (model, task)
    defer { running = nil }

    // Stop the download when the phone leaves Wi-Fi and cellular is not allowed.
    let monitor = NWPathMonitor()
    let stoppedForCellular = Flag()
    if !allowCellular {
      monitor.pathUpdateHandler = { p in
        if p.isExpensive || p.status != .satisfied, stoppedForCellular.setOnce() { task.cancel() }
      }
      monitor.start(queue: .global(qos: .utility))
    }
    defer { monitor.cancel() }

    do {
      try await task.value
    } catch SharedModelsError.busy {
      throw ParakeetError(code: "busy", message: SharedModelsError.busy.localizedDescription)
    } catch {
      if stoppedForCellular.isSet {
        throw ParakeetError(code: "cellular", message: "The download stopped: the phone left Wi-Fi.")
      }
      if task.isCancelled || error is CancellationError {
        throw ParakeetError(code: "cancelled", message: "The download was cancelled")
      }
      throw ParakeetError(code: "download_failed", message: error.localizedDescription)
    }
    guard model.installed else {
      throw ParakeetError(code: "download_failed", message: "The model files are not complete")
    }
  }

  /// Stops a running download. Files that are complete stay; the next download goes on from them.
  func cancelDownload() {
    running?.task.cancel()
  }

  /// Deletes the model files, also for other Zog Tech apps that share them.
  /// Unloads the model first when it is loaded. Rejects with "busy" while a download runs.
  func delete(_ model: Model) throws {
    if running?.model == model { throw ParakeetError(code: "busy", message: "The model downloads now") }
    if loaded == model { unload() }
    do {
      try SharedModels.delete(model.version)
    } catch SharedModelsError.busy {
      throw ParakeetError(code: "busy", message: SharedModelsError.busy.localizedDescription)
    } catch {
      throw ParakeetError(code: "failed", message: error.localizedDescription)
    }
  }

  /// Transcribes the WAV file at `url`. Loads `model` first when another one (or none) is loaded.
  /// Rejects with "not_installed" or "failed".
  func transcribe(url: URL, model: Model) async throws -> String {
    guard model.installed else { throw ParakeetError(code: "not_installed", message: "The Parakeet model is not downloaded") }
    do {
      let asr = try await load(model)
      var state = TdtDecoderState.make(decoderLayers: model.version.decoderLayers)
      let result = try await asr.transcribe(url, decoderState: &state)
      return result.text.trimmingCharacters(in: .whitespacesAndNewlines)
    } catch let e as ParakeetError {
      throw e
    } catch {
      throw ParakeetError(code: "failed", message: error.localizedDescription)
    }
  }

  /// Frees the model memory. The next transcription loads it again.
  func unload() {
    if let manager { Task { await manager.cleanup() } }
    manager = nil
    loaded = nil
  }

  private func load(_ model: Model) async throws -> AsrManager {
    if let manager, loaded == model { return manager }
    unload()
    let models = try await SharedModels.load(model.version)
    let asr = AsrManager(config: .default)
    try await asr.loadModels(models)
    manager = asr
    loaded = model
    return asr
  }

  private static func currentPath() async -> NWPath {
    await withCheckedContinuation { c in
      let monitor = NWPathMonitor()
      let once = Flag()
      monitor.pathUpdateHandler = { p in
        guard once.setOnce() else { return }
        monitor.cancel()
        c.resume(returning: p)
      }
      monitor.start(queue: .global(qos: .utility))
    }
  }
}

/// Lets a progress value through when it moved by 1 % or reached the end.
private final class Step: @unchecked Sendable {
  private let lock = NSLock()
  private var last = -1.0

  func passes(_ v: Double) -> Bool {
    lock.withLock {
      guard v - last >= 0.01 || (v >= 1 && last < 1) else { return false }
      last = v
      return true
    }
  }
}

/// True once: the first `setOnce` returns true, every later one false.
private final class Flag: @unchecked Sendable {
  private let lock = NSLock()
  private var set = false

  var isSet: Bool { lock.withLock { set } }

  func setOnce() -> Bool {
    lock.withLock {
      defer { set = true }
      return !set
    }
  }
}

struct ParakeetError: Error {
  let code: String
  let message: String
}
