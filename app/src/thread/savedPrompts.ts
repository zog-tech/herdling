/**
 * Saved prompts (quick replies): short texts that the composer shows as chips while the prompt box
 * is empty and has the focus. A tap puts the text in the box; a long press offers "Send now".
 * The list stays on the phone only. The functions here are the pure rules; the store persists the
 * list like the other settings.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { secureJSONStorage } from "@/secureStorage";

/** The list on a new install, and after "Restore the defaults". */
export const DEFAULT_PROMPTS: readonly string[] = ["Continue", "Yes, go ahead", "Run the tests", "Explain the change", "Commit and push"];
/** The most saved prompts. The phone keychain keeps small values only. */
export const SAVED_PROMPT_CAP = 20;
/** A longer text is cut to this length. */
export const SAVED_PROMPT_MAX_CHARS = 300;

/** The text as it is kept: trimmed and cut to the length limit. Null when it is empty. */
export function cleanPrompt(text: string): string | null {
  const t = text.trim().slice(0, SAVED_PROMPT_MAX_CHARS).trim();
  return t ? t : null;
}

/** The list with `text` at the end. A text that is already there, an empty text or a full list: no change. */
export function addPrompt(list: readonly string[], text: string, cap = SAVED_PROMPT_CAP): readonly string[] {
  const t = cleanPrompt(text);
  if (t === null || list.includes(t) || list.length >= cap) return list;
  return [...list, t];
}

/**
 * The list with the prompt at `index` changed to `text`. An empty text, a bad index, or a text that
 * another prompt already has: no change.
 */
export function editPrompt(list: readonly string[], index: number, text: string): readonly string[] {
  const t = cleanPrompt(text);
  if (t === null || index < 0 || index >= list.length || list[index] === t) return list;
  if (list.some((p, i) => i !== index && p === t)) return list;
  return list.map((p, i) => (i === index ? t : p));
}

/** The list without the prompt at `index`. */
export function removePrompt(list: readonly string[], index: number): readonly string[] {
  if (index < 0 || index >= list.length) return list;
  return list.filter((_, i) => i !== index);
}

/** The list with the prompt at `from` moved to `to`. An index out of range: no change. */
export function movePrompt(list: readonly string[], from: number, to: number): readonly string[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const out = [...list];
  const [p] = out.splice(from, 1);
  out.splice(to, 0, p);
  return out;
}

export type PromptAction = "edit" | "up" | "down" | "delete";

/** The menu of the prompt at `index` in Settings, in menu order. The first prompt has no "Move up". */
export function promptActions(index: number, count: number): PromptAction[] {
  return ["edit", ...(index > 0 ? ["up" as const] : []), ...(index < count - 1 ? ["down" as const] : []), "delete"];
}

export const PROMPT_ACTION_LABEL: Record<PromptAction, string> = { edit: "Edit", up: "Move up", down: "Move down", delete: "Delete" };

/** The chip text on one line: line ends show as spaces. */
export const promptChipLabel = (text: string) => text.replace(/\s*[\r\n]+\s*/g, " ");

type Store = { prompts: readonly string[] };

/** The saved prompts, persisted. A new install starts with the defaults. */
export const useSavedPrompts = create<Store>()(
  persist(() => ({ prompts: DEFAULT_PROMPTS }) as Store, { name: "herdling.saved_prompts", storage: secureJSONStorage() }),
);

function update(f: (list: readonly string[]) => readonly string[]): void {
  useSavedPrompts.setState((s) => {
    const next = f(s.prompts);
    return next === s.prompts ? s : { prompts: next };
  });
}

export const saveNewPrompt = (text: string) => update((l) => addPrompt(l, text));
export const changePrompt = (index: number, text: string) => update((l) => editPrompt(l, index, text));
export const deletePrompt = (index: number) => update((l) => removePrompt(l, index));
export const reorderPrompt = (from: number, to: number) => update((l) => movePrompt(l, from, to));
export const restoreDefaultPrompts = () => useSavedPrompts.setState({ prompts: DEFAULT_PROMPTS });
