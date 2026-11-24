/**
 * The hardware keyboard shortcuts: one table for the keys, the titles in the iPadOS shortcut
 * list, and the tab routes. `useKeyCommand` (in `keyCommands.ts`) connects an id to an action.
 */
import type { KeyModifier, NativeKeyCommand } from "../../modules/keys";

export type ShortcutId =
  | "tab1"
  | "tab2"
  | "tab3"
  | "usage"
  | "automations"
  | "prevAgent"
  | "nextAgent"
  | "send"
  | "interrupt"
  | "toggleMode"
  | "newSession"
  | "refresh"
  | "find"
  | "escape";

export type Shortcut = NativeKeyCommand & { id: ShortcutId };

const cmd: KeyModifier[] = ["command"];
const cmdShift: KeyModifier[] = ["command", "shift"];

/** All shortcuts, in the order of the iPadOS shortcut list. */
export const SHORTCUTS: readonly Shortcut[] = [
  { id: "tab1", input: "1", modifiers: cmd, title: "Agents" },
  { id: "tab2", input: "2", modifiers: cmd, title: "Spaces" },
  { id: "tab3", input: "3", modifiers: cmd, title: "More" },
  { id: "usage", input: "u", modifiers: cmdShift, title: "Usage" },
  { id: "automations", input: "a", modifiers: cmdShift, title: "Automations" },
  { id: "prevAgent", input: "[", modifiers: cmd, title: "Previous Agent" },
  { id: "nextAgent", input: "]", modifiers: cmd, title: "Next Agent" },
  { id: "send", input: "enter", modifiers: cmd, title: "Send Prompt" },
  { id: "interrupt", input: ".", modifiers: cmd, title: "Send Ctrl-C" },
  { id: "toggleMode", input: "t", modifiers: cmd, title: "Thread or Terminal" },
  { id: "newSession", input: "n", modifiers: cmd, title: "New Session" },
  { id: "refresh", input: "r", modifiers: cmd, title: "Reconnect Offline Computers" },
  { id: "find", input: "f", modifiers: cmd, title: "Find" },
  { id: "escape", input: "escape", modifiers: [], title: "Send Esc" },
];

/**
 * The route of each app-wide shortcut: ⌘1 to ⌘3 for the three tabs (Agents, Spaces, More), and
 * ⌘⇧U and ⌘⇧A for Usage and Automations, which were tabs before and are now stack screens.
 */
export const TAB_ROUTES: Readonly<Record<"tab1" | "tab2" | "tab3" | "usage" | "automations", string>> = {
  tab1: "/",
  tab2: "/spaces",
  tab3: "/settings",
  usage: "/usage",
  automations: "/automations",
};

/** The shortcuts with these ids, in table order. Unknown ids are left out. */
export function shortcutsFor(ids: Iterable<string>): Shortcut[] {
  const wanted = new Set(ids);
  return SHORTCUTS.filter((s) => wanted.has(s.id));
}

const KEY_SIGN: Record<string, string> = { enter: "↩", escape: "Esc" };
const MOD_SIGN: Record<KeyModifier, string> = { control: "⌃", alternate: "⌥", shift: "⇧", command: "⌘" };
const MOD_ORDER: KeyModifier[] = ["control", "alternate", "shift", "command"];

/** The keys of a shortcut as Apple writes them, for example "⌘↩" or "⌘[". */
export function shortcutLabel(s: Pick<Shortcut, "input" | "modifiers">): string {
  const mods = MOD_ORDER.filter((m) => s.modifiers.includes(m)).map((m) => MOD_SIGN[m]).join("");
  return mods + (KEY_SIGN[s.input] ?? s.input.toUpperCase());
}
