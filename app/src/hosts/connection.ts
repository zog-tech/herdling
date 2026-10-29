import type { Hello } from "@zogssh/protocol";
import { AppState } from "react-native";
import { create } from "zustand";

import * as ssh from "../../modules/ssh";
import { RpcClient } from "../rpc/RpcClient";
import type { LineTransport } from "../rpc/transport";
import { useHosts, type Host } from "./store";

export type HostConn = {
  status: "offline" | "connecting" | "online";
  lastSeen?: number;
  rpc?: RpcClient;
  hello?: Hello;
  error?: string;
};

/** Seconds to wait before retry number n (1-based); the last value repeats. */
const BACKOFF_S = [1, 2, 4, 8, 16, 30];
const OFFLINE: HostConn = { status: "offline" };

/** `LineTransport` over a native exec channel. Splits `onData` chunks into lines. */
export class ExecTransport implements LineTransport {
  private buffer = "";
  private closed = false;
  private readonly lineCbs = new Set<(line: string) => void>();
  private readonly closeCbs = new Set<(reason: string) => void>();
  private readonly subs: { remove(): void }[];

  constructor(readonly channelId: string) {
    this.subs = [
      ssh.addListener("onData", (e) => {
        if (e.channelId === channelId) this.push(e.data);
      }),
      ssh.addListener("onStderr", (e) => {
        if (e.channelId === channelId) console.warn(`[ssh ${channelId}] stderr:`, e.data.trimEnd());
      }),
      ssh.addListener("onChannelClose", (e) => {
        if (e.channelId === channelId) this.end(e.reason);
      }),
    ];
  }

  send(line: string): void {
    if (this.closed) throw new Error("channel closed");
    ssh.write(this.channelId, line + "\n").catch((e) => this.end(e instanceof Error ? e.message : "write failed"));
  }

  onLine(cb: (line: string) => void): () => void {
    this.lineCbs.add(cb);
    return () => this.lineCbs.delete(cb);
  }

  onClose(cb: (reason: string) => void): () => void {
    this.closeCbs.add(cb);
    return () => this.closeCbs.delete(cb);
  }

  close(): void {
    if (this.closed) return;
    ssh.closeChannel(this.channelId).catch(() => {});
    this.end("closed");
  }

  private push(chunk: string): void {
    this.buffer += chunk;
    const parts = this.buffer.split("\n");
    this.buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.endsWith("\r") ? part.slice(0, -1) : part;
      if (line.length > 0) this.lineCbs.forEach((cb) => cb(line));
    }
  }

  private end(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.subs.forEach((s) => s.remove());
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

/** Current state outside React. */
export function getHostConn(hostId: string): HostConn {
  return useConns.getState().conns[hostId] ?? OFFLINE;
}

/** One saved host: connects, opens the rpc channel, says hello and retries with backoff. */
class HostConnection {
  private generation = 0;
  private failures = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private rpc?: RpcClient;
  /** Set on a host key mismatch: no retries until the host entry changes. */
  private blocked = false;
  private stopped = false;

  constructor(private host: Host) {}

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

  connectNow(): void {
    if (this.stopped) return;
    this.teardown();
    void this.attempt(++this.generation);
  }

  private async attempt(gen: number): Promise<void> {
    const host = this.host;
    setConn(host.id, { ...getHostConn(host.id), status: "connecting", rpc: undefined });
    try {
      const { fingerprint } = await ssh.connect(host.id, {
        host: host.address,
        port: host.port,
        user: host.user,
        fingerprint: host.fingerprint,
      });
      if (gen !== this.generation) return;
      if (!host.fingerprint && fingerprint) {
        this.host = { ...this.host, fingerprint };
        useHosts.getState().updateHost(host.id, { fingerprint });
      }
      const channelId = await ssh.openExec(host.id, host.command);
      if (gen !== this.generation) {
        ssh.closeChannel(channelId).catch(() => {});
        return;
      }
      const transport = new ExecTransport(channelId);
      const rpc = new RpcClient(transport);
      this.rpc = rpc;
      transport.onClose((reason) => {
        if (gen === this.generation) this.dropped(`channel closed: ${reason}`);
      });
      const hello = await rpc.call<Hello>("hello");
      if (gen !== this.generation) return;
      this.failures = 0;
      setConn(host.id, { status: "online", lastSeen: Date.now(), rpc, hello });
    } catch (e) {
      if (gen !== this.generation) return;
      this.teardown();
      const code = (e as { code?: unknown })?.code;
      const message = errorText(e);
      if (code === "host_key_mismatch") {
        this.blocked = true;
        setConn(host.id, { status: "offline", error: `Host key changed: ${message}` });
        return;
      }
      this.fail(message);
    }
  }

  private fail(error: string): void {
    const prev = getHostConn(this.id);
    setConn(this.id, { status: "offline", lastSeen: prev.lastSeen, hello: prev.hello, error });
    const delay = BACKOFF_S[Math.min(this.failures, BACKOFF_S.length - 1)];
    this.failures++;
    this.timer = setTimeout(() => this.connectNow(), delay * 1000);
  }

  private teardown(): void {
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

let running: { conns: Map<string, HostConnection>; cleanup: (() => void)[] } | undefined;

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
      const created = new HostConnection(h);
      conns.set(h.id, created);
      created.connectNow();
    }
  }
}

/** Connects all saved hosts and keeps them connected. Safe to call more than once. */
export function startConnections(): void {
  if (running) return;
  const state = { conns: new Map<string, HostConnection>(), cleanup: [] as (() => void)[] };
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
    if (s === "active") state.conns.forEach((c) => c.wake());
  });
  state.cleanup.push(() => appState.remove());

  const sub = ssh.addListener("onDisconnect", (e) => state.conns.get(e.hostId)?.dropped(e.reason));
  state.cleanup.push(() => sub.remove());
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
