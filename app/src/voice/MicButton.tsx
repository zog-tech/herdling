import { Mic, X } from "lucide-react-native";
import { useEffect, useMemo } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { cubicBezier, useReducedMotion, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { colors, motion, radius, space, state as uiState } from "@/theme/tokens";
import { Text } from "@/ui/Text";

import { CANCEL_DISTANCE, type HoldEvent } from "./holdToTalk";
import { useDictation } from "./useDictation";

/** Default size. The composer passes `hitTarget` so the mic matches the send button. */
export const MIC_SIZE = 64;
const RING = 3;
const EASE_OUT = cubicBezier(...motion.ease.out);

/**
 * Hold to talk: hold to dictate, release to send, slide more than CANCEL_DISTANCE away to cancel.
 * Or tap to toggle: a short tap starts, the next tap sends. VoiceOver activate does the same.
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
    if (disabled) dispatch({ type: "cancel", force: true });
  }, [disabled, dispatch]);

  const gesture = useMemo(() => {
    // Press and release carry the time, so a short press counts as a tap (tap-to-toggle).
    const send = (e: HoldEvent) => dispatch(e.type === "press" || e.type === "release" ? { ...e, at: Date.now() } : e);
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
  const latched = !!state.latched && phase === "recording";
  const hint = armed
    ? "Release to cancel"
    : latched
      ? "Listening · tap to send"
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
          accessibilityLabel={holding ? "Stop and send dictation" : "Dictate"}
          accessibilityHint="Double tap to start, double tap again to send. Or hold, speak and release."
          accessibilityState={{ disabled: !!disabled, busy: phase === "finishing", selected: holding }}
          accessibilityActions={[{ name: "activate" }]}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === "activate" && !disabled) dispatch({ type: "toggle" });
          }}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: RING,
            borderColor: holding ? colors.danger : colors.border,
            backgroundColor: armed ? colors.danger : holding ? colors.card : colors.muted,
            opacity: disabled ? uiState.disabledOpacity : 1,
            transform: [{ scale: holding && !reduced ? motion.press.growScale : 1 }],
            transitionProperty: ["transform", "backgroundColor", "borderColor"],
            transitionDuration: reduced ? 0 : motion.stateMs,
            transitionTimingFunction: EASE_OUT,
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
