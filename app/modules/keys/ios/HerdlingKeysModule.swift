import ExpoModulesCore
import UIKit

/// Hardware keyboard shortcuts for iPad (and iPhone with a keyboard).
///
/// JS sends the active shortcuts with `setCommands`. The module adds them as `UIKeyCommand`s to the
/// root view controller of the key window. Each responder chain ends there (a presented screen
/// passes to the screen that presented it), so the shortcuts also work while a text input has the
/// focus. iPadOS shows the titles in the shortcut list when the user holds ⌘.
public class HerdlingKeysModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HerdlingKeys")

    Events("onKeyCommand")

    OnCreate {
      HerdlingKeyCenter.shared.onPress = { [weak self] id in
        self?.sendEvent("onKeyCommand", ["id": id])
      }
    }

    OnDestroy {
      DispatchQueue.main.async {
        HerdlingKeyCenter.shared.onPress = nil
        HerdlingKeyCenter.shared.clear()
      }
    }

    AsyncFunction("setCommands") { (commands: [[String: Any]]) in
      HerdlingKeyCenter.shared.set(commands)
    }.runOnQueue(.main)
  }
}

/// Keeps the installed key commands, so that the next `set` can remove them. Main thread only.
final class HerdlingKeyCenter {
  static let shared = HerdlingKeyCenter()

  var onPress: ((String) -> Void)?
  private var installed: [UIKeyCommand] = []
  private weak var host: UIViewController?

  func clear() {
    if let host = host {
      installed.forEach { host.removeKeyCommand($0) }
    }
    installed = []
    host = nil
  }

  func set(_ commands: [[String: Any]]) {
    clear()
    guard let root = Self.rootViewController() else { return }
    for item in commands {
      guard let id = item["id"] as? String,
            let input = item["input"] as? String,
            let key = Self.keyInput(input) else { continue }
      let title = item["title"] as? String ?? ""
      let modifiers = item["modifiers"] as? [String] ?? []
      let command = UIKeyCommand(
        title: title,
        image: nil,
        action: #selector(UIViewController.herdlingKeyCommand(_:)),
        input: key,
        modifierFlags: Self.flags(modifiers),
        propertyList: id
      )
      // A text input must not take ⌘↩ or ⌘. before the app sees it.
      command.wantsPriorityOverSystemBehavior = true
      root.addKeyCommand(command)
      installed.append(command)
    }
    host = root
  }

  private static func keyInput(_ input: String) -> String? {
    switch input {
    case "enter": return "\r"
    case "escape": return UIKeyCommand.inputEscape
    default: return input.count == 1 ? input : nil
    }
  }

  private static func flags(_ names: [String]) -> UIKeyModifierFlags {
    var flags: UIKeyModifierFlags = []
    for name in names {
      switch name {
      case "command": flags.insert(.command)
      case "shift": flags.insert(.shift)
      case "alternate": flags.insert(.alternate)
      case "control": flags.insert(.control)
      default: break
      }
    }
    return flags
  }

  private static func rootViewController() -> UIViewController? {
    let windows = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
    return (windows.first { $0.isKeyWindow } ?? windows.first)?.rootViewController
  }
}

extension UIViewController {
  /// The action of every Herdling key command. Any view controller in the responder chain can
  /// take it; the command carries its id in `propertyList`.
  @objc func herdlingKeyCommand(_ sender: UIKeyCommand) {
    guard let id = sender.propertyList as? String else { return }
    HerdlingKeyCenter.shared.onPress?(id)
  }
}
