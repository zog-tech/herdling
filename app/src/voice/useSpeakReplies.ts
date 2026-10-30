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

/** A push open waits this long for the thread to load a reply. */
const PUSH_WAIT_MS = 10_000;

const quiet = (p: Promise<unknown>) => void p.catch(() => {});

/** Bumped by every stop, so a speak that waits for the audio session can see it was cancelled. */
let epoch = 0;

function stopSpeech() {
  epoch++;
  quiet(Speech.stop());
}

/** Speaks `text` with the saved voice and rate. Music ducks while it plays. */
async function speak(text: string): Promise<void> {
  const { voice, rate } = useVoiceSettings.getState();
  const release = () => quiet(releaseAudio());
  const mine = epoch;
  try {
    await setSpeechAudio();
  } catch {
    return; // The microphone is in use.
  }
  if (mine !== epoch || useRecording.getState().recording) return release();
  Speech.speak(text, { voice, rate, onDone: release, onStopped: release, onError: release });
}

const lastAssistantId = (items: ThreadItem[]) => [...items].reverse().find((i) => i.kind === "assistant")?.id;
const finished = (s: AgentStatus | undefined) => s === "idle" || s === "done";

/**
 * Speaks the agent's last reply when it goes working to idle or done (summary mode falls back to full for now).
 * `speakNow` (opened from a push) speaks the reply once: at once if the agent is finished, else when it finishes.
 * Both go through one settle delay and dedupe by the last assistant item.
 * Turning the speaker off, a new prompt, recording or leaving the screen stops speech.
 */
export function useSpeakReplies(
  hostId: string,
  paneId: string,
  status: AgentStatus | undefined,
  items: ThreadItem[],
  o?: { speakNow?: boolean },
): void {
  const enabled = useSpeakEnabled(hostId, paneId);
  const recording = useRecording((s) => s.recording);
  const latest = useRef({ items, enabled });
  latest.current = { items, enabled };
  const prev = useRef<AgentStatus | undefined>(undefined);
  const spokenId = useRef<string | undefined>(undefined);
  const pushDone = useRef(false);
  const userCount = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** A push open still waits for a reply to exist. */
  const pushPending = useRef(false);
  const giveUp = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const endPush = () => {
    pushPending.current = false;
    clearTimeout(giveUp.current);
  };

  const settleThenSpeak = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const { items, enabled } = latest.current;
      const reply = replyToSpeak(items);
      const id = lastAssistantId(items);
      if (!reply && pushPending.current) return; // The items effect re-arms when they load.
      endPush();
      if (!enabled || !reply || id === spokenId.current || useRecording.getState().recording) return;
      const text = speechText(reply);
      if (!text) return;
      spokenId.current = id;
      quiet(speak(text));
    }, SETTLE_MS);
  };

  // A push open waits for the thread to load.
  useEffect(() => {
    if (pushPending.current && replyToSpeak(items)) settleThenSpeak();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // Recording stops speech.
  useEffect(() => {
    if (recording) stopSpeech();
  }, [recording]);

  // The speaker turned off.
  useEffect(() => {
    if (!enabled) stopSpeech();
  }, [enabled]);

  // A new prompt stops speech. The first value is the baseline.
  useEffect(() => {
    const count = items.filter((i) => i.kind === "user").length;
    if (userCount.current !== null && count > userCount.current) stopSpeech();
    userCount.current = count;
  }, [items]);

  // Leaving the screen stops speech and drops a pending speak.
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      clearTimeout(giveUp.current);
      stopSpeech();
    },
    [],
  );

  // Working to idle or done, or a push open on a finished agent: one path.
  useEffect(() => {
    const before = prev.current;
    prev.current = status;
    if (status === "working") clearTimeout(timer.current);
    if (!status) return;
    const fromPush = !!o?.speakNow && !pushDone.current && finished(status);
    if (shouldSpeak(before, status) || fromPush) {
      if (fromPush) {
        pushDone.current = true;
        pushPending.current = true;
        clearTimeout(giveUp.current);
        giveUp.current = setTimeout(endPush, PUSH_WAIT_MS);
      } else if (finished(status) && o?.speakNow) pushDone.current = true;
      settleThenSpeak();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, o?.speakNow]);
}
