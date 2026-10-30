import type { AgentStatus, ThreadItem } from "@zogssh/protocol";
import { act, create as createRenderer } from "react-test-renderer";

import { useRecording } from "./recording";
import { useSessionSpeak, useVoiceSettings } from "./settings";
import { useSpeakReplies } from "./useSpeakReplies";

const mockSpeak = jest.fn();
const mockHaptic = jest.fn(async () => {});
jest.mock("expo-haptics", () => ({ selectionAsync: () => mockHaptic() }));
const mockStop = jest.fn(async () => {});
jest.mock("expo-speech", () => ({
  speak: (...a: unknown[]) => mockSpeak(...a),
  stop: () => mockStop(),
}));
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
const mockCall = jest.fn(async (..._a: unknown[]): Promise<unknown> => ({ summary: "Host summary." }));
let mockRpc: { call: typeof mockCall } | undefined;
jest.mock("../hosts/connection", () => ({ getHostConn: () => ({ status: "online", attempt: 1, rpc: mockRpc }) }));
jest.mock("expo-secure-store", () => ({ getItemAsync: async () => null, setItemAsync: async () => {}, deleteItemAsync: async () => {} }));

const user = (id: string): ThreadItem => ({ kind: "user", id, ts: 0, text: "hi" });
const asst = (id: string, markdown: string): ThreadItem => ({ kind: "assistant", id, ts: 0, markdown });

function Probe(p: { status?: AgentStatus; items: ThreadItem[]; speakNow?: boolean }) {
  useSpeakReplies("h", "p", p.status, p.items, { speakNow: p.speakNow });
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
  useVoiceSettings.setState({ ttsDefault: true, mode: "full", voice: "v1", rate: 1.2 });
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

  it("stays quiet when the session speaker is off, or from a non-working status", async () => {
    useSessionSpeak.setState({ bySession: { "h:p": false } });
    let r: any;
    await act(async () => {
      r = create(<Probe status="working" items={items} />);
    });
    await act(async () => r.update(<Probe status="idle" items={items} />));
    await flush();
    expect(mockSpeak).not.toHaveBeenCalled();
    useSessionSpeak.setState({ bySession: {} });
    await act(async () => r.update(<Probe status="blocked" items={items} />));
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

  it("summary mode falls back to full text offline or without a key", async () => {
    useVoiceSettings.setState({ mode: "summary" });
    mockRpc = undefined;
    await finishTurn();
    expect(mockSpeak).toHaveBeenCalledWith("Hello there", expect.anything());
    mockSpeak.mockClear();
    mockRpc = { call: mockCall };
    mockCall.mockRejectedValueOnce(Object.assign(new Error("no key"), { code: "no_key" }));
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
});
