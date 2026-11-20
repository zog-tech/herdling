import { useState } from "react";
import { Image, View } from "react-native";
import { GestureDetector, usePanGesture, usePinchGesture, useSimultaneousGestures, useTapGesture } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

import { motion } from "@/theme/tokens";

/** Zoom range of the pinch. */
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 6;
/** The zoom of a double tap on an image at full fit. */
const ZOOM_TAP = 2.5;

/** Keeps a value in the zoom range. Runs on the UI thread too. */
export function clampZoom(z: number): number {
  "worklet";
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/**
 * A full-screen image that the user zooms with two fingers (1–6×) and moves with one finger while
 * it is zoomed. A double tap zooms in, or back to the full fit. It uses Gesture Handler and
 * Reanimated, which every build has, so it works on iOS and Android with no new native module.
 */
export function ZoomImage({ uri, label, onError }: { uri: string; label: string; onError?: () => void }) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const base = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const pinch = usePinchGesture({
    onUpdate: (e) => {
      "worklet";
      scale.set(clampZoom(base.get() * e.scale));
    },
    onDeactivate: () => {
      "worklet";
      base.set(scale.get());
      if (scale.get() <= ZOOM_MIN) {
        x.set(0);
        y.set(0);
      }
    },
  });
  const pan = usePanGesture({
    minPointers: 1,
    onActivate: () => {
      "worklet";
      startX.set(x.get());
      startY.set(y.get());
    },
    onUpdate: (e) => {
      "worklet";
      if (scale.get() <= ZOOM_MIN) return;
      x.set(startX.get() + e.translationX);
      y.set(startY.get() + e.translationY);
    },
  });
  const doubleTap = useTapGesture({
    numberOfTaps: 2,
    onActivate: () => {
      "worklet";
      const next = scale.get() > ZOOM_MIN ? ZOOM_MIN : ZOOM_TAP;
      const ms = reduced ? 0 : motion.enterMs;
      scale.set(withTiming(next, { duration: ms }));
      base.set(next);
      x.set(withTiming(0, { duration: ms }));
      y.set(withTiming(0, { duration: ms }));
    },
  });
  const gesture = useSimultaneousGestures(pinch, pan, doubleTap);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: scale.get() }] }));

  return (
    <View style={{ flex: 1, overflow: "hidden" }} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={[{ flex: 1 }, style]} accessibilityHint="Pinch to zoom. Double tap to zoom in or out.">
          {size.w > 0 ? (
            <Image
              source={{ uri }}
              accessibilityLabel={label}
              resizeMode="contain"
              style={{ width: size.w, height: size.h }}
              onError={onError}
            />
          ) : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
