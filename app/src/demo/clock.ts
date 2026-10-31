/**
 * A timer queue that can pause. The demo uses it for all its scripted steps.
 * Only one native timer runs at a time (for the earliest step). While paused, no timer runs,
 * and the time does not advance: a step that had 3 s left still has 3 s left after `resume()`.
 */
export class PausableClock {
  private queue: { at: number; seq: number; fn: () => void }[] = [];
  private seq = 0;
  /** Active time that passed before the last `resume()`, in ms. */
  private elapsed = 0;
  /** Wall time of the last `resume()`; undefined while paused. */
  private resumedAt?: number;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  /** Active time in ms since the clock was made. */
  now(): number {
    return this.elapsed + (this.resumedAt === undefined ? 0 : Date.now() - this.resumedAt);
  }

  get active(): boolean {
    return this.resumedAt !== undefined;
  }

  /** Number of steps that wait (exposed for tests). */
  get size(): number {
    return this.queue.length;
  }

  /** Runs `fn` after `ms` of active time. */
  after(ms: number, fn: () => void): void {
    if (this.stopped) return;
    this.queue.push({ at: this.now() + Math.max(0, ms), seq: this.seq++, fn });
    this.queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
    this.arm();
  }

  pause(): void {
    if (this.resumedAt === undefined) return;
    this.elapsed = this.now();
    this.resumedAt = undefined;
    this.disarm();
  }

  resume(): void {
    if (this.stopped || this.resumedAt !== undefined) return;
    this.resumedAt = Date.now();
    this.arm();
  }

  /** Removes all steps and stops for good. */
  stop(): void {
    this.stopped = true;
    this.pause();
    this.queue = [];
  }

  private disarm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private arm(): void {
    this.disarm();
    if (!this.active || this.queue.length === 0) return;
    const delay = Math.max(0, this.queue[0].at - this.now());
    this.timer = setTimeout(() => this.fire(), delay);
  }

  private fire(): void {
    this.timer = undefined;
    const t = this.now();
    // Run the due steps one by one: a step can add new steps or pause the clock.
    while (this.active && this.queue.length > 0 && this.queue[0].at <= t) {
      const step = this.queue.shift()!;
      step.fn();
    }
    this.arm();
  }
}
