import ExpoModulesCore
import Foundation
import UIKit

// Parakeet belongs to voice input, but its code lives in this pod: FluidAudio is a Swift package,
// and React Native can build only one static pod with a Swift package (see SshModule.podspec).
// JS reaches it as its own native module, "ParakeetModule", through `modules/voice/parakeet.ts`.

struct DownloadOptions: Record {
  @Field var allowCellular: Bool = false
}

private func parakeetException(_ e: Error) -> Exception {
  if let e = e as? ParakeetError { return Exception(name: "ParakeetError", description: e.message, code: e.code) }
  return Exception(name: "ParakeetError", description: e.localizedDescription, code: "failed")
}

private func model(_ name: String) throws -> Parakeet.Model {
  guard let m = Parakeet.Model(rawValue: name) else {
    throw Exception(name: "ParakeetError", description: "Unknown model \(name)", code: "bad_model")
  }
  return m
}

public class ParakeetModule: Module {
  private let parakeet = Parakeet()
  private var memoryObserver: NSObjectProtocol?

  public func definition() -> ModuleDefinition {
    Name("ParakeetModule")

    Events("onModelProgress")

    OnCreate {
      let parakeet = self.parakeet
      self.memoryObserver = NotificationCenter.default.addObserver(
        forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: nil
      ) { _ in
        Task { await parakeet.unload() }
      }
    }

    OnAppEntersBackground {
      let parakeet = self.parakeet
      Task { await parakeet.unload() }
    }

    AsyncFunction("status") { () async -> [String: [String: Any]] in
      await self.parakeet.status()
    }

    AsyncFunction("download") { (name: String, opts: DownloadOptions?) async throws in
      let m = try model(name)
      do {
        try await self.parakeet.download(m, allowCellular: opts?.allowCellular ?? false) { [weak self] model, fraction in
          self?.sendEvent("onModelProgress", ["model": model, "fraction": fraction])
        }
      } catch {
        throw parakeetException(error)
      }
    }

    AsyncFunction("cancelDownload") { () async in
      await self.parakeet.cancelDownload()
    }

    AsyncFunction("remove") { (name: String) async throws in
      await self.parakeet.delete(try model(name))
    }

    AsyncFunction("transcribe") { (uri: String, name: String) async throws -> String in
      let m = try model(name)
      guard let url = URL(string: uri) else {
        throw Exception(name: "ParakeetError", description: "Bad file URL", code: "bad_uri")
      }
      do {
        return try await self.parakeet.transcribe(url: url, model: m)
      } catch {
        throw parakeetException(error)
      }
    }

    OnDestroy {
      if let observer = self.memoryObserver { NotificationCenter.default.removeObserver(observer) }
    }
  }
}
