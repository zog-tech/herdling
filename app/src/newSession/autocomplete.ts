import type { DirCache } from "./dirCache";
import { completionTarget, filterDirs, joinPath } from "./paths";

/** Wait this long after the last key before the host is asked. */
export const AUTOCOMPLETE_DELAY_MS = 150;
/** At most this many suggestions show under the path field. */
export const MAX_SUGGESTIONS = 8;

export type Suggestion = { name: string; path: string; git: boolean };
export type Suggestions = { input: string; items: Suggestion[] };
export type CompleteContext = { home: string; cwd: string; hidden: boolean };

/**
 * Live folder suggestions for the typed path. Each `update` waits `delayMs` (debounce), lists the
 * parent folder through the cache and keeps the names that start with the typed prefix. An answer
 * for older text is dropped. A folder that does not exist gives no suggestions.
 */
export class Autocomplete {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private seq = 0;

  constructor(
    private readonly cache: DirCache,
    private readonly onResult: (s: Suggestions) => void,
    private readonly delayMs = AUTOCOMPLETE_DELAY_MS,
  ) {}

  update(input: string, ctx: CompleteContext): void {
    this.cancel();
    const seq = this.seq;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.run(input, ctx, seq);
    }, this.delayMs);
  }

  /** Stops a wait and drops the answer of a request in flight. */
  cancel(): void {
    this.seq++;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async run(input: string, ctx: CompleteContext, seq: number) {
    const { dir, prefix } = completionTarget(input, ctx.home, ctx.cwd);
    let items: Suggestion[] = [];
    try {
      const list = await this.cache.get(dir, ctx.hidden);
      const git = new Set(list.git_dirs ?? []);
      items = filterDirs(list.dirs, prefix, ctx.hidden)
        .slice(0, MAX_SUGGESTIONS)
        .map((name) => ({ name, path: joinPath(list.path, name), git: git.has(name) }));
    } catch {
      // No such folder yet: no suggestions. "Go" shows the error.
    }
    if (seq === this.seq) this.onResult({ input, items });
  }
}
