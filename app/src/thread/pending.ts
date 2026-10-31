import type { ThreadItem } from "@herdling/protocol";
import { create } from "zustand";

import type { RpcClient } from "@/rpc/RpcClient";

/**
 * Prompts the user sent that the thread log does not show yet. Each one shows as a user bubble at
 * the end of the thread with a state line, until the log has a user item with the same text.
 * In memory only: they survive leaving and opening the session again, not an app restart.
 */

/** `sending`: the call is in flight. `queued`: the agent took it, the log has no copy yet. `failed`: the call failed. */
export type PendingState = "sending" | "queued" | "failed";

export type Pending = {
  id: string;
  text: string;
  /** Epoch ms of the (last) send. */
  sentAt: number;
  state: PendingState;
  error?: string;
  /**
   * Ids of log user items with the same text that the thread already had when this prompt was first
   * compared. They are older copies (the same prompt sent before) and never match.
   */
  before?: string[];
};

type State = { byPane: Record<string, Pending[]> };

export const usePending = create<State>(() => ({ byPane: {} }));

/** A pending prompt older than this goes away. */
export const PENDING_MAX_AGE_MS = 30 * 60_000;
/** Characters compared between a pending prompt and a log user item. */
const MATCH_CHARS = 200;

const paneKey = (hostId: string, paneId: string) => `${hostId}:${paneId}`;
/** A line that is only the path of a photo the app uploaded (`files.put` saves to `.cache/herdling/uploads/`). */
const UPLOAD_LINE = /^\s*\S*\/\.cache\/herdling\/uploads\/\S+\s*$/;
/** The placeholder Claude Code writes for an attached image ("[Image #12]"). */
const IMAGE_TAG = /\[Image #\d+\]/g;

/** The prompt without the upload path lines the app adds after the text, and how many there were. */
export function splitUploads(text: string): { text: string; images: number } {
  const lines = text.split("\n");
  const kept = lines.filter((l) => !UPLOAD_LINE.test(l));
  return { text: kept.join("\n").trim(), images: lines.length - kept.length };
}

/**
 * The text compared. Claude Code turns an image path into an attachment and writes "[Image #N]"
 * in its place, so both the paths and the placeholders go, and runs of white space become one space.
 */
export const matchKey = (text: string) =>
  splitUploads(text).text.replace(IMAGE_TAG, " ").replace(/\s+/g, " ").trim().slice(0, MATCH_CHARS);

let seq = 0;

function update(key: string, fn: (list: Pending[]) => Pending[]): void {
  usePending.setState((s) => {
    const cur = s.byPane[key] ?? [];
    const next = fn(cur);
    if (next === cur) return s;
    const byPane = { ...s.byPane };
    if (next.length > 0) byPane[key] = next;
    else delete byPane[key];
    return { byPane };
  });
}

export function addPending(hostId: string, paneId: string, text: string, now = Date.now()): string {
  const id = `p${++seq}`;
  update(paneKey(hostId, paneId), (list) => [...list, { id, text, sentAt: now, state: "sending" }]);
  return id;
}

export function setPendingState(hostId: string, paneId: string, id: string, state: PendingState, error?: string): void {
  update(paneKey(hostId, paneId), (list) =>
    list.some((p) => p.id === id) ? list.map((p) => (p.id === id ? { ...p, state, error } : p)) : list,
  );
}

export function removePending(hostId: string, paneId: string, id: string): void {
  update(paneKey(hostId, paneId), (list) => (list.some((p) => p.id === id) ? list.filter((p) => p.id !== id) : list));
}

/** Pending prompts of one pane, in send order. */
export function pendingOf(hostId: string, paneId: string): Pending[] {
  return usePending.getState().byPane[paneKey(hostId, paneId)] ?? [];
}

const EMPTY: Pending[] = [];
export function usePendingList(hostId: string, paneId: string): Pending[] {
  return usePending((s) => s.byPane[paneKey(hostId, paneId)] ?? EMPTY);
}

/**
 * Compares the pending prompts with the thread. A pending prompt goes away when a user item with
 * the same text (trimmed, first 200 chars) appears that was not there at the first compare. One
 * log item matches one pending prompt, oldest first. Prompts older than 30 min go away too.
 */
export function reconcilePending(hostId: string, paneId: string, items: ThreadItem[], now = Date.now()): void {
  update(paneKey(hostId, paneId), (list) => {
    if (list.length === 0) return list;
    const users = items.filter((i): i is Extract<ThreadItem, { kind: "user" }> => i.kind === "user");
    const used = new Set<string>();
    let changed = false;
    const next: Pending[] = [];
    for (const p of list) {
      if (now - p.sentAt > PENDING_MAX_AGE_MS) {
        changed = true;
        continue;
      }
      const key = matchKey(p.text);
      const same = users.filter((u) => matchKey(u.text) === key);
      if (!p.before) {
        // First compare: what is in the log now is older than this prompt.
        next.push({ ...p, before: same.map((u) => u.id) });
        changed = true;
        continue;
      }
      if (p.state !== "failed") {
        const hit = same.find((u) => !p.before!.includes(u.id) && !used.has(u.id));
        if (hit) {
          used.add(hit.id);
          changed = true;
          continue;
        }
      }
      next.push(p);
    }
    return changed ? next : list;
  });
}

type Rpc = Pick<RpcClient, "call">;

/**
 * Sends `text` to the agent with a pending bubble for it. With `retryId`, sends that failed bubble
 * again instead of adding one. Throws the send error after the bubble shows "Not sent".
 */
export async function sendWithPending(
  rpc: Rpc,
  hostId: string,
  paneId: string,
  text: string,
  retryId?: string,
): Promise<void> {
  let id = retryId;
  if (id) {
    const known = pendingOf(hostId, paneId).some((p) => p.id === id);
    if (!known) id = addPending(hostId, paneId, text);
    else {
      update(paneKey(hostId, paneId), (list) =>
        list.map((p) => (p.id === id ? { ...p, state: "sending", error: undefined, sentAt: Date.now() } : p)),
      );
    }
  } else id = addPending(hostId, paneId, text);
  try {
    await rpc.call("herdr.call", { method: "agent.prompt", params: { target: paneId, text } });
    setPendingState(hostId, paneId, id, "queued");
  } catch (e) {
    setPendingState(hostId, paneId, id, "failed", e instanceof Error ? e.message : String(e));
    throw e;
  }
}
