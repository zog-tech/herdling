import { memo, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

import { colors, motion, radius, space } from "@/theme/tokens";
import { LanternGlow } from "./LanternGlow";
import { STATUS_META, StatusIcon, statusSpoken, useElapsed, type BadgeStatus } from "./StatusIcon";
import { Text } from "./Text";
import { SPOKEN_TICK_MS, TickingDuration } from "./TickingDuration";

/** Only these states show a row. Idle, done and unknown hide it. */
const SHOWN: readonly BadgeStatus[] = ["working", "blocked", "offline"];
const PILL_HEIGHT = 40;
const ROW_ICON = 20;
/** Space between the newest message and the pill. */
const PILL_GAP = space.sm;
const ROW_HEIGHT = PILL_HEIGHT + PILL_GAP;
const SLIDE = 6;
const EASE_OUT = Easing.bezier(...motion.ease.out);

/** Hide-and-show time of the pill, so the list can keep it in view while it grows. */
export const STATUS_ANIM_MS = motion.stateMs;

/** Whether this state shows the pill. */
export const isStatusShown = (status: BadgeStatus) => SHOWN.includes(status);

/** What VoiceOver says on a change: only work that finishes, and "Needs you". */
export function announcement(from: BadgeStatus, to: BadgeStatus): string | undefined {
  if (to === "blocked" && from !== "blocked") return STATUS_META.blocked.label;
  if (from === "working" && (to === "done" || to === "idle")) return "Finished";
  return undefined;
}

/**
 * Agent status pill, the last item of the thread list (below the newest message). Working shows the
 * icon, "Working" and a ticking clock. The pill is centered, fades and slides in and out, and takes no height when hidden.
 * The clock ticks on the UI thread (`TickingDuration`), so a busy JS thread does not freeze it, and
 * it pauses while the row is hidden. VoiceOver reads the time in whole minutes.
 */
export const StatusRow = memo(function StatusRow({ status, since }: { status: BadgeStatus; since?: number }) {
  const reduced = useReducedMotion();
  const visible = SHOWN.includes(status);
  // Keep the last shown state, so the content stays while the row fades out.
  const [shown, setShown] = useState<BadgeStatus>(visible ? status : "working");
  const progress = useSharedValue(visible ? 1 : 0);
  const prev = useRef(status);

  useEffect(() => {
    if (visible) setShown(status);
    const to = visible ? 1 : 0;
    if (reduced) {
      progress.set(to);
      return;
    }
    const ms = visible ? motion.stateMs : motion.stateMs * motion.exitRatio;
    progress.set(withTiming(to, { duration: ms, easing: EASE_OUT }));
  }, [status, visible, reduced, progress]);

  useEffect(() => {
    const said = announcement(prev.current, status);
    prev.current = status;
    if (said) AccessibilityInfo.announceForAccessibility(said);
  }, [status]);

  const working = status === "working";
  // Coarse JS clock, for the VoiceOver label only.
  const elapsed = useElapsed(working ? since : undefined, working, SPOKEN_TICK_MS);
  const { label, color } = STATUS_META[shown];
  const text = statusSpoken(shown, shown === "working" ? elapsed : undefined);

  const style = useAnimatedStyle(() => ({
    height: progress.get() * ROW_HEIGHT,
    opacity: progress.get(),
    transform: [{ translateY: reduced ? 0 : (1 - progress.get()) * SLIDE }],
  }));

  return (
    <Animated.View
      style={[{ overflow: "hidden" }, style]}
      pointerEvents="none"
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
    >
      <View
        accessible={visible}
        accessibilityRole="text"
        accessibilityLabel={text}
        style={{
          alignSelf: "center",
          marginTop: PILL_GAP,
          height: PILL_HEIGHT,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          paddingHorizontal: space.lg,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.raised,
        }}
      >
        <View style={{ width: ROW_ICON, height: ROW_ICON }}>
          <LanternGlow active={working} size={ROW_ICON} />
          <StatusIcon status={shown} size={ROW_ICON} />
        </View>
        <Text variant="small" bold color={color} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {label}
        </Text>
        {shown === "working" && since !== undefined ? (
          <TickingDuration variant="small" since={since} active={working} maxFontSizeMultiplier={1.3} accessible={false} />
        ) : null}
      </View>
    </Animated.View>
  );
});
