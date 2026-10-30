import { View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";

import { colors, radius, space } from "@/theme/tokens";
import { Text } from "@/ui/Text";

import type { BoardItem } from "./buckets";
import { BUCKET_META } from "./bucketMeta";
import { pillText } from "./elapsed";

/** Working pill: a slow breathe of the icon. Loops, so a CSS animation, off under Reduce Motion. */
const PULSE = { from: { opacity: 1 }, to: { opacity: 0.35 } };

/** Status pill: icon + text in the bucket color, with the elapsed time. */
export function StatusPill({ item, now }: { item: BoardItem; now: number }) {
  const reduced = useReducedMotion();
  const { color, Icon } = BUCKET_META[item.bucket];
  const pulse = item.bucket === "working" && !reduced;
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
      <Animated.View
        style={
          pulse
            ? {
                animationName: PULSE,
                animationDuration: "1100ms",
                animationIterationCount: "infinite",
                animationDirection: "alternate",
                animationTimingFunction: "ease-in-out",
              }
            : undefined
        }
      >
        <Icon size={12} color={color} />
      </Animated.View>
      <Text variant="caption" color={color} bold numberOfLines={1} maxFontSizeMultiplier={1.4}>
        {text}
      </Text>
    </View>
  );
}
