// SharedModels.swift
//
// Storage of the FluidAudio Parakeet models in one App Group container, so that all
// Zog Tech apps of the same team use one copy of the files. This file is shared
// between the apps: copy it byte for byte. It has no dependency on one app.
//
// Contract (every app that copies this file must keep it):
//
// - FluidAudio: exact version 0.17.7 (Swift package, `exactVersion`).
// - Hugging Face revisions that a new download uses (`pinnedRevision(for:)`):
//     v2  FluidInference/parakeet-tdt-0.6b-v2-coreml  ee09c569f73759e6d44c9bd16766f477b2b36d39
//     v3  FluidInference/parakeet-tdt-0.6b-v3-coreml  7dd20fe6b1797d35f5e3307e8b1732d9a178edfe
//   The v3 encoder variant is "int8" (FluidAudio's default).
// - App Group: "group.com.zogtech.models" (entitlement com.apple.security.application-groups).
// - Layout, with <group> the App Group container:
//     <group>/FluidAudio/Models/<folder>/        a complete model; FluidAudio's own layout
//     <group>/FluidAudio/Downloads/<folder>/     a download in progress (resumable)
//     <group>/FluidAudio/Downloads/<folder>.lock the flock(2) lock of that model
//   <folder> is the last path component of `AsrModels.defaultCacheDirectory(for:)`:
//   "parakeet-tdt-0.6b-v2-coreml" or "parakeet-tdt-0.6b-v3-coreml".
//   Without the App Group entitlement, <group>/FluidAudio is the private
//   Application Support/FluidAudio folder (FluidAudio's default) and nothing is shared.
// - The revision marker ".fluidaudio-revision" stays in the model folder. Each app
//   accepts the files of the other app: an installed model loads at the revision in its
//   marker (or "main" when it has no marker), never at this file's pin. So FluidAudio
//   does not delete or download again a complete model because the pins differ.
// - Only the holder of the model's lock writes to Downloads/<folder>, moves a folder into
//   Models/ or deletes a model. A download goes to Downloads/<folder> and then moves
//   into Models/ with one rename. A second app gets `SharedModelsError.busy`.
// - The lock is a file lock in a shared container. iOS ends an app that keeps such a
//   lock while it is suspended (0xdead10cc). So a download asks for background time,
//   and when that time ends, it releases the lock and stops. Do not compile this file
//   into an app extension (it uses UIApplication).
// - A Downloads/<folder> that nobody locks and that is older than one day is deleted.
// - `delete(_:)` deletes the shared copy: every app loses the model.
//
// Usage: call `download`, `load`, `delete`, `isInstalled` and `bytes`. Each call moves
// models from the old private folder into the group first (once per process).

import FluidAudio
import Foundation
#if canImport(UIKit)
import UIKit
#endif

public enum SharedModelsError: LocalizedError, Equatable {
  /// Another app (or another call) holds the model's lock.
  case busy
  /// The download ended, but the model files are not complete.
  case incomplete

  public var errorDescription: String? {
    switch self {
    case .busy: return "Another Zog Tech app downloads or changes this model now. Try again soon."
    case .incomplete: return "The model files are not complete"
    }
  }
}

public enum SharedModels {
  public static let appGroup = "group.com.zogtech.models"

  /// The models that this storage knows. Every app keeps both, also when it uses one,
  /// so that the revision rule and the migration are the same in each app.
  public static let versions: [AsrModelVersion] = [.v2, .v3]

  /// The Hugging Face commit that a new download uses. FluidAudio 0.17.7 downloads these
  /// repos at the mutable `main` ref; a fixed commit keeps the files that were tested.
  /// To update: read `sha` from https://huggingface.co/api/models/<repo>, test the model on
  /// a device, and change the value in every app at the same time.
  public static func pinnedRevision(for version: AsrModelVersion) -> String {
    switch version {
    case .v2: return "ee09c569f73759e6d44c9bd16766f477b2b36d39"  // main on 2026-11-09
    default: return "7dd20fe6b1797d35f5e3307e8b1732d9a178edfe"  // v3, main on 2026-11-09
    }
  }

  /// FluidAudio's Hugging Face repo of `version`.
  public static func repo(for version: AsrModelVersion) -> Repo {
    version == .v2 ? .parakeetV2 : .parakeetV3
  }

  /// The encoder build FluidAudio loads by default ("int8" for v3, none for v2).
  public static func variant(for version: AsrModelVersion) -> String? {
    version == .v2 ? nil : ParakeetEncoderPrecision.int8.rawValue
  }

  // MARK: - Paths

  /// The App Group container, or nil when the app has no App Group entitlement.
  public static var groupContainer: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
  }

  /// True when the models are in the App Group container (shared with other apps).
  public static var isShared: Bool { groupContainer != nil }

  /// FluidAudio's private default: Application Support/FluidAudio/Models.
  static var privateRoot: URL { MLModelConfigurationUtils.defaultModelsDirectory() }

  /// "<group>/FluidAudio", or the private "Application Support/FluidAudio".
  static var base: URL {
    if let group = groupContainer { return group.appendingPathComponent("FluidAudio", isDirectory: true) }
    return privateRoot.deletingLastPathComponent()
  }

  /// The folder that holds the complete models.
  public static var root: URL { base.appendingPathComponent("Models", isDirectory: true) }

  /// The folder that holds downloads in progress and the locks.
  static var downloads: URL { base.appendingPathComponent("Downloads", isDirectory: true) }

  /// The folder name of `version`, the same as in FluidAudio's default cache folder.
  static func folderName(for version: AsrModelVersion) -> String {
    AsrModels.defaultCacheDirectory(for: version).lastPathComponent
  }

  /// The folder of a complete model.
  public static func directory(for version: AsrModelVersion) -> URL {
    root.appendingPathComponent(folderName(for: version), isDirectory: true)
  }

  static func temporaryDirectory(for version: AsrModelVersion) -> URL {
    downloads.appendingPathComponent(folderName(for: version), isDirectory: true)
  }

  static func lockFile(named folder: String) -> URL {
    downloads.appendingPathComponent(folder + ".lock", isDirectory: false)
  }

  // MARK: - State

  /// True when all model files of `version` are in the model folder.
  public static func isInstalled(_ version: AsrModelVersion) -> Bool {
    prepare()
    return complete(directory(for: version), version)
  }

  /// Bytes on disk of the model folder of `version`.
  public static func bytes(_ version: AsrModelVersion) -> Int {
    prepare()
    let dir = directory(for: version)
    guard let files = FileManager.default.enumerator(at: dir, includingPropertiesForKeys: [.totalFileAllocatedSizeKey])
    else { return 0 }
    var total = 0
    for case let f as URL in files {
      total += (try? f.resourceValues(forKeys: [.totalFileAllocatedSizeKey]).totalFileAllocatedSize) ?? 0
    }
    return total
  }

  /// The revision in the marker of a model folder, or nil when it has no marker.
  /// FluidAudio 0.17.7 writes it (`ModelCache.revisionMarkerName`); check the name again
  /// when FluidAudio changes.
  static func storedRevision(at dir: URL) -> String? {
    guard let data = try? Data(contentsOf: dir.appendingPathComponent(".fluidaudio-revision")) else { return nil }
    return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private static func complete(_ dir: URL, _ version: AsrModelVersion) -> Bool {
    AsrModels.modelsExist(at: dir, version: version)
  }

  // MARK: - Revisions

  /// Sets FluidAudio's `ModelRegistry.revisionOverrides` for the Parakeet repos. Call it
  /// before each FluidAudio download or load: the load checks the cache against the same
  /// revision, and on a mismatch FluidAudio deletes the folder and downloads again.
  ///
  /// - An installed model gets the revision in its marker, so a model that another app
  ///   downloaded at another pin stays valid. A model that an older build downloaded at
  ///   `main` has no marker and keeps `main`.
  /// - A model that is not installed gets `pinnedRevision(for:)` for its new download.
  ///
  /// Other entries of `revisionOverrides` stay as they are.
  static func applyRevisionOverrides() {
    var pins = ModelRegistry.revisionOverrides
    for v in versions {
      let dir = directory(for: v)
      let revision = complete(dir, v) ? (storedRevision(at: dir) ?? "main") : pinnedRevision(for: v)
      pins[repo(for: v).remotePath] = revision
    }
    if ModelRegistry.revisionOverrides != pins { ModelRegistry.revisionOverrides = pins }
  }

  // MARK: - Load

  /// Loads the installed model `version` from the model folder.
  public static func load(_ version: AsrModelVersion) async throws -> AsrModels {
    prepare()
    applyRevisionOverrides()
    return try await AsrModels.load(from: directory(for: version), version: version)
  }

  // MARK: - Download

  /// Downloads `version` into Downloads/<folder> and moves it into the model folder.
  /// Files of an earlier, stopped download stay and the download goes on from them.
  /// `onProgress` gets 0...1. Does nothing when the model is installed.
  /// Throws `SharedModelsError.busy` when another app holds the lock, `CancellationError`
  /// when the task is cancelled or the background time ends, and FluidAudio's errors.
  public static func download(
    _ version: AsrModelVersion, onProgress: @escaping @Sendable (Double) -> Void
  ) async throws {
    prepare()
    if complete(directory(for: version), version) { return }
    let folder = folderName(for: version)
    let fm = FileManager.default
    try fm.createDirectory(at: downloads, withIntermediateDirectories: true)
    excludeFromBackup(base)
    guard let lock = try FileLock.acquire(lockFile(named: folder)) else { throw SharedModelsError.busy }
    defer { lock.release() }
    // Another app can finish the same model before this app gets the lock.
    if complete(directory(for: version), version) { return }

    let temp = temporaryDirectory(for: version)
    if fm.fileExists(atPath: temp.path) {
      // The stale-download cleanup reads this date.
      try? fm.setAttributes([.modificationDate: Date()], ofItemAtPath: temp.path)
    }
    applyRevisionOverrides()
    let hubRepo = repo(for: version)
    let hubVariant = variant(for: version)
    let parent = downloads
    let work = Task {
      try await ModelHub.download(hubRepo, to: parent, variant: hubVariant) { p in
        // The download fills 0...0.5 of FluidAudio's scale; compile steps do not run here.
        onProgress(min(1, p.fractionCompleted * 2))
      }
      try Task.checkCancellation()
      // FluidAudio's own download adds any small file the repo download did not get
      // (the vocabulary). It writes into the same folder.
      if !complete(temp, version) { try await AsrModels.download(to: temp, version: version) }
    }
    let time = await BackgroundTime.begin {
      // iOS ends a suspended app that keeps a lock in a shared container.
      lock.release()
      work.cancel()
    }
    do {
      try await withTaskCancellationHandler {
        try await work.value
      } onCancel: {
        work.cancel()
      }
    } catch {
      await time.end()
      throw error
    }
    await time.end()
    guard lock.isHeld else { throw CancellationError() }
    guard complete(temp, version) else { throw SharedModelsError.incomplete }
    try install(temp, at: directory(for: version), version: version)
  }

  /// Moves a complete folder into the model folder with one rename. The caller holds the lock.
  private static func install(_ temp: URL, at dir: URL, version: AsrModelVersion) throws {
    let fm = FileManager.default
    try fm.createDirectory(at: dir.deletingLastPathComponent(), withIntermediateDirectories: true)
    if fm.fileExists(atPath: dir.path) {
      if complete(dir, version) {
        try? fm.removeItem(at: temp)
        return
      }
      try fm.removeItem(at: dir)
    }
    try fm.moveItem(at: temp, to: dir)
    excludeFromBackup(base)
    excludeFromBackup(dir)
  }

  // MARK: - Delete

  /// Deletes the model files of `version`: the shared copy, a download in progress and an
  /// old private copy. Every app that uses the App Group loses the model.
  /// Throws `SharedModelsError.busy` when another app holds the lock.
  public static func delete(_ version: AsrModelVersion) throws {
    prepare()
    let fm = FileManager.default
    try fm.createDirectory(at: downloads, withIntermediateDirectories: true)
    guard let lock = try FileLock.acquire(lockFile(named: folderName(for: version))) else {
      throw SharedModelsError.busy
    }
    defer { lock.release() }
    for dir in [directory(for: version), temporaryDirectory(for: version)] where fm.fileExists(atPath: dir.path) {
      try fm.removeItem(at: dir)
    }
    if isShared {
      try? fm.removeItem(at: privateRoot.appendingPathComponent(folderName(for: version), isDirectory: true))
    }
  }

  // MARK: - Migration and cleanup

  /// Runs the migration (until each model is done) and the stale-download cleanup (once)
  /// for this process. Cheap after the first call.
  static func prepare() {
    State.shared.run()
  }

  private final class State: @unchecked Sendable {
    static let shared = State()
    private let mutex = NSLock()
    private var migrated: Set<String> = []
    private var cleaned = false

    func run() {
      mutex.lock()
      defer { mutex.unlock() }
      for v in SharedModels.versions {
        let folder = SharedModels.folderName(for: v)
        if !migrated.contains(folder), SharedModels.migrate(v) { migrated.insert(folder) }
      }
      if !cleaned {
        cleaned = true
        SharedModels.removeStaleDownloads()
      }
    }
  }

  /// Moves a model from the old private folder into the group. Returns true when there is
  /// nothing more to do, false when another app holds the lock (the next call tries again).
  ///
  /// - The group has a complete copy: the private copy is deleted.
  /// - The private copy is complete: it moves into Models/ (one rename on the same volume),
  ///   with its revision marker.
  /// - The private copy is not complete: it moves into Downloads/ so that the next download
  ///   goes on from it, or it is deleted when a download is already there.
  fileprivate static func migrate(_ version: AsrModelVersion) -> Bool {
    guard isShared else { return true }
    let fm = FileManager.default
    let folder = folderName(for: version)
    let old = privateRoot.appendingPathComponent(folder, isDirectory: true)
    guard fm.fileExists(atPath: old.path) else { return true }
    do {
      try fm.createDirectory(at: downloads, withIntermediateDirectories: true)
      excludeFromBackup(base)
      guard let lock = try FileLock.acquire(lockFile(named: folder)) else { return false }
      defer { lock.release() }
      let new = directory(for: version)
      let temp = temporaryDirectory(for: version)
      if complete(new, version) {
        try fm.removeItem(at: old)
      } else if complete(old, version) {
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        if fm.fileExists(atPath: new.path) { try fm.removeItem(at: new) }
        try fm.moveItem(at: old, to: new)
        excludeFromBackup(new)
      } else if !fm.fileExists(atPath: temp.path) {
        try fm.moveItem(at: old, to: temp)
        try? fm.setAttributes([.modificationDate: Date()], ofItemAtPath: temp.path)
      } else {
        try fm.removeItem(at: old)
      }
      return true
    } catch {
      // The model stays where it is; the next call tries again.
      return false
    }
  }

  /// Deletes each Downloads/<folder> that is older than one day and that nobody locks.
  fileprivate static func removeStaleDownloads() {
    let fm = FileManager.default
    let keys: [URLResourceKey] = [.isDirectoryKey, .contentModificationDateKey]
    guard let items = try? fm.contentsOfDirectory(at: downloads, includingPropertiesForKeys: keys) else { return }
    let limit = Date().addingTimeInterval(-24 * 60 * 60)
    for item in items {
      guard let values = try? item.resourceValues(forKeys: Set(keys)), values.isDirectory == true,
        let date = values.contentModificationDate, date < limit,
        let lock = (try? FileLock.acquire(lockFile(named: item.lastPathComponent))) ?? nil
      else { continue }
      try? fm.removeItem(at: item)
      lock.release()
    }
  }

  private static func excludeFromBackup(_ url: URL) {
    var url = url
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? url.setResourceValues(values)
  }
}

/// An exclusive flock(2) lock on a file. It works between apps of one App Group and between
/// two calls in one process (each `acquire` opens the file again).
private final class FileLock: @unchecked Sendable {
  private let mutex = NSLock()
  private var fd: Int32

  private init(fd: Int32) { self.fd = fd }

  /// The lock, or nil when another holder has it. Throws when the file does not open.
  static func acquire(_ url: URL) throws -> FileLock? {
    let fd = open(url.path, O_RDWR | O_CREAT | O_CLOEXEC, 0o644)
    guard fd >= 0 else { throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO) }
    guard flock(fd, LOCK_EX | LOCK_NB) == 0 else {
      close(fd)
      return nil
    }
    return FileLock(fd: fd)
  }

  var isHeld: Bool { mutex.withLock { fd >= 0 } }

  /// Releases the lock. A second call does nothing.
  func release() {
    mutex.withLock {
      guard fd >= 0 else { return }
      flock(fd, LOCK_UN)
      close(fd)
      fd = -1
    }
  }

  deinit { release() }
}

/// Background time for a download, so that a short switch to another app does not stop it.
/// When the time ends, `onExpire` runs on the main thread before iOS suspends the app.
private final class BackgroundTime: @unchecked Sendable {
  #if canImport(UIKit)
  private var id: UIBackgroundTaskIdentifier = .invalid
  #endif

  static func begin(onExpire: @escaping @Sendable () -> Void) async -> BackgroundTime {
    let time = BackgroundTime()
    #if canImport(UIKit)
    await MainActor.run {
      time.id = UIApplication.shared.beginBackgroundTask(withName: "SharedModels download") {
        onExpire()
        MainActor.assumeIsolated { time.endOnMain() }
      }
    }
    #endif
    return time
  }

  func end() async {
    #if canImport(UIKit)
    await MainActor.run { self.endOnMain() }
    #endif
  }

  #if canImport(UIKit)
  @MainActor private func endOnMain() {
    guard id != .invalid else { return }
    UIApplication.shared.endBackgroundTask(id)
    id = .invalid
  }
  #endif
}
