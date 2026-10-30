import { File } from "expo-file-system";
import { useCallback, useEffect, useRef, useState } from "react";

import * as Voice from "../../modules/voice";
import { transcribeParakeet } from "../../modules/voice/parakeet";
import { holdReducer, IDLE, type HoldEffect, type HoldEvent, type HoldState } from "./holdToTalk";
import { parakeetReady, useParakeet } from "./parakeet";
import { useRecording } from "./recording";
import { inputEngine, useVoiceSettings, type InputEngine } from "./settings";
import { logSpeech } from "./speechLog";
import { ENGINE_NAME, TranscribeError, transcribeRecording, type Transcribers } from "./transcribe";
import * as haptics from "@/ui/haptics";

/** How long the caption with the engine name stays after the text lands. */
export const CAPTION_MS = 2_000;

const errorText = (e: unknown): string | undefined => {
  const code = (e as { code?: unknown })?.code;
  if (code === "cancelled" || code === "busy") return undefined;
  if (code === "denied") return "Microphone or speech access is off. Turn it on in Settings.";
  const message = (e as { message?: unknown })?.message;
  if (typeof message !== "string" || !message) return String(e);
  // Native errors come as "Calling the 'x' function has failed → Caused by: <cause>".
  const cause = message.split("Caused by: ").pop()!.trim();
  return cause || message;
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

/** Deletes a recording file. Never throws: the system clears the caches folder later. */
function deleteRecording(uri: string | undefined) {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // Left for the system to clear.
  }
}

/** The engine for a new recording, from the settings and the installed models. */
function currentEngine(): { engine: InputEngine; transcribers: Pick<Transcribers, "parakeet"> } {
  const { input, parakeetModel } = useVoiceSettings.getState();
  const ready = parakeetReady(useParakeet.getState(), parakeetModel);
  return {
    engine: inputEngine(input, ready),
    transcribers: { parakeet: ready ? (uri) => transcribeParakeet(uri, parakeetModel) : undefined },
  };
}

/**
 * Runs the voice input reducer against the native voice module.
 * Native calls run one after another, so a quick release waits for the start to finish.
 *
 * Builds with file recording: the microphone writes a WAV file, and after the stop an engine
 * turns it into text (Parakeet, the host, or the live Apple text). Older builds (build 5): live
 * Apple dictation only. The text goes to `onText`; it is never sent from here.
 * `hostStt`: the host's `stt.make` for a file, when the host has it.
 */
export function useDictation({
  onText,
  onPartial,
  hostStt,
}: {
  onText: (text: string) => void;
  onPartial?: (text: string) => void;
  hostStt?: (uri: string) => Promise<string>;
}) {
  const [state, setState] = useState<HoldState>(IDLE);
  const [error, setError] = useState<string>();
  /** The engine that made the last text, for a short caption. */
  const [caption, setCaption] = useState<string>();
  const current = useRef<HoldState>(IDLE);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const handlers = useRef({ onText, onPartial, hostStt });
  handlers.current = { onText, onPartial, hostStt };
  /** How the current run uses the microphone: a file recording or live dictation (older builds). */
  const mode = useRef<"record" | "dictate">(Voice.recordingAvailable() ? "record" : "dictate");
  /** The engine chosen when the recording started. */
  const engine = useRef<InputEngine>("apple");
  /** The recording that waits for text. Deleted when the text lands or on discard. */
  const pending = useRef<Voice.Recorded | undefined>(undefined);
  const alive = useRef(true);
  const captionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const enqueue = useCallback(<T>(call: () => Promise<T>): Promise<T> => {
    const p = queue.current.then(call);
    queue.current = p.catch(() => {});
    return p;
  }, []);

  const dispatch = useCallback(
    (e: HoldEvent) => {
      const { state: next, effects } = holdReducer(current.current, e);
      if (next !== current.current) {
        current.current = next;
        setState(next);
      }
      effects.forEach(run);
    },
    // `run` only uses refs and stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const fail = useCallback(
    (e: unknown) => {
      const text = errorText(e);
      if (text) {
        setError(text);
        logSpeech(`Voice input failed: ${text}`);
      }
      dispatch({ type: "error" });
    },
    [dispatch],
  );

  const showCaption = (name: string) => {
    clearTimeout(captionTimer.current);
    setCaption(name);
    captionTimer.current = setTimeout(() => setCaption(undefined), CAPTION_MS);
  };

  /** Turns the pending recording into text. On failure the file stays for a retry. */
  async function transcribe() {
    const rec = pending.current;
    if (!rec) return dispatch({ type: "final", text: "" });
    const { transcribers } = currentEngine();
    try {
      const r = await transcribeRecording(rec, engine.current, { ...transcribers, host: handlers.current.hostStt });
      logSpeech(
        `Voice input: ${ENGINE_NAME[r.engine]}, ${seconds(rec.durationMs)} audio` +
          (r.engine === "apple" ? " (live)" : `, ${seconds(r.ms)} to transcribe`),
      );
      pending.current = undefined;
      deleteRecording(rec.uri);
      if (!alive.current) return;
      if (r.text) showCaption(ENGINE_NAME[r.engine]);
      dispatch({ type: "final", text: r.text });
    } catch (e) {
      const text = e instanceof TranscribeError ? e.message : errorText(e) ?? "Transcription failed";
      logSpeech(`Voice input failed: ${text}`);
      if (!alive.current) {
        pending.current = undefined;
        deleteRecording(rec.uri);
        return;
      }
      setError(`Transcription failed. ${text}`);
      dispatch({ type: "failed" });
    }
  }

  function run(fx: HoldEffect) {
    if (typeof fx === "object") {
      handlers.current.onText(fx.text);
      return;
    }
    switch (fx) {
      case "start": {
        setError(undefined);
        mode.current = Voice.recordingAvailable() ? "record" : "dictate";
        const chosen = currentEngine().engine;
        engine.current = mode.current === "record" ? chosen : "apple";
        // Live recognition (and its permission) only for the Apple engine.
        const live = engine.current === "apple";
        enqueue(async () => {
          const allowed = live ? await Voice.requestPermission() : await Voice.requestMicPermission();
          if (allowed !== "granted") throw Object.assign(new Error("denied"), { code: "denied" });
          if (mode.current === "record") await Voice.startRecording({ live });
          else await Voice.startDictation();
        }).catch(fail);
        return;
      }
      case "stop":
        if (mode.current === "dictate") {
          enqueue(Voice.stopDictation).then((text) => {
            logSpeech("Voice input: Apple (live dictation)");
            dispatch({ type: "final", text });
          }, fail);
          return;
        }
        enqueue(Voice.stopRecording).then((rec) => {
          pending.current = rec;
          return transcribe();
        }, fail);
        return;
      case "retry":
        setError(undefined);
        void transcribe();
        return;
      case "discard":
        setError(undefined);
        deleteRecording(pending.current?.uri);
        pending.current = undefined;
        return;
      case "cancel":
        enqueue(mode.current === "record" ? Voice.cancelRecording : Voice.cancelDictation).catch(() => {});
        return;
      // Recording starts: medium. It stops: light. Cancelled: warning.
      case "hapticStart":
        return haptics.peek();
      case "hapticStop":
        return haptics.press();
      case "hapticCancel":
        return haptics.warn();
    }
  }

  useEffect(() => {
    alive.current = true;
    const partial = Voice.addListener("onPartial", ({ text }) => dispatch({ type: "partial", text }));
    // The events are global: an idle button (another screen) must not show them.
    const failed = Voice.addListener("onDictationError", (e) => {
      const p = current.current.phase;
      if (p === "recording" || p === "armedCancel") fail(e);
    });
    const halted = Voice.addListener("onRecordingHalted", ({ reason }) => {
      const p = current.current.phase;
      if (p !== "recording" && p !== "armedCancel") return;
      const why = reason === "limit" ? "it reached 10 minutes" : "the microphone was interrupted";
      logSpeech(`Voice input: recording stopped, ${why}`);
      setError(`Recording stopped: ${why}.`);
      dispatch({ type: "halted" });
    });
    return () => {
      alive.current = false;
      partial.remove();
      failed.remove();
      halted.remove();
      clearTimeout(captionTimer.current);
      // Leaving the screen must not leave the microphone on. Queued, so it also runs after a start
      // that is still waiting (for example on the permission alert), whatever the phase is now.
      enqueue(mode.current === "record" ? Voice.cancelRecording : Voice.cancelDictation).catch(() => {});
      if (current.current.phase === "failed") {
        deleteRecording(pending.current?.uri);
        pending.current = undefined;
      }
    };
  }, [dispatch, fail, enqueue]);

  // Speech waits for the microphone and stops when it starts. Only the instance that set the
  // global flag clears it, so a second mounted composer cannot clear another one's recording.
  const setFlag = useRef(false);
  const micOn = state.phase === "recording" || state.phase === "armedCancel" || state.phase === "finishing";
  useEffect(() => {
    if (micOn) {
      setFlag.current = true;
      useRecording.setState({ recording: true });
    } else if (setFlag.current) {
      setFlag.current = false;
      useRecording.setState({ recording: false });
    }
  }, [micOn]);
  useEffect(
    () => () => {
      if (setFlag.current) useRecording.setState({ recording: false });
    },
    [],
  );

  useEffect(() => {
    handlers.current.onPartial?.(state.partial);
  }, [state.partial]);

  return { state, error, caption, dispatch, clearError: () => setError(undefined) };
}

export type Dictation = ReturnType<typeof useDictation>;
