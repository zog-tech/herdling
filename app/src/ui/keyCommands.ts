/**
 * Connects hardware keyboard shortcuts to actions. A screen calls `useKeyCommand(id, handler)`.
 * Only shortcuts with a handler are active, so iPadOS lists only what works on the current screen.
 * When two handlers have the same id, the newest one runs (for example the session on top).
 * Builds without the native `keys` module do nothing.
 */
import { useEffect, useRef } from "react";

import { addKeyCommandListener, hasKeyCommands, setKeyCommands, type NativeKeyCommand } from "../../modules/keys";

import { shortcutsFor, type ShortcutId } from "./shortcuts";

type Entry = { id: string; run: () => void };

/** The handlers for each shortcut id. Pure: it does not touch the native module. */
export class KeyRegistry {
  private entries: Entry[] = [];
  private onChange: () => void;

  constructor(onChange: () => void = () => {}) {
    this.onChange = onChange;
  }

  /** Adds a handler for `id`. Returns a function that removes it. */
  add(id: string, run: () => void): () => void {
    const entry = { id, run };
    this.entries.push(entry);
    this.onChange();
    return () => {
      const at = this.entries.indexOf(entry);
      if (at < 0) return;
      this.entries.splice(at, 1);
      this.onChange();
    };
  }

  /** The ids that have at least one handler. */
  ids(): Set<string> {
    return new Set(this.entries.map((e) => e.id));
  }

  /** Runs the newest handler for `id`. Returns false when `id` has no handler. */
  dispatch(id: string): boolean {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].id === id) {
        this.entries[i].run();
        return true;
      }
    }
    return false;
  }
}

/** The native list for a set of active ids. */
export function nativeCommands(ids: Iterable<string>): NativeKeyCommand[] {
  return shortcutsFor(ids).map(({ id, input, modifiers, title }) => ({ id, input, modifiers, title }));
}

let syncQueued = false;
let lastSent = "";
const registry = new KeyRegistry(() => {
  // Many hooks mount in one render: send one list after them.
  if (syncQueued) return;
  syncQueued = true;
  queueMicrotask(() => {
    syncQueued = false;
    const list = nativeCommands(registry.ids());
    const key = list.map((c) => c.id).join(",");
    if (key === lastSent) return;
    lastSent = key;
    setKeyCommands(list);
  });
});

let stopListening: (() => void) | undefined;
function listen() {
  if (!stopListening) stopListening = addKeyCommandListener((id) => registry.dispatch(id));
}

/**
 * Runs `handler` when the user presses the shortcut `id` on a hardware keyboard, while `enabled`
 * is true. The newest handler always runs, so the handler can change on each render.
 */
export function useKeyCommand(id: ShortcutId, handler: () => void, { enabled = true }: { enabled?: boolean } = {}): void {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled || !hasKeyCommands) return;
    listen();
    return registry.add(id, () => ref.current());
  }, [id, enabled]);
}
