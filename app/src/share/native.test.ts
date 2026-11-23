import { Platform } from "react-native";

const mockModule = jest.fn((_name: string): unknown => null);
jest.mock("expo", () => ({ requireOptionalNativeModule: (n: string) => mockModule(n) }));

type Native = typeof import("./native");

function load(module: unknown): Native {
  mockModule.mockImplementation(() => module);
  let out: Native | undefined;
  jest.isolateModules(() => {
    out = require("./native") as Native;
  });
  return out!;
}

const fakeModule = () => {
  const listeners: Record<string, ((e: { value?: unknown }) => void)[]> = {};
  return {
    listeners,
    getShareIntent: jest.fn(async (_url: string) => {}),
    clearShareIntent: jest.fn(),
    addListener: jest.fn((name: string, cb: (e: { value?: unknown }) => void) => {
      (listeners[name] ??= []).push(cb);
      return { remove: () => (listeners[name] = listeners[name].filter((l) => l !== cb)) };
    }),
  };
};

describe("share native module", () => {
  const os = Platform.OS;
  afterEach(() => {
    Platform.OS = os;
  });

  it("does nothing on a binary without the module (an older build that got this code over the air)", () => {
    const n = load(null);
    expect(mockModule).toHaveBeenCalledWith("ExpoShareIntentModule");
    expect(n.hasShareIntent).toBe(false);
    expect(() => n.requestShare("herdling://dataUrl=herdlingShareKey#media")).not.toThrow();
    expect(() => n.clearShare()).not.toThrow();
    const off = n.addShareListener(jest.fn(), jest.fn());
    expect(() => off()).not.toThrow();
  });

  it("knows the link of the iOS extension", () => {
    const n = load(null);
    expect(n.isShareUrl("herdling://dataUrl=herdlingShareKey?nonce=1#media")).toBe(true);
    expect(n.isShareUrl("herdling://pair?code=1")).toBe(false);
    expect(n.isShareUrl("https://dataUrl=x")).toBe(true);
    expect(n.isShareUrl(null)).toBe(false);
  });

  it("iOS: asks only with the link of the extension", () => {
    Platform.OS = "ios";
    const m = fakeModule();
    const n = load(m);
    n.requestShare(null);
    n.requestShare("herdling://pair?code=1");
    expect(m.getShareIntent).not.toHaveBeenCalled();
    n.requestShare("herdling://dataUrl=herdlingShareKey#weburl");
    expect(m.getShareIntent).toHaveBeenCalledWith("herdling://dataUrl=herdlingShareKey#weburl");
  });

  it("Android: asks for the intent of the activity with no link", () => {
    Platform.OS = "android";
    const m = fakeModule();
    const n = load(m);
    n.requestShare(null);
    n.requestShare("herdling://anything");
    expect(m.getShareIntent.mock.calls).toEqual([[""], [""]]);
  });

  it("passes the values and the errors on, and clears with the share key", () => {
    const m = fakeModule();
    const n = load(m);
    const onValue = jest.fn();
    const onError = jest.fn();
    const off = n.addShareListener(onValue, onError);
    m.listeners.onChange[0]({ value: '{"text":"hi"}' });
    m.listeners.onError[0]({ value: "no app group" });
    expect(onValue).toHaveBeenCalledWith('{"text":"hi"}');
    expect(onError).toHaveBeenCalledWith("no app group");
    off();
    expect(m.listeners.onChange).toEqual([]);
    n.clearShare();
    expect(m.clearShareIntent).toHaveBeenCalledWith(n.SHARE_KEY);
    expect(n.SHARE_KEY).toBe("herdlingShareKey");
  });
});

describe("redirectSystemPath", () => {
  it("sends the link of the extension to the share screen and keeps other links", () => {
    mockModule.mockImplementation(() => null);
    const { redirectSystemPath } = require("@/app/+native-intent") as typeof import("@/app/+native-intent");
    expect(redirectSystemPath({ path: "herdling://dataUrl=herdlingShareKey#media", initial: true })).toBe("/share");
    expect(redirectSystemPath({ path: "/dataUrl=herdlingShareKey", initial: false })).toBe("/share");
    expect(redirectSystemPath({ path: "herdling://pair?code=1", initial: true })).toBe("herdling://pair?code=1");
    expect(redirectSystemPath({ path: "/session/h1/p1", initial: false })).toBe("/session/h1/p1");
  });
});
