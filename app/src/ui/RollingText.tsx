import { View, type TextStyle } from "react-native";
import Animated, { Easing, Keyframe, LayoutAnimationConfig, ReduceMotion } from "react-native-reanimated";

import { motion } from "@/theme/tokens";

import { rollSlots } from "./rollSlots";

/** How far a character moves while it rolls, in pt. */
const ROLL = 6;
const EASE_OUT = Easing.bezier(...motion.ease.out);

/** A new character rolls up into its slot. */
const ENTER = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: ROLL }] },
  100: { opacity: 1, transform: [{ translateY: 0 }], easing: EASE_OUT },
})
  .duration(motion.stateMs)
  .reduceMotion(ReduceMotion.System);

/** The old character rolls up out of its slot, a little faster than the new one enters. */
const EXIT = new Keyframe({
  0: { opacity: 1, transform: [{ translateY: 0 }] },
  100: { opacity: 0, transform: [{ translateY: -ROLL }], easing: EASE_OUT },
})
  .duration(Math.round(motion.stateMs * motion.exitRatio))
  .reduceMotion(ReduceMotion.System);

/**
 * Text whose changed characters roll up, for a counter that ticks (for example "1m 4s").
 * Only a changed character moves; the first render does not roll. Under Reduce Motion the text changes without motion.
 * Use tabular figures in `style`, so the digits keep one width. The caller sets the
 * accessibility label: the characters are hidden from VoiceOver.
 */
export function RollingText({ text, style, maxFontSizeMultiplier }: { text: string; style: TextStyle; maxFontSizeMultiplier?: number }) {
  return (
    <LayoutAnimationConfig skipEntering>
      <View style={{ flexDirection: "row" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {rollSlots(text).map(({ key, ch }) => (
        <View key={key.split(":")[0]} style={{ overflow: "hidden" }}>
          <Animated.Text key={key} entering={ENTER} exiting={EXIT} style={style} maxFontSizeMultiplier={maxFontSizeMultiplier}>
            {ch}
          </Animated.Text>
        </View>
        ))}
      </View>
    </LayoutAnimationConfig>
  );
}
