/**
 * Ordered send queue for one pane. Every line and key goes into a FIFO. When the host keeps
 * the order of typing calls (`pipeline()` is true), the queue sends the next item without
 * waiting for the last reply, so a burst of keys costs one round trip, not one per key.
 * Otherwise it sends one item at a time. An error drops the items that wait, so a later
 * Enter does not run a half-typed command, and reports the error once.
 */

/** One `pane.send_input`: text first, then keys. */
export type SendOp = { text?: string; keys?: string[] };

/** The reason of a rejected `push` whose item was never sent, because an earlier item failed. */
export class DroppedError extends Error {
  constructor() {
    super("not sent: an earlier key or line failed");
    this.name = "DroppedError";
  }
}

type Item = { op: SendOp; resolve: () => void; reject: (e: unknown) => void };

export class SendQueue {
  private waiting: Item[] = [];
  private inFlight = 0;
  /** Bumped on each error, so the later failures of items sent before it are not reported again. */
  private generation = 0;

  constructor(
    private readonly send: (op: SendOp) => Promise<void>,
    private readonly opts: { pipeline: () => boolean; onError: (e: unknown) => void },
  ) {}

  /** Items not yet answered (waiting or in flight). */
  get size(): number {
    return this.waiting.length + this.inFlight;
  }

  /**
   * Queues `op`. The promise resolves when the host accepted it, and rejects when it failed or
   * was dropped. A caller may ignore the promise: errors also go to `onError`.
   */
  push(op: SendOp): Promise<void> {
    const p = new Promise<void>((resolve, reject) => this.waiting.push({ op, resolve, reject }));
    p.catch(() => {});
    this.pump();
    return p;
  }

  /**
   * Drops the waiting items (for example, the view closes). Items in flight still finish.
   * The queue stays usable, so a React effect that runs twice does not break it.
   */
  dispose(): void {
    this.drop();
  }

  private drop(): void {
    const dropped = this.waiting;
    this.waiting = [];
    dropped.forEach((i) => i.reject(new DroppedError()));
  }

  private pump(): void {
    while (this.waiting.length > 0 && (this.inFlight === 0 || this.opts.pipeline())) {
      const item = this.waiting.shift()!;
      const gen = this.generation;
      this.inFlight++;
      let sent: Promise<void>;
      try {
        sent = this.send(item.op);
      } catch (e) {
        sent = Promise.reject(e);
      }
      sent.then(
        () => {
          this.inFlight--;
          item.resolve();
          this.pump();
        },
        (e: unknown) => {
          this.inFlight--;
          item.reject(e);
          if (gen === this.generation) {
            this.generation++;
            this.drop();
            this.opts.onError(e);
          }
          this.pump();
        },
      );
    }
  }
}

/**
 * Direct typing: printable text typed within one `windowMs` window goes out as one item.
 * A key sends the waiting text together with the key, in one call (text first, then the key).
 */
export class Typist {
  private text = "";
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly queue: Pick<SendQueue, "push">,
    private readonly windowMs = 16,
  ) {}

  type(text: string): void {
    if (!text) return;
    this.text += text;
    this.timer ??= setTimeout(() => this.flush(), this.windowMs);
  }

  key(key: string): Promise<void> {
    const text = this.take();
    return this.queue.push(text ? { text, keys: [key] } : { keys: [key] });
  }

  /** Sends the waiting text now. */
  flush(): void {
    const text = this.take();
    if (text) void this.queue.push({ text });
  }

  private take(): string {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    const text = this.text;
    this.text = "";
    return text;
  }
}
