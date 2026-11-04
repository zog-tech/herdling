import { create } from "zustand";
import { persist } from "zustand/middleware";

import { secureJSONStorage } from "@/secureStorage";

import { buildArgs, cleanChoice, type StartChoice } from "./startOptions";

type Store = { byKind: Record<string, StartChoice> };

/** The last start options per agent kind, persisted. New session opens with them. */
export const useStartOptionsMemory = create<Store>()(
  persist(() => ({ byKind: {} }) as Store, { name: "herdling.start_options", storage: secureJSONStorage() }),
);

/** The options to preselect for `kind`. Data that an older or newer app stored is cleaned (see `cleanChoice`). */
export function choiceFor(byKind: Record<string, unknown>, kind: string): StartChoice {
  return cleanChoice(kind, byKind[kind]);
}

export function rememberChoice(kind: string, choice: StartChoice): void {
  useStartOptionsMemory.setState((s) => ({ byKind: { ...s.byKind, [kind]: cleanChoice(kind, choice) } }));
}

/** The agent arguments of the remembered options of `kind` (for a restart). */
export function rememberedArgs(kind: string | null | undefined): string[] {
  return kind ? buildArgs(kind, choiceFor(useStartOptionsMemory.getState().byKind, kind)) : [];
}
