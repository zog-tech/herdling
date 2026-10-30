import type { AgentStatus, ThreadItem } from "@zogssh/protocol";
import { act, create } from "react-test-renderer";

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
afterEach(() => jest.useRealTimers());

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

  it("speakNow speaks once", async () => {
    let r: any;
    await act(async () => {
      r = create(<Probe status="idle" items={items} speakNow />);
    });
    await act(async () => r.update(<Probe status="idle" items={[...items]} speakNow />));
    expect(mockSpeak).toHaveBeenCalledTimes(1);
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
