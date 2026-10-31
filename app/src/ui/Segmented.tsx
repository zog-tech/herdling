import { useEffect, useRef, useState } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";

import { colors, denseScale, hitTarget, motion, radius } from "@/theme/tokens";

import * as haptics from "./haptics";
import { Text } from "./Text";

const PAD = 3;

export type SegmentOption<T extends string> = { id: T; label: string };

/**
 * A segmented control: one filled track, the selected segment is a lighter pill that slides to it
 * with a spring on the UI thread. Reduce Motion: the pill moves at once. A change gives the
 * selection haptic. `label` names the whole control for VoiceOver.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  style,
}: {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const segW = width > 0 ? (width - PAD * 2) / options.length : 0;
  const index = Math.max(0, options.findIndex((o) => o.id === value));
  const x = useSharedValue(0);
  const placed = useRef(false);
  useEffect(() => {
    const to = index * segW;
    // The first layout places the pill; later changes slide it.
    if (reduced || !placed.current) x.set(to);
    else x.set(withSpring(to, motion.segment));
    if (segW > 0) placed.current = true;
  }, [index, segW, reduced, x]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[{ flexDirection: "row", backgroundColor: colors.raised, borderRadius: radius.md, padding: PAD }, style]}
    >
      {segW > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              top: PAD,
              bottom: PAD,
              left: PAD,
              width: segW,
              borderRadius: radius.sm + 1,
              backgroundColor: colors.raisedHigh,
              borderTopWidth: 1,
              borderTopColor: colors.hairline,
            },
            pill,
          ]}
        />
      ) : null}
      {options.map((o) => {
        const active = o.id === value;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="tab"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (o.id !== value) haptics.tap();
              onChange(o.id);
            }}
            hitSlop={{ top: 4, bottom: 4 }}
            style={{
              flex: 1,
              minHeight: hitTarget - 8,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.sm + 1,
              // Before the first layout there is no pill: the selected segment carries its own fill.
              backgroundColor: active && segW === 0 ? colors.raisedHigh : "transparent",
            }}
          >
            <Text variant="small" bold={active} muted={!active} numberOfLines={1} maxFontSizeMultiplier={denseScale.row}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
