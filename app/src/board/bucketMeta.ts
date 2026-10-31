import { colors } from "@/theme/tokens";

import type { Bucket } from "./buckets";

/** Color per bucket. Status is never shown by color alone: the word (`BUCKET_LABEL`) goes with it. */
export const BUCKET_META: Record<Bucket, { color: string }> = {
  needs_you: { color: colors.status.blocked },
  ready: { color: colors.status.done },
  working: { color: colors.status.working },
  idle: { color: colors.status.unknown },
};
