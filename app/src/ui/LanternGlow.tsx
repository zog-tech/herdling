import { memo, useEffect, useId } from "react";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";

import { colors, motion } from "@/theme/tokens";

const EASE_IN_OUT = Easing.bezier(...motion.ease.inOut);
const EASE_OUT = Easing.bezier(...motion.ease.out);

/**
 * The lantern glow: a soft gold light behind a working status icon. It breathes slowly while
 * `active` and fades out when work stops (it never cuts off). Reduce Motion: a static glow.
 * Place it in a box of the icon's size; it centers itself and takes no layout space.
 * Decorative only: the icon and the label carry the state.
 */
export const LanternGlow = memo(function LanternGlow({ active, size }: { active: boolean; size: number }) {
  const reduced = useReducedMotion();
  const opacity = useSharedValue(0);
  const id = `lantern${useId().replace(/:/g, "")}`;
  const { periodMs, min, max, still, fadeOutMs, sizeRatio } = motion.lantern;

  useEffect(() => {
    cancelAnimation(opacity);
    if (!active) {
      opacity.set(withTiming(0, { duration: fadeOutMs, easing: EASE_OUT }));
      return;
    }
    if (reduced) {
      opacity.set(withTiming(still, { duration: motion.stateMs, easing: EASE_OUT }));
      return;
    }
    const half = periodMs / 2;
    opacity.set(
      withSequence(
        withTiming(min, { duration: motion.stateMs, easing: EASE_OUT }),
        withRepeat(
          withSequence(
            withTiming(max, { duration: half, easing: EASE_IN_OUT }),
            withTiming(min, { duration: half, easing: EASE_IN_OUT }),
          ),
          -1,
        ),
      ),
    );
  }, [active, reduced, opacity, periodMs, min, max, still, fadeOutMs]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  const d = Math.round(size * sizeRatio);
  const off = (size - d) / 2;

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ position: "absolute", left: off, top: off, width: d, height: d }, style]}
    >
      <Svg width={d} height={d}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={colors.status.working} stopOpacity={0.9} />
            <Stop offset="0.45" stopColor={colors.status.working} stopOpacity={0.35} />
            <Stop offset="1" stopColor={colors.status.working} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={d / 2} cy={d / 2} r={d / 2} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
});
