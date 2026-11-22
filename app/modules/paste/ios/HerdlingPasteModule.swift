import ExpoModulesCore

/// Paste an image or a video into a multiline text input with the system edit menu.
/// The image hook acts only while JS listens for "onPasteImage", the video hook only while JS
/// listens for "onPasteVideo".
public class HerdlingPasteModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HerdlingPaste")

    // Builds before video paste do not have this constant. JS offers video paste only when it is true.
    Constants(["video": true])

    Events("onPasteImage", "onPasteVideo")

    OnCreate {
      HerdlingPasteHook.install { [weak self] base64, width, height in
        self?.sendEvent("onPasteImage", ["base64": base64, "width": width, "height": height])
      }
      HerdlingPasteHook.installVideoHandler { [weak self] uri, size, name, mime, durationMs, error in
        var event: [String: Any] = ["name": name, "size": size]
        if let uri { event["uri"] = uri }
        if let mime { event["mime"] = mime }
        if durationMs > 0 { event["duration"] = durationMs }
        if let error { event["error"] = error }
        self?.sendEvent("onPasteVideo", event)
      }
    }

    OnDestroy {
      HerdlingPasteHook.setEnabled(false)
      HerdlingPasteHook.setVideoEnabled(false)
    }

    OnStartObserving("onPasteImage") {
      HerdlingPasteHook.setEnabled(true)
    }

    OnStopObserving("onPasteImage") {
      HerdlingPasteHook.setEnabled(false)
    }

    OnStartObserving("onPasteVideo") {
      HerdlingPasteHook.setVideoEnabled(true)
    }

    OnStopObserving("onPasteVideo") {
      HerdlingPasteHook.setVideoEnabled(false)
    }

    /// A larger video is not copied: the event has `error: "too_large"` and the size.
    Function("setVideoMaxBytes") { (maxBytes: Double) in
      HerdlingPasteHook.setVideoMaxBytes(Int64(maxBytes))
    }
  }
}
