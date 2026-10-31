import type { Bucket } from "./buckets";

/** Text of a card's status pill: the bucket label. The pill shows no time. */
export function pillText(bucket: Bucket): string {
  return bucket === "needs_you" ? "needs you" : bucket;
}
