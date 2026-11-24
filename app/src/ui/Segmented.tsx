import type { LucideIcon } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring } from "react-native-reanimated";

import { colors, denseScale, hitTarget, icon, motion, radius, space } from "@/theme/tokens";

import * as haptics from "./haptics";
import { Dot } from "./StatusDot";
import { Text } from "./Text";

/** The pad of the track around the pill. */
const PAD = space.xxs;
/** A segment is a little lower than a touch target; `hitSlop` makes up the rest. */
const SEG_H = hitTarget - space.sm;
/** One segment of the icon form: a full touch target wide. */
const ICON_SEG_W = hitTarget;

export type SegmentOption<T extends string> = {
  id: T;
  /** The text of the segment, and always its VoiceOver name. */
  label: string;
  /** The icon form: the segment shows this icon in place of the label. */
  Icon?: LucideIcon;
  /**
   * An attention mark: a small ember dot next to the label, for example "needs you". The text is
   * added to the VoiceOver name of the segment, so the dot is never the only cue.
   */
  attention?: string;
};

/**
 * A segmented control (design rule 2: choose 1 of 2 to 4 fixed options): one filled track, the
 * selected segment is a lighter pill that slides to it with a spring on the UI thread. Reduce
 * Motion: the pill moves at once. A change gives the selection haptic. `label` names the whole
 * control for VoiceOver.
 *
 * - Text form: the control fills the width of its parent, the segments share it.
 * - Icon form (every option has `Icon`): each segment is one touch target wide, so the control is
 *   compact enough for a header row (the session's Thread / Terminal switch).
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
  const iconForm = options.length > 0 && options.every((o) => !!o.Icon);
  const [width, setWidth] = useState(0);
  const segW = iconForm ? ICON_SEG_W : width > 0 ? (width - PAD * 2) / options.length : 0;
  const index = Math.max(0, options.findIndex((o) => o.id === value));
  const x = useSharedValue(index * segW);
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
      onLayout={iconForm ? undefined : (e) => setWidth(e.nativeEvent.layout.width)}
      style={[{ flexDirection: "row", alignSelf: iconForm ? "center" : undefined, backgroundColor: colors.raised, borderRadius: radius.md, padding: PAD }, style]}
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
              borderRadius: radius.sm,
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
        const tint = active ? colors.text : colors.textMuted;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="tab"
            accessibilityLabel={o.attention ? `${o.label}, ${o.attention}` : o.label}
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (o.id !== value) haptics.tap();
              onChange(o.id);
            }}
            hitSlop={{ top: space.xs, bottom: space.xs }}
            style={{
              ...(iconForm ? { width: ICON_SEG_W } : { flex: 1, paddingHorizontal: space.xs }),
              minHeight: SEG_H,
              flexDirection: "row",
              gap: space.xs,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.sm,
              // Before the first layout there is no pill: the selected segment carries its own fill.
              backgroundColor: active && segW === 0 ? colors.raisedHigh : "transparent",
            }}
          >
            {o.Icon ? (
              <o.Icon size={icon.md} color={tint} strokeWidth={icon.strokeWidth} />
            ) : (
              <Text variant="small" bold={active} muted={!active} numberOfLines={1} maxFontSizeMultiplier={denseScale.row} style={{ flexShrink: 1 }}>
                {o.label}
              </Text>
            )}
            {o.attention ? (
              <Dot color={colors.status.blocked} style={o.Icon ? { position: "absolute", top: space.xs, right: space.xs } : undefined} />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
