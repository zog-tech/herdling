import type { Hello, HerdrUpdate } from "@herdling/protocol";

import { getHostConn, retryNow } from "./connection";
import { listsMethod } from "./methods";
import { waitForHello } from "./updates";

/**
 * herdr updates from the phone: `herdr.update` runs `herdr update --handoff` on the computer.
 *
 * The flow is a pure state machine: idle → confirming → running → done or failed. The card
 * (`HerdrUpdateCard`) sends the events and runs the effects. Each run has a generation, so a
 * late result of an old run cannot change a newer state. Only "confirming" accepts "confirm", so
 * one card cannot start two runs. herdlingd holds a file lock for the runs of other phones.
 */

/** `herdr update` downloads, installs and hands off the live panes. herdlingd stops it after 180 s. */
export const HERDR_UPDATE_TIMEOUT_MS = 190_000;
/** How long to wait for the host to connect again after the update. */
const RECONNECT_WAIT_MS = 30_000;

export type HerdrUpdateState =
  | { phase: "idle"; gen: number }
  | { phase: "confirming"; gen: number }
  | { phase: "running"; gen: number }
  | { phase: "done"; gen: number; text: string; output?: string }
  | { phase: "failed"; gen: number; text: string };

export type HerdrUpdateEvent =
  /** The user tapped "Update herdr". */
  | { type: "press" }
  | { type: "confirm" }
  | { type: "cancel" }
  /** The run of generation `gen` finished. `output` is shown under the text, when present. */
  | { type: "succeeded"; gen: number; text: string; output?: string }
  | { type: "failed"; gen: number; text: string };

export type HerdrUpdateEffect = { type: "ask" } | { type: "run"; gen: number };

type Result = { state: HerdrUpdateState; effects: HerdrUpdateEffect[] };

export const initialHerdrUpdate: HerdrUpdateState = { phase: "idle", gen: 0 };

const same = (state: HerdrUpdateState): Result => ({ state, effects: [] });

export function reducer(state: HerdrUpdateState, event: HerdrUpdateEvent): Result {
  switch (event.type) {
    case "press":
      // A new run can start after a result, not while one is asked for or runs.
      if (state.phase === "confirming" || state.phase === "running") return same(state);
      return { state: { phase: "confirming", gen: state.gen }, effects: [{ type: "ask" }] };
    case "cancel":
      return state.phase === "confirming" ? same({ phase: "idle", gen: state.gen }) : same(state);
    case "confirm": {
      if (state.phase !== "confirming") return same(state);
      const gen = state.gen + 1;
      return { state: { phase: "running", gen }, effects: [{ type: "run", gen }] };
    }
    case "succeeded":
      if (state.phase !== "running" || event.gen !== state.gen) return same(state);
      return same({ phase: "done", gen: state.gen, text: event.text, output: event.output });
    case "failed":
      if (state.phase !== "running" || event.gen !== state.gen) return same(state);
      return same({ phase: "failed", gen: state.gen, text: event.text });
  }
}

/** True when the card shows: the host lists `herdr.update`. */
export function canUpdateHerdr(hello: Hello | undefined): boolean {
  return listsMethod(hello, "herdr.update");
}

export const CONFIRM_TITLE = "Update herdr?";
export const CONFIRM_BODY =
  "herdr tries to keep your sessions running. If it cannot, herdr restarts: running commands and agents stop. " +
  "herdr then restores your workspaces, tabs and folders, and resumes Claude Code and Codex chats when their integration is installed.";

/** The result text. It says that the sessions kept running only when herdr reported a complete handoff. */
export function outcome(r: HerdrUpdate, runningVersion?: string): { text: string; output?: string } {
  const to = r.to ?? runningVersion;
  if (r.status === "up_to_date") return { text: to ? `herdr ${to} is already up to date.` : "herdr is already up to date." };
  const updated = to ? `Updated to ${to}.` : "herdr is updated.";
  if (r.handoff === "complete") return { text: `${updated} Sessions kept running.` };
  const output = r.output.trim();
  return { text: updated, output: output === "" ? undefined : output };
}

/** Text for a failed `herdr.update`. */
export function herdrUpdateErrorMessage(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  const message = e instanceof Error ? e.message : "";
  switch (code) {
    case "managed_install":
      return "herdr is installed with a package manager (Homebrew, mise or Nix). Update it there.";
    case "not_installed":
      return "herdlingd cannot find herdr on this computer.";
    case "busy":
      return "A herdr update is already running on this computer. Wait a moment, then try again.";
    case "timeout":
      return "The herdr update took too long and stopped. Check the herdr version, then try again.";
    case "disconnected":
      return "The connection closed during the update. Check the herdr version when the host is online again.";
    default:
      return `The herdr update failed${message ? `: ${message.slice(0, 600)}` : "."}`;
  }
}

/**
 * Runs `herdr.update`, then reconnects so that `hello.herdr_version` shows the running server.
 * Returns the result text. Throws with a user text.
 */
export async function runHerdrUpdate(hostId: string, waitMs = RECONNECT_WAIT_MS): Promise<{ text: string; output?: string }> {
  const conn = getHostConn(hostId);
  if (conn.status !== "online" || !conn.rpc) throw new Error("The host is offline. Connect it first.");
  let r: HerdrUpdate;
  try {
    r = await conn.rpc.call<HerdrUpdate>("herdr.update", {}, HERDR_UPDATE_TIMEOUT_MS);
  } catch (e) {
    throw new Error(herdrUpdateErrorMessage(e));
  }
  if (r.status === "up_to_date") return outcome(r, conn.hello?.herdr_version);
  // A new hello reads the version of the herdr server that runs now.
  const attempt = retryNow(hostId);
  const hello = await waitForHello(hostId, attempt, waitMs);
  return outcome(r, hello?.herdr_version);
}
