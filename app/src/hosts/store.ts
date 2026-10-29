import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type Host = {
  id: string;
  name: string;
  address: string;
  port: number;
  user: string;
  /** Pinned host key, `SHA256:<base64>`. Unset until the first successful connect. */
  fingerprint?: string;
  /** Command for the exec channel. Default "zogsshd rpc". */
  command: string;
};

export const DEFAULT_COMMAND = "zogsshd rpc";

type HostStore = {
  hosts: Host[];
  addHost: (h: Omit<Host, "id" | "command"> & { id?: string; command?: string }) => Host;
  updateHost: (id: string, patch: Partial<Omit<Host, "id">>) => void;
  removeHost: (id: string) => void;
};

function newId(): string {
  return `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Saved hosts. The list is small, so it lives in the Keychain through expo-secure-store. */
export const useHosts = create<HostStore>()(
  persist(
    (set) => ({
      hosts: [],
      addHost: (h) => {
        const host: Host = { ...h, id: h.id ?? newId(), command: h.command ?? DEFAULT_COMMAND };
        set((s) => ({ hosts: [...s.hosts, host] }));
        return host;
      },
      updateHost: (id, patch) =>
        set((s) => ({ hosts: s.hosts.map((h) => (h.id === id ? { ...h, ...patch } : h)) })),
      removeHost: (id) => set((s) => ({ hosts: s.hosts.filter((h) => h.id !== id) })),
    }),
    {
      name: "zogssh.hosts",
      storage: createJSONStorage(() => ({
        getItem: (k) => SecureStore.getItemAsync(k),
        setItem: (k, v) => SecureStore.setItemAsync(k, v),
        removeItem: (k) => SecureStore.deleteItemAsync(k),
      })),
      partialize: (s) => ({ hosts: s.hosts }),
    },
  ),
);
