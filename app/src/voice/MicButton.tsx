import { Mic, X } from "lucide-react-native";
import { useEffect, useMemo } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useReducedMotion, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { colors, radius, space } from "@/theme/tokens";
import { Text } from "@/ui/Text";

import { CANCEL_DISTANCE, type HoldEvent } from "./holdToTalk";
import { useDictation } from "./useDictation";

/** Default size. The composer passes `hitTarget` so the mic matches the send button. */
export const MIC_SIZE = 64;
const RING = 3;

/**
 * Hold to talk: hold to dictate, release to send, slide more than CANCEL_DISTANCE away to cancel.
 * The final text goes to `onSend`; `onPartial` gets the live transcript ("" when it ends).
 */
export function MicButton({
  onSend,
  onPartial,
  disabled,
  size = MIC_SIZE,
}: {
  onSend: (text: string) => void;
  onPartial?: (text: string) => void;
  disabled?: boolean;
  /** Diameter of the idle button in points. While held, the button grows a little. */
  size?: number;
}) {
  const icon = Math.min(28, Math.round(size / 2));
  const { state, error, dispatch } = useDictation({ onSend, onPartial });
  const reduced = useReducedMotion();
  const far = useSharedValue(false);
  const ended = useSharedValue(false);

  // Disabled mid-hold (host went offline): drop the recording.
  useEffect(() => {
    if (disabled) dispatch({ type: "cancel" });
  }, [disabled, dispatch]);

  const gesture = useMemo(() => {
    const send = (e: HoldEvent) => dispatch(e);
    return (
      Gesture.Pan()
        .enabled(!disabled)
        .minDistance(0)
        // A pan activates only on movement; a still finger would never get onEnd. Activate at once.
        .activateAfterLongPress(1)
        .shouldCancelWhenOutside(false)
        .onBegin(() => {
          far.set(false);
          ended.set(false);
          scheduleOnRN(send, { type: "press" });
        })
        .onUpdate((e) => {
          // Cross the RN runtime only when the cancel zone changes, not every frame.
          const isFar = Math.hypot(e.translationX, e.translationY) > CANCEL_DISTANCE;
          if (isFar !== far.get()) {
            far.set(isFar);
            scheduleOnRN(send, { type: "move", dx: e.translationX, dy: e.translationY });
          }
        })
        .onEnd(() => {
          ended.set(true);
          scheduleOnRN(send, { type: "release" });
        })
        .onFinalize(() => {
          if (!ended.get()) scheduleOnRN(send, { type: "cancel" });
        })
    );
  }, [disabled, dispatch, far, ended]);

  const { phase } = state;
  const holding = phase === "recording" || phase === "armedCancel";
  const armed = phase === "armedCancel";
  const hint = armed
    ? "Release to cancel"
    : phase === "recording"
      ? "Release to send · slide away to cancel"
      : phase === "finishing"
        ? "Transcribing…"
        : error;

  return (
    <GestureHandlerRootView style={{ width: size, height: size }}>
      {hint ? (
        <View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={{
            position: "absolute",
            right: 0,
            bottom: size + space.sm,
            width: 260,
            alignItems: "flex-end",
          }}
        >
          <View
            style={{
              backgroundColor: colors.card,
              borderColor: armed || (!holding && error) ? colors.danger : colors.border,
              borderWidth: 1,
              borderRadius: radius.md,
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
            }}
          >
            <Text variant="small" color={armed || (!holding && phase !== "finishing" && error) ? colors.danger : colors.text}>
              {hint}
            </Text>
          </View>
        </View>
      ) : null}
      <GestureDetector gesture={gesture}>
        <Animated.View
          accessible
          accessibilityRole="button"
          accessibilityLabel="Hold to talk"
          accessibilityHint="Hold and speak, release to send, slide away to cancel"
          accessibilityState={{ disabled: !!disabled, busy: phase === "finishing" }}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: RING,
            borderColor: holding ? colors.danger : colors.muted,
            backgroundColor: armed ? colors.danger : holding ? colors.card : colors.muted,
            opacity: disabled ? 0.5 : 1,
            transform: [{ scale: holding && !reduced ? 1.08 : 1 }],
            transitionProperty: ["transform", "backgroundColor", "borderColor"],
            transitionDuration: reduced ? 0 : 150,
            transitionTimingFunction: "ease-out",
          }}
        >
          {armed ? (
            <X size={icon} color={colors.bg} />
          ) : (
            <Mic size={icon} color={holding ? colors.danger : disabled ? colors.textMuted : colors.text} />
          )}
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}
