import { create } from "zustand";
import { persist } from "zustand/middleware";

import { AGENT_KINDS, DEFAULT_KIND } from "@/herdr/agentKinds";
import { secureJSONStorage } from "@/secureStorage";

type Store = { byHost: Record<string, string> };

/** The last agent kind started on each host, persisted. New session opens with it. */
export const useAgentMemory = create<Store>()(
  persist(() => ({ byHost: {} }) as Store, { name: "herdling.new_session_agent", storage: secureJSONStorage() }),
);

/** The kind to preselect for `hostId`: the remembered one, else Claude Code. An unknown kind falls back too. */
export function agentFor(byHost: Record<string, string>, hostId: string | undefined): string {
  const k = hostId ? byHost[hostId] : undefined;
  return k && (AGENT_KINDS as readonly string[]).includes(k) ? k : DEFAULT_KIND;
}

export function rememberAgent(hostId: string, kind: string): void {
  useAgentMemory.setState((s) => (s.byHost[hostId] === kind ? s : { byHost: { ...s.byHost, [hostId]: kind } }));
}
