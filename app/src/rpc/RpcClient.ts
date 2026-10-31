import type { RpcError as WireError } from "@herdling/protocol";

import type { LineTransport } from "./transport";

/** Error thrown by RpcClient. `code` is the companion error code, or `timeout` / `disconnected` for local failures. */
export class RpcError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: RpcError) => void;
  timer: ReturnType<typeof setTimeout>;
  /** Runs synchronously when the result arrives, before the promise resolves. */
  onResult?: (result: unknown) => void;
};

type Handler = (data: unknown) => void;

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_EARLY_EVENTS = 500;
const MAX_ENDED_STREAMS = 1000;

export class RpcClient {
  closed = false;

  private nextId = 1;
  private readonly timeoutMs: number;
  private readonly pending = new Map<number, Pending>();
  private readonly handlers = new Map<string, Handler>();
  /** Events that arrived for a stream id before its subscribe result. */
  private readonly early = new Map<string, unknown[]>();
  private earlyCount = 0;
  /** Number of subscribe requests awaiting their result. Events are buffered only while this is above zero. */
  private subscribing = 0;
  /** Stream ids the app unsubscribed from; their late events are dropped. */
  private readonly ended = new Set<string>();
  private readonly offLine: () => void;
  private readonly offClose: () => void;

  constructor(
    private readonly transport: LineTransport,
    opts?: { timeoutMs?: number },
  ) {
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.offLine = transport.onLine((line) => this.handleLine(line));
    this.offClose = transport.onClose(() => this.handleClose());
  }

  /** Number of buffered early events (exposed for tests). */
  get bufferedEvents(): number {
    return this.earlyCount;
  }

  /** `timeoutMs` overrides the client default for this call only. */
  call<T>(method: string, params?: object, timeoutMs?: number): Promise<T> {
    return this.request(method, params, undefined, timeoutMs) as Promise<T>;
  }

  async stream<T>(method: string, params: object, onData: (d: T) => void): Promise<() => void> {
    let streamId: string | undefined;
    const handler = onData as Handler;
    this.subscribing++;
    try {
      await this.request(method, params, (result) => {
      const id = (result as { stream?: unknown } | null)?.stream;
      if (typeof id !== "string") return;
      streamId = id;
      this.handlers.set(id, handler);
      const buffered = this.early.get(id);
      if (buffered) {
        this.early.delete(id);
        this.earlyCount -= buffered.length;
        buffered.forEach((d) => handler(d));
      }
    });
    } finally {
      // No subscribe in flight: any remaining buffered events belong to no one.
      if (--this.subscribing === 0) this.clearEarly();
    }
    if (streamId === undefined) throw new RpcError("bad_response", `${method} did not return a stream id`);
    const id = streamId;
    let cancelled = false;
    return () => {
      if (cancelled) return;
      cancelled = true;
      this.handlers.delete(id);
      this.ended.add(id);
      if (this.ended.size > MAX_ENDED_STREAMS) this.ended.delete(this.ended.values().next().value as string);
      if (!this.closed) this.call("rpc.cancel", { stream: id }).catch(() => {});
    };
  }

  /** Close the transport and reject everything pending. */
  close(): void {
    if (!this.closed) this.transport.close();
    this.handleClose();
  }

  private request(
    method: string,
    params?: object,
    onResult?: (r: unknown) => void,
    timeoutMs: number = this.timeoutMs,
  ): Promise<unknown> {
    if (this.closed) return Promise.reject(new RpcError("disconnected", "connection closed"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new RpcError("timeout", `${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, onResult });
      try {
        this.transport.send(JSON.stringify({ id, method, params: params ?? {} }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new RpcError("disconnected", e instanceof Error ? e.message : "send failed"));
      }
    });
  }

  private handleLine(line: string): void {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg === null || typeof msg !== "object") return;

    if (msg.method === "event") {
      const stream = msg.params?.stream;
      if (typeof stream !== "string") return;
      const handler = this.handlers.get(stream);
      if (handler) handler(msg.params.data);
      else if (this.subscribing > 0 && !this.ended.has(stream)) this.buffer(stream, msg.params.data);
      return;
    }

    if (typeof msg.id !== "number") {
      if (msg.error) console.warn("rpc error without id:", (msg.error as WireError).code, (msg.error as WireError).message);
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) {
      p.reject(new RpcError(String(msg.error.code ?? "error"), String(msg.error.message ?? "")));
      return;
    }
    p.onResult?.(msg.result);
    p.resolve(msg.result);
  }

  private buffer(stream: string, data: unknown): void {
    const buf = this.early.get(stream);
    if (buf) buf.push(data);
    else this.early.set(stream, [data]);
    if (++this.earlyCount > MAX_EARLY_EVENTS) {
      // Drop the oldest event overall (Map keeps insertion order by first event per stream).
      for (const [id, events] of this.early) {
        events.shift();
        this.earlyCount--;
        if (events.length === 0) this.early.delete(id);
        break;
      }
    }
  }

  private clearEarly(): void {
    this.early.clear();
    this.earlyCount = 0;
  }

  private handleClose(): void {
    this.closed = true;
    this.offLine();
    this.offClose();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new RpcError("disconnected", "connection closed"));
    }
    this.pending.clear();
    this.handlers.clear();
    this.clearEarly();
    this.ended.clear();
  }
}
