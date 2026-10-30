import FluidAudio
import Foundation
import Network

/// On-device transcription with NVIDIA Parakeet TDT 0.6B (FluidAudio, Core ML).
/// The model downloads only on request, lives in Application Support (not in the iCloud
/// backup), loads on first use and unloads on a memory warning or in the background.
actor Parakeet {
  /// "v2": English, best recall. "v3": 25 European languages.
  enum Model: String {
    case v2
    case v3

    var version: AsrModelVersion { self == .v2 ? .v2 : .v3 }
    var repo: Repo { self == .v2 ? .parakeetV2 : .parakeetV3 }
    /// The v3 encoder build FluidAudio loads by default.
    var variant: String? { self == .v2 ? nil : ParakeetEncoderPrecision.int8.rawValue }
    /// The folder that holds this model's files.
    var dir: URL { AsrModels.defaultCacheDirectory(for: version) }
    var installed: Bool { AsrModels.modelsExist(at: dir, version: version) }
  }

  typealias ProgressHandler = @Sendable (_ model: String, _ fraction: Double) -> Void

  private var manager: AsrManager?
  private var loaded: Model?
  private var running: (model: Model, task: Task<Void, Error>)?
  /// A download call is in progress (it can still be in its network check).
  private var claimed = false

  /// Installed state and bytes on disk of each model.
  func status() -> [String: [String: Any]] {
    var out: [String: [String: Any]] = [:]
    for m in [Model.v2, .v3] {
      out[m.rawValue] = [
        "installed": m.installed,
        "bytes": Self.size(of: m.dir),
        "downloading": running?.model == m,
      ]
    }
    return out
  }

  /// Downloads `model`. Without `allowCellular`, it runs only on a network that is not
  /// expensive (Wi-Fi, Ethernet) and stops when the phone moves to cellular.
  /// Rejects with "busy", "offline", "cellular", "cancelled" or "download_failed".
  func download(_ model: Model, allowCellular: Bool, onProgress: @escaping ProgressHandler) async throws {
    // Claimed before the first await: the actor can take a second call while this one waits.
    guard running == nil, !claimed else { throw ParakeetError(code: "busy", message: "A model download already runs") }
    claimed = true
    defer { claimed = false }
    let path = await Self.currentPath()
    guard path.status == .satisfied else { throw ParakeetError(code: "offline", message: "No network connection") }
    if !allowCellular && path.isExpensive {
      throw ParakeetError(code: "cellular", message: "The model downloads on Wi-Fi only. Allow cellular in Settings.")
    }

    let parent = model.dir.deletingLastPathComponent()
    let task = Task {
      try FileManager.default.createDirectory(at: parent, withIntermediateDirectories: true)
      Self.excludeFromBackup(parent.deletingLastPathComponent())
      let step = Step()
      try await ModelHub.download(model.repo, to: parent, variant: model.variant) { p in
        // The download fills 0...0.5 of FluidAudio's scale; compile steps do not run here.
        let fraction = min(1, p.fractionCompleted * 2)
        if step.passes(fraction) { onProgress(model.rawValue, fraction) }
      }
      try Task.checkCancellation()
      // FluidAudio's own download adds any small file the repo download did not get (the vocabulary).
      if !model.installed { try await AsrModels.download(version: model.version) }
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

  /// Deletes the model files. Unloads the model first when it is loaded.
  func delete(_ model: Model) {
    if loaded == model { unload() }
    try? FileManager.default.removeItem(at: model.dir)
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
    let models = try await AsrModels.load(from: model.dir, version: model.version)
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

  private static func excludeFromBackup(_ url: URL) {
    var url = url
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? url.setResourceValues(values)
  }

  private static func size(of dir: URL) -> Int {
    guard let files = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: [.totalFileAllocatedSizeKey]) else { return 0 }
    var total = 0
    for case let f as URL in files {
      total += (try? f.resourceValues(forKeys: [.totalFileAllocatedSizeKey]).totalFileAllocatedSize) ?? 0
    }
    return total
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
