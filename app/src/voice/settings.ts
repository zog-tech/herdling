import { create } from "zustand";
import { persist } from "zustand/middleware";

import { secureJSONStorage } from "@/secureStorage";

/** "iphone": the device's voices (expo-speech). "host": the host's `tts_command` through `tts.make`. */
export type VoiceEngine = "iphone" | "host";

export type VoiceSettings = { ttsDefault: boolean; mode: "full" | "summary"; engine: VoiceEngine; voice?: string; rate: number };

type VoiceStore = VoiceSettings & { set: (patch: Partial<VoiceSettings>) => void };

const storage = secureJSONStorage();

/** Text-to-speech settings. Persisted. Speech is off until the user turns it on. */
export const useVoiceSettings = create<VoiceStore>()(
  persist(
    (set) => ({
      ttsDefault: false,
      mode: "full",
      engine: "iphone",
      voice: undefined,
      rate: 1.0,
      set: (patch) => set(patch),
    }),
    {
      name: "zogssh.voice_settings",
      storage,
      partialize: (s) => ({ ttsDefault: s.ttsDefault, mode: s.mode, engine: s.engine, voice: s.voice, rate: s.rate }),
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
    { name: "zogssh.session_speak", storage, partialize: (s) => ({ bySession: s.bySession }) },
  ),
);

export const sessionKey = (hostId: string, paneId: string) => `${hostId}:${paneId}`;

/** Whether this session speaks replies now. */
export function useSpeakEnabled(hostId: string, paneId: string): boolean {
  const def = useVoiceSettings((s) => s.ttsDefault);
  const own = useSessionSpeak((s) => s.bySession[sessionKey(hostId, paneId)]);
  return own ?? def;
}
