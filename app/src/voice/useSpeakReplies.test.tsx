import type { AgentStatus, ThreadItem } from "@zogssh/protocol";
import { act, create as createRenderer } from "react-test-renderer";

import { useRecording } from "./recording";
import { useSessionSpeak, useVoiceSettings } from "./settings";
import { logSpeech, useSpeechLog } from "./speechLog";
import { speakReplyNow, stopSpeaking, testVoice, useManualSpeech, useSpeakReplies, useSpeaking } from "./useSpeakReplies";
import { HOST_VOICE_FAILED, resetVoiceNotice, useVoiceNotice } from "./voiceNotice";

const mockSpeak = jest.fn();
const mockHaptic = jest.fn((_c: unknown) => {});
jest.mock("@/ui/haptics", () => ({ status: (c: unknown) => mockHaptic(c) }));
const mockStop = jest.fn(async () => {});
jest.mock("expo-speech", () => ({
  speak: (...a: unknown[]) => mockSpeak(...a),
  stop: () => mockStop(),
  getAvailableVoicesAsync: () => mockVoices(),
}));
const mockVoices = jest.fn(async (): Promise<{ identifier: string }[]> => [{ identifier: "v1" }]);
const mockSet = jest.fn(async () => {});
const mockRelease = jest.fn(async () => {});
const mockLocalAvailable = jest.fn(async () => false);
const mockSummarizeLocal = jest.fn(async (_t: string, _i: string) => "Local summary.");
jest.mock("../../modules/voice", () => ({
  setSpeechAudio: () => mockSet(),
  releaseAudio: () => mockRelease(),
  localSummaryAvailable: () => mockLocalAvailable(),
  summarizeLocal: (t: string, i: string) => mockSummarizeLocal(t, i),
}));
/** Host voice player: each clip ends on the next tick, or at once on stop. */
const mockPlayed: string[] = [];
const mockDeleted: string[] = [];
const mockStopHost = jest.fn();
const mockPlayback = jest.fn(async () => {});
jest.mock("./hostAudio", () => ({
  stopHostAudio: () => mockStopHost(),
  setPlaybackSession: () => mockPlayback(),
  hostAudio: () => ({
    writeClip: async (a: { audio_b64: string }) => ({ uri: `file:///${a.audio_b64}` }),
    deleteClip: (c: { uri: string }) => mockDeleted.push(c.uri),
    play: async (c: { uri: string }) => void mockPlayed.push(c.uri),
  }),
}));
const hostAnswers = async (method: unknown, params?: any, _t?: unknown): Promise<unknown> =>
  method === "tts.make" ? { audio_b64: params.text, mime: "audio/wav" } : { summary: "Host summary." };
const mockCall = jest.fn(hostAnswers);
let mockRpc: { call: typeof mockCall } | undefined;
jest.mock("../hosts/connection", () => ({ getHostConn: () => ({ status: "online", attempt: 1, rpc: mockRpc }) }));
jest.mock("expo-secure-store", () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));

const user = (id: string): ThreadItem => ({ kind: "user", id, ts: 0, text: "hi" });
const asst = (id: string, markdown: string): ThreadItem => ({ kind: "assistant", id, ts: 0, markdown });

function Probe(p: { status?: AgentStatus; items: ThreadItem[]; speakNow?: boolean; focused?: boolean }) {
  useSpeakReplies("h", "p", p.status, p.items, { speakNow: p.speakNow, focused: p.focused });
  return null;
}

const roots: { unmount: () => void }[] = [];
const create = (el: React.ReactElement) => {
  const r = createRenderer(el);
  roots.push(r);
  return r;
};

const flush = async () => {
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockVoices.mockImplementation(async () => [{ identifier: "v1" }]);
  useSpeechLog.getState().clear();
  useManualSpeech.setState({ key: undefined, owner: -1 });
  useVoiceSettings.setState({ ttsDefault: true, mode: "full", engine: "iphone", voice: "v1", rate: 1.2 });
  mockCall.mockImplementation(hostAnswers);
  mockPlayed.length = 0;
  mockDeleted.length = 0;
  resetVoiceNotice();
  useSessionSpeak.setState({ bySession: {} });
  useRecording.setState({ recording: false });
  mockLocalAvailable.mockResolvedValue(false);
  mockRpc = { call: mockCall };
});
afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  jest.useRealTimers();
});

const items = [user("1"), asst("2", "**Hello** there")];

describe("useSpeakReplies", () => {
  it("taps a haptic on a real status change, not on mount or a repeat", async () => {
    let r: any;
    await act(async () => {
      r = create(<Probe status="working" items={items} />);
    });
    expect(mockHaptic).not.toHaveBeenCalled();
    await act(async () => r.update(<Probe status="working" items={[...items]} />));
    expect(mockHaptic).not.toHaveBeenCalled();
    await act(async () => r.update(<Probe status="blocked" items={items} />));
    expect(mockHaptic).toHaveBeenCalledTimes(1);
    expect(mockHaptic).toHaveBeenLastCalledWith({ from: "working", to: "blocked" });
    await act(async () => r.update(<Probe status="idle" items={items} />));
    expect(mockHaptic).toHaveBeenCalledTimes(2);
  });

  it("speaks the reply when working turns idle", async () => {
    let r: any;
    await act(async () => {
      r = create(<Probe status="working" items={items} />);
    });
    await act(async () => r.update(<Probe status="idle" items={items} />));
    await flush();
    expect(mockSpeak).toHaveBeenCalledWith("Hello there", expect.objectContaining({ voice: "v1", rate: 1.2 }));
  });

  it("opened on a finished agent, a short false working never speaks the old reply", async () => {
    let r: any;
    await act(async () => {
      r = create(<Probe status="idle" items={items} />);
    });
    await act(async () => r.update(<Probe status="working" items={items} />));
    await act(async () => r.update(<Probe status="idle" items={items} />));
    await flush();
    expect(mockSpeak).not.toHaveBeenCalled();
    expect(useSpeechLog.getState().events.map((e) => e.text)).toContain("skipped: reply from before the screen opened");
    // A real new turn still speaks.
    const next = [...items, user("3"), asst("4", "New answer")];
    await act(async () => r.update(<Probe status="working" items={next} />));
    await act(async () => r.update(<Probe status="idle" items={next} />));
    await flush();
    expect(mockSpeak).toHaveBeenCalledWith("New answer", expect.anything());
  });

  it("speaking shows while speech plays, and stopSpeaking stops it", async () => {
    let r: any;
    await act(async () => {
      r = create(<Probe status="working" items={items} />);
    });
    await act(async () => r.update(<Probe status="idle" items={items} />));
    await flush();
    expect(useSpeaking.getState().speaking).toBe(true);
    mockStop.mockClear();
    act(() => stopSpeaking());
    expect(mockStop).toHaveBeenCalledTimes(1);
    expect(useSpeaking.getState().speaking).toBe(false);
  });

  it("stays quiet when the session speaker is off, or from a non-working status", async () => {
    useSessionSpeak.setState({ bySession: { "h:p": false } });
    let r: any;
    await act(async () => {
      r = create(<Probe status="working" items={items} />);
    });
    await act(async () => r.update(<Probe status="idle" items={items} />));
    await flush();
    expect(mockSpeak).not.toHaveBeenCalled();
    await act(async () => r.update(<Probe status="blocked" items={items} />));
    await act(async () => {
      useSessionSpeak.setState({ bySession: {} });
    });
    await act(async () => r.update(<Probe status="idle" items={items} />));
    await flush();
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it("does not speak while recording, and recording stops speech", async () => {
    useRecording.setState({ recording: true });
    let r: any;
    await act(async () => {
      r = create(<Probe status="working" items={items} />);
    });
    await act(async () => r.update(<Probe status="done" items={items} />));
    await flush();
    expect(mockSpeak).not.toHaveBeenCalled();
    expect(mockStop).toHaveBeenCalled();
  });

  it("a session under another screen speaks nothing and stops speech when it loses focus", async () => {
    let r: any;
    await act(async () => {
      r = create(<Probe status="working" items={items} focused={false} />);
    });
    await act(async () => r.update(<Probe status="idle" items={items} focused={false} />));
    await flush();
    expect(mockSpeak).not.toHaveBeenCalled();
    expect(mockHaptic).not.toHaveBeenCalled();

    // Focused again, then covered while a speak waits for the settle delay: the speak is dropped.
    await act(async () => r.update(<Probe status="working" items={items} />));
    await act(async () => r.update(<Probe status="idle" items={[...items, asst("3", "Next")]} />));
    mockStop.mockClear();
    await act(async () => r.update(<Probe status="idle" items={[...items, asst("3", "Next")]} focused={false} />));
    expect(mockStop).toHaveBeenCalled();
    await flush();
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it("a push for the open session (setParams) does not speak the reply a second time", async () => {
    let r: any;
    await act(async () => {
      r = create(<Probe status="working" items={items} />);
    });
    await act(async () => r.update(<Probe status="idle" items={items} />));
    await flush();
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    await act(async () => r.update(<Probe status="idle" items={items} speakNow />));
    await flush();
    expect(mockSpeak).toHaveBeenCalledTimes(1);
  });

  it("speakNow speaks once, after the settle delay", async () => {
    let r: any;
    await act(async () => {
      r = create(<Probe status="idle" items={items} speakNow />);
    });
    expect(mockSpeak).not.toHaveBeenCalled();
    await act(async () => r.update(<Probe status="idle" items={[...items]} speakNow />));
    await flush();
    expect(mockSpeak).toHaveBeenCalledTimes(1);
  });

  it("speakNow while working speaks only the final reply, once", async () => {
    const partial = [user("1"), asst("2", "Part")];
    let r: any;
    await act(async () => {
      r = create(<Probe status="working" items={partial} speakNow />);
    });
    await act(async () => r.update(<Probe status="idle" items={partial} speakNow />));
    await act(async () => {
      r.update(<Probe status="idle" items={[user("1"), asst("2", "Part"), asst("3", "Final")]} speakNow />);
    });
    await flush();
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    expect(mockSpeak.mock.calls[0][0]).toBe("Part Final");
  });

  it("speakNow waits for items that load after the settle delay", async () => {
    let r: any;
    await act(async () => {
      r = create(<Probe status="idle" items={[]} speakNow />);
    });
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(mockSpeak).not.toHaveBeenCalled();
    await act(async () => r.update(<Probe status="idle" items={items} speakNow />));
    await flush();
    await act(async () => r.update(<Probe status="idle" items={[...items]} speakNow />));
    await flush();
    expect(mockSpeak).toHaveBeenCalledTimes(1);
  });

  it("speakNow gives up after 10 s without a reply", async () => {
    let r: any;
    await act(async () => {
      r = create(<Probe status="idle" items={[]} speakNow />);
    });
    await act(async () => {
      jest.advanceTimersByTime(11000);
    });
    await act(async () => r.update(<Probe status="idle" items={items} speakNow />));
    await flush();
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it("speakNow respects the speaker toggle", async () => {
    useSessionSpeak.setState({ bySession: { "h:p": false } });
    await act(async () => {
      create(<Probe status="idle" items={items} speakNow />);
    });
    await flush();
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  const finishTurn = async () => {
    let r: any;
    await act(async () => {
      r = create(<Probe status="working" items={items} />);
    });
    await act(async () => r.update(<Probe status="idle" items={items} />));
    await flush();
    return r;
  };

  it("summary mode speaks the on-device summary when the model is there", async () => {
    useVoiceSettings.setState({ mode: "summary" });
    mockLocalAvailable.mockResolvedValue(true);
    await finishTurn();
    expect(mockSummarizeLocal).toHaveBeenCalledWith("Hello there", expect.stringContaining("headphones"));
    expect(mockCall).not.toHaveBeenCalled();
    expect(mockSpeak).toHaveBeenCalledWith("Local summary.", expect.anything());
  });

  it("summary mode asks the host when the on-device model is not there", async () => {
    useVoiceSettings.setState({ mode: "summary" });
    await finishTurn();
    expect(mockCall).toHaveBeenCalledWith("summary.make", { text: "Hello there" }, expect.any(Number));
    expect(mockSpeak).toHaveBeenCalledWith("Host summary.", expect.anything());
  });

  it("summary mode falls back to full text offline or without a host command", async () => {
    useVoiceSettings.setState({ mode: "summary" });
    mockRpc = undefined;
    await finishTurn();
    expect(mockSpeak).toHaveBeenCalledWith("Hello there", expect.anything());
    mockSpeak.mockClear();
    mockRpc = { call: mockCall };
    mockCall.mockRejectedValueOnce(Object.assign(new Error("no command"), { code: "no_command" }));
    await finishTurn();
    expect(mockSpeak).toHaveBeenCalledWith("Hello there", expect.anything());
  });

  it("a new prompt while the summary is pending drops it", async () => {
    useVoiceSettings.setState({ mode: "summary" });
    let answer: (v: unknown) => void = () => {};
    mockCall.mockImplementationOnce(() => new Promise((res) => (answer = res)));
    const r = await finishTurn();
    expect(mockCall).toHaveBeenCalledTimes(1);
    await act(async () => r.update(<Probe status="working" items={[...items, user("3")]} />));
    await act(async () => answer({ summary: "Late summary." }));
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it("full mode never asks for a summary", async () => {
    mockLocalAvailable.mockResolvedValue(true);
    await finishTurn();
    expect(mockLocalAvailable).not.toHaveBeenCalled();
    expect(mockCall).not.toHaveBeenCalled();
    expect(mockSpeak).toHaveBeenCalledWith("Hello there", expect.anything());
  });

  it("turning the speaker on speaks the last reply of a finished agent, again after off and on", async () => {
    useSessionSpeak.setState({ bySession: { "h:p": false } });
    await act(async () => {
      create(<Probe status="idle" items={items} />);
    });
    await flush();
    expect(mockSpeak).not.toHaveBeenCalled();
    await act(async () => {
      useSessionSpeak.setState({ bySession: { "h:p": true } });
    });
    await flush();
    expect(mockSpeak).toHaveBeenCalledTimes(1);
    await act(async () => {
      useSessionSpeak.setState({ bySession: { "h:p": false } });
    });
    await act(async () => {
      useSessionSpeak.setState({ bySession: { "h:p": true } });
    });
    await flush();
    expect(mockSpeak).toHaveBeenCalledTimes(2);
  });

  it("turning the speaker on while the agent works speaks nothing yet", async () => {
    useSessionSpeak.setState({ bySession: { "h:p": false } });
    await act(async () => {
      create(<Probe status="working" items={items} />);
    });
    await act(async () => {
      useSessionSpeak.setState({ bySession: { "h:p": true } });
    });
    await flush();
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it("turning the speaker off stops speech", async () => {
    let r: any;
    await act(async () => {
      r = create(<Probe status="idle" items={items} />);
    });
    mockStop.mockClear();
    await act(async () => {
      useSessionSpeak.setState({ bySession: { "h:p": false } });
    });
    expect(mockStop).toHaveBeenCalledTimes(1);
    await act(async () => r.unmount());
  });

  it("a new prompt and unmount stop speech", async () => {
    let r: any;
    await act(async () => {
      r = create(<Probe status="idle" items={items} />);
    });
    mockStop.mockClear();
    await act(async () => r.update(<Probe status="working" items={[...items, user("3")]} />));
    expect(mockStop).toHaveBeenCalledTimes(1);
    await act(async () => r.unmount());
    expect(mockStop).toHaveBeenCalledTimes(2);
  });
  const longReply = [user("1"), asst("2", "The build passed on the first try. Should I open a pull request now?")];
  const finishLong = async () => {
    let r: any;
    await act(async () => {
      r = create(<Probe status="working" items={longReply} />);
    });
    await act(async () => r.update(<Probe status="idle" items={longReply} />));
    await flush();
    await act(async () => {});
    return r;
  };

  it("host engine speaks each sentence through tts.make, in order, and deletes the clips", async () => {
    useVoiceSettings.setState({ engine: "host" });
    await finishLong();
    const tts = mockCall.mock.calls.filter((c) => c[0] === "tts.make").map((c) => (c[1] as { text: string }).text);
    expect(tts).toEqual(["The build passed on the first try.", "Should I open a pull request now?"]);
    expect(mockPlayed).toEqual(["file:///The build passed on the first try.", "file:///Should I open a pull request now?"]);
    expect(mockDeleted).toEqual(mockPlayed);
    expect(mockSpeak).not.toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("host engine falls back to the iPhone voice for the rest of the reply and shows the notice once", async () => {
    useVoiceSettings.setState({ engine: "host" });
    mockCall.mockImplementation(async (method: unknown, params?: any) => {
      if (method !== "tts.make") return { summary: "Host summary." };
      if (params.text.startsWith("Should")) throw Object.assign(new Error("failed"), { code: "command_failed" });
      return { audio_b64: params.text, mime: "audio/wav" };
    });
    await finishLong();
    expect(mockPlayed).toEqual(["file:///The build passed on the first try."]);
    expect(mockSpeak).toHaveBeenCalledWith("Should I open a pull request now?", expect.objectContaining({ voice: "v1" }));
    expect(useVoiceNotice.getState().text).toBe(HOST_VOICE_FAILED);

    // A second failure in this app run shows no new notice.
    useVoiceNotice.setState({ text: undefined });
    mockSpeak.mockClear();
    mockCall.mockRejectedValue(Object.assign(new Error("no command"), { code: "no_command" }));
    await finishLong();
    expect(mockSpeak).toHaveBeenCalledWith("The build passed on the first try. Should I open a pull request now?", expect.anything());
    expect(useVoiceNotice.getState().text).toBeUndefined();
  });

  it("host engine without a connection uses the iPhone voice", async () => {
    useVoiceSettings.setState({ engine: "host" });
    mockRpc = undefined;
    await finishTurn();
    expect(mockSpeak).toHaveBeenCalledWith("Hello there", expect.anything());
  });

  it("stopping speech stops the host voice player", async () => {
    let r: any;
    await act(async () => {
      r = create(<Probe status="idle" items={items} />);
    });
    mockStopHost.mockClear();
    await act(async () => r.update(<Probe status="working" items={[...items, user("3")]} />));
    expect(mockStopHost).toHaveBeenCalledTimes(1);
  });

  const logged = () => useSpeechLog.getState().events.map((e) => e.text);

  it("logs why it stays quiet: speaker off, not focused, busy", async () => {
    useSessionSpeak.setState({ bySession: { "h:p": false } });
    let r: any;
    await act(async () => {
      r = create(<Probe status="working" items={items} />);
    });
    await act(async () => r.update(<Probe status="idle" items={items} />));
    await flush();
    expect(logged()).toContain("skipped: speaker off");

    useSessionSpeak.setState({ bySession: {} });
    useSpeechLog.getState().clear();
    await act(async () => r.update(<Probe status="working" items={items} focused={false} />));
    await act(async () => r.update(<Probe status="idle" items={items} focused={false} />));
    await flush();
    expect(logged()).toContain("skipped: not focused");

    useSpeechLog.getState().clear();
    mockSet.mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "busy" }));
    await act(async () => r.update(<Probe status="working" items={items} />));
    await act(async () => r.update(<Probe status="idle" items={items} />));
    await flush();
    expect(logged()).toContain("audio session busy (microphone)");
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it("sets the session through the fallback when the native call fails, then speaks", async () => {
    mockSet.mockRejectedValueOnce(new Error("OSStatus error -50"));
    await act(async () => testVoice());
    expect(mockPlayback).toHaveBeenCalledTimes(1);
    expect(logged()).toContain("audio session set by the fallback");
    expect(mockSpeak).toHaveBeenCalledWith("Voice output works.", expect.anything());
  });

  it("stays quiet when the fallback fails too", async () => {
    mockSet.mockRejectedValueOnce(new Error("OSStatus error -50"));
    mockPlayback.mockRejectedValueOnce(new Error("nope"));
    await act(async () => testVoice());
    expect(logged()).toContain("audio session fallback error: nope");
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it("logs the speak and its end", async () => {
    let r: any;
    await act(async () => {
      r = create(<Probe status="working" items={items} />);
    });
    await act(async () => r.update(<Probe status="idle" items={items} />));
    await flush();
    expect(logged()).toContain("speaking (iphone, 11 chars, voice v1)");
    await act(async () => mockSpeak.mock.calls[0][1].onDone());
    expect(logged().at(-1)).toBe("done");
  });

  it("speaks with the system voice when the saved voice is missing", async () => {
    mockVoices.mockResolvedValue([{ identifier: "other" }]);
    await act(async () => {
      await speakReplyNow("h", "Hello there", "a1");
    });
    expect(mockSpeak).toHaveBeenCalledWith("Hello there", expect.objectContaining({ voice: undefined, rate: 1.2 }));
    expect(logged()).toContain("saved voice missing, using default");
  });

  it("the play button path speaks with the speaker off, and a second call stops it", async () => {
    useVoiceSettings.setState({ ttsDefault: false });
    await act(async () => {
      await speakReplyNow("h", "**Hello** there", "a1");
    });
    expect(mockSpeak).toHaveBeenCalledWith("Hello there", expect.objectContaining({ voice: "v1", rate: 1.2 }));
    expect(useManualSpeech.getState().key).toBe("a1");
    mockStop.mockClear();
    await act(async () => {
      await speakReplyNow("h", "**Hello** there", "a1");
    });
    expect(mockStop).toHaveBeenCalled();
    expect(useManualSpeech.getState().key).toBeUndefined();
    expect(mockSpeak).toHaveBeenCalledTimes(1);
  });

  it("the test voice speaks its phrase and logs it", async () => {
    await act(async () => {
      await testVoice();
    });
    expect(mockSpeak).toHaveBeenCalledWith("Voice output works.", expect.anything());
    expect(logged()).toContain("test voice");
  });

  it("keeps only the last 20 events", () => {
    for (let i = 0; i < 25; i++) logSpeech(`e${i}`);
    const e = useSpeechLog.getState().events;
    expect(e).toHaveLength(20);
    expect(e[0].text).toBe("e5");
  });
});
