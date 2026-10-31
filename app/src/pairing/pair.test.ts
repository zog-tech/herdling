const mockEnsureKey = jest.fn(async () => ({ publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA herdling" }));
jest.mock("../../modules/ssh", () => ({ ensureKey: () => mockEnsureKey() }));
jest.mock("expo-secure-store", () => {
  const items = new Map<string, string>();
  return {
    getItemAsync: async (k: string) => items.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => void items.set(k, v),
    deleteItemAsync: async (k: string) => void items.delete(k),
  };
});
jest.mock("expo-device", () => ({ deviceName: "Sam's iPhone" }));
const mockGetExpoToken = jest.fn(async () => "ExponentPushToken[test]");
jest.mock("../push/token", () => ({ getExpoToken: () => mockGetExpoToken() }));

import { getDeviceId } from "../device";
import { useHosts } from "../hosts/store";
import { PairFailed, pairMessage, pairWithHost } from "./pair";

const FP = "SHA256:" + "a".repeat(43);
const FP2 = "SHA256:" + "b".repeat(43);
const yes = { confirm: async () => true };

function response(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

beforeEach(() => useHosts.setState({ hosts: [] }));

describe("pairWithHost", () => {
  it("pair_posts_request_and_saves_host", async () => {
    const fetch = jest.fn(async (_url: string, _init?: RequestInit) =>
      response(200, { host_name: "studio", user: "sam", ssh_port: 22, host_key_fingerprint: "SHA256:abc" }),
    );
    const host = await pairWithHost(
      { address: "10.0.0.5", code: "123456", check: yes },
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("http://10.0.0.5:7790/pair");
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeDefined();
    const body = JSON.parse(String(init?.body));
    expect(body).toEqual({
      code: "123456",
      device_id: await getDeviceId(),
      device_name: "Sam's iPhone",
      host_id: host.id,
      public_key: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA herdling",
      // The push token goes only over the pinned SSH session (push.register), never over plain HTTP.
      expo_token: null,
    });
    expect(mockGetExpoToken).not.toHaveBeenCalled();
    expect(body.device_id).toMatch(/^d_/);

    const saved = useHosts.getState().hosts;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      id: host.id,
      address: "10.0.0.5",
      port: 22,
      user: "sam",
      fingerprint: "SHA256:abc",
      name: "studio",
    });
  });

  it("pair_uses_given_name_and_port", async () => {
    const fetch = jest.fn(async () => response(200, { host_name: "studio", user: "sam", ssh_port: 2222, host_key_fingerprint: null }));
    const host = await pairWithHost(
      { address: "10.0.0.5", port: 7791, code: "123456", name: "Work", check: yes },
      { fetch: fetch as unknown as typeof globalThis.fetch },
    );
    expect((fetch.mock.calls[0] as unknown[])[0]).toBe("http://10.0.0.5:7791/pair");
    expect(host).toMatchObject({ name: "Work", port: 2222 });
    expect(host.fingerprint).toBeUndefined();
    expect(JSON.parse(String(((fetch.mock.calls[0] as unknown[])[1] as RequestInit).body)).expo_token).toBeNull();
  });

  it("pair_maps_errors", async () => {
    const cases: [number, string][] = [
      [403, "bad_code"],
      [410, "no_window"],
      [429, "too_many_attempts"],
      [400, "bad_request"],
    ];
    for (const [status, code] of cases) {
      const fetch = jest.fn(async () => response(status, { error: code }));
      const err = await pairWithHost(
        { address: "10.0.0.5", code: "123456", check: yes },
        { fetch: fetch as unknown as typeof globalThis.fetch },
      ).catch((e) => e);
      expect(err).toBeInstanceOf(PairFailed);
      expect((err as PairFailed).code).toBe(code);
    }

    const down = jest.fn(async () => {
      throw new TypeError("Network request failed");
    });
    const err = await pairWithHost(
      { address: "10.0.0.5", code: "123456", check: yes },
      { fetch: down as unknown as typeof globalThis.fetch },
    ).catch((e) => e);
    expect(err).toBeInstanceOf(PairFailed);
    expect((err as PairFailed).code).toBe("unreachable");
    expect((err as PairFailed).message).toBe("Can't reach 10.0.0.5:7790. Is herdlingd serve running?");

    expect(useHosts.getState().hosts).toHaveLength(0);
  });

  it("pair_server_error_is_bad_request", async () => {
    const fetch = jest.fn(async () => response(500, { error: "internal" }));
    const err = await pairWithHost(
      { address: "10.0.0.5", code: "123456", check: yes },
      { fetch: fetch as unknown as typeof globalThis.fetch },
    ).catch((e) => e);
    expect((err as PairFailed).code).toBe("bad_request");
    expect(useHosts.getState().hosts).toHaveLength(0);
  });

  it("pair_messages", () => {
    expect(pairMessage("bad_code")).toBe("Wrong code. Check the code on the host.");
    expect(pairMessage("no_window")).toBe("No pairing window. Run herdlingd pair on the host.");
    expect(pairMessage("too_many_attempts")).toBe("Too many wrong codes. Run herdlingd pair again.");
  });
});

describe("getDeviceId", () => {
  it("device_id_is_stable", async () => {
    const a = await getDeviceId();
    expect(a).toMatch(/^d_[a-z0-9]+$/);
    expect(await getDeviceId()).toBe(a);
  });
});

describe("pairWithHost re-pair", () => {
  const ok = (body: object) =>
    jest.fn(async (_url: string, _init?: RequestInit) => response(200, body)) as jest.Mock;
  const bodyOf = (f: jest.Mock) => JSON.parse(String((f.mock.calls[0][1] as RequestInit).body));

  it("pair_again_same_fingerprint_updates_host", async () => {
    const old = useHosts.getState().addHost({
      name: "Work",
      address: "10.0.0.9",
      port: 22,
      user: "sam",
      fingerprint: "SHA256:abc",
    });
    const fetch = ok({ host_name: "studio", user: "sam", ssh_port: 2222, host_key_fingerprint: "SHA256:abc" });
    const host = await pairWithHost({ address: "10.0.0.5", code: "123456", check: yes }, { fetch: fetch as never });

    const saved = useHosts.getState().hosts;
    expect(saved).toHaveLength(1);
    expect(host.id).toBe(old.id);
    expect(saved[0]).toMatchObject({ id: old.id, name: "Work", address: "10.0.0.5", port: 2222, fingerprint: "SHA256:abc" });
  });

  it("pair_again_same_address_port_user_updates_host", async () => {
    const old = useHosts.getState().addHost({ name: "studio", address: "10.0.0.5", port: 22, user: "sam" });
    const fetch = ok({ host_name: "studio", user: "sam", ssh_port: 22, host_key_fingerprint: "SHA256:abc" });
    const host = await pairWithHost({ address: "10.0.0.5", code: "123456", check: yes }, { fetch: fetch as never });

    expect(bodyOf(fetch).host_id).toBe(old.id);
    const saved = useHosts.getState().hosts;
    expect(saved).toHaveLength(1);
    expect(host.id).toBe(old.id);
    expect(saved[0]).toMatchObject({ id: old.id, fingerprint: "SHA256:abc" });
  });

  it("pair_same_address_other_user_adds_host_with_unique_id", async () => {
    const other = useHosts.getState().addHost({ name: "root box", address: "10.0.0.5", port: 22, user: "root" });
    const fetch = ok({ host_name: "studio", user: "sam", ssh_port: 22, host_key_fingerprint: null });
    const host = await pairWithHost({ address: "10.0.0.5", code: "123456", check: yes }, { fetch: fetch as never });

    const saved = useHosts.getState().hosts;
    expect(saved).toHaveLength(2);
    expect(host.id).not.toBe(other.id);
    expect(new Set(saved.map((h) => h.id)).size).toBe(2);
  });
});

describe("pairWithHost host key", () => {
  const ok = (fp: string | null) =>
    jest.fn(async () => response(200, { host_name: "studio", user: "sam", ssh_port: 22, host_key_fingerprint: fp }));

  it("qr_fingerprint_must_match", async () => {
    const err = await pairWithHost(
      { address: "10.0.0.5", code: "123456", check: { fingerprint: FP } },
      { fetch: ok(FP2) as never },
    ).catch((e) => e);
    expect((err as PairFailed).code).toBe("host_key_mismatch");
    const none = await pairWithHost(
      { address: "10.0.0.5", code: "123456", check: { fingerprint: FP } },
      { fetch: ok(null) as never },
    ).catch((e) => e);
    expect((none as PairFailed).code).toBe("host_key_mismatch");
    expect(useHosts.getState().hosts).toHaveLength(0);

    const host = await pairWithHost(
      { address: "10.0.0.5", code: "123456", check: { fingerprint: FP } },
      { fetch: ok(FP) as never },
    );
    expect(host.fingerprint).toBe(FP);
  });

  it("manual_entry_asks_to_confirm_the_reported_key", async () => {
    const confirm = jest.fn(async () => false);
    const err = await pairWithHost({ address: "10.0.0.5", code: "123456", check: { confirm } }, { fetch: ok(FP) as never }).catch(
      (e) => e,
    );
    expect(confirm).toHaveBeenCalledWith(FP);
    expect((err as PairFailed).code).toBe("not_confirmed");
    expect(useHosts.getState().hosts).toHaveLength(0);

    const yesConfirm = jest.fn(async () => true);
    await pairWithHost({ address: "10.0.0.5", code: "123456", check: { confirm: yesConfirm } }, { fetch: ok(null) as never });
    expect(yesConfirm).toHaveBeenCalledWith(null);
    expect(useHosts.getState().hosts).toHaveLength(1);
  });

  it("repair_never_replaces_a_pinned_key", async () => {
    const old = useHosts.getState().addHost({ name: "Work", address: "10.0.0.5", port: 22, user: "sam", fingerprint: FP });
    const confirm = jest.fn(async () => true);
    const err = await pairWithHost({ address: "10.0.0.5", code: "123456", check: { confirm } }, { fetch: ok(FP2) as never }).catch(
      (e) => e,
    );
    expect((err as PairFailed).code).toBe("host_key_changed");
    expect((err as PairFailed).message).toMatch(/different from the saved one/);
    // Refused before the user is asked, so a tap on "It matches" cannot override the pin.
    expect(confirm).not.toHaveBeenCalled();
    expect(useHosts.getState().hosts).toEqual([expect.objectContaining({ id: old.id, fingerprint: FP })]);
  });

  it("repair_never_clears_a_pinned_key", async () => {
    const old = useHosts.getState().addHost({ name: "Work", address: "10.0.0.5", port: 22, user: "sam", fingerprint: FP });
    const err = await pairWithHost({ address: "10.0.0.5", code: "123456", check: yes }, { fetch: ok(null) as never }).catch((e) => e);
    expect((err as PairFailed).code).toBe("host_key_changed");
    const saved = useHosts.getState().hosts.find((h) => h.id === old.id)!;
    expect(saved.fingerprint).toBe(FP);
    expect("fingerprint" in saved).toBe(true);
  });

  it("repair_without_key_on_unpinned_host_writes_no_fingerprint_field", async () => {
    const old = useHosts.getState().addHost({ name: "Work", address: "10.0.0.5", port: 22, user: "sam" });
    await pairWithHost({ address: "10.0.0.5", code: "123456", check: yes }, { fetch: ok(null) as never });
    const saved = useHosts.getState().hosts.find((h) => h.id === old.id)!;
    expect("fingerprint" in saved).toBe(false);
  });
});
