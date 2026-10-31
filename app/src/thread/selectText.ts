import { create } from "zustand";

/** The text that the "Select text" screen shows. A row sets it, then opens the screen. */
export type SelectTextView = { title: string; text: string };

export const useSelectText = create<{ current?: SelectTextView }>(() => ({}));

export function openSelectText(v: SelectTextView): void {
  useSelectText.setState({ current: v });
  // Loaded on first use: the router module is large, and thread rows load this module.
  const { router } = require("expo-router") as typeof import("expo-router");
  router.push("/select-text" as never);
}
