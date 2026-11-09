/**
 * Pairing v2: the phone side of the CPace exchange with `herdlingd serve` (`POST /pair/v2/start`,
 * `POST /pair/v2/finish`). The 6-digit code is the CPace password and never goes over the network.
 * The phone's tag proves the code over its public key, so a relay cannot enroll its own key.
 * The host's tag proves the code over the host fields (user, port, host key), so a fake host fails.
 * The exact messages are in `docs/protocol.md`, "Pairing v2"; the host side is `companion/src/pair_v2.rs`.
 */
import type {
  PairResponse,
  PairV2FinishRequest,
  PairV2FinishResponse,
  PairV2StartRequest,
  PairV2StartResponse,
} from "@herdling/protocol";

import {
  calculateGenerator,
  equalBytes,
  fromHex,
  hmacSha512,
  iskIr,
  lvCat,
  macKey,
  scalarFromRandom,
  scalarMult,
  scalarMultVfy,
  toHex,
  utf8,
} from "./cpace";

/** CPace channel identifier (CI). */
export const LABEL = utf8("herdling-pair-v2");
const NONCE_LEN = 16;
const TAG_LEN = 64;

/** The CPace ADa: the phone's device id. */
export function ada(deviceId: string): Uint8Array {
  return utf8(deviceId);
}

/** The message under `tag_a`: the phone's CPace message and every field that the host saves. */
export function tagAMsg(ya: Uint8Array, a: Uint8Array, deviceName: string, hostId: string, publicKey: string): Uint8Array {
  return lvCat(utf8("herdling-pair-v2/a"), ya, a, utf8(deviceName), utf8(hostId), utf8(publicKey));
}

/** The message under `tag_b`: the host's CPace message, `tag_a` and every field that the phone saves. */
export function tagBMsg(yb: Uint8Array, adb: Uint8Array, tagA: Uint8Array, r: PairResponse): Uint8Array {
  return lvCat(
    utf8("herdling-pair-v2/b"),
    yb,
    adb,
    tagA,
    utf8(r.host_name),
    utf8(r.user),
    utf8(String(r.ssh_port)),
    utf8(r.host_key_fingerprint ?? ""),
  );
}

/** The phone's first CPace step: the secret scalar and Ya. Null for a zero scalar. */
export function initiate(code: string, sid: Uint8Array, yRandom: Uint8Array): { y: bigint; ya: Uint8Array } | null {
  const y = scalarFromRandom(yRandom);
  if (y === null) return null;
  return { y, ya: scalarMult(y, calculateGenerator(utf8(code), LABEL, sid)) };
}

/** The phone's last CPace step: the tag key, or null when the host's message is not valid. */
export function initiatorMacKey(
  y: bigint,
  sid: Uint8Array,
  ya: Uint8Array,
  a: Uint8Array,
  yb: Uint8Array,
  adb: Uint8Array,
): Uint8Array | null {
  const k = scalarMultVfy(y, yb);
  if (!k) return null;
  return macKey(sid, iskIr(sid, k, ya, a, yb, adb));
}

/** Why a v2 exchange stopped. `not_supported`: the host has no v2 (an older herdlingd answers 404). */
export type V2Failure =
  | "not_supported"
  | "unreachable"
  | "bad_code"
  | "no_window"
  | "too_many_attempts"
  | "no_session"
  | "bad_request"
  | "host_not_verified";

export class V2Failed extends Error {
  constructor(readonly code: V2Failure) {
    super(code);
    this.name = "V2Failed";
  }
}

const SERVER_CODES: readonly V2Failure[] = ["bad_code", "no_window", "too_many_attempts", "no_session", "bad_request"];

type Post = (path: string, body: unknown) => Promise<{ status: number; ok: boolean; json: unknown }>;

function serverFailure(status: number, json: unknown): V2Failed {
  const code = (json as { error?: unknown } | undefined)?.error;
  return new V2Failed(SERVER_CODES.includes(code as V2Failure) ? (code as V2Failure) : "bad_request");
}

function isFinishResponse(v: unknown): v is PairV2FinishResponse {
  const r = v as PairV2FinishResponse;
  return (
    typeof r === "object" &&
    r !== null &&
    typeof r.host_name === "string" &&
    typeof r.user === "string" &&
    Number.isInteger(r.ssh_port) &&
    r.ssh_port >= 1 &&
    r.ssh_port <= 65535 &&
    (r.host_key_fingerprint === null || typeof r.host_key_fingerprint === "string") &&
    typeof r.tag_b === "string"
  );
}

/**
 * Runs the v2 exchange through `post` and returns the host fields that the host's tag proves.
 * `random(n)` gives secure random bytes. Throws `V2Failed`.
 */
export async function exchangeV2(
  o: { code: string; deviceId: string; deviceName: string; hostId: string; publicKey: string },
  deps: { post: Post; random: (n: number) => Uint8Array },
): Promise<PairResponse> {
  const sid = deps.random(NONCE_LEN);
  let first = initiate(o.code, sid, deps.random(32));
  // A zero scalar has a chance of 2^-252; take new bytes then.
  while (!first) first = initiate(o.code, sid, deps.random(32));
  const { y, ya } = first;

  const startBody: PairV2StartRequest = { device_id: o.deviceId, sid: toHex(sid), ya: toHex(ya) };
  const started = await deps.post("/pair/v2/start", startBody);
  if (started.status === 404) throw new V2Failed("not_supported");
  if (!started.ok) throw serverFailure(started.status, started.json);
  const s = started.json as Partial<PairV2StartResponse> | undefined;
  const adb = typeof s?.session === "string" ? fromHex(s.session, NONCE_LEN) : null;
  const yb = typeof s?.yb === "string" ? fromHex(s.yb, 32) : null;
  if (!adb || !yb) throw new V2Failed("bad_request");

  const a = ada(o.deviceId);
  // An invalid Yb is the host's fault (or an attacker's): stop before the code is used in a tag.
  const key = initiatorMacKey(y, sid, ya, a, yb, adb);
  if (!key) throw new V2Failed("host_not_verified");
  const tagA = hmacSha512(key, tagAMsg(ya, a, o.deviceName, o.hostId, o.publicKey));
  const finishBody: PairV2FinishRequest = {
    session: toHex(adb),
    device_name: o.deviceName,
    host_id: o.hostId,
    public_key: o.publicKey,
    tag_a: toHex(tagA),
  };
  const finished = await deps.post("/pair/v2/finish", finishBody);
  if (!finished.ok) throw serverFailure(finished.status, finished.json);
  const r = finished.json;
  if (!isFinishResponse(r)) throw new V2Failed("bad_request");
  const tagB = fromHex(r.tag_b, TAG_LEN);
  const fields: PairResponse = {
    host_name: r.host_name,
    user: r.user,
    ssh_port: r.ssh_port,
    host_key_fingerprint: r.host_key_fingerprint,
  };
  if (!tagB || !equalBytes(tagB, hmacSha512(key, tagBMsg(yb, adb, tagA, fields)))) {
    throw new V2Failed("host_not_verified");
  }
  return fields;
}
