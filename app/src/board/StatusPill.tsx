import { View } from "react-native";

import { denseScale, radius, space } from "@/theme/tokens";
import { LanternGlow } from "@/ui/LanternGlow";
import { StatusIcon } from "@/ui/StatusIcon";
import { Text } from "@/ui/Text";

import type { BoardItem } from "./buckets";
import { BUCKET_META } from "./bucketMeta";
import { pillText } from "./elapsed";

const PILL_ICON = 12;

/** Status pill: icon + label in the bucket color. */
export function StatusPill({ item }: { item: BoardItem }) {
  const { color, Icon } = BUCKET_META[item.bucket];
  const text = pillText(item.bucket);
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
      {/* Working: the same spinner as the session header (static under Reduce Motion), lit by the lantern glow. */}
      <View style={{ width: PILL_ICON, height: PILL_ICON }}>
        <LanternGlow active={item.bucket === "working"} size={PILL_ICON} />
        {item.bucket === "working" ? <StatusIcon status="working" size={PILL_ICON} color={color} /> : <Icon size={PILL_ICON} color={color} />}
      </View>
      <Text {...textProps} numberOfLines={1} style={{ flexShrink: 1 }}>
        {text}
      </Text>
    </View>
  );
}
