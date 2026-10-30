import type { PairRequest, PairResponse } from "@zogssh/protocol";

import { ensureKey } from "../../modules/ssh";
import { deviceName, getDeviceId } from "../device";
import { newHostId, useHosts, type Host } from "../hosts/store";
import { DEFAULT_PAIR_PORT } from "./pairUrl";

export type PairFailCode = "bad_code" | "no_window" | "too_many_attempts" | "unreachable" | "bad_request";

const TIMEOUT_MS = 10_000;

/** Pairing did not work. `message` is the text for the user. */
export class PairFailed extends Error {
  constructor(
    readonly code: PairFailCode,
    message = pairMessage(code),
  ) {
    super(message);
    this.name = "PairFailed";
  }
}

export function pairMessage(code: PairFailCode, target?: { address: string; port: number }): string {
  switch (code) {
    case "bad_code":
      return "Wrong code. Check the code on the host.";
    case "no_window":
      return "No pairing window. Run zogsshd pair on the host.";
    case "too_many_attempts":
      return "Too many wrong codes. Run zogsshd pair again.";
    case "unreachable":
      return target
        ? `Can't reach ${target.address}:${target.port}. Is zogsshd serve running?`
        : "Can't reach the host. Is zogsshd serve running?";
    case "bad_request":
      return "The host rejected the pairing request.";
  }
}

const SERVER_CODES: readonly PairFailCode[] = ["bad_code", "no_window", "too_many_attempts", "bad_request"];

function isPairResponse(v: unknown): v is PairResponse {
  const r = v as PairResponse;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.host_name === "string" &&
    typeof r.user === "string" &&
    Number.isInteger(r.ssh_port) &&
    r.ssh_port >= 1 &&
    r.ssh_port <= 65535 &&
    (r.host_key_fingerprint === null || typeof r.host_key_fingerprint === "string")
  );
}

/**
 * Pairs with `zogsshd serve` at `address:port` using the code it shows, then saves the host
 * with the user, SSH port and host key the companion reports. Throws `PairFailed`; nothing is saved then.
 */
export async function pairWithHost(
  o: { address: string; port?: number; code: string; name?: string },
  deps?: { fetch?: typeof fetch; expoToken?: () => Promise<string | null> },
): Promise<Host> {
  const doFetch = deps?.fetch ?? fetch;
  const address = o.address.trim();
  const port = o.port ?? DEFAULT_PAIR_PORT;
  // Re-pairing a saved host keeps its id, so the companion's host_id matches.
  const id = useHosts.getState().hosts.find((h) => h.address === address)?.id ?? newHostId();
  const [deviceId, key, expoToken] = await Promise.all([
    getDeviceId(),
    ensureKey(),
    deps?.expoToken ? deps.expoToken().catch(() => null) : Promise.resolve(null),
  ]);
  const body: PairRequest = {
    code: o.code,
    device_id: deviceId,
    device_name: deviceName(),
    host_id: id,
    public_key: key.publicKey,
    expo_token: expoToken,
  };

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  let res: Response;
  let json: unknown;
  try {
    res = await doFetch(`http://${address}:${port}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
    json = await res.json().catch(() => undefined);
  } catch {
    throw new PairFailed("unreachable", pairMessage("unreachable", { address, port }));
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const code = (json as { error?: unknown } | undefined)?.error;
    throw new PairFailed(SERVER_CODES.includes(code as PairFailCode) ? (code as PairFailCode) : "bad_request");
  }
  if (!isPairResponse(json)) throw new PairFailed("bad_request");

  const values = {
    address,
    port: json.ssh_port,
    user: json.user,
    fingerprint: json.host_key_fingerprint ?? undefined,
  };
  const { hosts, addHost, updateHost } = useHosts.getState();
  const saved = savedHostFor(hosts, values);
  if (saved) {
    // Keep the saved name: the user may have renamed the host.
    updateHost(saved.id, values);
    return useHosts.getState().hosts.find((h) => h.id === saved.id)!;
  }
  // The id guessed from the address belongs to another saved host (for example another user): use a new one.
  const freeId = hosts.some((h) => h.id === id) ? newHostId() : id;
  return addHost({ id: freeId, name: o.name?.trim() || json.host_name, ...values });
}

/** The saved host a pairing answer belongs to: same pinned key first, else same address, port and user. */
function savedHostFor(hosts: Host[], v: { address: string; port: number; user: string; fingerprint?: string }) {
  if (v.fingerprint) {
    const byKey = hosts.find((h) => h.fingerprint === v.fingerprint);
    if (byKey) return byKey;
  }
  return hosts.find((h) => h.address === v.address && h.port === v.port && h.user === v.user);
}
