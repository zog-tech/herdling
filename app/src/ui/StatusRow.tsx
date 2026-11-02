import { memo, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

import { colors, motion, radius, space, threadGap } from "@/theme/tokens";
import { subagentCount } from "@/thread/subagentState";
import { StatusGlyph } from "./StatusGlyph";
import { STATUS_META, statusSpoken, type BadgeStatus } from "./StatusIcon";
import { Text } from "./Text";

/** Only these states show a row. Idle, done and unknown hide it, unless background work runs. */
const SHOWN: readonly BadgeStatus[] = ["working", "blocked", "offline"];
/** These states show the row while background work runs: "Idle · 1 shell running". */
const QUIET: readonly BadgeStatus[] = ["idle", "done"];
/** Height of a thread pill. The subagent pill uses the same height. */
export const PILL_HEIGHT = 40;
/** Icon size in a thread pill. */
export const ROW_ICON = 20;
/** Space between the newest message and the pill. Same as the gap between two thread rows. */
export const PILL_GAP = threadGap;
const ROW_HEIGHT = PILL_HEIGHT + PILL_GAP;
const SLIDE = 6;
const EASE_OUT = Easing.bezier(...motion.ease.out);

/** Hide-and-show time of the pill, so the list can keep it in view while it grows. */
export const STATUS_ANIM_MS = motion.stateMs;

/** Whether this state shows the pill. `background`: the text of the background work, if any. */
export const isStatusShown = (status: BadgeStatus, background?: string) =>
  SHOWN.includes(status) || (!!background && QUIET.includes(status));

/** What VoiceOver says on a change: only work that finishes, and "Needs you". */
export function announcement(from: BadgeStatus, to: BadgeStatus): string | undefined {
  if (to === "blocked" && from !== "blocked") return STATUS_META.blocked.label;
  if (from === "working" && (to === "done" || to === "idle")) return "Finished";
  return undefined;
}

/**
 * Agent status pill, the last item of the thread list (below the newest message). Working shows the
 * icon and "Working". The pill is centered, fades and slides in and out, and takes no height when hidden.
 * `subagents`: running subagents; while working, the pill adds " · 2 subagents".
 * `background`: background work of an idle agent ("1 shell running"); the pill shows "Idle · 1 shell running".
 */
export const StatusRow = memo(function StatusRow({
  status,
  subagents = 0,
  background,
}: {
  status: BadgeStatus;
  subagents?: number;
  background?: string;
}) {
  const reduced = useReducedMotion();
  const visible = isStatusShown(status, background);
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
  const { label, color } = STATUS_META[shown];
  const bg = QUIET.includes(shown) ? background : undefined;
  const subs = shown === "working" && subagents > 0 ? subagentCount(subagents) : bg;
  const spoken = statusSpoken(shown);
  const text = subs ? `${spoken}, ${subs}` : spoken;

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
        <StatusGlyph status={shown} glow={working} size={ROW_ICON} />
        <Text variant="small" bold color={color} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {label}
        </Text>
        {subs ? (
          <Text variant="small" muted numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {`· ${subs}`}
          </Text>
        ) : null}
      </View>
    </Animated.View>
  );
});
