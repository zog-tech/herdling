import type { AgentStatus, ThreadItem, TtsAudio } from "@zogssh/protocol";
import * as Haptics from "expo-haptics";
import * as Speech from "expo-speech";
import { useEffect, useRef } from "react";

import { localSummaryAvailable, releaseAudio, setSpeechAudio, summarizeLocal } from "../../modules/voice";
import { getHostConn } from "../hosts/connection";
import type { RpcClient } from "../rpc/RpcClient";
import { hostAudio, stopHostAudio } from "./hostAudio";
import { speakWithHost } from "./hostVoice";
import { useRecording } from "./recording";
import { replyToSpeak, shouldSpeak } from "./replyToSpeak";
import { useSpeakEnabled, useVoiceSettings } from "./settings";
import { splitSentences } from "./sentences";
import { speechText } from "./speechText";
import { speakableReply, SUMMARY_INSTRUCTIONS } from "./summarize";
import { noticeHostVoiceFailed } from "./voiceNotice";

/** The log can land a moment after the status flips; wait before reading the reply. */
const SETTLE_MS = 800;

/** A push open waits this long for the thread to load a reply. */
const PUSH_WAIT_MS = 10_000;

/** The companion gives a TTS command 30 s; wait a little longer. */
export const TTS_TIMEOUT_MS = 35_000;

const quiet = (p: Promise<unknown>) => void p.catch(() => {});

/** Bumped by every stop, so a speak that waits for the audio session can see it was cancelled. */
let epoch = 0;
/** The epoch of the speak that holds the speech audio session. An older speak never releases it. */
let audioOwner = -1;

function stopSpeech() {
  epoch++;
  quiet(Speech.stop());
  stopHostAudio();
}

const local = {
  available: localSummaryAvailable,
  summarize: (t: string) => summarizeLocal(t, SUMMARY_INSTRUCTIONS),
};

/**
 * Speaks `text` with the saved engine, voice and rate. Music ducks while it plays.
 * `mine` is the epoch the speak began in; a stop since then drops it.
 * The host engine speaks sentence by sentence through `tts.make`; a failure speaks the rest
 * with the iPhone voice and shows a one-time notice. Without a connection it uses the iPhone voice.
 */
async function speak(text: string, mine: number, rpc: Pick<RpcClient, "call"> | undefined): Promise<void> {
  const { voice, rate, engine } = useVoiceSettings.getState();
  const release = () => {
    if (audioOwner !== mine) return;
    audioOwner = -1;
    quiet(releaseAudio());
  };
  const stale = () => mine !== epoch || useRecording.getState().recording;
  if (mine !== epoch) return;
  try {
    await setSpeechAudio();
  } catch {
    return; // The microphone is in use.
  }
  audioOwner = mine;
  if (stale()) return release();
  let rest = text;
  if (engine === "host" && rpc) {
    const sentences = splitSentences(text);
    const tts = (t: string) => rpc.call<TtsAudio>("tts.make", { text: t }, TTS_TIMEOUT_MS);
    const r = await speakWithHost(sentences, { tts, ...hostAudio(rate) }, stale);
    if (r.status !== "failed" || stale()) return release();
    noticeHostVoiceFailed();
    rest = sentences.slice(r.at).join(" ");
  }
  Speech.speak(rest, { voice, rate, onDone: release, onStopped: release, onError: release });
}

const lastAssistantId = (items: ThreadItem[]) => [...items].reverse().find((i) => i.kind === "assistant")?.id;
const finished = (s: AgentStatus | undefined) => s === "idle" || s === "done";

/**
 * Speaks the agent's last reply when it goes working to idle or done. Summary mode speaks a short
 * summary (on-device model, else the host summary command, else the full text).
 * `speakNow` (opened from a push) speaks the reply once: at once if the agent is finished, else when it finishes.
 * Both go through one settle delay and dedupe by the last assistant item.
 * A light haptic marks each real status change (not the first value).
 * The voice engine (iPhone voices or the host voice command) comes from the voice settings.
 * Turning the speaker off, a new prompt, recording or leaving the screen stops speech.
 * Only the focused screen speaks: `focused: false` (a session under another screen) stops speech
 * and speaks nothing, so two mounted screens never speak the same reply twice.
 */
export function useSpeakReplies(
  hostId: string,
  paneId: string,
  status: AgentStatus | undefined,
  items: ThreadItem[],
  o?: { speakNow?: boolean; focused?: boolean },
): void {
  const enabled = useSpeakEnabled(hostId, paneId);
  const focused = o?.focused ?? true;
  const recording = useRecording((s) => s.recording);
  const latest = useRef({ items, enabled, focused });
  latest.current = { items, enabled, focused };
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
      const { items, enabled, focused } = latest.current;
      if (!focused) return;
      const reply = replyToSpeak(items);
      const id = lastAssistantId(items);
      if (!reply && pushPending.current) return; // The items effect re-arms when they load.
      endPush();
      if (!enabled || !reply || id === spokenId.current || useRecording.getState().recording) return;
      if (!speechText(reply)) return;
      spokenId.current = id;
      const mine = epoch;
      const { mode } = useVoiceSettings.getState();
      quiet(
        speakableReply(reply, mode, { local, rpc: getHostConn(hostId).rpc }).then(({ text }) => {
          if (text) return speak(text, mine, getHostConn(hostId).rpc);
        }),
      );
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

  // The speaker turned off stops speech. Turned on while the agent is finished, it speaks the last reply.
  const wasEnabled = useRef(enabled);
  useEffect(() => {
    const before = wasEnabled.current;
    wasEnabled.current = enabled;
    if (!enabled) stopSpeech();
    else if (!before && finished(status)) {
      spokenId.current = undefined;
      settleThenSpeak();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Another screen covers this one: stop speech and drop a pending speak.
  useEffect(() => {
    if (focused) return;
    clearTimeout(timer.current);
    endPush();
    stopSpeech();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);

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
    // A real change of the open session's status; the first value is the baseline.
    if (before !== undefined && status !== undefined && before !== status && latest.current.focused) quiet(Haptics.selectionAsync());
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
