/**
 * Herdr 2 (herdr-core) entries in the herdr snapshot. herdlingd merges the core terminals into the
 * herdr 1 snapshot: the same arrays and field names, plus `backend: "core"` and ids with the `hc:`
 * prefix. A core entry supports fewer actions. This module holds the one rule for that, so the
 * screens do not check ids themselves.
 */
import { RpcError } from "@/rpc/RpcClient";

/** The id prefix of every Herdr 2 entry (pane, tab and workspace). */
export const CORE_ID_PREFIX = "hc:";

/** The short label of a Herdr 2 entry on the board. */
export const CORE_LABEL = "Herdr 2";

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
 * The actions that only herdr 1 has. A Herdr 2 pane can show its screen, take input and keys,
 * answer a permission menu, show its git changes, ports and commands, and close.
 * - `rename`: the agent, pane, tab or workspace name.
 * - `restart`, `resume`: they start a new agent in the same workspace.
 * - `newTab`: a new tab, agent or worktree inside the workspace.
 * - `explain`: "Why this status?" (`agent.explain`).
 * - `closeGroup`: the close of a whole tab or workspace.
 * - `shellWatch`: "Notify me when it finishes".
 * - `thread`: the chat view. Herdr 2 agents have no transcript yet.
 */
export type HerdrOneAction = "rename" | "restart" | "resume" | "newTab" | "explain" | "closeGroup" | "shellWatch" | "thread";

/** The herdr 1 actions that a Herdr 2 entry also has. Empty in this slice; a later slice adds to it. */
const CORE_HAS: ReadonlySet<HerdrOneAction> = new Set<HerdrOneAction>();

/** True when the app can offer `action` for the entry. Every herdr 1 entry allows every action. */
export function allows(t: BackendTarget, action: HerdrOneAction): boolean {
  return !isCore(t) || CORE_HAS.has(action);
}

/** The text of the error when an action needs herdr 1. */
export const CORE_UNSUPPORTED_TEXT = "This needs herdr 1. A Herdr 2 terminal does not have it yet.";

/**
 * Throws an `RpcError` with the code `unsupported` when the entry does not allow `action`.
 * The actions call it first, so a deep link to a Herdr 2 pane fails with a clear message.
 */
export function assertAllows(t: BackendTarget, action: HerdrOneAction): void {
  if (!allows(t, action)) throw new RpcError(CORE_UNSUPPORTED, CORE_UNSUPPORTED_TEXT);
}

/** The backend label for an entry: "Herdr 2" for a core entry, else undefined (herdr 1 shows none). */
export function backendLabel(t: BackendTarget): string | undefined {
  return isCore(t) ? CORE_LABEL : undefined;
}
