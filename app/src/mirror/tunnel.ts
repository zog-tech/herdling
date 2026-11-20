/**
 * The tunnel of one mirror screen as a pure state machine: `mirror.start` on the computer, then
 * the preview listener on the phone (`ssh.startPreview` with the grant), then the web view.
 *
 * Each attempt has a generation (`gen`). A late result of an older attempt is ignored, and what
 * it holds (a grant, a local port) is released. `useMirror` (useMirror.ts) sends the events and
 * runs the effects. Background and a lost connection release the phone side; the computer keeps
 * the mirror for a short grace time, so a return is fast. Close also stops the mirror.
 */
import type { MirrorStart } from "@herdling/protocol";

import { validStart } from "./devices";

export type MirrorTunnel =
  | { phase: "starting"; gen: number }
  | { phase: "opening"; gen: number; start: MirrorStart }
  | { phase: "ready"; gen: number; start: MirrorStart; localPort: number; started: number }
  | { phase: "paused"; gen: number }
  | { phase: "error"; gen: number; message: string }
  | { phase: "closed"; gen: number };

export type MirrorEvent =
  /** The screen shows with a connection (also after a reconnect or a retry). */
  | { type: "begin"; now: number }
  | { type: "started"; gen: number; result: MirrorStart }
  | { type: "tunnelOpen"; gen: number; localPort: number; now: number }
  | { type: "failed"; gen: number; message: string }
  /** The app left the foreground, or the connection dropped. */
  | { type: "pause" }
  | { type: "close" };

export type MirrorEffect =
  | { type: "start"; gen: number }
  | { type: "openTunnel"; gen: number; port: number; grant: string }
  | { type: "stopTunnel"; localPort: number }
  | { type: "closeGrant"; grant: string }
  | { type: "stopMirror" };

export const initialTunnel: MirrorTunnel = { phase: "starting", gen: 0 };

/** The effects that release what a state holds on the phone and the grant. */
function release(s: MirrorTunnel): MirrorEffect[] {
  const fx: MirrorEffect[] = [];
  if (s.phase === "ready") fx.push({ type: "stopTunnel", localPort: s.localPort });
  if (s.phase === "opening" || s.phase === "ready") fx.push({ type: "closeGrant", grant: s.start.grant });
  return fx;
}

/** One transition. Pure. */
export function reduceTunnel(s: MirrorTunnel, e: MirrorEvent): { state: MirrorTunnel; effects: MirrorEffect[] } {
  // A closed tunnel opens again only with "begin" (a remount, for example in development).
  if (s.phase === "closed" && e.type !== "begin") {
    // Late results after close: release them.
    if (e.type === "started" && validStart(e.result)) return { state: s, effects: [{ type: "closeGrant", grant: e.result.grant }] };
    if (e.type === "tunnelOpen") return { state: s, effects: [{ type: "stopTunnel", localPort: e.localPort }] };
    return { state: s, effects: [] };
  }
  switch (e.type) {
    case "begin": {
      const gen = s.gen + 1;
      return { state: { phase: "starting", gen }, effects: [...release(s), { type: "start", gen }] };
    }
    case "started": {
      if (e.gen !== s.gen || s.phase !== "starting") {
        return { state: s, effects: validStart(e.result) ? [{ type: "closeGrant", grant: e.result.grant }] : [] };
      }
      if (!validStart(e.result)) return { state: { phase: "error", gen: s.gen, message: "the computer sent a bad mirror address" }, effects: [] };
      return {
        state: { phase: "opening", gen: s.gen, start: e.result },
        effects: [{ type: "openTunnel", gen: s.gen, port: e.result.port, grant: e.result.grant }],
      };
    }
    case "tunnelOpen": {
      if (e.gen !== s.gen || s.phase !== "opening") return { state: s, effects: [{ type: "stopTunnel", localPort: e.localPort }] };
      return { state: { phase: "ready", gen: s.gen, start: s.start, localPort: e.localPort, started: e.now }, effects: [] };
    }
    case "failed": {
      if (e.gen !== s.gen || (s.phase !== "starting" && s.phase !== "opening")) return { state: s, effects: [] };
      return { state: { phase: "error", gen: s.gen, message: e.message }, effects: release(s) };
    }
    case "pause":
      if (s.phase === "paused" || s.phase === "error") return { state: s, effects: [] };
      return { state: { phase: "paused", gen: s.gen + 1 }, effects: release(s) };
    case "close":
      return { state: { phase: "closed", gen: s.gen + 1 }, effects: [...release(s), { type: "stopMirror" }] };
  }
}

/** The URL that the web view loads: the page path on the phone's local port. */
export function mirrorUrl(localPort: number, path: string): string {
  return `http://localhost:${localPort}${path}`;
}

/** True when the web view may load `url`: the mirror page itself, nothing else. */
export function staysInMirror(url: string, localPort: number, path: string): boolean {
  if (url === "about:blank") return true;
  return url === mirrorUrl(localPort, path) || url === `http://127.0.0.1:${localPort}${path}`;
}
