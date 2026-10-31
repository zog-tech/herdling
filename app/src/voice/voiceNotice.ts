import { create } from "zustand";

import { PHONE } from "@/device";

/** How long a voice notice stays on screen. */
export const NOTICE_MS = 5_000;

type VoiceNotice = { text?: string };

/** A short voice notice for the session screen. Not persisted. */
export const useVoiceNotice = create<VoiceNotice>()(() => ({}));

let hostFailShown = false;
let timer: ReturnType<typeof setTimeout> | undefined;

export const HOST_VOICE_FAILED = `Host voice command failed — using ${PHONE} voice`;

/** Shows the host voice failure notice once per app run. */
export function noticeHostVoiceFailed(): void {
  if (hostFailShown) return;
  hostFailShown = true;
  useVoiceNotice.setState({ text: HOST_VOICE_FAILED });
  clearTimeout(timer);
  timer = setTimeout(() => useVoiceNotice.setState({ text: undefined }), NOTICE_MS);
}

/** For tests. */
export function resetVoiceNotice(): void {
  hostFailShown = false;
  clearTimeout(timer);
  useVoiceNotice.setState({ text: undefined });
}
