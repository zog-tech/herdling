import type { AgentStatus, ThreadItem, TtsAudio } from "@zogssh/protocol";
import * as Speech from "expo-speech";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { create } from "zustand";

import { localSummaryAvailable, releaseAudio, setSpeechAudio, summarizeLocal } from "../../modules/voice";
import { getHostConn } from "../hosts/connection";
import type { RpcClient } from "../rpc/RpcClient";
import { hostAudio, stopHostAudio } from "./hostAudio";
import { speakWithHost } from "./hostVoice";
import { useRecording } from "./recording";
import { replyToSpeak, shouldSpeak } from "./replyToSpeak";
import { useSpeakEnabled, useVoiceSettings } from "./settings";
import { splitSentences } from "./sentences";
import { logSpeech } from "./speechLog";
import { speechText } from "./speechText";
import { speakableReply, SUMMARY_INSTRUCTIONS } from "./summarize";
import { noticeHostVoiceFailed } from "./voiceNotice";
import * as haptics from "@/ui/haptics";

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

/** The reply that a play button speaks now. `owner` is the epoch of that speak. */
export const useManualSpeech = create<{ key?: string; owner: number }>()(() => ({ key: undefined, owner: -1 }));

function stopSpeech() {
  epoch++;
  quiet(Speech.stop());
  stopHostAudio();
  useManualSpeech.setState({ key: undefined, owner: -1 });
}

const local = {
  available: localSummaryAvailable,
  summarize: (t: string) => summarizeLocal(t, SUMMARY_INSTRUCTIONS),
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The saved voice id, or undefined (system default) when the device no longer has that voice. */
async function usableVoice(voice: string | undefined): Promise<string | undefined> {
  if (!voice) return undefined;
  try {
    const all = await Speech.getAvailableVoicesAsync();
    if (Array.isArray(all) && all.length > 0 && !all.some((v) => v.identifier === voice)) {
      logSpeech("saved voice missing, using default");
      return undefined;
    }
  } catch {
    // The list is not known; keep the saved voice.
  }
  return voice;
}

/**
 * Speaks `text` with the saved engine, voice and rate. Music ducks while it plays.
 * `mine` is the epoch the speak began in; a stop since then drops it.
 * The host engine speaks sentence by sentence through `tts.make`; a failure speaks the rest
 * with the iPhone voice and shows a one-time notice. Without a connection it uses the iPhone voice.
 * `onEnd` runs once when the speak ends for any reason. Every outcome goes to the speech log.
 */
async function speak(text: string, mine: number, rpc: Pick<RpcClient, "call"> | undefined, onEnd?: () => void): Promise<void> {
  const { voice, rate, engine } = useVoiceSettings.getState();
  let handedOff = false;
  const release = () => {
    if (audioOwner !== mine) return;
    audioOwner = -1;
    quiet(releaseAudio());
  };
  const stale = () => mine !== epoch || useRecording.getState().recording;
  try {
    if (mine !== epoch) return;
    try {
      await setSpeechAudio();
    } catch (e) {
      // The native module rejects with code "busy" while dictation holds the audio session.
      logSpeech((e as { code?: unknown })?.code === "busy" ? "audio session busy (microphone)" : `audio session error: ${message(e)}`);
      return;
    }
    audioOwner = mine;
    if (stale()) return release();
    let rest = text;
    if (engine === "host" && rpc) {
      const sentences = splitSentences(text);
      const tts = (t: string) => rpc.call<TtsAudio>("tts.make", { text: t }, TTS_TIMEOUT_MS);
      logSpeech(`speaking (host, ${text.length} chars, voice host command)`);
      const r = await speakWithHost(sentences, { tts, ...hostAudio(rate) }, stale);
      if (r.status !== "failed" || stale()) {
        logSpeech(stale() ? "stopped" : "done");
        return release();
      }
      logSpeech("error: host voice failed, using iPhone voice");
      noticeHostVoiceFailed();
      rest = sentences.slice(r.at).join(" ");
    }
    const use = await usableVoice(voice);
    if (stale()) return release();
    logSpeech(`speaking (iphone, ${rest.length} chars, voice ${use ?? "default"})`);
    const end = (what: string) => () => {
      logSpeech(what);
      release();
      onEnd?.();
    };
    handedOff = true;
    Speech.speak(rest, {
      voice: use,
      rate,
      onDone: end("done"),
      onStopped: end("stopped"),
      onError: (e: unknown) => end(`error: ${message(e)}`)(),
    });
  } finally {
    if (!handedOff) onEnd?.();
  }
}

/**
 * Speaks one reply now, from a play button. It uses the same path as auto-speak (summary mode,
 * engine, voice, rate) and ignores the session speaker toggle. The same `key` again while it
 * speaks stops it. Any other speech stops first.
 */
export async function speakReplyNow(hostId: string, markdown: string, key: string = markdown): Promise<void> {
  if (useManualSpeech.getState().key === key) return stopSpeech();
  stopSpeech();
  const mine = epoch;
  useManualSpeech.setState({ key, owner: mine });
  const clear = () => {
    if (useManualSpeech.getState().owner === mine) useManualSpeech.setState({ key: undefined, owner: -1 });
  };
  try {
    const { mode } = useVoiceSettings.getState();
    const rpc = getHostConn(hostId).rpc;
    const { text, source } = await speakableReply(markdown, mode, { local, rpc });
    if (mine !== epoch) return clear();
    if (mode === "summary") logSpeech(`summary: ${source}`);
    if (!text) {
      logSpeech("skipped: no reply");
      return clear();
    }
    await speak(text, mine, rpc, clear);
  } catch (e) {
    logSpeech(`error: ${message(e)}`);
    clear();
  }
}

/** Speaks the Settings test phrase through `speak()`, with no summary step. */
export async function testVoice(hostId?: string): Promise<void> {
  stopSpeech();
  logSpeech("test voice");
  await speak("Voice output works.", epoch, hostId ? getHostConn(hostId).rpc : undefined);
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
  /** A speak waits for the summary or the audio session. */
  const speakPending = useRef(false);
  /** The settle delay runs. */
  const settling = useRef(false);

  // iOS pauses JS in the background, so a pending speak cannot run there. Log it.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active" && (speakPending.current || settling.current)) {
        logSpeech(`app went to background while a speak is pending (iOS pauses JS; it cannot speak in the background)`);
      }
    });
    return () => sub.remove();
  }, []);

  const endPush = () => {
    pushPending.current = false;
    clearTimeout(giveUp.current);
  };

  const settleThenSpeak = () => {
    clearTimeout(timer.current);
    settling.current = true;
    timer.current = setTimeout(() => {
      settling.current = false;
      const { items, enabled, focused } = latest.current;
      const skip = (why: string) => logSpeech(`skipped: ${why}`);
      if (!focused) return skip("not focused");
      const reply = replyToSpeak(items);
      const id = lastAssistantId(items);
      if (!reply && pushPending.current) return; // The items effect re-arms when they load.
      endPush();
      if (!enabled) return skip("speaker off");
      if (AppState.currentState === "background" || AppState.currentState === "inactive") return skip("app not active");
      if (!reply) return skip("no reply");
      if (id === spokenId.current) return skip("same reply");
      if (useRecording.getState().recording) return skip("recording");
      if (!speechText(reply)) return skip("no reply");
      spokenId.current = id;
      const mine = epoch;
      const { mode } = useVoiceSettings.getState();
      speakPending.current = true;
      const done = () => {
        speakPending.current = false;
      };
      quiet(
        speakableReply(reply, mode, { local, rpc: getHostConn(hostId).rpc })
          .then(({ text, source }) => {
            if (mode === "summary") logSpeech(`summary: ${source}`);
            if (text) return speak(text, mine, getHostConn(hostId).rpc);
            logSpeech("skipped: no reply");
          })
          .finally(done),
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
    settling.current = false;
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
      settling.current = false;
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
    if (before !== undefined && status !== undefined && before !== status && latest.current.focused) haptics.status({ from: before, to: status });
    if (status === "working") {
      clearTimeout(timer.current);
      settling.current = false;
    }
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
