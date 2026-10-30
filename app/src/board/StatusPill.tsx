import { View } from "react-native";

import { denseScale, radius, space } from "@/theme/tokens";
import { StatusIcon } from "@/ui/StatusIcon";
import { Text } from "@/ui/Text";

import type { BoardItem } from "./buckets";
import { BUCKET_META } from "./bucketMeta";
import { pillText } from "./elapsed";

/** Status pill: icon + text in the bucket color, with the elapsed time. */
export function StatusPill({ item, now }: { item: BoardItem; now: number }) {
  const { color, Icon } = BUCKET_META[item.bucket];
  const text = pillText(item.bucket, item.since, now);
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
      <Text variant="caption" color={color} bold numberOfLines={1} maxFontSizeMultiplier={denseScale.pill} style={{ flexShrink: 1 }}>
        {text}
      </Text>
    </View>
  );
}
