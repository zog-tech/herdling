import type { AgentStatus, ThreadItem } from "@zogssh/protocol";
import { act, create as createRenderer } from "react-test-renderer";

import { useRecording } from "./recording";
import { useSessionSpeak, useVoiceSettings } from "./settings";
import { useSpeakReplies } from "./useSpeakReplies";

const mockSpeak = jest.fn();
const mockStop = jest.fn(async () => {});
jest.mock("expo-speech", () => ({
  speak: (...a: unknown[]) => mockSpeak(...a),
  stop: () => mockStop(),
}));
const mockSet = jest.fn(async () => {});
const mockRelease = jest.fn(async () => {});
jest.mock("../../modules/voice", () => ({ setSpeechAudio: () => mockSet(), releaseAudio: () => mockRelease() }));
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
});
afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  jest.useRealTimers();
});

const items = [user("1"), asst("2", "**Hello** there")];

describe("useSpeakReplies", () => {
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

  it("speakNow respects the speaker toggle", async () => {
    useSessionSpeak.setState({ bySession: { "h:p": false } });
    await act(async () => {
      create(<Probe status="idle" items={items} speakNow />);
    });
    await flush();
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it("summary mode falls back to full", async () => {
    useVoiceSettings.setState({ mode: "summary" });
    let r: any;
    await act(async () => {
      r = create(<Probe status="working" items={items} />);
    });
    await act(async () => r.update(<Probe status="idle" items={items} />));
    await flush();
    expect(mockSpeak).toHaveBeenCalledTimes(1);
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
