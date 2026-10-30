import type { AgentStatus, ThreadItem } from "@zogssh/protocol";
import * as Speech from "expo-speech";
import { useEffect, useRef } from "react";

import { releaseAudio, setSpeechAudio } from "../../modules/voice";
import { useRecording } from "./recording";
import { replyToSpeak, shouldSpeak } from "./replyToSpeak";
import { useSpeakEnabled, useVoiceSettings } from "./settings";
import { speechText } from "./speechText";

/** The log can land a moment after the status flips; wait before reading the reply. */
const SETTLE_MS = 800;

const quiet = (p: Promise<unknown>) => void p.catch(() => {});

/** Speaks `text` with the saved voice and rate. Music ducks while it plays. */
async function speak(text: string): Promise<void> {
  const { voice, rate } = useVoiceSettings.getState();
  const release = () => quiet(releaseAudio());
  try {
    await setSpeechAudio();
  } catch {
    return; // The microphone is in use.
  }
  if (useRecording.getState().recording) return release();
  Speech.speak(text, { voice, rate, onDone: release, onStopped: release, onError: release });
}

const lastAssistantId = (items: ThreadItem[]) => [...items].reverse().find((i) => i.kind === "assistant")?.id;

/**
 * Full mode: speaks the agent's last reply when it goes working to idle or done.
 * `speakNow` (opened from a push) speaks the current reply once. A new prompt or leaving the screen stops speech.
 */
export function useSpeakReplies(
  hostId: string,
  paneId: string,
  status: AgentStatus | undefined,
  items: ThreadItem[],
  o?: { speakNow?: boolean },
): void {
  const enabled = useSpeakEnabled(hostId, paneId);
  const mode = useVoiceSettings((s) => s.mode);
  const recording = useRecording((s) => s.recording);
  const latest = useRef({ items, enabled, mode });
  latest.current = { items, enabled, mode };
  const prev = useRef<AgentStatus | undefined>(undefined);
  const spokenId = useRef<string | undefined>(undefined);
  const pushDone = useRef(false);
  const userCount = useRef<number | null>(null);

  const speakLatest = () => {
    const items = latest.current.items;
    const id = lastAssistantId(items);
    const reply = replyToSpeak(items);
    if (!reply || id === spokenId.current || useRecording.getState().recording) return false;
    const text = speechText(reply);
    if (!text) return false;
    spokenId.current = id;
    quiet(speak(text));
    return true;
  };

  // Recording stops speech.
  useEffect(() => {
    if (recording) quiet(Speech.stop());
  }, [recording]);

  // A new prompt stops speech. The first value is the baseline.
  useEffect(() => {
    const count = items.filter((i) => i.kind === "user").length;
    if (userCount.current !== null && count > userCount.current) quiet(Speech.stop());
    userCount.current = count;
  }, [items]);

  // Leaving the screen stops speech.
  useEffect(() => () => void quiet(Speech.stop()), []);

  // Working to idle or done: speak after the log settles.
  useEffect(() => {
    const before = prev.current;
    prev.current = status;
    if (!status || !shouldSpeak(before, status)) return;
    const timer = setTimeout(() => {
      const { enabled, mode } = latest.current;
      if (enabled && mode === "full") speakLatest();
    }, SETTLE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Opened from a push: speak the finished reply once, as soon as it is loaded.
  useEffect(() => {
    if (!o?.speakNow || pushDone.current || (status !== "idle" && status !== "done")) return;
    if (speakLatest()) pushDone.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o?.speakNow, status, items]);
}
