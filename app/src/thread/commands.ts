import type { CommandInfo, CommandList } from "@herdling/protocol";
import { useEffect, useState } from "react";

import { useSnapshots } from "@/herdr/snapshotStore";
import { useHostConn } from "@/hosts/connection";
import { hasMethod } from "@/hosts/methods";
import type { RpcClient } from "@/rpc/RpcClient";

/**
 * The text after `/` while the user types a command name: the text starts with `/` and has no
 * space yet. Otherwise `undefined`.
 */
export function slashQuery(text: string): string | undefined {
  return text.startsWith("/") && !/\s/.test(text) ? text.slice(1) : undefined;
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

/** True when the agent kind is unknown or Claude. The list only makes sense for Claude Code. */
export function commandsApply(kind: string | undefined): boolean {
  return !kind || kind === "unknown" || kind === "claude";
}

/** Lists for the app session, by host and folder (or pane when the folder is unknown). */
const cache = new Map<string, Promise<CommandInfo[]>>();

/** Clears the cache. For tests. */
export function clearCommandsCache(): void {
  cache.clear();
}

function load(rpc: RpcClient, key: string, paneId: string, cwd: string | undefined): Promise<CommandInfo[]> {
  let p = cache.get(key);
  if (!p) {
    p = rpc
      .call<CommandList>("commands.list", cwd ? { pane_id: paneId, cwd } : { pane_id: paneId })
      .then((r) => r.commands ?? []);
    // A failed call is not kept: the next request tries again.
    p.catch(() => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/**
 * The slash commands of the pane. The host is asked once, when `wanted` first becomes true;
 * the result is kept for the app session. `supported` is false when the host lacks
 * `commands.list` or the agent is not Claude.
 */
export function useCommands(
  hostId: string,
  paneId: string,
  wanted: boolean,
): { supported: boolean; commands: CommandInfo[] | undefined } {
  const { rpc, hello, status } = useHostConn(hostId);
  const agent = useSnapshots((s) => s.byHost[hostId]?.agents.find((a) => a.pane_id === paneId));
  const kind = agent?.agent;
  const cwd = agent?.cwd;
  const supported = hasMethod(hello, "commands.list") && commandsApply(kind);
  const key = `${hostId}\n${cwd ?? `pane:${paneId}`}`;
  const [got, setGot] = useState<{ key: string; commands: CommandInfo[] }>();

  useEffect(() => {
    if (!wanted || !supported || !rpc || status !== "online" || got?.key === key) return;
    let live = true;
    load(rpc, key, paneId, cwd).then(
      (commands) => {
        if (live) setGot({ key, commands });
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [wanted, supported, rpc, status, key, paneId, cwd, got?.key]);

  return { supported, commands: got?.key === key ? got.commands : undefined };
}
