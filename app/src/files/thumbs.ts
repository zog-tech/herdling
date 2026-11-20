/**
 * Thumbnails of the images in a folder. A thumbnail is the whole image in one `files.get` call, so
 * only small images get one (`THUMB_MAX`). At most `THUMB_JOBS` calls run at once, so a folder of
 * screenshots does not hold up the other calls on the channel. Results stay in a small cache.
 */

/** Largest image that gets a thumbnail: one part of `files.get` (384 KiB). */
export const THUMB_MAX = 384 << 10;
/** Thumbnail calls at once. */
export const THUMB_JOBS = 2;
/** Thumbnails kept in memory. */
export const THUMB_CACHE = 40;

/** A data URI, or null when the image gave no thumbnail. */
type Thumb = string | null;

export type ThumbLoader = {
  /** The cached thumbnail, or undefined when none is loaded yet. */
  get(key: string): Thumb | undefined;
  /** Loads a thumbnail. The promise gives the data URI, or null on an error. */
  load(key: string, fetch: () => Promise<string | null>): Promise<Thumb>;
};

/** A loader with its own queue and cache. The app keeps one; tests make their own. */
export function thumbLoader(jobs = THUMB_JOBS, cacheSize = THUMB_CACHE): ThumbLoader {
  const cache = new Map<string, Thumb>();
  const pending = new Map<string, Promise<Thumb>>();
  const waiting: (() => void)[] = [];
  let running = 0;

  const remember = (key: string, v: Thumb) => {
    cache.delete(key);
    cache.set(key, v);
    if (cache.size > cacheSize) cache.delete(cache.keys().next().value as string);
  };
  // The count goes up when a job gets its slot, not later: two calls in one tick cannot both pass.
  const acquire = (): Promise<void> => {
    if (running < jobs) {
      running++;
      return Promise.resolve();
    }
    return new Promise<void>((go) =>
      waiting.push(() => {
        running++;
        go();
      }),
    );
  };
  const release = () => {
    running--;
    waiting.shift()?.();
  };

  return {
    get: (key) => cache.get(key),
    load(key, fetch) {
      if (cache.has(key)) return Promise.resolve(cache.get(key) as Thumb);
      const p = pending.get(key);
      if (p) return p;
      const job = acquire().then(async () => {
        try {
          const v = await fetch().catch(() => null);
          remember(key, v);
          return v;
        } finally {
          pending.delete(key);
          release();
        }
      });
      pending.set(key, job);
      return job;
    },
  };
}

/** The loader of the app. */
export const thumbs = thumbLoader();
