import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useDictation } from "./useDictation";

/** Order of native calls, so tests can check what reached the mic and when. */
const calls: string[] = [];
let releasePermission: (v: "granted" | "denied") => void = () => {};
const listeners: Record<string, ((e: any) => void)[]> = {};

/** False: an older build (live dictation only). True: file recording. */
let mockRecording = false;
let mockStopResult: any = { uri: "file:///cache/rec.wav", durationMs: 4200 };
const mockDeleted: string[] = [];

jest.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    constructor(mockUri: string) {
      this.uri = mockUri;
    }
    get exists() {
      return true;
    }
    delete() {
      mockDeleted.push(this.uri);
    }
  },
}));
jest.mock("../../modules/voice/parakeet", () => ({
  parakeetAvailable: () => false,
  transcribeParakeet: async () => "",
  addParakeetListener: () => ({ remove() {} }),
}));
jest.mock("../../modules/voice", () => ({
  recordingAvailable: () => mockRecording,
  requestMicPermission: async () => {
    calls.push("requestMicPermission");
    return "granted";
  },
  startRecording: async (o: { live: boolean }) => {
    calls.push(o.live ? "startRecording:live" : "startRecording");
  },
  stopRecording: async () => {
    calls.push("stopRecording");
    return mockStopResult;
  },
  cancelRecording: async () => {
    calls.push("cancelRecording");
  },
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
jest.mock("@/ui/haptics", () => ({ peek: jest.fn(), press: jest.fn(), warn: jest.fn() }));
jest.mock("@/secureStorage", () => ({
  secureJSONStorage: () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }),
}));

type Api = ReturnType<typeof useDictation>;
const roots: ReactTestRenderer[] = [];

afterEach(async () => {
  // Unmount what a test left, so no caption timer fires after it.
  for (const r of roots.splice(0)) {
    try {
      act(() => r.unmount());
    } catch {
      // Already unmounted by the test.
    }
  }
  await act(async () => {});
});

function mount(onText = jest.fn(), hostStt?: (uri: string) => Promise<string>) {
  const api: { current?: Api } = {};
  function Probe() {
    api.current = useDictation({ onText, hostStt });
    return null;
  }
  let root!: ReactTestRenderer;
  act(() => {
    root = create(<Probe />);
  });
  roots.push(root);
  return { api, root };
}

const flush = () => act(async () => {});

beforeEach(() => {
  mockRecording = false;
  mockStopResult = { uri: "file:///cache/rec.wav", durationMs: 4200 };
  mockDeleted.length = 0;
  require("./settings").useVoiceSettings.setState({ input: undefined });
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
  const onText = jest.fn();
  const { api } = mount(onText);
  act(() => api.current!.dispatch({ type: "press" }));
  await flush();
  releasePermission("granted");
  await flush();
  act(() => listeners.onDictationError.forEach((f) => f({ code: "recognition_failed", message: "boom" })));
  await flush();
  expect(api.current!.error).toBe("boom");
  expect(api.current!.state.phase).toBe("idle");
  expect(calls).toEqual(["requestPermission", "start", "cancel"]);
  expect(onText).not.toHaveBeenCalled();
});

test("second_instance_does_not_clear_another_ones_recording_flag", async () => {
  const { useRecording } = require("./recording") as typeof import("./recording");
  useRecording.setState({ recording: false });
  const a = mount();
  act(() => a.api.current!.dispatch({ type: "press" }));
  await flush();
  expect(useRecording.getState().recording).toBe(true);
  // Another composer mounts and unmounts while the first one records.
  const b = mount();
  expect(useRecording.getState().recording).toBe(true);
  act(() => b.root.unmount());
  expect(useRecording.getState().recording).toBe(true);
  act(() => a.root.unmount());
  expect(useRecording.getState().recording).toBe(false);
  releasePermission("denied");
  await flush();
});

test("recording_with_apple_runs_live_and_the_live_text_lands", async () => {
  mockRecording = true;
  mockStopResult = { uri: "file:///cache/a.wav", durationMs: 3000, text: " hello there " };
  const onText = jest.fn();
  const { api } = mount(onText);
  act(() => api.current!.dispatch({ type: "toggle" }));
  await flush();
  releasePermission("granted");
  await flush();
  expect(calls).toEqual(["requestPermission", "startRecording:live"]);
  act(() => api.current!.dispatch({ type: "toggle" }));
  await flush();
  expect(onText).toHaveBeenCalledWith("hello there");
  expect(api.current!.caption).toBe("Apple");
  expect(api.current!.state.phase).toBe("idle");
  expect(mockDeleted).toEqual(["file:///cache/a.wav"]);
});

test("host_engine_records_a_file_and_uses_stt_make", async () => {
  mockRecording = true;
  require("./settings").useVoiceSettings.setState({ input: "host" });
  const onText = jest.fn();
  const host = jest.fn(async () => "from the host");
  const { api } = mount(onText, host);
  act(() => api.current!.dispatch({ type: "toggle" }));
  await flush();
  // A file engine needs the microphone only, not speech recognition.
  expect(calls).toEqual(["requestMicPermission", "startRecording"]);
  act(() => api.current!.dispatch({ type: "toggle" }));
  await flush();
  expect(host).toHaveBeenCalledWith("file:///cache/rec.wav");
  expect(onText).toHaveBeenCalledWith("from the host");
  expect(api.current!.caption).toBe("Host");
  expect(mockDeleted).toEqual(["file:///cache/rec.wav"]);
});

test("failed_transcription_keeps_the_file_then_retry_and_discard", async () => {
  mockRecording = true;
  require("./settings").useVoiceSettings.setState({ input: "host" });
  const onText = jest.fn();
  const host = jest.fn().mockRejectedValueOnce(new Error("no stt_command")).mockResolvedValueOnce("second try");
  const { api } = mount(onText, host);
  act(() => api.current!.dispatch({ type: "toggle" }));
  await flush();
  act(() => api.current!.dispatch({ type: "toggle" }));
  await flush();
  expect(api.current!.state.phase).toBe("failed");
  expect(api.current!.error).toContain("no stt_command");
  expect(mockDeleted).toEqual([]);
  act(() => api.current!.dispatch({ type: "retry" }));
  await flush();
  expect(onText).toHaveBeenCalledWith("second try");
  expect(mockDeleted).toEqual(["file:///cache/rec.wav"]);

  // A second failure, then Discard: the file goes.
  host.mockRejectedValueOnce(new Error("timeout"));
  act(() => api.current!.dispatch({ type: "toggle" }));
  await flush();
  act(() => api.current!.dispatch({ type: "toggle" }));
  await flush();
  expect(api.current!.state.phase).toBe("failed");
  act(() => api.current!.dispatch({ type: "discard" }));
  expect(api.current!.state.phase).toBe("idle");
  expect(mockDeleted).toEqual(["file:///cache/rec.wav", "file:///cache/rec.wav"]);
});

test("cancel_while_recording_cancels_the_recording", async () => {
  mockRecording = true;
  require("./settings").useVoiceSettings.setState({ input: "host" });
  const { api } = mount(jest.fn(), async () => "x");
  act(() => api.current!.dispatch({ type: "toggle" }));
  await flush();
  act(() => api.current!.dispatch({ type: "cancel", force: true }));
  await flush();
  expect(calls).toEqual(["requestMicPermission", "startRecording", "cancelRecording"]);
});

test("halted_recording_is_transcribed_with_a_notice", async () => {
  mockRecording = true;
  require("./settings").useVoiceSettings.setState({ input: "host" });
  const onText = jest.fn();
  const { api } = mount(onText, async () => "long talk");
  act(() => api.current!.dispatch({ type: "toggle" }));
  await flush();
  act(() => listeners.onRecordingHalted.forEach((f) => f({ reason: "limit" })));
  await flush();
  expect(calls).toContain("stopRecording");
  expect(onText).toHaveBeenCalledWith("long talk");
  expect(api.current!.error).toBe("Recording stopped: it reached 10 minutes.");
});
