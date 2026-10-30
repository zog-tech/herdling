import type { AgentStatus } from "@zogssh/protocol";
import { Check, CircleHelp, CircleSlash, Hand, LoaderCircle } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { colors, icon, motion, space } from "@/theme/tokens";
import { formatDuration } from "./format";
import { Text } from "./Text";

export type BadgeStatus = AgentStatus | "offline";

export const STATUS_META: Record<BadgeStatus, { label: string; color: string; Icon: LucideIcon }> = {
  working: { label: "Working", color: colors.status.working, Icon: LoaderCircle },
  blocked: { label: "Needs you", color: colors.status.blocked, Icon: Hand },
  idle: { label: "Idle", color: colors.status.idle, Icon: Check },
  done: { label: "Done", color: colors.status.done, Icon: Check },
  unknown: { label: "Unknown", color: colors.status.unknown, Icon: CircleHelp },
  offline: { label: "Offline", color: colors.textMuted, Icon: CircleSlash },
};

/** One linear turn, looped: a CSS animation, so it runs on the UI thread with no JS per frame. */
const SPIN = { from: { transform: [{ rotate: "0deg" }] }, to: { transform: [{ rotate: "360deg" }] } };
const EASE_OUT = Easing.bezier(...motion.ease.out);

/**
 * Status icon with motion that shows state: working spins (one turn per second), "needs you" pulses
 * once when it starts, finished work pops once. Reduce Motion: a static icon.
 */
export function StatusIcon({ status, size = icon.header, color }: { status: BadgeStatus; size?: number; color?: string }) {
  const reduced = useReducedMotion();
  const { Icon, color: own } = STATUS_META[status];
  const scale = useSharedValue(1);
  const prev = useRef(status);

  useEffect(() => {
    const from = prev.current;
    prev.current = status;
    if (reduced || from === status) return;
    const s = motion.status;
    if (status === "blocked") {
      scale.set(
        withSequence(
          withTiming(s.pulseScale, { duration: s.pulseInMs, easing: EASE_OUT }),
          withTiming(1, { duration: s.pulseOutMs, easing: EASE_OUT }),
        ),
      );
    } else if (from === "working" && (status === "done" || status === "idle")) {
      scale.set(withSequence(withTiming(s.popScale, { duration: s.popInMs, easing: EASE_OUT }), withSpring(1, motion.spring.release)));
    }
  }, [status, reduced, scale]);

  const pop = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const spin = status === "working" && !reduced;

  return (
    <Animated.View style={pop}>
      <Animated.View
        style={
          spin
            ? {
                animationName: SPIN,
                animationDuration: `${motion.status.spinMs}ms`,
                animationIterationCount: "infinite",
                animationTimingFunction: "linear",
              }
            : undefined
        }
      >
        <Icon size={size} color={color ?? own} strokeWidth={icon.strokeWidth} />
      </Animated.View>
    </Animated.View>
  );
}

/** Seconds since `since` (epoch ms), ticking every second while `tick`. */
function useElapsed(since: number | undefined, tick: boolean): number | undefined {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!tick || since === undefined) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [tick, since]);
  return since === undefined ? undefined : Math.max(0, (now - since) / 1000);
}

/** "Working 1m 12s", "Needs you", "Done". */
export function statusText(status: BadgeStatus, elapsedS?: number): string {
  const label = STATUS_META[status].label;
  return status === "working" && elapsedS !== undefined ? `${label} ${formatDuration(elapsedS)}` : label;
}

/**
 * Header status: the animated icon at header icon size and a short label under the elapsed time.
 * Only the working state ticks; the clock lives here, so the screen does not re-render each second.
 */
export function HeaderStatus({ status, since }: { status: BadgeStatus; since?: number }) {
  const elapsed = useElapsed(status === "working" ? since : undefined, status === "working");
  const { label, color } = STATUS_META[status];
  const text = statusText(status, elapsed);
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={text}
      style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: 44 }}
    >
      <StatusIcon status={status} />
      <View>
        <Text variant="caption" bold color={color} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {label}
        </Text>
        {status === "working" && elapsed !== undefined ? (
          <Text variant="caption" muted numberOfLines={1} maxFontSizeMultiplier={1.3} style={{ fontVariant: ["tabular-nums"] }}>
            {formatDuration(elapsed)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
