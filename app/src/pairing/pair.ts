import type { PairRequest, PairResponse } from "@zogssh/protocol";

import { ensureKey } from "../../modules/ssh";
import { deviceName, getDeviceId } from "../device";
import { newHostId, useHosts, type Host } from "../hosts/store";
import { DEFAULT_PAIR_PORT } from "./pairUrl";

export type PairFailCode =
  | "bad_code"
  | "no_window"
  | "too_many_attempts"
  | "unreachable"
  | "bad_request"
  | "host_key_mismatch"
  | "host_key_changed"
  | "not_confirmed";

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
    case "host_key_mismatch":
      return "The host key is not the one in the QR code. Someone on the network may be intercepting the pairing. Nothing was saved.";
    case "host_key_changed":
      return "The host key is different from the saved one. Nothing was changed. To trust the new key, remove the host and pair again.";
    case "not_confirmed":
      return "Pairing stopped: the host key was not confirmed. Nothing was saved.";
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
 * How the app checks the host key in the `/pair` answer, which comes over plain HTTP:
 * - `fingerprint`: the key from the QR code. A different key (or none) stops pairing.
 * - `confirm`: manual entry. The user compares the key with the one `zogsshd pair` prints;
 *   `false` stops pairing. It gets `null` when the host reports no key.
 */
export type HostKeyCheck = { fingerprint: string } | { confirm: (fingerprint: string | null) => Promise<boolean> };

/**
 * Pairs with `zogsshd serve` at `address:port` using the code it shows, then saves the host
 * with the user, SSH port and host key the companion reports. Throws `PairFailed`; nothing is saved then.
 * The push token is not sent here: it goes only over the pinned SSH session (`push.register`).
 */
export async function pairWithHost(
  o: { address: string; port?: number; code: string; name?: string; check: HostKeyCheck },
  deps?: { fetch?: typeof fetch },
): Promise<Host> {
  const doFetch = deps?.fetch ?? fetch;
  const address = o.address.trim();
  const port = o.port ?? DEFAULT_PAIR_PORT;
  // Re-pairing a saved host keeps its id, so the companion's host_id matches.
  const id = useHosts.getState().hosts.find((h) => h.address === address)?.id ?? newHostId();
  const [deviceId, key] = await Promise.all([getDeviceId(), ensureKey()]);
  const body: PairRequest = {
    code: o.code,
    device_id: deviceId,
    device_name: deviceName(),
    host_id: id,
    public_key: key.publicKey,
    expo_token: null,
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

  const reported = json.host_key_fingerprint;
  const values: { address: string; port: number; user: string; fingerprint?: string } = {
    address,
    port: json.ssh_port,
    user: json.user,
  };
  // Never write `fingerprint: undefined`: that would unpin a saved host.
  if (reported) values.fingerprint = reported;
  const saved = savedHostFor(values);
  if ("fingerprint" in o.check) {
    if (reported !== o.check.fingerprint) throw new PairFailed("host_key_mismatch");
  } else if (!(await o.check.confirm(reported))) {
    throw new PairFailed("not_confirmed");
  }
  return saveHost(saved, { id, name: o.name?.trim() || json.host_name }, values);
}

/** Address, port, user and the host key (when known) of a host being paired or enrolled. */
export type HostValues = { address: string; port: number; user: string; fingerprint?: string };

/**
 * The saved host that `v` belongs to: same pinned key first, else same address, port and user.
 * Throws `PairFailed("host_key_changed")` when that host has a different pinned key:
 * a pinned key never changes through pairing.
 */
export function savedHostFor(v: HostValues): Host | undefined {
  const hosts = useHosts.getState().hosts;
  const byKey = v.fingerprint ? hosts.find((h) => h.fingerprint === v.fingerprint) : undefined;
  const saved = byKey ?? hosts.find((h) => h.address === v.address && h.port === v.port && h.user === v.user);
  if (saved?.fingerprint && saved.fingerprint !== v.fingerprint) throw new PairFailed("host_key_changed");
  return saved;
}

/**
 * Saves `values`: updates `saved` (from `savedHostFor`) and keeps its name, else adds a host
 * with `fresh.id` (a new id when another saved host already uses it) and `fresh.name`.
 */
export function saveHost(saved: Host | undefined, fresh: { id: string; name: string }, values: HostValues): Host {
  const { hosts, addHost, updateHost } = useHosts.getState();
  const current = saved && hosts.find((h) => h.id === saved.id);
  if (current) {
    // Keep the saved name: the user may have renamed the host.
    updateHost(current.id, values);
    return useHosts.getState().hosts.find((h) => h.id === current.id)!;
  }
  // The id guessed from the address belongs to another saved host (for example another user): use a new one.
  const freeId = hosts.some((h) => h.id === fresh.id) ? newHostId() : fresh.id;
  return addHost({ id: freeId, name: fresh.name, ...values });
}
