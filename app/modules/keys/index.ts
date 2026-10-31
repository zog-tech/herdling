import { NativeModule, requireOptionalNativeModule } from "expo";

/** A modifier key of a shortcut. On Android, "command" matches Meta and also Ctrl. */
export type KeyModifier = "command" | "shift" | "alternate" | "control";

/**
 * One hardware keyboard shortcut. `input` is one character ("1", "[", "t") or a key name:
 * "enter" or "escape". `title` shows in the iPadOS shortcut list (hold ⌘).
 */
export type NativeKeyCommand = { id: string; input: string; modifiers: KeyModifier[]; title: string };

type KeysEvents = { onKeyCommand: (e: { id: string }) => void };

declare class KeysNativeModule extends NativeModule<KeysEvents> {
  setCommands(commands: NativeKeyCommand[]): Promise<void>;
}

// Builds before the iPad build do not have this module. An OTA update must not crash them.
const Keys = requireOptionalNativeModule<KeysNativeModule>("HerdlingKeys");

/** True when this build can get hardware keyboard shortcuts. False on older builds: shortcuts do nothing. */
export const hasKeyCommands = Keys != null;

/** Replaces the active shortcuts. Shortcuts that are not in the list do nothing. */
export function setKeyCommands(commands: NativeKeyCommand[]): void {
  void Keys?.setCommands(commands);
}

/** Calls `cb` with the id of each shortcut the user presses. Returns a function that stops it. */
export function addKeyCommandListener(cb: (id: string) => void): () => void {
  if (!Keys) return () => {};
  const sub = Keys.addListener("onKeyCommand", (e) => cb(e.id));
  return () => sub.remove();
}
