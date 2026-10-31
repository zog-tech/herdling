import { Check, CircleX } from "lucide-react-native";
import { useEffect } from "react";
import { AccessibilityInfo, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";

import { colors, icon, motion, radius, space } from "@/theme/tokens";

import { GlassSurface } from "./Glass";
import { Text } from "./Text";

/**
 * A short confirmation ("Copied") that shows at the top of the screen and goes away by itself.
 * It does not take touches. VoiceOver and TalkBack announce it.
 */

/** Time the notice stays on screen. */
export const NOTICE_MS = 1_400;
/** How far the notice moves while it enters. */
const RISE = 6;
const EASE_OUT = Easing.bezier(...motion.ease.out);

type Notice = { text: string; n: number; failed?: boolean };

export const useNotice = create<{ notice?: Notice }>(() => ({}));

let count = 0;

/** Shows `text` for a short time. `failed` shows the error icon in place of the check. */
export function showNotice(text: string, o?: { failed?: boolean }): void {
  count += 1;
  useNotice.setState({ notice: { text, n: count, failed: o?.failed } });
  AccessibilityInfo.announceForAccessibility(text);
}

/** Shows the notices of `showNotice`. Mount it once, near the root. */
export function NoticeHost() {
  const notice = useNotice((s) => s.notice);
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  useEffect(() => {
    if (!notice) return;
    progress.set(withTiming(1, { duration: motion.enterMs, easing: EASE_OUT }));
    const exitMs = Math.round(motion.enterMs * motion.exitRatio);
    const hide = setTimeout(() => progress.set(withTiming(0, { duration: exitMs, easing: EASE_OUT })), NOTICE_MS);
    const clear = setTimeout(() => {
      if (useNotice.getState().notice?.n === notice.n) useNotice.setState({ notice: undefined });
    }, NOTICE_MS + exitMs);
    return () => {
      clearTimeout(hide);
      clearTimeout(clear);
    };
  }, [notice, progress]);
  const style = useAnimatedStyle(() => ({
    opacity: progress.get(),
    transform: [{ translateY: reduced ? 0 : (progress.get() - 1) * RISE }],
  }));
  if (!notice) return null;
  return (
    <View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={{ position: "absolute", top: insets.top + space.xs, left: 0, right: 0, alignItems: "center" }}
    >
      <Animated.View style={style}>
        <GlassSurface
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            paddingHorizontal: space.md,
            paddingVertical: space.sm,
            borderRadius: radius.pill,
            overflow: "hidden",
          }}
        >
          {notice.failed ? <CircleX size={icon.sm} color={colors.danger} /> : <Check size={icon.sm} color={colors.status.done} />}
          <Text variant="small" bold>
            {notice.text}
          </Text>
        </GlassSurface>
      </Animated.View>
    </View>
  );
}
