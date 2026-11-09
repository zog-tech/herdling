// pairWithHost with pairing v2, against a fake host that answers with the shared Rust vector
// (protocol/fixtures/cpace-ristretto255.json, made by companion/src/pair_v2.rs).
import vectors from "../../../protocol/fixtures/cpace-ristretto255.json";

const { input: V, output: O } = vectors.herdling;

jest.mock("../../modules/ssh", () => ({
  ensureKey: async () => ({ publicKey: jest.requireActual("../../../protocol/fixtures/cpace-ristretto255.json").herdling.input.public_key }),
}));
jest.mock("../device", () => ({
  getDeviceId: async () => jest.requireActual("../../../protocol/fixtures/cpace-ristretto255.json").herdling.input.device_id,
  deviceName: () => jest.requireActual("../../../protocol/fixtures/cpace-ristretto255.json").herdling.input.device_name,
}));

import { useHosts } from "../hosts/store";
import { fromHex } from "./cpace";
import { PairFailed, pairWithHost, type PairOptions } from "./pair";

const hex = (s: string) => fromHex(s, s.length / 2)!;

/** Gives the fixed sid, then the fixed scalar bytes, as the Rust vector used them. */
function fixedRandom() {
  const queue = [hex(V.sid), hex(V.ya_random)];
  return jest.fn((n: number) => {
    const next = queue.shift();
    if (!next || next.length !== n) throw new Error(`unexpected random(${n})`);
    return next;
  });
}

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const FIELDS = { host_name: V.host_name, user: V.user, ssh_port: V.ssh_port, host_key_fingerprint: V.host_key_fingerprint };

type Calls = { url: string; body: Record<string, unknown> }[];

/**
 * A fake herdlingd with pairing v2. It checks that the phone sends the vector's Ya and tag_a,
 * and answers with the vector's Yb and tag_b. `finish` changes the finish answer.
 */
function v2Host(calls: Calls, finish: (ok: object) => [number, unknown] = (ok) => [200, ok]) {
  return jest.fn(async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url, body });
    if (url.endsWith("/pair/v2/start")) {
      expect(body).toEqual({ device_id: V.device_id, sid: V.sid, ya: O.ya });
      return response(200, { session: V.session, yb: O.yb });
    }
    if (url.endsWith("/pair/v2/finish")) {
      if (body.tag_a !== O.tag_a) return response(403, { error: "bad_code" });
      const [status, answer] = finish({ ...FIELDS, tag_b: O.tag_b });
      return response(status, answer);
    }
    return response(404, undefined);
  });
}

/** A fake older herdlingd: no v2 (404), and v1 at `/pair`. */
function oldHost(calls: Calls) {
  return jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    if (url.endsWith("/pair")) return response(200, FIELDS);
    return response(404, undefined);
  });
}

const base = (o: Partial<PairOptions> = {}): PairOptions => ({
  address: "10.0.0.5",
  code: V.code,
  check: { confirm: async () => true },
  ...o,
});

/** The vector's host id: the phone re-pairs a saved host at this address. */
function seedHost() {
  useHosts.setState({ hosts: [] });
  useHosts.getState().addHost({ id: V.host_id, name: "studio", address: "10.0.0.5", port: 22, user: "sam" });
}

beforeEach(seedHost);

describe("pairWithHost v2", () => {
  it("full_exchange_matches_the_rust_vector", async () => {
    const calls: Calls = [];
    const confirm = jest.fn(async () => true);
    const paired = await pairWithHost(base({ check: { confirm } }), { fetch: v2Host(calls) as never, random: fixedRandom() });

    expect(paired.checked).toBe(true);
    expect(calls.map((c) => c.url)).toEqual(["http://10.0.0.5:7790/pair/v2/start", "http://10.0.0.5:7790/pair/v2/finish"]);
    expect(calls[1].body).toEqual({
      session: V.session,
      device_name: V.device_name,
      host_id: V.host_id,
      public_key: V.public_key,
      tag_a: O.tag_a,
    });
    // The code never goes over the network.
    expect(JSON.stringify(calls)).not.toContain(V.code);
    // The host's tag proves its key, so the user does not have to compare it.
    expect(confirm).not.toHaveBeenCalled();
    expect(paired.host).toMatchObject({ id: V.host_id, user: "sam", port: 22, fingerprint: V.host_key_fingerprint });
  });

  it("qr_fingerprint_is_still_compared", async () => {
    const other = "SHA256:" + "b".repeat(43);
    const err = await pairWithHost(base({ check: { fingerprint: other } }), { fetch: v2Host([]) as never, random: fixedRandom() }).catch(
      (e) => e,
    );
    expect((err as PairFailed).code).toBe("host_key_mismatch");
  });

  it("host_without_the_code_fails", async () => {
    for (const change of [
      (ok: object) => ({ ...ok, tag_b: "00".repeat(64) }),
      (ok: object) => ({ ...ok, host_key_fingerprint: "SHA256:" + "c".repeat(43) }),
      (ok: object) => ({ ...ok, ssh_port: 2222 }),
      (ok: object) => ({ ...ok, tag_b: "zz" }),
    ]) {
      seedHost();
      const fetch = v2Host([], (ok) => [200, change(ok)]);
      const err = await pairWithHost(base(), { fetch: fetch as never, random: fixedRandom() }).catch((e) => e);
      expect(err).toBeInstanceOf(PairFailed);
      expect((err as PairFailed).code).toBe("host_not_verified");
      expect(useHosts.getState().hosts[0].fingerprint).toBeUndefined();
    }
  });

  it("wrong_code_and_server_errors", async () => {
    const wrong = await pairWithHost(base({ code: "000000" }), {
      fetch: jest.fn(async (url: string) =>
        url.endsWith("/start") ? response(200, { session: V.session, yb: O.yb }) : response(403, { error: "bad_code" }),
      ) as never,
      random: fixedRandom(),
    }).catch((e) => e);
    expect((wrong as PairFailed).code).toBe("bad_code");

    for (const [status, code] of [
      [410, "no_session"],
      [410, "no_window"],
      [429, "too_many_attempts"],
      [500, "internal"],
    ] as const) {
      const fetch = v2Host([], () => [status, { error: code }]);
      const err = await pairWithHost(base(), { fetch: fetch as never, random: fixedRandom() }).catch((e) => e);
      expect((err as PairFailed).code).toBe(code === "internal" ? "bad_request" : code);
    }

    const down = jest.fn(async () => {
      throw new TypeError("Network request failed");
    });
    const err = await pairWithHost(base(), { fetch: down as never, random: fixedRandom() }).catch((e) => e);
    expect((err as PairFailed).code).toBe("unreachable");
  });
});

describe("pairWithHost and an older herdlingd", () => {
  it("no_fallback_when_v2_is_required", async () => {
    const calls: Calls = [];
    const confirmLegacy = jest.fn(async () => true);
    const err = await pairWithHost(base({ requireV2: true, confirmLegacy }), { fetch: oldHost(calls) as never, random: fixedRandom() }).catch(
      (e) => e,
    );
    expect((err as PairFailed).code).toBe("v2_required");
    expect(confirmLegacy).not.toHaveBeenCalled();
    expect(calls.map((c) => c.url)).toEqual(["http://10.0.0.5:7790/pair/v2/start"]);
  });

  it("fallback_needs_the_user_to_agree", async () => {
    for (const confirmLegacy of [undefined, jest.fn(async () => false)]) {
      const calls: Calls = [];
      const err = await pairWithHost(base({ confirmLegacy }), { fetch: oldHost(calls) as never, random: fixedRandom() }).catch((e) => e);
      expect((err as PairFailed).code).toBe("legacy_declined");
      expect(calls).toHaveLength(1);
    }
  });

  it("fallback_after_yes_uses_v1", async () => {
    const calls: Calls = [];
    const confirmLegacy = jest.fn(async () => true);
    const confirm = jest.fn(async () => true);
    const paired = await pairWithHost(base({ confirmLegacy, check: { confirm } }), {
      fetch: oldHost(calls) as never,
      random: fixedRandom(),
    });
    expect(confirmLegacy).toHaveBeenCalledTimes(1);
    expect(paired.checked).toBe(false);
    expect(calls.map((c) => c.url)).toEqual(["http://10.0.0.5:7790/pair/v2/start", "http://10.0.0.5:7790/pair"]);
    expect(calls[1].body.code).toBe(V.code);
    // v1 answers are not proved: the user compares the host key.
    expect(confirm).toHaveBeenCalledWith(V.host_key_fingerprint);
  });

  it("other_errors_never_fall_back", async () => {
    const confirmLegacy = jest.fn(async () => true);
    const fetch = jest.fn(async () => response(400, { error: "bad_request" }));
    const err = await pairWithHost(base({ confirmLegacy }), { fetch: fetch as never, random: fixedRandom() }).catch((e) => e);
    expect((err as PairFailed).code).toBe("bad_request");
    expect(confirmLegacy).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
