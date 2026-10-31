import { create } from "zustand";
import { persist } from "zustand/middleware";

import { secureJSONStorage } from "@/secureStorage";

export type Host = {
  id: string;
  name: string;
  address: string;
  port: number;
  user: string;
  /** Pinned host key, `SHA256:<base64>`. Unset until the first successful connect. */
  fingerprint?: string;
  /** Command for the exec channel. Default "herdlingd rpc". */
  command: string;
  /** True for the in-app demo host (`src/demo`). It never uses SSH, pairing or push. */
  demo?: boolean;
};

export const DEFAULT_COMMAND = "herdlingd rpc";

type HostStore = {
  hosts: Host[];
  addHost: (h: Omit<Host, "id" | "command"> & { id?: string; command?: string }) => Host;
  updateHost: (id: string, patch: Partial<Omit<Host, "id">>) => void;
  removeHost: (id: string) => void;
};

/** A new saved-host id. Pairing makes it before the host is saved, to send it to the companion. */
export function newHostId(): string {
  return `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Saved hosts. The list is small, so it lives in the Keychain through expo-secure-store. */
export const useHosts = create<HostStore>()(
  persist(
    (set) => ({
      hosts: [],
      addHost: (h) => {
        const host: Host = { ...h, id: h.id ?? newHostId(), command: h.command ?? DEFAULT_COMMAND };
        set((s) => ({ hosts: [...s.hosts, host] }));
        return host;
      },
      updateHost: (id, patch) =>
        set((s) => ({ hosts: s.hosts.map((h) => (h.id === id ? { ...h, ...patch } : h)) })),
      removeHost: (id) => set((s) => ({ hosts: s.hosts.filter((h) => h.id !== id) })),
    }),
    {
      name: "herdling.hosts",
      storage: secureJSONStorage(),
      partialize: (s) => ({ hosts: s.hosts }),
    },
  ),
);
