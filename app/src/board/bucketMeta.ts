import { colors } from "@/theme/tokens";

import type { Bucket } from "./buckets";

/**
 * Color per bucket. Status is never shown by color alone: the word (`BUCKET_LABEL`) goes with it.
 * Each color is read on access, so a theme change at runtime applies.
 */
export const BUCKET_META: Record<Bucket, { readonly color: string }> = {
  needs_you: {
    get color() {
      return colors.status.blocked;
    },
  },
  ready: {
    get color() {
      return colors.status.done;
    },
  },
  working: {
    get color() {
      return colors.status.working;
    },
  },
  // The lantern gold, but quiet: no glow and a muted word (see `BucketStatus`).
  background: {
    get color() {
      return colors.status.working;
    },
  },
  idle: {
    get color() {
      return colors.status.unknown;
    },
  },
};
