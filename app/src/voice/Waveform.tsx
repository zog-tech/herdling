import { useEffect } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";

import * as Voice from "../../modules/voice";
import { colors } from "@/theme/tokens";

/** Bars on screen. The newest level is on the right. */
export const BARS = 36;
const BAR_W = 3;
const BAR_GAP = 2;
const HEIGHT = 28;
/** A silent bar keeps this share of the height, so the waveform reads as "listening". */
const MIN_SCALE = 0.1;

function Bar({ levels, index }: { levels: SharedValue<number[]>; index: number }) {
  // scaleY, not height: a transform does not run layout each time a level comes.
  const style = useAnimatedStyle(() => ({
    transform: [{ scaleY: Math.max(MIN_SCALE, levels.get()[index] ?? 0) }],
  }));
  return (
    <Animated.View
      style={[{ width: BAR_W, height: HEIGHT, borderRadius: BAR_W / 2, backgroundColor: colors.text }, style]}
    />
  );
}

/**
 * Live microphone level as scrolling bars. Levels come from the native `onLevel` event (about
 * 20 a second) into a shared value; React does not render per level. Older builds send no
 * levels: the bars stay at rest and the elapsed time still shows that recording runs.
 */
export function Waveform() {
  const levels = useSharedValue<number[]>(Array.from({ length: BARS }, () => 0));
  useEffect(() => {
    const sub = Voice.addListener("onLevel", ({ level }) => {
      levels.set((cur) => [...cur.slice(1), level]);
    });
    return () => sub.remove();
  }, [levels]);
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ flexDirection: "row", alignItems: "center", gap: BAR_GAP, height: HEIGHT, overflow: "hidden" }}
    >
      {Array.from({ length: BARS }, (_, i) => (
        <Bar key={i} levels={levels} index={i} />
      ))}
    </View>
  );
}
