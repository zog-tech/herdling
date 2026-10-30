const mockItems = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => mockItems.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockItems.set(k, v),
  deleteItemAsync: async (k: string) => void mockItems.delete(k),
}));
jest.mock("../../modules/ssh", () => ({}));
jest.mock("./connection", () => ({ retryNow: jest.fn() }));
jest.mock("expo-device", () => ({ deviceName: "Sam's iPhone" }));

import type { PasswordExecOptions, PasswordExecResult } from "../../modules/ssh";
import { ENROLL_COMMAND, parseEnroll, type SetupDeps, SetupFailed, setUpWithPassword } from "./passwordSetup";
import { useHosts } from "./store";

const FP = "SHA256:" + "a".repeat(43);
const FP2 = "SHA256:" + "b".repeat(43);
const PASSWORD = "correct horse battery staple";
const PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIA zogssh";

function deps(over: { stdout?: string; exitCode?: number; probe?: string; seen?: string; execError?: object } = {}) {
  const exec = jest.fn(async (o: PasswordExecOptions): Promise<PasswordExecResult> => {
    if (over.execError) throw over.execError;
    void o;
    return {
      stdout: over.stdout ?? `${JSON.stringify({ ok: true, host_fingerprint: FP, hostname: "studio" })}\n`,
      stderr: "",
      exitCode: over.exitCode ?? 0,
      hostFingerprint: over.seen ?? FP,
    };
  });
  const d: SetupDeps & { execWithPassword: typeof exec; reconnect: jest.Mock } = {
    probeHostKey: jest.fn(async () => ({ fingerprint: over.probe ?? FP })),
    execWithPassword: exec,
    ensureKey: jest.fn(async () => ({ publicKey: PUBLIC_KEY })),
    getDeviceId: async () => "d_test",
    deviceName: () => "Sam's iPhone",
    reconnect: jest.fn(),
  };
  return d;
}

const base = { address: " 10.0.0.5 ", port: 22, user: "sam", password: PASSWORD };
const yes = jest.fn(async () => true);

async function failure(p: Promise<unknown>): Promise<SetupFailed> {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(SetupFailed);
  expect((e as Error).message).not.toContain(PASSWORD);
  return e as SetupFailed;
}

beforeEach(() => {
  useHosts.setState({ hosts: [] });
  yes.mockClear();
});

describe("setUpWithPassword", () => {
  it("cancel at fingerprint confirm sends nothing", async () => {
    const d = deps();
    const confirm = jest.fn(async () => false);
    const e = await failure(setUpWithPassword({ ...base, confirm }, d));
    expect(e.code).toBe("not_confirmed");
    expect(confirm).toHaveBeenCalledWith(FP);
    expect(d.probeHostKey).toHaveBeenCalledWith({ host: "10.0.0.5", port: 22, timeoutMs: expect.any(Number) });
    expect(d.execWithPassword).not.toHaveBeenCalled();
    expect(d.ensureKey).not.toHaveBeenCalled();
    expect(useHosts.getState().hosts).toEqual([]);
  });

  it("not_installed gives the install message", async () => {
    const d = deps({ stdout: '{"ok":false,"code":"not_installed"}\n', exitCode: 3 });
    const e = await failure(setUpWithPassword({ ...base, confirm: yes }, d));
    expect(e.code).toBe("not_installed");
    expect(e.message).toMatch(/^zogsshd is not installed on this host\. Install it first/);
    expect(useHosts.getState().hosts).toEqual([]);
  });

  it("enroll fingerprint mismatch aborts and saves nothing", async () => {
    const d = deps({ stdout: JSON.stringify({ ok: true, host_fingerprint: FP2, hostname: "studio" }) });
    const e = await failure(setUpWithPassword({ ...base, confirm: yes }, d));
    expect(e.code).toBe("host_key_mismatch");
    expect(useHosts.getState().hosts).toEqual([]);

    // A host with no readable host key file cannot be cross-checked either.
    const none = deps({ stdout: JSON.stringify({ ok: true, host_fingerprint: null, hostname: "studio" }) });
    expect((await failure(setUpWithPassword({ ...base, confirm: yes }, none))).code).toBe("host_key_mismatch");
    expect(useHosts.getState().hosts).toEqual([]);
  });

  it("success saves host with pinned fingerprint and never stores the password", async () => {
    const d = deps({ stdout: `Welcome to the host\n${JSON.stringify({ ok: true, host_fingerprint: FP, hostname: "studio" })}\n` });
    const host = await setUpWithPassword({ ...base, confirm: yes }, d);

    const [opts] = d.execWithPassword.mock.calls[0];
    expect(opts).toMatchObject({
      host: "10.0.0.5",
      port: 22,
      user: "sam",
      password: PASSWORD,
      command: ENROLL_COMMAND,
      expectedFingerprint: FP,
    });
    // The request goes on stdin as one line, never in the command line.
    expect(opts.stdin.endsWith("\n")).toBe(true);
    expect(JSON.parse(opts.stdin)).toEqual({
      device_id: "d_test",
      device_name: "Sam's iPhone",
      host_id: host.id,
      public_key: PUBLIC_KEY,
    });
    expect(opts.command).not.toContain(PUBLIC_KEY);
    expect(opts.stdin).not.toContain(PASSWORD);

    expect(useHosts.getState().hosts).toEqual([
      { id: host.id, name: "studio", address: "10.0.0.5", port: 22, user: "sam", fingerprint: FP, command: "zogsshd rpc" },
    ]);
    // Neither the store nor the Keychain holds the password.
    expect(JSON.stringify(useHosts.getState())).not.toContain(PASSWORD);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockItems.size).toBeGreaterThan(0);
    for (const v of mockItems.values()) expect(v).not.toContain(PASSWORD);
    expect(d.reconnect).not.toHaveBeenCalled();
  });

  it("re-enroll updates the existing host", async () => {
    const saved = useHosts.getState().addHost({ name: "my box", address: "10.0.0.5", port: 22, user: "sam", fingerprint: FP });
    const d = deps();
    const host = await setUpWithPassword({ ...base, name: "ignored", confirm: yes }, d);

    expect(host.id).toBe(saved.id);
    expect(JSON.parse(d.execWithPassword.mock.calls[0][0].stdin).host_id).toBe(saved.id);
    expect(useHosts.getState().hosts).toEqual([{ ...saved, fingerprint: FP }]);
    expect(d.reconnect).toHaveBeenCalledWith(saved.id);
  });

  it("refuses before sending the password when the saved pin differs", async () => {
    useHosts.getState().addHost({ name: "my box", address: "10.0.0.5", port: 22, user: "sam", fingerprint: FP2 });
    const d = deps();
    const e = await failure(setUpWithPassword({ ...base, confirm: yes }, d));
    expect(e.code).toBe("host_key_changed");
    expect(yes).not.toHaveBeenCalled();
    expect(d.execWithPassword).not.toHaveBeenCalled();
    expect(useHosts.getState().hosts[0].fingerprint).toBe(FP2);
  });

  it("maps native errors and enroll failures without the password", async () => {
    const auth = deps({ execError: { code: "auth_failed", message: `bad ${PASSWORD}` } });
    expect((await failure(setUpWithPassword({ ...base, confirm: yes }, auth))).code).toBe("auth_failed");

    const mismatch = deps({ execError: { code: "host_key_mismatch" } });
    expect((await failure(setUpWithPassword({ ...base, confirm: yes }, mismatch))).code).toBe("host_key_mismatch");

    const refused = deps();
    refused.probeHostKey = jest.fn(async () => {
      throw { code: "connect_failed", message: "Connection refused" };
    });
    const e = await failure(setUpWithPassword({ ...base, confirm: yes }, refused));
    expect(e.code).toBe("unreachable");
    expect(e.message).toBe("Can't reach 10.0.0.5:22. Check the host and port.");

    const bad = deps({ stdout: '{"ok":false,"code":"bad_request","message":"invalid host_id"}', exitCode: 1 });
    const b = await failure(setUpWithPassword({ ...base, confirm: yes }, bad));
    expect(b.code).toBe("enroll_failed");
    expect(b.message).toContain("invalid host_id");

    const junk = deps({ stdout: "sh: zogsshd: oops\n", exitCode: 127 });
    expect((await failure(setUpWithPassword({ ...base, confirm: yes }, junk))).code).toBe("bad_answer");
    expect(useHosts.getState().hosts).toEqual([]);
  });
});

describe("ENROLL_COMMAND", () => {
  it("is the exact shell command (checked in zsh and bash: exit 3 and the not_installed line without zogsshd)", () => {
    expect(ENROLL_COMMAND).toBe(
      String.raw`sh -c 'Z=$(command -v zogsshd || echo "$HOME/.local/bin/zogsshd"); [ -x "$Z" ] || { echo "{\"ok\":false,\"code\":\"not_installed\"}"; exit 3; }; exec "$Z" enroll'`,
    );
  });
});

describe("parseEnroll", () => {
  it("takes the last result line", () => {
    expect(parseEnroll('{"x":1}\nhello\n{"ok":true,"host_fingerprint":null,"hostname":"h"}\n\n')).toEqual({
      ok: true,
      host_fingerprint: null,
      hostname: "h",
    });
    expect(parseEnroll("nothing here")).toBeUndefined();
    expect(parseEnroll('{"ok":true}')).toBeUndefined();
  });
});
