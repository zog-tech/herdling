/**
 * Device mirror rules with no native parts: when the feature shows, which devices the list
 * offers, the detail lines and tool hints, and the checks of a `mirror.start` result. The screens
 * are `app/devices/[hostId].tsx` and `app/mirror/[hostId]/[device].tsx`.
 */
import type { DevicesList, Hello, MirrorDevice, MirrorStart } from "@herdling/protocol";

import { listsMethod } from "@/hosts/methods";

/**
 * True when the device mirror shows for a host: the host lists `mirror.start`, the build has the
 * web view and the preview tunnel, and the host is not the demo host (it has no simulator).
 */
export function mirrorSupported(hello: Hello | undefined, o: { webView: boolean; nativeProxy: boolean; demo: boolean }): boolean {
  return !o.demo && o.webView && o.nativeProxy && listsMethod(hello, "mirror.start") && listsMethod(hello, "devices.list");
}

/** The devices that the list offers (simulators and emulators) and the count of real devices it hides. */
export function offeredDevices(list: MirrorDevice[]): { devices: MirrorDevice[]; hidden: number } {
  const devices = list.filter((d) => d.kind === "simulator" || d.kind === "emulator");
  const order = (d: MirrorDevice) => (d.platform === "ios" ? 0 : 1);
  devices.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return { devices, hidden: list.length - devices.length };
}

/** The detail line of a device row: "iOS 26.5 · Video and touch", "Android 15 · Screenshots, view only". */
export function deviceDetail(d: MirrorDevice): string {
  const how = d.video ? (d.input ? "Video and touch" : "Video, view only") : d.input ? "Screenshots and touch" : "Screenshots, view only";
  return [d.os ?? (d.platform === "ios" ? "iOS simulator" : "Android emulator"), how].join(" · ");
}

/** Hints for the tools that herdlingd did not find. `macos`: the computer is a Mac. */
export function toolHints(tools: DevicesList["tools"], macos: boolean): string[] {
  const hints: string[] = [];
  if (macos && !tools.xcrun) hints.push("Install Xcode to see iOS simulators.");
  if (macos && tools.xcrun && !tools.idb) hints.push("Install idb (fb-idb and idb-companion) for video and touch on iOS simulators.");
  if (!tools.adb) hints.push("Install the Android SDK platform tools (adb) to see Android emulators.");
  return hints;
}

/** The message of an empty list. */
export function emptyMessage(hidden: number): string {
  const base = "No booted simulator or running emulator on this computer. Start one, then pull to refresh.";
  if (hidden === 0) return base;
  return `${base} ${hidden === 1 ? "1 real device is" : `${hidden} real devices are`} not shown.`;
}

const PATH = /^\/m\/[0-9a-f]{32}\/$/;
const GRANT = /^[0-9a-f]{32}$/;

/** True when a `mirror.start` result is safe to open: a valid port, the page path and a grant. */
export function validStart(r: MirrorStart | undefined): r is MirrorStart {
  return !!r && Number.isInteger(r.port) && r.port >= 1 && r.port <= 65535 && PATH.test(r.path) && GRANT.test(r.grant);
}

/** True when a device id has the form of `devices.list` ids. */
export function validDeviceId(id: string | undefined): id is string {
  return !!id && /^(ios:[0-9A-Fa-f-]{8,64}|android:[A-Za-z0-9._:-]{1,64})$/.test(id) && !id.startsWith("android:-");
}

/** The route of the mirror screen of a device. */
export function mirrorRoute(hostId: string, d: Pick<MirrorDevice, "id" | "name" | "platform">): string {
  const q = `name=${encodeURIComponent(d.name)}&platform=${d.platform}`;
  return `/mirror/${encodeURIComponent(hostId)}/${encodeURIComponent(d.id)}?${q}`;
}
