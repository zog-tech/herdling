import type { Hello, UpdateApply, UpdateCheck } from "@herdling/protocol";
import { useEffect } from "react";

import * as ssh from "../../modules/ssh";
import { isDemoHost } from "../demo/demoHost";
import type { RpcClient } from "../rpc/RpcClient";
import { getHostConn, retryNow, useHostConn } from "./connection";
import { runInstaller, type InstallerDeps, type InstallResult } from "./installer";
import { listsMethod } from "./methods";
import { useHosts, type Host, type UpdateCache } from "./store";

/**
 * herdlingd updates: `update.check` at most once a day for each host, the status that the host
 * screens show, `update.apply` with the reconnect after it, and the password path for a
 * herdlingd that is too old to update itself.
 */

export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
/** `update.apply` downloads and replaces the binary on the host. */
export const APPLY_TIMEOUT_MS = 180_000;
const CHECK_TIMEOUT_MS = 30_000;
/** How long to wait for the host to connect again after an update. */
const RECONNECT_WAIT_MS = 60_000;
const POLL_MS = 500;

export type UpdateStatus =
  | { kind: "none" }
  | { kind: "available"; from: string; to: string; notes: string }
  /** The host's herdlingd has no `update.apply`: the installer must run over a password login. */
  | { kind: "password" };

/** True when the host can answer `update.check` and the saved result is missing, old, or for another version. */
export function shouldCheck(host: Host, hello: Hello | undefined, now: number): boolean {
  if (isDemoHost(host) || !hello || !listsMethod(hello, "update.check")) return false;
  const c = host.updateCheck;
  return !c || c.current !== hello.herdlingd || now - c.checkedAt >= CHECK_EVERY_MS || now < c.checkedAt;
}

/** What the host screens show. `hello` is undefined while the host is offline. */
export function updateStatus(host: Host, hello: Hello | undefined): UpdateStatus {
  if (isDemoHost(host) || !hello) return { kind: "none" };
  if (!listsMethod(hello, "update.apply")) return { kind: "password" };
  const c = host.updateCheck;
  if (c && c.updateAvailable && c.current === hello.herdlingd) return { kind: "available", from: c.current, to: c.latest, notes: c.notes };
  return { kind: "none" };
}

/** True when the Overview shows the one-line notice: an update the user did not close. */
export function showUpdateNotice(host: Host, status: UpdateStatus): boolean {
  return status.kind === "available" && host.dismissedUpdate !== status.to;
}

function cacheOf(r: UpdateCheck, now: number): UpdateCache {
  return { checkedAt: now, current: r.current, latest: r.latest, updateAvailable: r.update_available, notes: r.notes ?? "" };
}

const checking = new Set<string>();

/** Calls `update.check` and saves the result on the host. A failure is quiet: the next day tries again. */
export async function checkForUpdate(hostId: string, rpc: RpcClient, now = Date.now()): Promise<UpdateCache | undefined> {
  if (checking.has(hostId)) return undefined;
  checking.add(hostId);
  try {
    const r = await rpc.call<UpdateCheck>("update.check", {}, CHECK_TIMEOUT_MS);
    const cache = cacheOf(r, now);
    useHosts.getState().updateHost(hostId, { updateCheck: cache });
    return cache;
  } catch {
    // Keep the old result, but do not ask again for a day.
    const old = useHosts.getState().hosts.find((h) => h.id === hostId)?.updateCheck;
    if (old) useHosts.getState().updateHost(hostId, { updateCheck: { ...old, checkedAt: now } });
    return undefined;
  } finally {
    checking.delete(hostId);
  }
}

/** Checks one host for an update when it comes online, at most once a day. */
export function useUpdateCheck(hostId: string): void {
  const { status, rpc, hello } = useHostConn(hostId);
  const host = useHosts((s) => s.hosts.find((h) => h.id === hostId));
  useEffect(() => {
    if (status !== "online" || !rpc || !host || !shouldCheck(host, hello, Date.now())) return;
    void checkForUpdate(hostId, rpc);
  }, [status, rpc, hello, host, hostId]);
}

/** Text for a failed `update.apply`. */
export function updateErrorMessage(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  const message = e instanceof Error ? e.message : "";
  switch (code) {
    case "update_unavailable":
      return "The computer could not get the release from GitHub. Check its network, then try again.";
    case "checksum_mismatch":
      return "The download is damaged or changed (checksum mismatch). herdlingd was not changed.";
    case "unsupported_target":
      return "There is no herdlingd build for this computer. Build it from source.";
    case "downgrade":
      return "The release is older than the running herdlingd. Nothing was changed.";
    case "update_in_progress":
      return "An update is already running on this computer. Wait a moment, then try again.";
    case "timeout":
      return "The update took too long. herdlingd may still finish it: check the version again in a minute.";
    case "disconnected":
      return "The connection closed during the update. Check the version when the host is online again.";
    default:
      return `The update failed${message ? `: ${message.slice(0, 200)}` : "."}`;
  }
}

/** Waits until the host is online again after attempt `attempt` started. Returns its hello, or undefined after the wait. */
async function waitForHello(hostId: string, attempt: number | undefined, waitMs: number): Promise<Hello | undefined> {
  const end = Date.now() + waitMs;
  while (Date.now() < end) {
    const c = getHostConn(hostId);
    if (c.status === "online" && c.hello && (attempt === undefined || c.attempt >= attempt)) return c.hello;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return undefined;
}

export type ApplyOutcome = { status: UpdateApply["status"]; version: string };

/**
 * Runs `update.apply`, then reconnects: the open rpc process keeps the old code, and a new SSH
 * channel runs the new binary. Returns the version from the new hello. Throws with a user text.
 */
export async function applyUpdate(hostId: string, waitMs = RECONNECT_WAIT_MS): Promise<ApplyOutcome> {
  const conn = getHostConn(hostId);
  if (conn.status !== "online" || !conn.rpc) throw new Error("The host is offline. Connect it first.");
  let r: UpdateApply;
  try {
    r = await conn.rpc.call<UpdateApply>("update.apply", {}, APPLY_TIMEOUT_MS);
  } catch (e) {
    throw new Error(updateErrorMessage(e));
  }
  const saveRunning = (version: string, latest: string) =>
    useHosts.getState().updateHost(hostId, {
      updateCheck: { checkedAt: Date.now(), current: version, latest, updateAvailable: false, notes: "" },
    });
  if (r.status === "up_to_date") {
    saveRunning(r.to, r.to);
    return { status: r.status, version: r.to };
  }
  const attempt = retryNow(hostId);
  const hello = await waitForHello(hostId, attempt, waitMs);
  if (!hello) throw new Error(`herdlingd ${r.to} is installed, but the host did not connect again yet. Herdling keeps trying.`);
  saveRunning(hello.herdlingd, r.to);
  return { status: r.status, version: hello.herdlingd };
}

const defaultInstallerDeps: InstallerDeps = { execWithPassword: ssh.execWithPassword };

/**
 * For a herdlingd with no `update.apply`: logs in once with the password and runs the installer,
 * pinned to the saved host key. Then reconnects. The password is not kept.
 */
export async function updateWithPassword(
  host: Host,
  password: string,
  deps: InstallerDeps = defaultInstallerDeps,
): Promise<InstallResult> {
  if (!host.fingerprint) {
    return { ok: false, code: "host_key_mismatch", message: "The host key is not pinned yet. Connect the host once first.", lines: [] };
  }
  const result = await runInstaller(deps, {
    host: host.address,
    port: host.port,
    user: host.user,
    password,
    expectedFingerprint: host.fingerprint,
  });
  if (result.ok) {
    useHosts.getState().updateHost(host.id, { updateCheck: undefined });
    retryNow(host.id);
  }
  return result;
}
