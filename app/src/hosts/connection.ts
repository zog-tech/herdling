import type { Hello } from "@zogssh/protocol";
import { AppState } from "react-native";
import { create } from "zustand";

import * as ssh from "../../modules/ssh";
import { useNotifPrefs } from "../push/prefs";
import { registerPush } from "../push/register";
import { RpcClient } from "../rpc/RpcClient";
import type { LineTransport } from "../rpc/transport";
import { useHosts, type Host } from "./store";

export type HostConn = {
  status: "offline" | "connecting" | "online";
  lastSeen?: number;
  rpc?: RpcClient;
  hello?: Hello;
  error?: string;
  /** Number of connection attempts started for this host. A caller that wants a fresh result compares it. */
  attempt: number;
};

/** Seconds to wait before retry number n (1-based); the last value repeats. */
const BACKOFF_S = [1, 2, 4, 8, 16, 30];
/** While in the foreground and online, ping this often; a ping that takes longer than the timeout counts as a drop. */
const PING_EVERY_MS = 15_000;
const PING_TIMEOUT_MS = 5_000;
const OFFLINE: HostConn = { status: "offline", attempt: 0 };

type ChannelEvent =
  | { kind: "data"; channelId: string; data: string }
  | { kind: "stderr"; channelId: string; data: string }
  | { kind: "close"; channelId: string; reason: string };

/** Subscribes to all channel events of the native module and passes them to `cb`. */
function listenChannels(cb: (e: ChannelEvent) => void): () => void {
  const subs = [
    ssh.addListener("onData", (e) => cb({ kind: "data", ...e })),
    ssh.addListener("onStderr", (e) => cb({ kind: "stderr", ...e })),
    ssh.addListener("onChannelClose", (e) => cb({ kind: "close", ...e })),
  ];
  return () => subs.forEach((s) => s.remove());
}

/**
 * `LineTransport` over a native exec channel. Splits `onData` chunks into lines.
 * Lines that arrive before the first `onLine` callback are kept and delivered to it;
 * a close is delivered to `onClose` callbacks added after it.
 */
export class ExecTransport implements LineTransport {
  private buffer = "";
  private closeReason?: string;
  private early: string[] | null = [];
  private readonly lineCbs = new Set<(line: string) => void>();
  private readonly closeCbs = new Set<(reason: string) => void>();
  private readonly unlisten: () => void;

  /** Subscribes first, then opens the channel, so no event of the new channel is lost. */
  static async open(hostId: string, command: string): Promise<ExecTransport> {
    const pending: ChannelEvent[] = [];
    const unlisten = listenChannels((e) => pending.push(e));
    try {
      const channelId = await ssh.openExec(hostId, command);
      return new ExecTransport(channelId, pending.filter((e) => e.channelId === channelId));
    } finally {
      unlisten();
    }
  }

  constructor(
    readonly channelId: string,
    replay: ChannelEvent[] = [],
  ) {
    this.unlisten = listenChannels((e) => {
      if (e.channelId === channelId) this.handle(e);
    });
    replay.forEach((e) => this.handle(e));
  }

  get closed(): boolean {
    return this.closeReason !== undefined;
  }

  send(line: string): void {
    if (this.closed) throw new Error("channel closed");
    ssh.write(this.channelId, line + "\n").catch((e) => this.end(errorText(e)));
  }

  onLine(cb: (line: string) => void): () => void {
    this.lineCbs.add(cb);
    const early = this.early;
    if (early) {
      this.early = null;
      // Async, so the subscriber finishes its own setup first.
      if (early.length > 0) queueMicrotask(() => early.forEach((l) => cb(l)));
    }
    return () => this.lineCbs.delete(cb);
  }

  onClose(cb: (reason: string) => void): () => void {
    this.closeCbs.add(cb);
    const reason = this.closeReason;
    if (reason !== undefined) queueMicrotask(() => this.closeCbs.has(cb) && cb(reason));
    return () => this.closeCbs.delete(cb);
  }

  close(): void {
    if (this.closed) return;
    ssh.closeChannel(this.channelId).catch(() => {});
    this.end("closed");
  }

  private handle(e: ChannelEvent): void {
    if (e.kind === "data") this.push(e.data);
    else if (e.kind === "stderr") console.warn(`[ssh ${this.channelId}] stderr:`, e.data.trimEnd());
    else this.end(e.reason);
  }

  private push(chunk: string): void {
    this.buffer += chunk;
    const parts = this.buffer.split("\n");
    this.buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.endsWith("\r") ? part.slice(0, -1) : part;
      if (line.length === 0) continue;
      if (this.early) this.early.push(line);
      else this.lineCbs.forEach((cb) => cb(line));
    }
  }

  private end(reason: string): void {
    if (this.closed) return;
    this.closeReason = reason;
    this.unlisten();
    this.closeCbs.forEach((cb) => cb(reason));
  }
}

const useConns = create<{ conns: Record<string, HostConn> }>(() => ({ conns: {} }));

function setConn(hostId: string, conn: HostConn): void {
  useConns.setState((s) => ({ conns: { ...s.conns, [hostId]: conn } }));
}

export function useHostConn(hostId: string): HostConn {
  return useConns((s) => s.conns[hostId] ?? OFFLINE);
}

/** Comma-joined ids of the given hosts that are online (a string, so the selector result is stable). */
export function useOnlineHostKey(hostIds: string[]): string {
  return useConns((s) => hostIds.filter((id) => s.conns[id]?.status === "online").join(","));
}

/** Current state outside React. */
export function getHostConn(hostId: string): HostConn {
  return useConns.getState().conns[hostId] ?? OFFLINE;
}

/** One saved host: connects, opens the rpc channel, says hello and retries with backoff. */
class HostConnection {
  private generation = 0;
  private attemptNo = 0;
  private failures = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private rpc?: RpcClient;
  private pingTimer?: ReturnType<typeof setInterval>;
  private foreground: boolean;
  /** Set on a host key mismatch: no retries until the host entry changes. */
  private blocked = false;
  private stopped = false;

  constructor(
    private host: Host,
    foreground: boolean,
  ) {
    this.foreground = foreground;
  }

  get id(): string {
    return this.host.id;
  }

  /** The saved entry changed. A new address, user or key pin restarts the connection. */
  update(host: Host): void {
    const old = this.host;
    this.host = host;
    const same =
      old.address === host.address &&
      old.port === host.port &&
      old.user === host.user &&
      old.command === host.command &&
      (old.fingerprint === host.fingerprint || old.fingerprint === undefined);
    if (same) return;
    this.blocked = false;
    this.failures = 0;
    this.connectNow();
  }

  /** Connect now unless online, connecting or blocked. */
  wake(): void {
    const status = getHostConn(this.id).status;
    if (this.blocked || this.stopped || status !== "offline") return;
    this.failures = 0;
    this.connectNow();
  }

  /** The app came to the foreground or left it. */
  setForeground(active: boolean): void {
    this.foreground = active;
    if (!active) {
      this.stopPings();
      return;
    }
    if (getHostConn(this.id).status === "online") {
      this.ping();
      this.startPings();
    } else {
      this.wake();
    }
  }

  /** The SSH connection dropped. */
  dropped(reason: string): void {
    if (getHostConn(this.id).status === "offline") return;
    this.teardown();
    this.fail(reason);
  }

  stop(): void {
    this.stopped = true;
    this.teardown();
    ssh.disconnect(this.id).catch(() => {});
    useConns.setState((s) => {
      const { [this.id]: _, ...rest } = s.conns;
      return { conns: rest };
    });
  }

  /** Reset backoff and the key-mismatch latch, then reconnect now. Returns the new attempt number. */
  retryNow(): number {
    this.blocked = false;
    this.failures = 0;
    this.connectNow();
    return this.attemptNo;
  }

  connectNow(): void {
    if (this.stopped) return;
    this.teardown();
    void this.attempt(++this.generation);
  }

  private async attempt(gen: number): Promise<void> {
    const host = this.host;
    const prev = getHostConn(host.id);
    setConn(host.id, { status: "connecting", lastSeen: prev.lastSeen, hello: prev.hello, attempt: ++this.attemptNo });
    try {
      const { fingerprint } = await ssh.connect(host.id, {
        host: host.address,
        port: host.port,
        user: host.user,
        fingerprint: host.fingerprint,
      });
      if (this.stopped) {
        // stop() ran during the handshake: make sure no connection stays open.
        ssh.disconnect(host.id).catch(() => {});
        return;
      }
      // A newer attempt supersedes this one natively (its connect replaces this client).
      if (gen !== this.generation) return;
      if (!host.fingerprint && fingerprint) {
        this.host = { ...this.host, fingerprint };
        useHosts.getState().updateHost(host.id, { fingerprint });
      }
      const transport = await ExecTransport.open(host.id, host.command);
      if (gen !== this.generation) {
        transport.close();
        return;
      }
      const rpc = new RpcClient(transport);
      this.rpc = rpc;
      transport.onClose((reason) => {
        if (gen === this.generation) this.dropped(`channel closed: ${reason}`);
      });
      const hello = await rpc.call<Hello>("hello");
      if (gen !== this.generation) return;
      this.failures = 0;
      setConn(host.id, { status: "online", lastSeen: Date.now(), rpc, hello, attempt: this.attemptNo });
      if (this.foreground) this.startPings();
      void registerPush(rpc, host.id);
    } catch (e) {
      if (gen !== this.generation) return;
      this.teardown();
      const code = (e as { code?: unknown })?.code;
      const message = errorText(e);
      if (code === "host_key_mismatch") {
        this.blocked = true;
        setConn(host.id, { status: "offline", error: `Host key changed: ${message}`, attempt: this.attemptNo });
        return;
      }
      this.fail(message);
    }
  }

  private fail(error: string): void {
    const prev = getHostConn(this.id);
    setConn(this.id, { status: "offline", lastSeen: prev.lastSeen, hello: prev.hello, error, attempt: this.attemptNo });
    const delay = BACKOFF_S[Math.min(this.failures, BACKOFF_S.length - 1)];
    this.failures++;
    this.timer = setTimeout(() => this.connectNow(), delay * 1000);
  }

  private startPings(): void {
    this.stopPings();
    this.pingTimer = setInterval(() => this.ping(), PING_EVERY_MS);
  }

  private stopPings(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }

  private ping(): void {
    const rpc = this.rpc;
    if (!rpc) return;
    const gen = this.generation;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("ping timed out")), PING_TIMEOUT_MS);
    });
    Promise.race([rpc.call("ping"), timeout])
      .then(() => {
        if (gen !== this.generation) return;
        const cur = getHostConn(this.id);
        if (cur.status === "online") setConn(this.id, { ...cur, lastSeen: Date.now() });
      })
      .catch((e) => {
        if (gen === this.generation) this.dropped(`ping failed: ${errorText(e)}`);
      })
      .finally(() => clearTimeout(timer));
  }

  private teardown(): void {
    this.stopPings();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const rpc = this.rpc;
    this.rpc = undefined;
    this.generation++;
    rpc?.close();
  }
}

/** Error text without Expo's "Calling the 'x' function has failed" wrapper line. */
function errorText(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  const cause = message.split(/Caused by:\s*/).pop()?.trim();
  return cause || message;
}

let running: { conns: Map<string, HostConnection>; cleanup: (() => void)[]; foreground: boolean } | undefined;

/** "unknown" (or no value yet) at launch counts as active. */
function isActive(s: string | null | undefined): boolean {
  return s == null || s === "active" || s === "unknown";
}

function syncHosts(hosts: Host[]): void {
  if (!running) return;
  const { conns } = running;
  const ids = new Set(hosts.map((h) => h.id));
  for (const [id, c] of conns) {
    if (!ids.has(id)) {
      c.stop();
      conns.delete(id);
    }
  }
  for (const h of hosts) {
    const c = conns.get(h.id);
    if (c) c.update(h);
    else {
      const created = new HostConnection(h, running.foreground);
      conns.set(h.id, created);
      created.connectNow();
    }
  }
}

/** Connects all saved hosts and keeps them connected. Safe to call more than once. */
export function startConnections(): void {
  if (running) return;
  const state = {
    conns: new Map<string, HostConnection>(),
    cleanup: [] as (() => void)[],
    foreground: isActive(AppState.currentState),
  };
  running = state;

  const start = () => {
    if (running !== state) return;
    syncHosts(useHosts.getState().hosts);
    state.cleanup.push(useHosts.subscribe((s) => syncHosts(s.hosts)));
  };
  // The host list loads from the Keychain asynchronously; wait for it.
  const persist = (useHosts as { persist?: typeof useHosts.persist }).persist;
  if (!persist || persist.hasHydrated()) start();
  else state.cleanup.push(persist.onFinishHydration(start));

  const appState = AppState.addEventListener("change", (s) => {
    state.foreground = s === "active";
    state.conns.forEach((c) => c.setForeground(state.foreground));
  });
  state.cleanup.push(() => appState.remove());

  const sub = ssh.addListener("onDisconnect", (e) => state.conns.get(e.hostId)?.dropped(e.reason));
  state.cleanup.push(() => sub.remove());

  // A changed notification pref goes to every online host.
  state.cleanup.push(
    useNotifPrefs.subscribe((p, prev) => {
      if (p.finished === prev.finished && p.needs_you === prev.needs_you) return;
      for (const id of state.conns.keys()) {
        const conn = getHostConn(id);
        if (conn.status === "online" && conn.rpc) void registerPush(conn.rpc, id);
      }
    }),
  );
}

/**
 * Reconnects a saved host now, even when it is online, in backoff or blocked by a key mismatch.
 * Returns the number of the new attempt (`HostConn.attempt`), or undefined when the host is unknown.
 */
export function retryNow(hostId: string): number | undefined {
  return running?.conns.get(hostId)?.retryNow();
}

/** Stops all connections and listeners. */
export function stopConnections(): void {
  if (!running) return;
  const state = running;
  running = undefined;
  state.cleanup.forEach((f) => f());
  state.conns.forEach((c) => c.stop());
  useConns.setState({ conns: {} });
}
