import { useEffect, useState } from "react";
import { View } from "react-native";

import { denseScale, radius, space } from "@/theme/tokens";
import { StatusIcon } from "@/ui/StatusIcon";
import { RollingText } from "@/ui/RollingText";
import { Text, textStyle } from "@/ui/Text";

import type { BoardItem } from "./buckets";
import { BUCKET_META } from "./bucketMeta";
import { pillParts, pillText } from "./elapsed";

/** Below this age the pill shows seconds, so it ticks every second on its own. */
const SECONDS_UNTIL_MS = 60_000;
/** The Board clock ticks every 5 s. A `now` older than this means the Board stopped it. */
const STOPPED_AFTER_MS = 10_000;

/**
 * `now`, refreshed every second while the elapsed time still shows seconds. Only the pill
 * re-renders. It follows the Board clock: when the Board stops it (not focused), this stops too.
 */
export function usePillNow(since: number | undefined, now: number): number {
  const [tick, setTick] = useState(now);
  const seconds = since !== undefined && now - since < SECONDS_UNTIL_MS && Date.now() - now < STOPPED_AFTER_MS;
  useEffect(() => {
    if (!seconds) return;
    setTick(Date.now());
    const t = setInterval(() => setTick(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [seconds, now]);
  return seconds ? Math.max(tick, now) : now;
}

/** Status pill: icon + text in the bucket color, with the elapsed time. */
export function StatusPill({ item, now: boardNow }: { item: BoardItem; now: number }) {
  const { color, Icon } = BUCKET_META[item.bucket];
  const now = usePillNow(item.since, boardNow);
  const text = pillText(item.bucket, item.since, now);
  const { label, elapsed, suffix } = pillParts(item.bucket, item.since, now);
  const textProps = { variant: "caption", color, bold: true, maxFontSizeMultiplier: denseScale.pill } as const;
  return (
    <View
      accessible
      accessibilityLabel={text}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        paddingHorizontal: space.sm,
        paddingVertical: 2,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: color,
      }}
    >
      {/* Working: the same spinner as the session header (static under Reduce Motion). */}
      {item.bucket === "working" ? <StatusIcon status="working" size={12} color={color} /> : <Icon size={12} color={color} />}
      <Text {...textProps} numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </Text>
      {/* The elapsed time rolls each changed digit. */}
      {elapsed ? (
        <RollingText
          text={elapsed}
          style={{ ...textStyle(textProps), fontVariant: ["tabular-nums"] }}
          maxFontSizeMultiplier={textProps.maxFontSizeMultiplier}
        />
      ) : null}
      {suffix ? <Text {...textProps}>{suffix}</Text> : null}
    </View>
  );
}
