import type { PairRequest, PairResponse } from "@herdling/protocol";

import { ensureKey } from "../../modules/ssh";
import { deviceName, getDeviceId } from "../device";
import { newHostId, useHosts, type Host } from "../hosts/store";
import { exchangeV2, V2Failed } from "./pairV2";
import { DEFAULT_PAIR_PORT } from "./pairUrl";
import { randomBytes } from "./random";

export type PairFailCode =
  | "bad_code"
  | "no_window"
  | "too_many_attempts"
  | "unreachable"
  | "bad_request"
  | "host_key_mismatch"
  | "host_key_changed"
  | "not_confirmed"
  | "no_session"
  | "host_not_verified"
  | "v2_required"
  | "legacy_declined";

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
      return "No pairing window. Run herdlingd pair on the host.";
    case "too_many_attempts":
      return "Too many wrong codes. Run herdlingd pair again.";
    case "unreachable":
      return target
        ? `Can't reach ${target.address}:${target.port}. Is herdlingd serve running?`
        : "Can't reach the host. Is herdlingd serve running?";
    case "bad_request":
      return "The host rejected the pairing request.";
    case "host_key_mismatch":
      return "The host key is not the one in the QR code. Someone on the network may be intercepting the pairing. Nothing was saved.";
    case "host_key_changed":
      return "The host key is different from the saved one. Nothing was changed. To trust the new key, remove the host and pair again.";
    case "not_confirmed":
      return "Pairing stopped: the host key was not confirmed. Nothing was saved.";
    case "no_session":
      return "The pairing took too long. Try again.";
    case "host_not_verified":
      return "The host did not prove that it knows the code. Someone on the network may be intercepting the pairing. Nothing was saved.";
    case "v2_required":
      return "The host at this address does not do safe pairing, but this host must do it. Someone on the network may be intercepting the pairing. Nothing was saved.";
    case "legacy_declined":
      return "Pairing stopped. Update herdlingd on the computer, then pair again.";
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
 * How the app checks the host key in the pairing answer:
 * - `fingerprint`: the key from the QR code. A different key (or none) stops pairing.
 * - `confirm`: manual entry. The user compares the key with the one `herdlingd pair` prints;
 *   `false` stops pairing. It gets `null` when the host reports no key. With pairing v2 the
 *   host's tag proves the key, so `confirm` runs only when the host reports no key.
 */
export type HostKeyCheck = { fingerprint: string } | { confirm: (fingerprint: string | null) => Promise<boolean> };

type Target = { address: string; port?: number; code: string; name?: string; check: HostKeyCheck };

export type PairOptions = Target & {
  /** The QR code or the Bonjour advert says that the host has pairing v2: never use v1. */
  requireV2?: boolean;
  /** Asks the user to continue with v1 when the host has no v2 (an older herdlingd). */
  confirmLegacy?: () => Promise<boolean>;
};

/** A paired host. `checked`: pairing v2 proved the code both ways, so no key compare is needed. */
export type Paired = { host: Host; checked: boolean };

type Fetch = typeof fetch;

/** POSTs JSON to the pairing endpoint with a time limit. A network failure gives `null`. */
async function postJson(
  doFetch: Fetch,
  base: string,
  path: string,
  body: unknown,
): Promise<{ status: number; ok: boolean; json: unknown } | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await doFetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
    const json: unknown = await res.json().catch(() => undefined);
    return { status: res.status, ok: res.ok, json };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The id of the host to pair: a saved host with this address keeps its id, so the companion's host_id matches. */
function hostIdFor(address: string): string {
  return useHosts.getState().hosts.find((h) => h.address === address)?.id ?? newHostId();
}

/**
 * Pairs with `herdlingd serve` at `address:port` using the code it shows, then saves the host.
 * It uses pairing v2 (CPace): the code never goes over the network, and both sides prove it.
 * When the host has no v2 (an older herdlingd), it uses v1 only when `requireV2` is not set and
 * `confirmLegacy` says yes. It never falls back without asking. Throws `PairFailed`; nothing is saved then.
 * The push token is not sent here: it goes only over the pinned SSH session (`push.register`).
 */
export async function pairWithHost(o: PairOptions, deps?: { fetch?: Fetch; random?: (n: number) => Uint8Array }): Promise<Paired> {
  const doFetch = deps?.fetch ?? fetch;
  const address = o.address.trim();
  const port = o.port ?? DEFAULT_PAIR_PORT;
  const id = hostIdFor(address);
  const [deviceId, key] = await Promise.all([getDeviceId(), ensureKey()]);
  const base = `http://${address}:${port}`;
  try {
    const answer = await exchangeV2(
      { code: o.code, deviceId, deviceName: deviceName(), hostId: id, publicKey: key.publicKey },
      {
        post: async (path, body) => {
          const r = await postJson(doFetch, base, path, body);
          if (!r) throw new V2Failed("unreachable");
          return r;
        },
        random: deps?.random ?? randomBytes,
      },
    );
    return { host: await checkAndSave(answer, { ...o, address }, id, true), checked: true };
  } catch (e) {
    if (!(e instanceof V2Failed)) throw e;
    if (e.code === "unreachable") throw new PairFailed("unreachable", pairMessage("unreachable", { address, port }));
    if (e.code !== "not_supported") throw new PairFailed(e.code);
    if (o.requireV2) throw new PairFailed("v2_required");
    if (!o.confirmLegacy || !(await o.confirmLegacy())) throw new PairFailed("legacy_declined");
  }
  return { host: await pairV1(o, deps), checked: false };
}

/**
 * Pairing v1 (`POST /pair`), for an older herdlingd: the code goes in clear JSON over plain HTTP.
 * Use it only through `pairWithHost`, after the user agreed. The user checks the host key
 * (`confirm`) and the phone key on the host (`herdlingd pair` asks).
 */
export async function pairV1(o: Target, deps?: { fetch?: Fetch }): Promise<Host> {
  const doFetch = deps?.fetch ?? fetch;
  const address = o.address.trim();
  const port = o.port ?? DEFAULT_PAIR_PORT;
  const id = hostIdFor(address);
  const [deviceId, key] = await Promise.all([getDeviceId(), ensureKey()]);
  const body: PairRequest = {
    code: o.code,
    device_id: deviceId,
    device_name: deviceName(),
    host_id: id,
    public_key: key.publicKey,
    expo_token: null,
  };
  const res = await postJson(doFetch, `http://${address}:${port}`, "/pair", body);
  if (!res) throw new PairFailed("unreachable", pairMessage("unreachable", { address, port }));
  if (!res.ok) {
    const code = (res.json as { error?: unknown } | undefined)?.error;
    throw new PairFailed(SERVER_CODES.includes(code as PairFailCode) ? (code as PairFailCode) : "bad_request");
  }
  if (!isPairResponse(res.json)) throw new PairFailed("bad_request");
  return checkAndSave(res.json, { ...o, address }, id, false);
}

/**
 * Checks the host key of `answer` and saves the host. `verified`: the host's v2 tag proves the
 * answer, so the user does not have to compare a reported key.
 */
async function checkAndSave(answer: PairResponse, o: Target, id: string, verified: boolean): Promise<Host> {
  const reported = answer.host_key_fingerprint;
  const values: { address: string; port: number; user: string; fingerprint?: string } = {
    address: o.address,
    port: answer.ssh_port,
    user: answer.user,
  };
  // Never write `fingerprint: undefined`: that would unpin a saved host.
  if (reported) values.fingerprint = reported;
  const saved = savedHostFor(values);
  if ("fingerprint" in o.check) {
    if (reported !== o.check.fingerprint) throw new PairFailed("host_key_mismatch");
  } else if ((!verified || reported === null) && !(await o.check.confirm(reported))) {
    throw new PairFailed("not_confirmed");
  }
  return saveHost(saved, { id, name: o.name?.trim() || answer.host_name }, values);
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
