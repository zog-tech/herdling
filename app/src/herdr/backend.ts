/**
 * Herdr 2 (herdr-core) entries in the herdr snapshot. herdlingd merges the core terminals into the
 * herdr 1 snapshot: the same arrays and field names, plus `backend: "core"` and ids with the `hc:`
 * prefix. On an older herdlingd a core entry supports fewer actions; a herdlingd with the plan C
 * methods supports them all. This module holds the one rule for that, so the screens do not check
 * ids or methods themselves.
 */
import type { Hello } from "@herdling/protocol";
import { create } from "zustand";

import { RpcError } from "@/rpc/RpcClient";

/** The id prefix of every Herdr 2 entry (pane, tab and workspace). */
export const CORE_ID_PREFIX = "hc:";

/** The error code of a herdr method that a Herdr 2 pane does not have. */
export const CORE_UNSUPPORTED = "unsupported";

/** A snapshot entry, or only its id. */
export type BackendTarget =
  | string
  | { backend?: string | null; pane_id?: string; tab_id?: string; workspace_id?: string }
  | null
  | undefined;

/**
 * True for a Herdr 2 entry: `backend` is "core", or its id starts with `hc:`. For an entry, the
 * own id counts: the pane id of an agent or a pane, else the tab id, else the workspace id.
 * An empty id does not count.
 */
export function isCore(t: BackendTarget): boolean {
  if (!t) return false;
  if (typeof t === "string") return t.startsWith(CORE_ID_PREFIX);
  if (t.backend === "core") return true;
  const id = [t.pane_id, t.tab_id, t.workspace_id].find((x) => typeof x === "string" && x !== "");
  return !!id && id.startsWith(CORE_ID_PREFIX);
}

/**
 * The herdr 1 actions. A Herdr 2 pane of an older herdlingd (0.1.x) has none of them: it can show
 * its screen, take input and keys, answer a permission menu, show its git changes, ports and
 * commands, and close.
 * - `rename`: the agent, pane, tab or workspace name.
 * - `restart`, `resume`: they start a new agent in the same workspace.
 * - `newTab`: a new tab, agent or worktree inside the workspace.
 * - `explain`: "Why this status?" (`agent.explain`).
 * - `closeGroup`: the close of a whole tab or workspace.
 * - `shellWatch`: "Notify me when it finishes".
 * - `thread`: the chat view.
 */
export type HerdrOneAction = "rename" | "restart" | "resume" | "newTab" | "explain" | "closeGroup" | "shellWatch" | "thread";

/** Every herdr 1 action. A host with the core actions (`coreActions`) has each of them for a Herdr 2 entry too. */
export const HERDR_ONE_ACTIONS: readonly HerdrOneAction[] = ["rename", "restart", "resume", "newTab", "explain", "closeGroup", "shellWatch", "thread"];

/**
 * The method that marks a herdlingd with the Herdr 2 meaning of every herdr 1 action (plan C).
 * The same release added `groups.list`, `pane.move` and `session.start`.
 */
export const CORE_ACTIONS_METHOD = "session.start";

/** True when the host gives every herdr 1 action a Herdr 2 meaning. An older herdlingd does not list the method. */
export function coreActions(hello: Pick<Hello, "methods"> | undefined): boolean {
  return hello?.methods?.includes(CORE_ACTIONS_METHOD) ?? false;
}

/** The hosts that have the core actions. The connection sets it on each `hello` (`setCoreActions`). */
export const useCoreActions = create<{ hosts: Record<string, true> }>(() => ({ hosts: {} }));

/** Stores whether `hostId` has the core actions. A host with no `hello` (offline) keeps the last value. */
export function setCoreActions(hostId: string, hello: Pick<Hello, "methods"> | undefined): void {
  if (!hello) return;
  const on = coreActions(hello);
  useCoreActions.setState((s) => {
    if (!!s.hosts[hostId] === on) return s;
    const hosts = { ...s.hosts };
    if (on) hosts[hostId] = true;
    else delete hosts[hostId];
    return { hosts };
  });
}

/** True when `hostId` has the core actions. No host id: false (the old rule). */
export function hostHasCoreActions(hostId: string | undefined): boolean {
  return !!hostId && !!useCoreActions.getState().hosts[hostId];
}

/**
 * True when the app can offer `action` for the entry. Every herdr 1 entry allows every action. A
 * Herdr 2 entry allows them only on a host with the core actions (`hostId` names the host).
 */
export function allows(t: BackendTarget, action: HerdrOneAction, hostId?: string): boolean {
  return !isCore(t) || (hostHasCoreActions(hostId) && HERDR_ONE_ACTIONS.includes(action));
}

/** The text of the error when an action needs a newer herdlingd. */
export const CORE_UNSUPPORTED_TEXT = "Update herdlingd on this computer to do this with a Herdr 2 terminal.";

/**
 * Throws an `RpcError` with the code `unsupported` when the entry does not allow `action`.
 * The actions call it first, so a deep link to a Herdr 2 pane fails with a clear message.
 */
export function assertAllows(t: BackendTarget, action: HerdrOneAction, hostId?: string): void {
  if (!allows(t, action, hostId)) throw new RpcError(CORE_UNSUPPORTED, CORE_UNSUPPORTED_TEXT);
}

/**
 * The rename kinds of an entry. A Herdr 2 entry has only the task name (the `herdling.name`
 * label): the Herdr app owns the names of its spaces and tabs.
 */
export function renameKindsFor(t: BackendTarget): ("session" | "tab" | "workspace")[] {
  return isCore(t) ? ["session"] : ["session", "tab", "workspace"];
}
