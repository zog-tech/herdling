import { Mic, X } from "lucide-react-native";
import { useEffect, useMemo } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { cubicBezier, useReducedMotion, useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { colors, motion, radius, space, state as uiState } from "@/theme/tokens";
import { Text } from "@/ui/Text";

import { CANCEL_DISTANCE, type HoldEvent } from "./holdToTalk";
import type { Dictation } from "./useDictation";

/** Default size. The composer passes `hitTarget` so the mic matches the send button. */
export const MIC_SIZE = 64;
const RING = 3;
const EASE_OUT = cubicBezier(...motion.ease.out);

/**
 * The mic: hold to record, release to stop, slide more than CANCEL_DISTANCE away to cancel.
 * Or tap to toggle: a short tap starts, the next tap stops. VoiceOver activate does the same.
 * `dictation` (from `useDictation`) owns the state; the text goes to its `onText`.
 * `hint`: show a bubble above the button with the state (screens without a record bar).
 */
export function MicButton({
  dictation,
  disabled,
  size = MIC_SIZE,
  hint: showHint = true,
}: {
  dictation: Dictation;
  disabled?: boolean;
  /** Diameter of the idle button in points. While held, the button grows a little. */
  size?: number;
  hint?: boolean;
}) {
  const icon = Math.min(28, Math.round(size / 2));
  const { state, error, dispatch } = dictation;
  const reduced = useReducedMotion();
  const far = useSharedValue(false);
  const ended = useSharedValue(false);

  // Disabled mid-hold (host went offline): drop the recording. A failed one stays for a retry.
  useEffect(() => {
    if (disabled && dictation.state.phase !== "failed") dispatch({ type: "cancel", force: true });
    // Only a change of `disabled` cancels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, dispatch]);
  // While text is on its way (or failed), the mic waits.
  const busy = state.phase === "finishing" || state.phase === "failed";
  const off = !!disabled || busy;

  const gesture = useMemo(() => {
    // Press and release carry the time, so a short press counts as a tap (tap-to-toggle).
    const send = (e: HoldEvent) => dispatch(e.type === "press" || e.type === "release" ? { ...e, at: Date.now() } : e);
    return (
      Gesture.Pan()
        .enabled(!off)
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
  }, [off, dispatch, far, ended]);

  const { phase } = state;
  const holding = phase === "recording" || phase === "armedCancel";
  const armed = phase === "armedCancel";
  const latched = !!state.latched && phase === "recording";
  const hint = !showHint
    ? undefined
    : armed
      ? "Release to cancel"
      : latched
        ? "Recording · tap to stop"
        : phase === "recording"
          ? "Release to stop · slide away to cancel"
          : phase === "finishing"
            ? "Transcribing…"
            : (error ?? (dictation.caption ? `Transcribed with ${dictation.caption}` : undefined));

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
          accessibilityLabel={holding ? "Stop and transcribe" : "Dictate"}
          accessibilityHint="Double tap to start recording, double tap again to stop. Or hold, speak and release. The text goes into the prompt box."
          accessibilityState={{ disabled: off, busy: phase === "finishing", selected: holding }}
          accessibilityActions={[{ name: "activate" }]}
          onAccessibilityAction={(e) => {
            if (e.nativeEvent.actionName === "activate" && !off) dispatch({ type: "toggle" });
          }}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: RING,
            borderColor: holding ? colors.danger : colors.border,
            backgroundColor: armed ? colors.danger : holding ? colors.card : colors.raised,
            opacity: off ? uiState.disabledOpacity : 1,
            transform: [{ scale: holding && !reduced ? motion.press.growScale : 1 }],
            transitionProperty: ["transform", "backgroundColor", "borderColor"],
            transitionDuration: reduced ? 0 : motion.stateMs,
            transitionTimingFunction: EASE_OUT,
          }}
        >
          {armed ? (
            <X size={icon} color={colors.onAccent} />
          ) : (
            <Mic size={icon} color={holding ? colors.danger : off ? colors.textMuted : colors.text} />
          )}
        </Animated.View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}
