import type { Hello } from "@herdling/protocol";
import { AppState } from "react-native";
import { create } from "zustand";

import * as ssh from "../../modules/ssh";
import { isDemoHost } from "../demo/demoHost";
import { DemoTransport } from "../demo/DemoTransport";
import { showDemoNotice } from "../demo/notify";
import { samePrefs, useNotifPrefs } from "../push/prefs";
import { registerPush } from "../push/register";
import { RpcClient } from "../rpc/RpcClient";
import type { LineTransport } from "../rpc/transport";
import {
  connectionReducer,
  initialConnState,
  toHostConn,
  type ConnEffect,
  type ConnEvent,
  type ConnState,
  type HostConn,
} from "./connectionMachine";
import { useHosts, type Host } from "./store";

export type { HostConn } from "./connectionMachine";

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

/** What an effect needs from the event that caused it: the channel that just opened. */
type EffectContext = { transport?: LineTransport; demo?: DemoTransport };

/**
 * One saved host: the I/O shell of `connectionReducer`. It sends events in and runs the effects
 * (native calls, the rpc channel, timers, pings). The rules live in connectionMachine.ts.
 */
class HostConnection {
  private state: ConnState;
  private timer?: ReturnType<typeof setTimeout>;
  private pingTimer?: ReturnType<typeof setInterval>;
  private rpc?: RpcClient;
  /** The in-app transport of the demo host; undefined for a real host. */
  private demo?: DemoTransport;

  constructor(
    private host: Host,
    foreground: boolean,
  ) {
    this.state = initialConnState(foreground);
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
    if (!same) this.dispatch({ type: "retry" });
  }

  /** Connect now unless online, connecting or blocked. */
  wake(): void {
    this.dispatch({ type: "wake" });
  }

  /** The app came to the foreground or left it. */
  setForeground(active: boolean): void {
    this.dispatch({ type: "foreground", active });
  }

  /** The native SSH connection dropped. */
  disconnected(reason: string): void {
    this.dispatch({ type: "disconnected", reason });
  }

  stop(): void {
    this.dispatch({ type: "stop" });
  }

  /** Reset backoff and the key-mismatch latch, then reconnect now. Returns the new attempt number. */
  retryNow(): number {
    this.dispatch({ type: "retry" });
    return this.state.attempt;
  }

  connectNow(): void {
    this.dispatch({ type: "connect" });
  }

  /** Applies an event: stores the new state, publishes its view, then runs the effects in order. */
  private dispatch(e: ConnEvent, ctx: EffectContext = {}): void {
    const prev = this.state;
    const { state, effects } = connectionReducer(prev, e);
    this.state = state;
    if (state !== prev) {
      const view = toHostConn(state, this.rpc);
      if (view) setConn(this.id, view);
    }
    for (const fx of effects) this.run(fx, ctx);
  }

  private run(fx: ConnEffect, ctx: EffectContext): void {
    switch (fx.type) {
      case "teardown":
        return this.teardown();
      case "connect":
        if (isDemoHost(this.host)) return this.openDemo(fx.gen);
        return void this.handshake(fx.gen);
      case "disconnect":
        if (!isDemoHost(this.host)) ssh.disconnect(this.id).catch(() => {});
        return;
      case "pin":
        if (this.host.fingerprint) return;
        this.host = { ...this.host, fingerprint: fx.fingerprint };
        useHosts.getState().updateHost(this.id, { fingerprint: fx.fingerprint });
        return;
      case "openChannel":
        return void this.openChannel(fx.gen);
      case "useChannel":
        return this.useChannel(fx.gen, ctx);
      case "dropChannel":
        ctx.transport?.close();
        return;
      case "schedule":
        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => this.dispatch({ type: "timer", gen: fx.gen }), fx.ms);
        return;
      case "startPings":
        this.stopPings();
        this.pingTimer = setInterval(() => this.ping(this.state.gen), PING_EVERY_MS);
        return;
      case "stopPings":
        return this.stopPings();
      case "ping":
        return this.ping(fx.gen);
      case "registerPush":
        if (!isDemoHost(this.host) && this.rpc) void registerPush(this.rpc, this.id, { hello: this.state.hello });
        return;
      case "setDemoActive":
        // The demo scripts stop while the app is in the background.
        this.demo?.setActive(fx.active);
        return;
      case "forget":
        useConns.setState((s) => {
          const { [this.id]: _, ...rest } = s.conns;
          return { conns: rest };
        });
        return;
    }
  }

  private async handshake(gen: number): Promise<void> {
    const host = this.host;
    try {
      const { fingerprint } = await ssh.connect(host.id, {
        host: host.address,
        port: host.port,
        user: host.user,
        fingerprint: host.fingerprint,
      });
      this.dispatch({ type: "connected", gen, fingerprint: fingerprint || undefined });
    } catch (e) {
      this.fail(gen, e);
    }
  }

  private async openChannel(gen: number): Promise<void> {
    try {
      const transport = await ExecTransport.open(this.host.id, this.host.command);
      this.dispatch({ type: "channelOpened", gen }, { transport });
    } catch (e) {
      this.fail(gen, e);
    }
  }

  /**
   * The demo host: an in-process transport. No SSH, no host key, no push registration.
   * Its agents start again with each new transport (each launch).
   */
  private openDemo(gen: number): void {
    const demo = new DemoTransport({ onNotice: (n) => void showDemoNotice(n), active: this.state.foreground });
    this.dispatch({ type: "channelOpened", gen }, { transport: demo, demo });
  }

  private useChannel(gen: number, ctx: EffectContext): void {
    const transport = ctx.transport;
    if (!transport) return;
    const rpc = new RpcClient(transport);
    this.rpc = rpc;
    this.demo = ctx.demo;
    const label = ctx.demo ? "demo closed" : "channel closed";
    transport.onClose((reason) => this.dispatch({ type: "dropped", gen, reason: `${label}: ${reason}` }));
    rpc.call<Hello>("hello").then(
      (hello) => this.dispatch({ type: "hello", gen, hello, at: Date.now() }),
      (e: unknown) => this.fail(gen, e),
    );
  }

  private fail(gen: number, e: unknown): void {
    const code = (e as { code?: unknown })?.code;
    this.dispatch({ type: "failed", gen, error: errorText(e), code: typeof code === "string" ? code : undefined });
  }

  private stopPings(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = undefined;
  }

  private ping(gen: number): void {
    const rpc = this.rpc;
    if (!rpc) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("ping timed out")), PING_TIMEOUT_MS);
    });
    Promise.race([rpc.call("ping"), timeout])
      .then(() => this.dispatch({ type: "pong", gen, at: Date.now() }))
      .catch((e) => this.dispatch({ type: "dropped", gen, reason: `ping failed: ${errorText(e)}` }))
      .finally(() => clearTimeout(timer));
  }

  private teardown(): void {
    this.stopPings();
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const rpc = this.rpc;
    this.rpc = undefined;
    this.demo = undefined;
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

  const sub = ssh.addListener("onDisconnect", (e) => state.conns.get(e.hostId)?.disconnected(e.reason));
  state.cleanup.push(() => sub.remove());

  // A changed notification pref goes to every online host.
  state.cleanup.push(
    useNotifPrefs.subscribe((p, prev) => {
      if (samePrefs(p, prev)) return;
      for (const id of state.conns.keys()) {
        if (isDemoHost(id)) continue;
        const conn = getHostConn(id);
        if (conn.status === "online" && conn.rpc) void registerPush(conn.rpc, id, { hello: conn.hello });
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

/**
 * The rpc client of `hostId` when the host is online on attempt `minAttempt` or later, or
 * undefined after `timeoutMs`. Wakes a host that waits for its next retry.
 * Gives undefined at once when the host is blocked by a host key mismatch: it does not retry by itself.
 */
export function waitForRpc(hostId: string, timeoutMs: number, minAttempt = 0): Promise<RpcClient | undefined> {
  const ready = (c: HostConn | undefined) => (c?.status === "online" && c.rpc && c.attempt >= minAttempt ? c.rpc : undefined);
  const now = ready(getHostConn(hostId));
  if (now) return Promise.resolve(now);
  running?.conns.get(hostId)?.wake();
  if (getHostConn(hostId).blocked) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let off = () => {};
    const timer = setTimeout(() => done(undefined), timeoutMs);
    const done = (rpc: RpcClient | undefined) => {
      clearTimeout(timer);
      off();
      resolve(rpc);
    };
    off = useConns.subscribe((s) => {
      const c = s.conns[hostId];
      const rpc = ready(c);
      if (rpc || c?.blocked) done(rpc);
    });
  });
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
