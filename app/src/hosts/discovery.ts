import { useEffect } from "react";
import { create } from "zustand";

import { addListener, type BrowseState, type FoundService, startBrowse, stopBrowse } from "../../modules/ssh";
import type { Host } from "./store";

/** A zogsshd host found on the local network through Bonjour. */
export type Discovered = {
  name: string;
  address: string | null;
  pairPort: number;
  user?: string;
  sshPort: number;
  fingerprint?: string;
  version?: string;
};

const DEFAULT_SSH_PORT = 22;

function parsePort(text: string | undefined): number {
  if (!text || !/^\d{1,5}$/.test(text)) return DEFAULT_SSH_PORT;
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : DEFAULT_SSH_PORT;
}

/** Empty TXT values count as absent. */
function field(txt: Record<string, string>, key: string): string | undefined {
  const v = txt[key];
  return v ? v : undefined;
}

function toDiscovered(s: FoundService): Discovered {
  return {
    name: s.name,
    address: s.address,
    pairPort: s.pairPort,
    user: field(s.txt, "user"),
    sshPort: parsePort(s.txt.ssh_port),
    fingerprint: field(s.txt, "fp"),
    version: field(s.txt, "ver"),
  };
}

const byName = (a: Discovered, b: Discovered) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Adds the service, or replaces the entry with the same name. The result is sorted by name. */
export function applyFound(list: Discovered[], s: FoundService): Discovered[] {
  return [...list.filter((d) => d.name !== s.name), toDiscovered(s)].sort(byName);
}

export function applyLost(list: Discovered[], name: string): Discovered[] {
  return list.filter((d) => d.name !== name);
}

/**
 * The saved host for a discovered one: same fingerprint first, else same address.
 * A saved host pinned to a different key never matches by address.
 */
export function knownHostFor(d: Discovered, hosts: Host[]): Host | undefined {
  if (d.fingerprint) {
    const byFp = hosts.find((h) => h.fingerprint === d.fingerprint);
    if (byFp) return byFp;
  }
  if (!d.address) return undefined;
  return hosts.find(
    (h) => h.address === d.address && (!d.fingerprint || !h.fingerprint || h.fingerprint === d.fingerprint),
  );
}

export type DiscoveryStatus = "stopped" | "starting" | "ready" | "waiting" | "failed";

/** One list shared by every `useDiscovery` consumer. `error` is set with "waiting" or "failed". */
export type DiscoveryState = { list: Discovered[]; status: DiscoveryStatus; error?: string };

const STOPPED: DiscoveryState = { list: [], status: "stopped" };
const useDiscoveryStore = create<DiscoveryState>(() => STOPPED);

/** Active `useDiscovery` consumers. The native browse runs while this is above 0. */
let consumers = 0;
let subscriptions: { remove(): void }[] = [];

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function onBrowseState(e: BrowseState) {
  if (e.state === "failed" || e.state === "stopped") {
    useDiscoveryStore.setState({ list: [], status: e.state, error: e.error });
  } else {
    useDiscoveryStore.setState({ status: e.state, error: e.error });
  }
}

function acquire() {
  consumers += 1;
  if (consumers > 1) return;
  useDiscoveryStore.setState({ list: [], status: "starting", error: undefined });
  subscriptions = [
    addListener("onServiceFound", (s) => useDiscoveryStore.setState((st) => ({ list: applyFound(st.list, s) }))),
    addListener("onServiceLost", (e) => useDiscoveryStore.setState((st) => ({ list: applyLost(st.list, e.name) }))),
    addListener("onBrowseState", onBrowseState),
  ];
  startBrowse().catch((e) => {
    if (consumers > 0) useDiscoveryStore.setState({ list: [], status: "failed", error: errorText(e) });
  });
}

function release() {
  consumers -= 1;
  if (consumers > 0) return;
  subscriptions.forEach((s) => s.remove());
  subscriptions = [];
  useDiscoveryStore.setState(STOPPED, true);
  stopBrowse().catch((e) => {
    if (consumers === 0) useDiscoveryStore.setState({ status: "failed", error: errorText(e) });
  });
}

/**
 * Browses for zogsshd hosts while `active` is true. All active consumers share one native
 * browse and one list: the browse starts with the first consumer and stops with the last.
 * An inactive consumer gets an empty, stopped state.
 */
export function useDiscovery(active: boolean): DiscoveryState {
  useEffect(() => {
    if (!active) return;
    acquire();
    return release;
  }, [active]);
  const state = useDiscoveryStore();
  return active ? state : STOPPED;
}
