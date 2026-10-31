import type { FsDirs } from "@herdling/protocol";

/** Lists one folder on the host (`fs.dirs`). `hidden` also lists dot folders. */
export type ListDir = (path: string, hidden: boolean) => Promise<FsDirs>;

/** A listing stays fresh for this long. Pull to refresh drops it before. */
export const DIR_TTL_MS = 30_000;

type Entry = { at: number; value: Promise<FsDirs> };

/**
 * Folder listings per path, so autocomplete and the browser ask the host once per folder.
 * Two calls for the same folder share one request. A failed request is not kept.
 */
export class DirCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly list: ListDir,
    private readonly ttlMs = DIR_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  private key(path: string, hidden: boolean) {
    return `${hidden ? "h" : "-"}:${path}`;
  }

  get(path: string, hidden = false): Promise<FsDirs> {
    const k = this.key(path, hidden);
    const hit = this.entries.get(k);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    const value = this.list(path, hidden);
    this.entries.set(k, { at: this.now(), value });
    value.then(
      // A symbolic link lists under its real path too: keep it there as well.
      (r) => {
        const real = this.key(r.path, hidden);
        if (real !== k && !this.entries.has(real)) this.entries.set(real, { at: this.now(), value });
      },
      () => {
        if (this.entries.get(k)?.value === value) this.entries.delete(k);
      },
    );
    return value;
  }

  /** Drops one folder (both hidden modes), or every folder. */
  invalidate(path?: string): void {
    if (path === undefined) this.entries.clear();
    else for (const h of [true, false]) this.entries.delete(this.key(path, h));
  }
}
