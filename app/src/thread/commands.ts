import type { CommandInfo, CommandList } from "@herdling/protocol";
import { useEffect, useState } from "react";

import { useSnapshots } from "@/herdr/snapshotStore";
import { useHostConn } from "@/hosts/connection";
import { hasMethod } from "@/hosts/methods";
import type { RpcClient } from "@/rpc/RpcClient";

export type Trigger = "/" | "$";

/**
 * The trigger and the text after it while the user types a command name: the text starts with one of
 * `triggers` and has no space yet. Otherwise `undefined`.
 */
export function commandQuery(text: string, triggers: readonly Trigger[]): { trigger: Trigger; query: string } | undefined {
  const trigger = triggers.find((t) => text.startsWith(t));
  return trigger && !/\s/.test(text) ? { trigger, query: text.slice(1) } : undefined;
}

/** The items that start with `trigger`. An item with no trigger starts with `/`. */
export function commandsFor(list: CommandInfo[], trigger: Trigger): CommandInfo[] {
  return list.filter((c) => (c.trigger ?? "/") === trigger);
}

/** The characters that open the picker for an agent kind. Codex skills start with `$`. */
export function commandTriggers(kind: string | undefined): readonly Trigger[] {
  return kind === "codex" ? ["/", "$"] : ["/"];
}

/** Names that start with `query` first, then names that contain it. Case is ignored; the list order is kept. */
export function filterCommands(list: CommandInfo[], query: string): CommandInfo[] {
  const q = query.toLowerCase();
  if (!q) return list;
  const prefix: CommandInfo[] = [];
  const inside: CommandInfo[] = [];
  for (const c of list) {
    const n = c.name.toLowerCase();
    if (n.startsWith(q)) prefix.push(c);
    else if (n.includes(q)) inside.push(c);
  }
  return [...prefix, ...inside];
}

/**
 * True when the host lists the agent kind in `command_kinds`. An unknown kind counts as Claude.
 * A host without that field knows only Claude.
 */
export function commandsApply(kind: string | undefined, commandKinds?: string[]): boolean {
  const k = !kind || kind === "unknown" ? "claude" : kind;
  return (commandKinds ?? ["claude"]).includes(k);
}

/** Lists for the app session, by host and folder (or pane when the folder is unknown). */
const cache = new Map<string, Promise<CommandInfo[]>>();

/** Clears the cache. For tests. */
export function clearCommandsCache(): void {
  cache.clear();
}

function load(rpc: RpcClient, key: string, paneId: string, cwd: string | undefined, kind: string | undefined): Promise<CommandInfo[]> {
  let p = cache.get(key);
  if (!p) {
    // Only Codex sends `kind`: the Claude call stays as before.
    const params: Record<string, string> = { pane_id: paneId };
    if (cwd) params.cwd = cwd;
    if (kind === "codex") params.kind = kind;
    p = rpc.call<CommandList>("commands.list", params).then((r) => r.commands ?? []);
    // A failed call is not kept: the next request tries again.
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/**
 * The commands of the pane. The host is asked once, when `wanted` first becomes true;
 * the result is kept for the app session. `supported` is false when the host lacks
 * `commands.list` or does not list the agent kind in `command_kinds`. `triggers` are the
 * characters that open the picker.
 */
export function useCommands(
  hostId: string,
  paneId: string,
  wanted: boolean,
): { supported: boolean; triggers: readonly Trigger[]; commands: CommandInfo[] | undefined } {
  const { rpc, hello, status } = useHostConn(hostId);
  const agent = useSnapshots((s) => s.byHost[hostId]?.agents.find((a) => a.pane_id === paneId));
  const kind = agent?.agent;
  const cwd = agent?.cwd;
  const supported = hasMethod(hello, "commands.list") && commandsApply(kind, hello?.command_kinds);
  const key = `${hostId}\n${kind === "codex" ? "codex" : "claude"}\n${cwd ?? `pane:${paneId}`}`;
  const [got, setGot] = useState<{ key: string; commands: CommandInfo[] }>();

  useEffect(() => {
    if (!wanted || !supported || !rpc || status !== "online" || got?.key === key) return;
    let live = true;
    load(rpc, key, paneId, cwd, kind).then(
      (commands) => {
        if (live) setGot({ key, commands });
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [wanted, supported, rpc, status, key, paneId, cwd, kind, got?.key]);

  return { supported, triggers: commandTriggers(kind), commands: got?.key === key ? got.commands : undefined };
}
