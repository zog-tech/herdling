import type { AgentStatus } from "@herdling/protocol";
import { Check, CircleHelp, CircleSlash, Hand, LoaderCircle } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { colors, icon, motion } from "@/theme/tokens";
import { formatDuration, spokenDuration } from "./format";

export type BadgeStatus = AgentStatus | "offline";

export const STATUS_META: Record<BadgeStatus, { label: string; color: string; Icon: LucideIcon }> = {
  // Getters: the colors change with the theme.
  working: { label: "Working", get color() { return colors.status.working; }, Icon: LoaderCircle },
  blocked: { label: "Needs you", get color() { return colors.status.blocked; }, Icon: Hand },
  idle: { label: "Idle", get color() { return colors.status.idle; }, Icon: Check },
  done: { label: "Done", get color() { return colors.status.done; }, Icon: Check },
  unknown: { label: "Unknown", get color() { return colors.status.unknown; }, Icon: CircleHelp },
  offline: { label: "Offline", get color() { return colors.textMuted; }, Icon: CircleSlash },
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

/**
 * Seconds since `since` (epoch ms), from a JS clock that ticks every `everyMs` while `tick`.
 * For coarse text, such as an accessibility label. A clock on screen uses `TickingDuration`.
 * A new `since` does not restart the interval: the interval only reads the time.
 */
export function useElapsed(since: number | undefined, tick: boolean, everyMs = 1_000): number | undefined {
  const [now, setNow] = useState(() => Date.now());
  const has = since !== undefined;
  useEffect(() => {
    if (!tick || !has) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [tick, has, everyMs]);
  return since === undefined ? undefined : Math.max(0, (now - since) / 1000);
}

/** "Working 1m 12s", "Needs you", "Done". */
export function statusText(status: BadgeStatus, elapsedS?: number): string {
  const label = STATUS_META[status].label;
  return status === "working" && elapsedS !== undefined ? `${label} ${formatDuration(elapsedS)}` : label;
}

/** What VoiceOver says: "Working, 2 minutes", "Working, under a minute", "Needs you". */
export function statusSpoken(status: BadgeStatus, elapsedS?: number): string {
  const label = STATUS_META[status].label;
  return status === "working" && elapsedS !== undefined ? `${label}, ${spokenDuration(elapsedS)}` : label;
}
