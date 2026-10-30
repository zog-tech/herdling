import { create } from "zustand";

/** True while hold-to-talk uses the microphone. Speech waits for it and stops when it starts. */
export const useRecording = create<{ recording: boolean }>(() => ({ recording: false }));
