import { create } from "zustand";

import type { Snapshot } from "./snapshot";

/** Latest snapshot per host, so screens can combine hosts (for example "Needs you"). */
export const useSnapshots = create<{ byHost: Record<string, Snapshot> }>(() => ({ byHost: {} }));

export function setHostSnapshot(hostId: string, snapshot: Snapshot | undefined): void {
  useSnapshots.setState((s) => {
    const { [hostId]: _, ...rest } = s.byHost;
    return { byHost: snapshot ? { ...rest, [hostId]: snapshot } : rest };
  });
}
