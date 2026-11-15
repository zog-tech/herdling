import { GestureHandlerRootView } from "react-native-gesture-handler";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useTerminalRenderer } from "@/terminal/renderer";
import { openSelectText } from "@/thread/selectText";

import { TerminalView } from "./TerminalView";

type Handler = (d: unknown) => void;
const mockStreams: { params: Record<string, unknown>; onData: Handler; cancelled: boolean }[] = [];
const mockCalls: { method: string; params: unknown }[] = [];
let mockStreamError: Error | undefined;
let mockHello: Record<string, unknown> = {};
const mockRpc = {
  srttMs: undefined as number | undefined,
  call: async (method: string, params: { method?: string }) => {
    if (method === "ping") return {};
    mockCalls.push({ method: params?.method ?? method, params });
    if (params?.method === "pane.read") return { read: { text: "classic screen" } };
    return {};
  },
  stream: async (_method: string, params: Record<string, unknown>, onData: Handler, onResult?: (r: unknown) => void) => {
    if (mockStreamError) throw mockStreamError;
    const s = { params, onData, cancelled: false };
    mockStreams.push(s);
    onResult?.({ stream: `pane:${mockStreams.length}`, format: "vt" });
    return () => {
      s.cancelled = true;
    };
  },
  onSrtt: () => () => {},
};
jest.mock("@/hosts/connection", () => ({
  useHostConn: () => ({ status: "online", attempt: 1, rpc: mockRpc, hello: mockHello }),
}));
jest.mock("expo-router", () => ({ useIsFocused: () => true }));
jest.mock("@/ui/haptics", () => ({ tap: jest.fn(), press: jest.fn() }));
jest.mock("@/thread/selectText", () => ({ openSelectText: jest.fn() }));

/** What the fake web view got through `postMessage`. */
const mockPosted: string[] = [];
let mockWebView = true;
jest.mock("@/preview/webview", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View } = jest.requireActual<typeof import("react-native")>("react-native");
  const Fake = React.forwardRef(function FakeWebView(props: object, ref: React.Ref<unknown>) {
    React.useImperativeHandle(ref, () => ({
      postMessage: (d: string) => mockPosted.push(d),
      goBack: () => {},
      goForward: () => {},
      reload: () => {},
    }));
    return React.createElement(View, { ...props, testID: "xterm-webview" });
  });
  return { hasWebView: () => mockWebView, loadWebView: () => (mockWebView ? Fake : null) };
});
// Keep the 1 MB asset module out of the render tests.
jest.mock("@/terminal/xterm/assets", () => ({
  loadXtermAssets: () => ({ css: "", xterm: "", search: "", unicode11: "", fontRegular: "", fontBold: "", versions: {} }),
}));

const VT_HELLO = { host: "studio.local", os: "macos", herdlingd: "0.2.0", herdr_ok: true, methods: ["pane.watch"], watch_formats: ["text", "ansi", "vt"] };

const flush = async () => {
  for (let i = 0; i < 5; i++) await act(async () => {});
};

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  mockStreams.length = 0;
  mockCalls.length = 0;
  mockPosted.length = 0;
  mockStreamError = undefined;
  mockWebView = true;
  mockHello = VT_HELLO;
  useTerminalRenderer.setState({ renderer: "terminal" });
  (openSelectText as jest.Mock).mockClear();
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
});

async function mount() {
  await act(async () => {
    tree = create(
      <GestureHandlerRootView>
        <TerminalView hostId="host-1" paneId="t1" controls />
      </GestureHandlerRootView>,
    );
  });
  await flush();
}
const webview = () => tree!.root.findAll((n) => n.props.testID === "xterm-webview")[0];
const fromPage = async (m: object) => {
  await act(async () => webview().props.onMessage({ nativeEvent: { data: JSON.stringify(m) } }));
  await flush();
};
const toPage = () => mockPosted.map((p) => JSON.parse(p) as { type: string; e?: number; b64?: string; cols?: number });
/** The classic view reads the screen text (`pane.read`, no `pane.watch` here). */
const classicText = () => mockCalls.filter((c) => c.method === "pane.read");

test("a host with vt shows the terminal and streams raw bytes", async () => {
  await mount();
  expect(webview()).toBeDefined();
  expect(mockStreams).toHaveLength(1);
  expect(mockStreams[0].params).toMatchObject({ pane_id: "t1", format: "vt" });
  expect(mockStreams[0].params.cols).toBeUndefined();
  expect(mockCalls.filter((c) => c.method === "pane.read")).toHaveLength(0);

  // Events before the page is ready wait, in order.
  await act(async () => {
    mockStreams[0].onData({ vt: "reset", gen: 1, seq: 0, cols: 80, rows: 24 });
    mockStreams[0].onData({ vt: "data", gen: 1, seq: 1, data: "QQ==" });
  });
  expect(mockPosted).toHaveLength(0);
  await fromPage({ type: "ready" });
  // The theme goes first; a font may come twice (harmless).
  const msgs = toPage().filter((m, i, all) => m.type !== "font" || all.findIndex((x) => x.type === "font") === i);
  expect(msgs.map((m) => m.type)).toEqual(["theme", "font", "reset", "data"]);
  expect(msgs[3]).toMatchObject({ type: "data", e: 1, b64: "QQ==" });

  // After a reattach, late bytes of the old attach do not reach the page.
  mockPosted.length = 0;
  await act(async () => {
    mockStreams[0].onData({ vt: "reset", gen: 2, seq: 0, cols: 80, rows: 24 });
    mockStreams[0].onData({ vt: "data", gen: 1, seq: 2, data: "Qg==" });
    mockStreams[0].onData({ vt: "data", gen: 2, seq: 1, data: "Qw==" });
  });
  expect(toPage().filter((m) => m.type !== "font")).toEqual([
    { type: "reset", e: 2, cols: 80, rows: 24 },
    { type: "data", e: 2, b64: "Qw==" },
  ]);
});

test("a gap in the stream starts a new watch", async () => {
  await mount();
  await act(async () => {
    mockStreams[0].onData({ vt: "reset", gen: 1, seq: 0, cols: 80, rows: 24 });
    mockStreams[0].onData({ vt: "data", gen: 1, seq: 3, data: "QQ==" });
  });
  // The new watch starts on the next turn of the timer queue.
  await act(async () => new Promise((r) => setTimeout(r, 10)));
  await flush();
  expect(mockStreams[0].cancelled).toBe(true);
  expect(mockStreams).toHaveLength(2);
});

test("a host that refuses vt falls back to the classic view", async () => {
  mockStreamError = Object.assign(new Error("format must be text or ansi"), { code: "bad_request" });
  mockHello = { ...VT_HELLO, methods: [] };
  await mount();
  expect(tree!.root.findAll((n) => n.props.testID === "xterm-webview")).toHaveLength(0);
  expect(classicText().length).toBeGreaterThan(0);
});

test("a host without watch_formats keeps the classic view and never asks for vt", async () => {
  mockHello = { host: "studio.local", os: "macos", herdlingd: "0.1.9", herdr_ok: true };
  await mount();
  expect(mockStreams).toHaveLength(0);
  expect(classicText().length).toBeGreaterThan(0);
});

test("a build without the web view keeps the classic view", async () => {
  mockWebView = false;
  mockHello = { ...VT_HELLO, methods: [] };
  await mount();
  expect(mockStreams).toHaveLength(0);
  expect(classicText().length).toBeGreaterThan(0);
});

test("the Classic choice in Settings keeps the classic view", async () => {
  useTerminalRenderer.setState({ renderer: "classic" });
  mockHello = { ...VT_HELLO, methods: [] };
  await mount();
  expect(mockStreams).toHaveLength(0);
  expect(classicText().length).toBeGreaterThan(0);
});

test("a full-screen app shows the page buttons; a long press opens Select text", async () => {
  await mount();
  const pages = () => tree!.root.findAll((n) => n.props.accessibilityLabel === "Page up" && !!n.props.onPress);
  expect(pages()).toHaveLength(0);
  await fromPage({ type: "buffer", alternate: true, atBottom: true });
  expect(pages()).toHaveLength(1);
  await fromPage({ type: "text", text: "line one\nline two" });
  expect(openSelectText).toHaveBeenCalledWith({ title: "Terminal", text: "line one\nline two" });
});

test("scrolled up: a Jump to end button scrolls the page to the end", async () => {
  await mount();
  await fromPage({ type: "ready" });
  await fromPage({ type: "buffer", alternate: false, atBottom: false });
  const jump = tree!.root.find((n) => n.props.accessibilityLabel === "Jump to end" && !!n.props.onPress);
  mockPosted.length = 0;
  await act(async () => jump.props.onPress());
  expect(toPage()).toEqual([{ type: "scrollToBottom" }]);
});

test("search goes to the page and the page count comes back", async () => {
  const onCount = jest.fn();
  await act(async () => {
    tree = create(
      <GestureHandlerRootView>
        <TerminalView hostId="host-1" paneId="t1" controls search={{ term: "err", index: -1, onCount }} />
      </GestureHandlerRootView>,
    );
  });
  await flush();
  await fromPage({ type: "ready" });
  expect(toPage().find((m) => m.type === "search")).toMatchObject({ type: "search", term: "err", dir: "prev" });
  await fromPage({ type: "search", index: 2, count: 3 });
  expect(onCount).toHaveBeenLastCalledWith(3);
});
