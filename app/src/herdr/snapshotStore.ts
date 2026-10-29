import { create } from "zustand";

import type { Snapshot } from "./snapshot";

type State = { byHost: Record<string, Snapshot>; errors: Record<string, string> };

/** Latest snapshot (and fetch error) per host, so screens can combine hosts (for example "Needs you"). */
export const useSnapshots = create<State>(() => ({ byHost: {}, errors: {} }));

export function setHostSnapshot(hostId: string, snapshot: Snapshot | undefined, error?: string): void {
  useSnapshots.setState((s) => {
    const { [hostId]: _a, ...byHost } = s.byHost;
    const { [hostId]: _b, ...errors } = s.errors;
    return {
      byHost: snapshot ? { ...byHost, [hostId]: snapshot } : byHost,
      errors: error ? { ...errors, [hostId]: error } : errors,
    };
  });
}
