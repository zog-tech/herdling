import type { AgentsInstalled, Hello } from "@herdling/protocol";

import { PICKER_KINDS } from "@/herdr/agentKinds";
import { listsMethod } from "@/hosts/methods";
import type { RpcClient } from "@/rpc/RpcClient";

export type Availability = "installed" | "missing" | "unknown";

/**
 * Which agents the host has (`agents.installed`, herdlingd 0.1.1). Undefined when the host does
 * not list the method or the call fails: then the picker shows every agent normally.
 */
export async function fetchInstalled(rpc: Pick<RpcClient, "call">, hello: Hello | undefined): Promise<AgentsInstalled | undefined> {
  if (!listsMethod(hello, "agents.installed")) return undefined;
  try {
    const r = await rpc.call<AgentsInstalled>("agents.installed", {});
    return Array.isArray(r?.installed) && Array.isArray(r?.missing) ? r : undefined;
  } catch {
    return undefined;
  }
}

export function availability(kind: string, info: AgentsInstalled | undefined): Availability {
  if (info?.installed.includes(kind)) return "installed";
  if (info?.missing.includes(kind)) return "missing";
  return "unknown";
}

/** Picker order with the agents that are not installed moved to the end. The order stays stable otherwise. */
export function pickerOrder(info: AgentsInstalled | undefined): string[] {
  const missing = (k: string) => availability(k, info) === "missing";
  return [...PICKER_KINDS.filter((k) => !missing(k)), ...PICKER_KINDS.filter(missing)];
}
