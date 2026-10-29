import type { Host } from "./store";

export type HostValues = Pick<Host, "name" | "address" | "port" | "user" | "command">;

/**
 * The update for a saved host. A new address or port is a different server, so the
 * pinned host key is cleared and the next connect pins the new one.
 */
export function editPatch(old: Host, values: HostValues): Partial<Omit<Host, "id">> {
  const moved = old.address !== values.address || old.port !== values.port;
  return moved ? { ...values, fingerprint: undefined } : values;
}
