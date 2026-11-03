import ExpoModulesCore
import Foundation

/// Native crash capture.
///
/// A release build that stops on an uncaught NSException (for example `RCTFatal`) leaves no
/// message in the JS crash log. This module installs an uncaught exception handler that writes the
/// name, the reason and the first lines of the call stack to a small file. On the next launch, JS
/// reads the file with `read`, adds it to the crash log and deletes it with `clear`.
///
/// File format: line 1 is the time in epoch ms. The other lines are the text of the crash.
public class HerdlingCrashModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HerdlingCrash")

    // The module registry makes the module when the React host starts, before the JS bundle runs.
    OnCreate {
      HerdlingCrashCatcher.install()
    }

    AsyncFunction("read") { () -> String? in
      return HerdlingCrashCatcher.read()
    }

    AsyncFunction("clear") {
      HerdlingCrashCatcher.clear()
    }
  }
}

/// The handler that was there before ours. Ours calls it after the write.
private var herdlingPreviousHandler: (@convention(c) (NSException) -> Void)?
/// The crash file. Set once in `install`, so the handler does no file manager work.
private var herdlingCrashURL: URL?

/// The uncaught exception handler. It is a C function pointer, so it can use only globals.
private func herdlingHandleException(_ exception: NSException) {
  HerdlingCrashCatcher.write(exception)
  herdlingPreviousHandler?(exception)
}

enum HerdlingCrashCatcher {
  /// The call stack keeps this many lines.
  static let stackLines = 30
  static let reasonChars = 500
  private static var installed = false
  private static let lock = NSLock()

  /// The file in Application Support. The folder is made here, not in the handler.
  static func fileURL() -> URL? {
    guard let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
      return nil
    }
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent("herdling-native-crash.txt")
  }

  /// Installs the handler once and keeps the previous handler.
  static func install() {
    lock.lock()
    defer { lock.unlock() }
    if installed { return }
    installed = true
    herdlingCrashURL = fileURL()
    herdlingPreviousHandler = NSGetUncaughtExceptionHandler()
    NSSetUncaughtExceptionHandler(herdlingHandleException)
  }

  /// Writes one small file synchronously. The app stops right after this.
  static func write(_ exception: NSException) {
    guard let url = herdlingCrashURL else { return }
    let at = Int64(Date().timeIntervalSince1970 * 1000)
    let reason = String((exception.reason ?? "").prefix(reasonChars))
    let stack = exception.callStackSymbols.prefix(stackLines).joined(separator: "\n")
    let text = "\(at)\n\(exception.name.rawValue): \(reason)\n\(stack)"
    try? text.data(using: .utf8)?.write(to: url, options: .atomic)
  }

  /// The file text, or nil when no crash was saved.
  static func read() -> String? {
    guard let url = fileURL() else { return nil }
    return try? String(contentsOf: url, encoding: .utf8)
  }

  static func clear() {
    guard let url = fileURL() else { return }
    try? FileManager.default.removeItem(at: url)
  }
}
