import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";

import * as Voice from "../../modules/voice";
import { holdReducer, IDLE, type HoldEffect, type HoldEvent, type HoldState } from "./holdToTalk";

const errorText = (e: unknown): string | undefined => {
  const code = (e as { code?: unknown })?.code;
  if (code === "cancelled" || code === "busy") return undefined;
  if (code === "denied") return "Microphone or speech access is off. Turn it on in Settings.";
  const message = (e as { message?: unknown })?.message;
  return typeof message === "string" && message ? message : String(e);
};

const haptic = (p: Promise<void>) => void p.catch(() => {});

/**
 * Runs the hold-to-talk reducer against the native voice module.
 * Native calls run one after another, so a quick release waits for the start to finish.
 */
export function useDictation({ onSend, onPartial }: { onSend: (text: string) => void; onPartial?: (text: string) => void }) {
  const [state, setState] = useState<HoldState>(IDLE);
  const [error, setError] = useState<string>();
  const current = useRef<HoldState>(IDLE);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const handlers = useRef({ onSend, onPartial });
  handlers.current = { onSend, onPartial };

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
      if (text) setError(text);
      dispatch({ type: "error" });
    },
    [dispatch],
  );

  function run(fx: HoldEffect) {
    if (typeof fx === "object") {
      handlers.current.onSend(fx.send);
      return;
    }
    switch (fx) {
      case "start":
        setError(undefined);
        enqueue(async () => {
          if ((await Voice.requestPermission()) !== "granted") throw Object.assign(new Error("denied"), { code: "denied" });
          await Voice.startDictation();
        }).catch(fail);
        return;
      case "stop":
        enqueue(Voice.stopDictation).then((text) => dispatch({ type: "final", text }), fail);
        return;
      case "cancel":
        enqueue(Voice.cancelDictation).catch(() => {});
        return;
      case "hapticStart":
        return haptic(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
      case "hapticSend":
        return haptic(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
      case "hapticCancel":
        return haptic(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
    }
  }

  useEffect(() => {
    const partial = Voice.addListener("onPartial", ({ text }) => dispatch({ type: "partial", text }));
    // The event is global: an idle button (another screen) must not show it.
    const failed = Voice.addListener("onDictationError", (e) => current.current.phase !== "idle" && fail(e));
    return () => {
      partial.remove();
      failed.remove();
      // Leaving the screen must not leave the microphone on. Queued, so it also runs after a start
      // that is still waiting (for example on the permission alert), whatever the phase is now.
      enqueue(Voice.cancelDictation).catch(() => {});
    };
  }, [dispatch, fail, enqueue]);

  useEffect(() => {
    handlers.current.onPartial?.(state.partial);
  }, [state.partial]);

  return { state, error, dispatch };
}
