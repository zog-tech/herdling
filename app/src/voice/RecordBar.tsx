import { RotateCcw, Square, Trash2, X } from "lucide-react-native";
import { useEffect, useState, type ReactNode } from "react";
import { Pressable, View } from "react-native";
import Animated, { useReducedMotion } from "react-native-reanimated";

import { colors, hitTarget, icon, motion, radius, space, state } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

import type { HoldState } from "./holdToTalk";
import { formatElapsed } from "./transcribe";
import { Waveform } from "./Waveform";

/** The shimmer band crosses from off the left edge to off the right edge. */
const SHIMMER = { from: { transform: [{ translateX: "-100%" }] }, to: { transform: [{ translateX: "100%" }] } };
const PULSE = { from: { opacity: 1 }, to: { opacity: motion.shimmerDim } };
const ELAPSED_TICK_MS = 500;

/** "0:07" since mount, ticking twice a second. */
function Elapsed() {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS);
    return () => clearInterval(t);
  }, []);
  const text = formatElapsed(now - start);
  return (
    <Text variant="small" muted accessibilityLabel={`Recording, ${text}`} style={{ fontVariant: ["tabular-nums"] }}>
      {text}
    </Text>
  );
}

/** "Transcribing…" with a band that sweeps the bar. Reduce Motion: the text fades instead. */
function Transcribing() {
  const reduced = useReducedMotion();
  return (
    <View style={{ flex: 1, justifyContent: "center", overflow: "hidden", borderRadius: radius.lg }}>
      {reduced ? null : (
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            animationName: SHIMMER,
            animationDuration: `${motion.shimmerMs}ms`,
            animationIterationCount: "infinite",
            animationTimingFunction: "linear",
          }}
        >
          <View style={{ width: "40%", height: "100%", backgroundColor: colors.raised }} />
        </Animated.View>
      )}
      <Animated.View
        style={
          reduced
            ? {
                animationName: PULSE,
                animationDuration: `${motion.shimmerMs}ms`,
                animationIterationCount: "infinite",
                animationDirection: "alternate",
                animationTimingFunction: "ease-in-out",
              }
            : undefined
        }
      >
        <Text variant="small" muted accessibilityLiveRegion="polite" style={{ paddingHorizontal: space.md }}>
          Transcribing…
        </Text>
      </Animated.View>
    </View>
  );
}

/** A plain icon button at an end of the bar, with the full 44 pt target. */
function BarButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={space.xs}
      style={({ pressed }) => ({
        width: hitTarget,
        height: hitTarget - 2,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? state.pressedOpacity : 1,
      })}
    >
      {children}
    </Pressable>
  );
}

/**
 * Takes the place of the prompt box while voice input runs:
 * recording → ✕ (discard), live waveform, elapsed time and, with `onStop`, a stop button at the end.
 * The stop button puts the text in the prompt box; the send button outside the bar sends it.
 * finishing → "Transcribing…" with a shimmer.
 * failed → Retry and Discard; the recording stays until one of them.
 */
export function RecordBar({
  phase,
  onCancel,
  onRetry,
  onDiscard,
  onStop,
}: {
  phase: HoldState["phase"];
  onCancel: () => void;
  /** Stop and transcribe into the prompt box. Without it, the bar has no stop button (a hold stops on release). */
  onStop?: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const shell = {
    flex: 1,
    minHeight: hitTarget,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: phase === "armedCancel" ? colors.danger : colors.border,
    borderRadius: radius.lg,
  };
  if (phase === "finishing") {
    return (
      <View style={shell} accessibilityState={{ busy: true }}>
        <Transcribing />
      </View>
    );
  }
  if (phase === "failed") {
    return (
      <View style={[shell, { paddingLeft: space.md, paddingRight: space.xs, paddingVertical: space.xs, gap: space.sm }]}>
        <Text variant="small" color={colors.danger} numberOfLines={1} style={{ flex: 1 }}>
          Not transcribed
        </Text>
        <Button label="Retry" Icon={RotateCcw} variant="secondary" onPress={onRetry} />
        <Button label="Discard recording" iconOnly Icon={Trash2} variant="danger" onPress={onDiscard} />
      </View>
    );
  }
  return (
    <View style={[shell, { paddingRight: onStop ? 0 : space.md, gap: space.sm }]}>
      <BarButton label="Discard recording" onPress={onCancel}>
        <X size={icon.md} color={colors.text} />
      </BarButton>
      <View style={{ flex: 1, alignItems: "center", overflow: "hidden" }}>
        <Waveform />
      </View>
      <Elapsed />
      {onStop ? (
        // A small filled square in the text color: quiet like the ✕, not a red record disc.
        <BarButton label="Stop and transcribe" onPress={onStop}>
          <Square size={icon.sm} color={colors.text} fill={colors.text} />
        </BarButton>
      ) : null}
    </View>
  );
}
