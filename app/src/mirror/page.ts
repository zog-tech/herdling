/**
 * The messages between the mirror screen and the player page of herdlingd. The app sends
 * commands with `postMessage`; the page posts its state with `ReactNativeWebView.postMessage`.
 */
import type { DevicePlatform } from "@herdling/protocol";

/** A key of the toolbar, as the page names it. */
export type MirrorKey = "home" | "back" | "app_switch" | "lock" | "volume_up" | "volume_down";

/** The longest text of one send, as herdlingd accepts it. */
export const MAX_TEXT = 1000;

/** What the page tells the app. */
export type PageState = {
  state: "connecting" | "starting" | "streaming" | "waiting" | "stopped" | "closed";
  source?: "video" | "screenshots";
  input: boolean;
  platform?: DevicePlatform;
  error?: string;
};

const STATES = new Set(["connecting", "starting", "streaming", "waiting", "stopped", "closed"]);

/** Reads a message of the page. Anything else gives undefined. */
export function parsePageMessage(data: string): PageState | undefined {
  let m: unknown;
  try {
    m = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (!m || typeof m !== "object") return undefined;
  const o = m as Record<string, unknown>;
  if (o.type !== "mirror" || typeof o.state !== "string" || !STATES.has(o.state)) return undefined;
  return {
    state: o.state as PageState["state"],
    source: o.source === "video" || o.source === "screenshots" ? o.source : undefined,
    input: o.input === true,
    platform: o.platform === "ios" || o.platform === "android" ? o.platform : undefined,
    error: typeof o.error === "string" ? o.error.slice(0, 300) : undefined,
  };
}

/** The toolbar keys of a platform, in order. iOS simulators have no Back key. */
export function toolbarKeys(platform: DevicePlatform): { key: MirrorKey; label: string }[] {
  if (platform === "ios") return [{ key: "home", label: "Home" }, { key: "lock", label: "Lock" }];
  return [
    { key: "back", label: "Back" },
    { key: "home", label: "Home" },
    { key: "app_switch", label: "Recent apps" },
  ];
}

/** The command for a key. */
export function keyCommand(key: MirrorKey): string {
  return JSON.stringify({ t: "key", key });
}

/** The command that types text on the device, or undefined for empty text. */
export function textCommand(text: string): string | undefined {
  const t = text.slice(0, MAX_TEXT);
  return t.length > 0 ? JSON.stringify({ t: "text", text: t }) : undefined;
}

/** The command that turns an Android emulator. */
export function rotateCommand(): string {
  return JSON.stringify({ t: "rotate" });
}

/** The status line under the device, or undefined when the stream runs with no note. */
export function statusLine(s: PageState | undefined): string | undefined {
  if (!s || s.state === "connecting") return "Connecting to the device…";
  if (s.error) return s.error;
  if (s.state === "starting") return "Starting the device stream…";
  if (s.state === "streaming") {
    const parts: string[] = [];
    if (s.source === "screenshots") parts.push("Screenshots, not video");
    if (!s.input) parts.push("view only");
    return parts.length ? parts.join(", ") : undefined;
  }
  if (s.state === "waiting") return "Waiting for the device.";
  return "The mirror stopped.";
}
