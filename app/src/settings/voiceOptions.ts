import type { PickerOption } from "@/ui/PickerSheet";
import { accentOf, voiceLabel, type ListedVoice } from "@/voice/voiceList";

/**
 * The rules of the Voice page: the options of the voice picker and the speed steps. Pure, so the
 * page stays thin and the rules have tests.
 */

/** The picker value of "System default". The store keeps `voice: undefined` for it. */
export const SYSTEM_VOICE = "";

export const RATE_STEP = 0.1;
export const RATE_MIN = 0.5;
export const RATE_MAX = 2;

/** A speed in range, rounded to one step (0.1). */
export function clampRate(r: number): number {
  return Math.round(Math.min(RATE_MAX, Math.max(RATE_MIN, r)) * 10) / 10;
}

/** "System default" first, then the device voices in their order. Enhanced voices say so. */
export function voiceOptions(voices: readonly ListedVoice[]): PickerOption<string>[] {
  return [
    { value: SYSTEM_VOICE, label: "System default" },
    ...voices.map((v) => {
      const accent = accentOf(v.language);
      return {
        value: v.identifier,
        label: voiceLabel(v),
        detail: v.quality === "Enhanced" ? "Enhanced" : undefined,
        keywords: [v.name, accent ? `${accent} English` : undefined, v.language].filter(Boolean).join(" "),
      };
    }),
  ];
}

/** The value text of the Voice row: the label of the stored voice, else "System default". */
export function voiceValue(voices: readonly ListedVoice[], voice: string | undefined): string {
  const current = voice ? voices.find((v) => v.identifier === voice) : undefined;
  return current ? voiceLabel(current) : "System default";
}
