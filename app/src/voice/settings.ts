import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { ParakeetModel } from "../../modules/voice/parakeet";
import { secureJSONStorage } from "@/secureStorage";

/** "iphone": the device's voices (expo-speech). "host": the host's `tts_command` through `tts.make`. */
export type VoiceEngine = "iphone" | "host";

/**
 * Voice input engine. "parakeet": on the device (FluidAudio). "host": the host's `stt_command`
 * through `stt.make`. "apple": live recognition on the device while recording.
 */
export type InputEngine = "parakeet" | "host" | "apple";

export type VoiceSettings = {
  ttsDefault: boolean;
  mode: "full" | "summary";
  engine: VoiceEngine;
  voice?: string;
  rate: number;
  /** Unset: Parakeet when its model is installed, else Apple. */
  input?: InputEngine;
  /** The Parakeet model to download and use. */
  parakeetModel: ParakeetModel;
  /** Let the model download use cellular data. Off: Wi-Fi only. */
  allowCellular: boolean;
};

type VoiceStore = VoiceSettings & { set: (patch: Partial<VoiceSettings>) => void };

const storage = secureJSONStorage();

/** Text-to-speech and voice input settings. Persisted. Speech is off until the user turns it on. */
export const useVoiceSettings = create<VoiceStore>()(
  persist(
    (set) => ({
      ttsDefault: false,
      mode: "full",
      engine: "iphone",
      voice: undefined,
      rate: 1.0,
      input: undefined,
      parakeetModel: "v2",
      allowCellular: false,
      set: (patch) => set(patch),
    }),
    {
      name: "herdling.voice_settings",
      storage,
      partialize: (s) => ({
        ttsDefault: s.ttsDefault,
        mode: s.mode,
        engine: s.engine,
        voice: s.voice,
        rate: s.rate,
        input: s.input,
        parakeetModel: s.parakeetModel,
        allowCellular: s.allowCellular,
      }),
    },
  ),
);

type SessionSpeak = { bySession: Record<string, boolean>; setSpeak: (key: string, on: boolean) => void };

/** Per-session speaker toggle, keyed `hostId:paneId`. Missing keys fall back to `ttsDefault`. Persisted. */
export const useSessionSpeak = create<SessionSpeak>()(
  persist(
    (set) => ({
      bySession: {},
      setSpeak: (key, on) => set((s) => ({ bySession: { ...s.bySession, [key]: on } })),
    }),
    { name: "herdling.session_speak", storage, partialize: (s) => ({ bySession: s.bySession }) },
  ),
);

export const sessionKey = (hostId: string, paneId: string) => `${hostId}:${paneId}`;

/** Whether this session speaks replies now. */
export function useSpeakEnabled(hostId: string, paneId: string): boolean {
  const def = useVoiceSettings((s) => s.ttsDefault);
  const own = useSessionSpeak((s) => s.bySession[sessionKey(hostId, paneId)]);
  return own ?? def;
}

/**
 * The engine that voice input uses now. Unset picks Parakeet when its model is installed, else
 * Apple. Parakeet without its model (or on a build without it) falls to Apple too.
 */
export function inputEngine(input: InputEngine | undefined, parakeetReady: boolean): InputEngine {
  if (input === "host" || input === "apple") return input;
  return parakeetReady ? "parakeet" : "apple";
}
