import { Easing, type SharedValue, withSequence, withSpring, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { motion } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";

type Settable = Pick<SharedValue<number>, "set">;

const EASE_OUT = Easing.bezier(...motion.ease.out);
const { press } = motion;

/**
 * Press feedback of a Board card, as worklets for the gesture callbacks (UI thread, no React state).
 * - `begin` (finger down): the light layer fades in; the card scales to 0.98, then keeps going
 *   toward 0.96 for the rest of the long-press delay, so the hold reads as "charging".
 * - `release` (finger up, swipe start, long press fired): springs back to rest, the layer fades out.
 * - `tap` / `long`: run the actions on the JS thread.
 * Reduce Motion: no scale; the layer stays.
 */
export function makeCardPress(
  v: { scale: Settable; overlay: Settable },
  reduced: boolean,
  onTap: () => void,
  onLong: () => void,
) {
  const { scale, overlay } = v;
  return {
    begin() {
      "worklet";
      overlay.set(withTiming(press.overlay, { duration: press.inMs, easing: EASE_OUT }));
      if (reduced) return;
      scale.set(
        withSequence(
          withTiming(press.scale, { duration: press.inMs, easing: EASE_OUT }),
          withTiming(press.holdScale, { duration: press.longPressMs - press.inMs, easing: Easing.linear }),
        ),
      );
    },
    release() {
      "worklet";
      overlay.set(withTiming(0, { duration: Math.round(press.inMs * motion.exitRatio), easing: EASE_OUT }));
      if (!reduced) scale.set(withSpring(1, motion.spring.release));
    },
    tap() {
      "worklet";
      scheduleOnRN(onTap);
    },
    long() {
      "worklet";
      scheduleOnRN(onLong);
    },
  };
}

/**
 * The card's tap and long-press actions with their haptics: a tap opens the session (light), a long
 * press peeks (medium, at the moment it fires). One haptic per gesture.
 */
export function cardActions<T>(item: T, onOpen: (i: T) => void, onPeek: (i: T) => void) {
  return {
    open: () => {
      haptics.press();
      onOpen(item);
    },
    peek: () => {
      haptics.peek();
      onPeek(item);
    },
  };
}
