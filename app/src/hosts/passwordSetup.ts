import type { EnrollRequest, EnrollResult } from "@herdling/protocol";

import * as ssh from "../../modules/ssh";
import { deviceName, getDeviceId } from "../device";
import { PairFailed, savedHostFor, saveHost, type HostValues } from "../pairing/pair";
import { retryNow } from "./connection";
import { runInstaller } from "./installer";
import { newHostId, type Host } from "./store";

export type SetupFailCode =
  | "unreachable"
  | "timeout"
  | "host_key_changed"
  | "not_confirmed"
  | "host_key_mismatch"
  | "auth_failed"
  | "not_installed"
  | "install_failed"
  | "enroll_failed"
  | "bad_answer";

/** Password setup did not work; nothing was saved. `message` is the text for the user and never holds the password. */
export class SetupFailed extends Error {
  constructor(
    readonly code: SetupFailCode,
    message = setupMessage(code),
  ) {
    super(message);
    this.name = "SetupFailed";
  }
}

export function setupMessage(code: SetupFailCode, target?: { address: string; port: number }): string {
  switch (code) {
    case "unreachable":
      return target ? `Can't reach ${target.address}:${target.port}. Check the host and port.` : "Can't reach the host.";
    case "timeout":
      return "The host did not answer in time. Nothing was saved.";
    case "host_key_changed":
      return "The host key is different from the saved one. Nothing was sent. To trust the new key, remove the host and set it up again.";
    case "not_confirmed":
      return "Setup stopped: the host key was not confirmed. The password was not sent.";
    case "host_key_mismatch":
      return "The host key changed during setup. Someone on the network may be intercepting the connection. Nothing was saved.";
    case "auth_failed":
      return "The host did not accept the user name and password, or it does not allow password login.";
    case "not_installed":
      return "herdlingd is not installed on this host. Install it from Herdling, or on the computer with the installer from herdling.zog-tech.com.";
    case "install_failed":
      return "herdlingd could not be installed. Nothing was saved.";
    case "enroll_failed":
      return "The host could not add this phone's key. Nothing was saved.";
    case "bad_answer":
      return "The host gave an answer Herdling does not understand. Is herdlingd up to date? Nothing was saved.";
  }
}

/**
 * Runs `herdlingd enroll` from the PATH, else from `~/.local/bin` (where `herdlingd install` puts it).
 * The enroll request goes on stdin, never in the command line. Exit 3 means not installed.
 */
export const ENROLL_COMMAND =
  `sh -c 'Z=$(command -v herdlingd || echo "$HOME/.local/bin/herdlingd"); ` +
  `[ -x "$Z" ] || { echo "{\\"ok\\":false,\\"code\\":\\"not_installed\\"}"; exit 3; }; exec "$Z" enroll'`;

const PROBE_TIMEOUT_MS = 10_000;
const EXEC_TIMEOUT_MS = 30_000;

export type SetupDeps = {
  probeHostKey: typeof ssh.probeHostKey;
  execWithPassword: typeof ssh.execWithPassword;
  ensureKey: typeof ssh.ensureKey;
  getDeviceId: () => Promise<string>;
  deviceName: () => string;
  /** Reconnects a saved host now. */
  reconnect: (hostId: string) => void;
};

const defaultDeps: SetupDeps = {
  probeHostKey: ssh.probeHostKey,
  execWithPassword: ssh.execWithPassword,
  ensureKey: ssh.ensureKey,
  getDeviceId,
  deviceName,
  reconnect: (id) => void retryNow(id),
};

export type SetupOptions = {
  name?: string;
  address: string;
  port: number;
  user: string;
  password: string;
  /** Shows the probed host key to the user; false stops setup before the password is sent. */
  confirm: (fingerprint: string) => Promise<boolean>;
  /**
   * Asks the user to install herdlingd when the host does not have it. True runs the installer
   * with the same password and host key. Missing or false: setup stops with "not_installed".
   */
  confirmInstall?: (target: { address: string }) => Promise<boolean>;
  /** The current step, for the screen. */
  onProgress?: (step: SetupStep) => void;
};

export type SetupStep = "connecting" | "installing" | "pairing";

/**
 * "Set up with password": reads the host key and asks the user to confirm it, logs in once with
 * the password (pinned to that key), runs `herdlingd enroll` to add this phone's restricted key,
 * then saves the host with the pinned key under the same rules as pairing. The password is used
 * for that one login only: it is never saved, logged or put in an error. Throws `SetupFailed`.
 */
export async function setUpWithPassword(o: SetupOptions, deps: SetupDeps = defaultDeps): Promise<Host> {
  const address = o.address.trim();
  const user = o.user.trim();
  const port = o.port;
  const target = { address, port };

  o.onProgress?.("connecting");
  const { fingerprint } = await native(() => deps.probeHostKey({ host: address, port, timeoutMs: PROBE_TIMEOUT_MS }), target);
  const values: HostValues = { address, port, user, fingerprint };
  // Refuse before the password goes anywhere when a saved pin for this host differs.
  const saved = findSaved(values);
  if (!(await o.confirm(fingerprint))) throw new SetupFailed("not_confirmed");

  const [deviceId, key] = await Promise.all([deps.getDeviceId(), deps.ensureKey()]);
  // Re-enrolling a saved host keeps its id, so the companion's host_id matches.
  const hostId = saved?.id ?? newHostId();
  const request: EnrollRequest = {
    device_id: deviceId,
    device_name: deps.deviceName(),
    host_id: hostId,
    public_key: key.publicKey,
  };
  const enrollOnce = async (): Promise<ParsedEnroll | "not_installed" | undefined> => {
    const res = await native(
      () =>
        deps.execWithPassword({
          host: address,
          port,
          user,
          password: o.password,
          command: ENROLL_COMMAND,
          stdin: `${JSON.stringify(request)}\n`,
          expectedFingerprint: fingerprint,
          timeoutMs: EXEC_TIMEOUT_MS,
        }),
      target,
    );
    if (res.hostFingerprint !== fingerprint) throw new SetupFailed("host_key_mismatch");
    const parsed = parseEnroll(res.stdout);
    if ((parsed && !parsed.ok && parsed.code === "not_installed") || (!parsed && res.exitCode === 3)) return "not_installed";
    return parsed;
  };

  o.onProgress?.("pairing");
  let answer = await enrollOnce();
  if (answer === "not_installed") {
    if (!o.confirmInstall || !(await o.confirmInstall({ address }))) throw new SetupFailed("not_installed");
    o.onProgress?.("installing");
    const installed = await runInstaller(deps, { host: address, port, user, password: o.password, expectedFingerprint: fingerprint });
    if (!installed.ok) {
      if (installed.code === "host_key_mismatch" || installed.code === "auth_failed" || installed.code === "timeout") {
        throw new SetupFailed(installed.code);
      }
      throw new SetupFailed("install_failed", `${installed.message} Nothing was saved.`);
    }
    o.onProgress?.("pairing");
    answer = await enrollOnce();
    // The installer said it worked, but the enroll command still finds no herdlingd.
    if (answer === "not_installed") throw new SetupFailed("install_failed");
  }
  if (!answer) throw new SetupFailed("bad_answer");
  if (!answer.ok) {
    const why = answer.message ? `: ${answer.message.slice(0, 200)}` : ".";
    throw new SetupFailed("enroll_failed", `The host could not add this phone's key${why} Nothing was saved.`);
  }
  // The companion reads the host key from disk: it must be the key the login was pinned to.
  if (answer.host_fingerprint !== fingerprint) throw new SetupFailed("host_key_mismatch");

  // The store may have changed while the login ran: apply the rule again.
  const current = findSaved(values);
  const host = saveHost(current, { id: hostId, name: o.name?.trim() || answer.hostname }, values);
  // A new host connects when it is added; a saved one may be in backoff after a failed key login.
  if (current) deps.reconnect(host.id);
  return host;
}

function findSaved(values: HostValues): Host | undefined {
  try {
    return savedHostFor(values);
  } catch (e) {
    if (e instanceof PairFailed && e.code === "host_key_changed") throw new SetupFailed("host_key_changed");
    throw e;
  }
}

/** Runs a native call and turns its error into `SetupFailed`. The native text is never shown. */
async function native<T>(call: () => Promise<T>, target: { address: string; port: number }): Promise<T> {
  try {
    return await call();
  } catch (e) {
    const code = (e as { code?: unknown } | null)?.code;
    switch (code) {
      case "host_key_mismatch":
      case "auth_failed":
      case "timeout":
        throw new SetupFailed(code);
      case "exec_failed":
        throw new SetupFailed("enroll_failed");
      default:
        throw new SetupFailed("unreachable", setupMessage("unreachable", target));
    }
  }
}

/** An enroll result, or the `not_installed` line of `ENROLL_COMMAND` (no message). */
export type ParsedEnroll = Extract<EnrollResult, { ok: true }> | { ok: false; code: string; message?: string };

/** The last stdout line that is an enroll result (a login shell may print other lines first). */
export function parseEnroll(stdout: string): ParsedEnroll | undefined {
  const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    let v: unknown;
    try {
      v = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const r = v as Record<string, unknown>;
    if (typeof r !== "object" || r === null) continue;
    if (
      r.ok === true &&
      typeof r.hostname === "string" &&
      (r.host_fingerprint === null || typeof r.host_fingerprint === "string")
    ) {
      return { ok: true, hostname: r.hostname, host_fingerprint: r.host_fingerprint as string | null };
    }
    if (r.ok === false && typeof r.code === "string") {
      return { ok: false, code: r.code, message: typeof r.message === "string" ? r.message : undefined };
    }
  }
  return undefined;
}
