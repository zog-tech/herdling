import { StatusDot } from "@/ui/StatusDot";

import { BUCKET_LABEL, type Bucket } from "./buckets";
import { BUCKET_META } from "./bucketMeta";

/**
 * The status of a Board row: a dot and a word in the bucket color. Working lights the lantern glow
 * behind the dot. Idle is quiet: a dim dot and a muted word. Background is quiet too: a gold dot
 * with no glow and a muted word.
 */
export function BucketStatus({ bucket }: { bucket: Bucket }) {
  return (
    <StatusDot
      label={BUCKET_LABEL[bucket]}
      color={BUCKET_META[bucket].color}
      lit={bucket === "working"}
      quiet={bucket === "idle" || bucket === "background"}
    />
  );
}
