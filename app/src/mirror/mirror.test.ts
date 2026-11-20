import type { Hello, MirrorDevice, MirrorStart } from "@herdling/protocol";

jest.mock("../../modules/ssh", () => ({ hasNativePreview: () => true, startPreview: jest.fn(), stopPreview: jest.fn() }));

import { deviceDetail, emptyMessage, mirrorRoute, mirrorSupported, offeredDevices, toolHints, validDeviceId, validStart } from "./devices";
import { keyCommand, parsePageMessage, rotateCommand, statusLine, textCommand, toolbarKeys } from "./page";
import { initialTunnel, mirrorUrl, reduceTunnel, staysInMirror, type MirrorEvent, type MirrorTunnel } from "./tunnel";
import { MirrorRunner, type MirrorIo } from "./useMirror";

const hello = (methods?: string[]): Hello => ({ host: "h", os: "macos", herdlingd: "0.2.1", herdr_ok: true, methods });
const dev = (p: Partial<MirrorDevice>): MirrorDevice => ({ id: "ios:AAAAAAAA-0000", platform: "ios", kind: "simulator", name: "iPhone", video: true, input: true, ...p });
const G = "0123456789abcdef0123456789abcdef";
const start = (p: Partial<MirrorStart> = {}): MirrorStart => ({
  device: "ios:AAAAAAAA-0000",
  platform: "ios",
  name: "iPhone",
  port: 50123,
  path: `/m/${G}/`,
  grant: G,
  expires_at: 1,
  source: "video",
  input: true,
  ...p,
});

test("mirrorSupported_needs_both_methods_the_web_view_the_tunnel_and_no_demo", () => {
  const all = { webView: true, nativeProxy: true, demo: false };
  const methods = ["devices.list", "mirror.start", "mirror.stop"];
  expect(mirrorSupported(hello(methods), all)).toBe(true);
  expect(mirrorSupported(hello(["devices.list"]), all)).toBe(false);
  expect(mirrorSupported(hello(), all)).toBe(false);
  expect(mirrorSupported(undefined, all)).toBe(false);
  expect(mirrorSupported(hello(methods), { ...all, webView: false })).toBe(false);
  expect(mirrorSupported(hello(methods), { ...all, nativeProxy: false })).toBe(false);
  expect(mirrorSupported(hello(methods), { ...all, demo: true })).toBe(false);
});

test("the_list_offers_simulators_and_emulators_and_hides_real_devices", () => {
  const { devices, hidden } = offeredDevices([
    dev({ id: "android:emulator-5556", platform: "android", kind: "emulator", name: "Pixel B" }),
    dev({ id: "android:192.0.2.1:5555", platform: "android", kind: "device", name: "TV" }),
    dev({ id: "ios:BBBBBBBB", name: "iPhone Z" }),
    dev({ id: "android:emulator-5554", platform: "android", kind: "emulator", name: "Pixel A" }),
  ]);
  expect(devices.map((d) => d.name)).toEqual(["iPhone Z", "Pixel A", "Pixel B"]);
  expect(hidden).toBe(1);
  expect(emptyMessage(0)).toMatch(/^No booted simulator/);
  expect(emptyMessage(2)).toMatch(/2 real devices are not shown\.$/);
});

test("detail_lines_and_tool_hints", () => {
  expect(deviceDetail(dev({ os: "iOS 26.5" }))).toBe("iOS 26.5 · Video and touch");
  expect(deviceDetail(dev({ video: false, input: false }))).toBe("iOS simulator · Screenshots, view only");
  expect(deviceDetail(dev({ platform: "android", kind: "emulator", os: "Android 15", video: true, input: true }))).toBe("Android 15 · Video and touch");
  expect(toolHints({ xcrun: true, idb: true, adb: true }, true)).toEqual([]);
  expect(toolHints({ xcrun: true, idb: false, adb: true }, true)).toEqual([expect.stringMatching(/idb/)]);
  expect(toolHints({ xcrun: false, idb: false, adb: false }, true)).toHaveLength(2);
  // Linux: no iOS hints.
  expect(toolHints({ xcrun: false, idb: false, adb: false }, false)).toEqual([expect.stringMatching(/adb/)]);
});

test("start_results_and_ids_are_checked", () => {
  expect(validStart(start())).toBe(true);
  expect(validStart(start({ port: 0 }))).toBe(false);
  expect(validStart(start({ path: "/../" }))).toBe(false);
  expect(validStart(start({ path: `http://evil.test/m/${G}/` }))).toBe(false);
  expect(validStart(start({ grant: "x" }))).toBe(false);
  expect(validStart(undefined)).toBe(false);
  expect(validDeviceId("ios:269EBED9-ADE0-4AF4-9067-6B649B12BCCB")).toBe(true);
  expect(validDeviceId("android:emulator-5554")).toBe(true);
  expect(validDeviceId("android:-x")).toBe(false);
  expect(validDeviceId("ios:../x")).toBe(false);
  expect(validDeviceId(undefined)).toBe(false);
  expect(mirrorRoute("h1", { id: "android:emulator-5554", name: "Pixel 8", platform: "android" })).toBe(
    "/mirror/h1/android%3Aemulator-5554?name=Pixel%208&platform=android",
  );
});

test("page_messages_and_commands", () => {
  expect(parsePageMessage(JSON.stringify({ type: "mirror", state: "streaming", source: "video", input: true, platform: "ios" }))).toEqual({
    state: "streaming",
    source: "video",
    input: true,
    platform: "ios",
    error: undefined,
  });
  expect(parsePageMessage(JSON.stringify({ type: "mirror", state: "hacked" }))).toBeUndefined();
  expect(parsePageMessage(JSON.stringify({ type: "other", state: "streaming" }))).toBeUndefined();
  expect(parsePageMessage("not json")).toBeUndefined();
  expect(toolbarKeys("ios").map((k) => k.key)).toEqual(["home", "lock"]);
  expect(toolbarKeys("android").map((k) => k.key)).toEqual(["back", "home", "app_switch"]);
  expect(JSON.parse(keyCommand("home"))).toEqual({ t: "key", key: "home" });
  expect(JSON.parse(textCommand("hi")!)).toEqual({ t: "text", text: "hi" });
  expect(textCommand("")).toBeUndefined();
  expect(JSON.parse(textCommand("x".repeat(5000))!).text).toHaveLength(1000);
  expect(JSON.parse(rotateCommand())).toEqual({ t: "rotate" });
  expect(statusLine(undefined)).toBe("Connecting to the device…");
  expect(statusLine({ state: "streaming", source: "video", input: true })).toBeUndefined();
  expect(statusLine({ state: "streaming", source: "screenshots", input: false })).toBe("Screenshots, not video, view only");
  expect(statusLine({ state: "waiting", input: true, error: "The scrcpy stream ended" })).toBe("The scrcpy stream ended");
});

test("urls_stay_on_the_mirror_page", () => {
  expect(mirrorUrl(50123, `/m/${G}/`)).toBe(`http://localhost:50123/m/${G}/`);
  expect(staysInMirror(`http://localhost:50123/m/${G}/`, 50123, `/m/${G}/`)).toBe(true);
  expect(staysInMirror(`http://localhost:50123/other`, 50123, `/m/${G}/`)).toBe(false);
  expect(staysInMirror(`https://example.com/`, 50123, `/m/${G}/`)).toBe(false);
});

function steps(events: MirrorEvent[], from: MirrorTunnel = initialTunnel) {
  let s = from;
  const effects = [];
  for (const e of events) {
    const r = reduceTunnel(s, e);
    s = r.state;
    effects.push(r.effects);
  }
  return { s, effects };
}

test("the_tunnel_starts_opens_and_gets_ready", () => {
  const { s, effects } = steps([
    { type: "begin", now: 1 },
    { type: "started", gen: 1, result: start() },
    { type: "tunnelOpen", gen: 1, localPort: 50999, now: 5 },
  ]);
  expect(effects[0]).toEqual([{ type: "start", gen: 1 }]);
  expect(effects[1]).toEqual([{ type: "openTunnel", gen: 1, port: 50123, grant: G }]);
  expect(s).toMatchObject({ phase: "ready", gen: 1, localPort: 50999, started: 5 });
  // Close releases the phone side and the grant, and stops the mirror.
  expect(reduceTunnel(s, { type: "close" }).effects).toEqual([
    { type: "stopTunnel", localPort: 50999 },
    { type: "closeGrant", grant: G },
    { type: "stopMirror" },
  ]);
  // Pause releases the phone side but keeps the mirror on the computer.
  const paused = reduceTunnel(s, { type: "pause" });
  expect(paused.state.phase).toBe("paused");
  expect(paused.effects).toEqual([{ type: "stopTunnel", localPort: 50999 }, { type: "closeGrant", grant: G }]);
});

test("late_results_of_old_attempts_are_released", () => {
  const { s } = steps([{ type: "begin", now: 1 }, { type: "pause" }, { type: "begin", now: 2 }]);
  expect(s).toEqual({ phase: "starting", gen: 3 });
  expect(reduceTunnel(s, { type: "started", gen: 1, result: start() }).effects).toEqual([{ type: "closeGrant", grant: G }]);
  expect(reduceTunnel(s, { type: "tunnelOpen", gen: 1, localPort: 7, now: 0 }).effects).toEqual([{ type: "stopTunnel", localPort: 7 }]);
  expect(reduceTunnel(s, { type: "failed", gen: 1, message: "x" }).state).toBe(s);
  const closed = reduceTunnel(s, { type: "close" }).state;
  expect(reduceTunnel(closed, { type: "started", gen: 3, result: start() }).effects).toEqual([{ type: "closeGrant", grant: G }]);
  expect(reduceTunnel(closed, { type: "begin", now: 9 }).state.phase).toBe("starting");
});

test("a_bad_start_result_or_a_failure_is_an_error_and_retry_begins_again", () => {
  const bad = steps([{ type: "begin", now: 1 }, { type: "started", gen: 1, result: start({ path: "/x" }) }]);
  expect(bad.s).toMatchObject({ phase: "error", message: expect.stringMatching(/bad mirror address/) });
  const failed = steps([
    { type: "begin", now: 1 },
    { type: "started", gen: 1, result: start() },
    { type: "failed", gen: 1, message: "no channel" },
  ]);
  expect(failed.s).toMatchObject({ phase: "error", message: "no channel" });
  expect(failed.effects[2]).toEqual([{ type: "closeGrant", grant: G }]);
  expect(reduceTunnel(failed.s, { type: "begin", now: 3 }).effects).toEqual([{ type: "start", gen: 2 }]);
});

test("the_runner_calls_mirror_start_opens_the_tunnel_and_stops_on_close", async () => {
  const calls: [string, object][] = [];
  const io: MirrorIo = {
    call: <T,>(method: string, params: object) => {
      calls.push([method, params]);
      return Promise.resolve((method === "mirror.start" ? start() : {}) as T);
    },
    startPreview: jest.fn(async () => ({ localPort: 50999 })),
    stopPreview: jest.fn(async () => undefined),
    command: () => "~/.local/bin/herdlingd rpc",
  };
  const r = new MirrorRunner("ios:AAAAAAAA-0000", io);
  const seen: string[] = [];
  r.subscribe((s) => seen.push(s.phase));
  r.send({ type: "begin", now: 1 });
  await new Promise((res) => setTimeout(res, 0));
  await new Promise((res) => setTimeout(res, 0));
  expect(io.startPreview).toHaveBeenCalledWith(50123, `~/.local/bin/herdlingd proxy 50123 ${G}`);
  expect(r.state.phase).toBe("ready");
  r.send({ type: "close" });
  expect(io.stopPreview).toHaveBeenCalledWith(50999);
  expect(calls.map((c) => c[0])).toEqual(["mirror.start", "preview.close", "mirror.stop"]);
  expect(seen).toEqual(["starting", "opening", "ready", "closed"]);
});
