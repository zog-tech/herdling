import { useEffect, useState } from "react";

import { addListener, type FoundService, startBrowse, stopBrowse } from "../../modules/ssh";
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

/** Browses for zogsshd hosts while `active` is true. The list empties when browsing stops. */
export function useDiscovery(active: boolean): Discovered[] {
  const [list, setList] = useState<Discovered[]>([]);

  useEffect(() => {
    if (!active) return;
    const found = addListener("onServiceFound", (s) => setList((l) => applyFound(l, s)));
    const lost = addListener("onServiceLost", (e) => setList((l) => applyLost(l, e.name)));
    startBrowse().catch(() => {});
    return () => {
      found.remove();
      lost.remove();
      stopBrowse().catch(() => {});
      setList([]);
    };
  }, [active]);

  return list;
}
