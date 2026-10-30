import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useDictation } from "./useDictation";

/** Order of native calls, so tests can check what reached the mic and when. */
const calls: string[] = [];
let releasePermission: (v: "granted" | "denied") => void = () => {};
const listeners: Record<string, ((e: any) => void)[]> = {};

jest.mock("../../modules/voice", () => ({
  requestPermission: () => {
    calls.push("requestPermission");
    return new Promise((resolve) => {
      releasePermission = resolve;
    });
  },
  startDictation: async () => {
    calls.push("start");
  },
  stopDictation: async () => {
    calls.push("stop");
    return "";
  },
  cancelDictation: async () => {
    calls.push("cancel");
  },
  addListener: (event: string, fn: (e: any) => void) => {
    (listeners[event] ??= []).push(fn);
    return { remove: () => (listeners[event] = listeners[event].filter((f) => f !== fn)) };
  },
}));
jest.mock("expo-haptics", () => ({
  impactAsync: async () => {},
  notificationAsync: async () => {},
  ImpactFeedbackStyle: { Medium: "medium" },
  NotificationFeedbackType: { Success: "success", Warning: "warning" },
}));

type Api = ReturnType<typeof useDictation>;

function mount(onSend = jest.fn()) {
  const api: { current?: Api } = {};
  function Probe() {
    api.current = useDictation({ onSend });
    return null;
  }
  let root!: ReactTestRenderer;
  act(() => {
    root = create(<Probe />);
  });
  return { api, root };
}

const flush = () => act(async () => {});

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(listeners)) delete listeners[k];
});

test("unmount_during_permission_request_turns_mic_off_after_start", async () => {
  const { api, root } = mount();
  act(() => api.current!.dispatch({ type: "press" }));
  await flush();
  expect(calls).toEqual(["requestPermission"]);
  // The screen goes away while the permission alert is still up, then the user allows.
  act(() => root.unmount());
  releasePermission("granted");
  await flush();
  expect(calls).toEqual(["requestPermission", "start", "cancel"]);
});

test("unmount_when_idle_cancels_harmlessly", async () => {
  const { root } = mount();
  act(() => root.unmount());
  await flush();
  expect(calls).toEqual(["cancel"]);
});

test("error_event_ignored_when_idle", async () => {
  const { api } = mount();
  act(() => listeners.onDictationError.forEach((f) => f({ code: "recognition_failed", message: "boom" })));
  await flush();
  expect(api.current!.error).toBeUndefined();
  expect(calls).toEqual([]);
});

test("error_event_while_recording_cancels_and_shows_message", async () => {
  const onSend = jest.fn();
  const { api } = mount(onSend);
  act(() => api.current!.dispatch({ type: "press" }));
  await flush();
  releasePermission("granted");
  await flush();
  act(() => listeners.onDictationError.forEach((f) => f({ code: "recognition_failed", message: "boom" })));
  await flush();
  expect(api.current!.error).toBe("boom");
  expect(api.current!.state.phase).toBe("idle");
  expect(calls).toEqual(["requestPermission", "start", "cancel"]);
  expect(onSend).not.toHaveBeenCalled();
});
