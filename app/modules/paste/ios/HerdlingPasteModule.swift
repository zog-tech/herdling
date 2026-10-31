import ExpoModulesCore

/// Paste an image into a multiline text input with the system edit menu.
/// The hook acts only while JS listens for "onPasteImage".
public class HerdlingPasteModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HerdlingPaste")

    Events("onPasteImage")

    OnCreate {
      HerdlingPasteHook.install { [weak self] base64, width, height in
        self?.sendEvent("onPasteImage", ["base64": base64, "width": width, "height": height])
      }
    }

    OnDestroy {
      HerdlingPasteHook.setEnabled(false)
    }

    OnStartObserving("onPasteImage") {
      HerdlingPasteHook.setEnabled(true)
    }

    OnStopObserving("onPasteImage") {
      HerdlingPasteHook.setEnabled(false)
    }
  }
}
