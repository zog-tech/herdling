import ExpoModulesCore

/// Paste an image into a multiline text input with the system edit menu.
/// The hook acts only while JS listens for "onPasteImage".
public class ZogPasteModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ZogPaste")

    Events("onPasteImage")

    OnCreate {
      ZogPasteHook.install { [weak self] base64, width, height in
        self?.sendEvent("onPasteImage", ["base64": base64, "width": width, "height": height])
      }
    }

    OnDestroy {
      ZogPasteHook.setEnabled(false)
    }

    OnStartObserving("onPasteImage") {
      ZogPasteHook.setEnabled(true)
    }

    OnStopObserving("onPasteImage") {
      ZogPasteHook.setEnabled(false)
    }
  }
}
