import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import {
  Keyboard,
  LayoutAnimation,
  Platform,
  View,
  type KeyboardEvent,
  type LayoutAnimationType,
  type StyleProp,
  type ViewStyle,
} from "react-native";

/**
 * The part of a view that the keyboard covers, in points. `viewY` and `viewHeight` give the view
 * frame in the window. `keyboardTop` is the top edge of the keyboard on the screen. A keyboard top
 * of 0 or less is not a real position (iOS sends 0 when "Prefer Cross-Fade Transitions" is on), so
 * the result is 0 for it.
 */
export function keyboardOverlap(viewY: number, viewHeight: number, keyboardTop: number): number {
  if (!(keyboardTop > 0)) return 0;
  return Math.max(0, Math.round(viewY + viewHeight - keyboardTop));
}

/**
 * A `flex: 1` view that adds bottom padding equal to the part of it that the keyboard covers.
 *
 * Use it in place of `KeyboardAvoidingView`. React Native's `KeyboardAvoidingView` takes its
 * frame from `onLayout`, which is relative to its parent, and compares it with the keyboard
 * position on the screen. Below a native stack header (or in a sheet) the parent starts lower than
 * the screen top, so the padding is short by that distance and the keyboard covers the bottom of
 * the view. This view measures its frame in the window each time the keyboard moves.
 *
 * The padding is inside the view, so the padding does not move the measured frame. iOS measures
 * again when the keyboard is fully up, because a sheet can move after the first event.
 */
export function KeyboardAvoider({ style, children }: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const ref = useRef<ComponentRef<typeof View> | null>(null);
  const [pad, setPad] = useState(0);
  const padRef = useRef(0);

  useEffect(() => {
    let alive = true;
    const apply = (next: number, e?: KeyboardEvent) => {
      if (!alive || next === padRef.current) return;
      padRef.current = next;
      // iOS: move the padding with the keyboard animation, as KeyboardAvoidingView does.
      if (Platform.OS === "ios" && e?.duration) {
        const duration = Math.max(10, e.duration);
        const type: LayoutAnimationType = (LayoutAnimation.Types as Record<string, LayoutAnimationType>)[e.easing] ?? "keyboard";
        LayoutAnimation.configureNext({ duration, update: { duration, type } });
      }
      setPad(next);
    };
    const measure = (e: KeyboardEvent) => {
      const top = e.endCoordinates.screenY;
      const view = ref.current;
      if (!view) return;
      view.measureInWindow((_x, y, _w, h) => apply(keyboardOverlap(y, h, top), e));
    };
    const subs =
      Platform.OS === "ios"
        ? [
            Keyboard.addListener("keyboardWillChangeFrame", measure),
            Keyboard.addListener("keyboardDidShow", measure),
            Keyboard.addListener("keyboardWillHide", (e) => apply(0, e)),
          ]
        : [Keyboard.addListener("keyboardDidShow", measure), Keyboard.addListener("keyboardDidHide", () => apply(0))];
    return () => {
      alive = false;
      subs.forEach((s) => s.remove());
    };
  }, []);

  return (
    <View ref={ref} style={[{ flex: 1 }, style, { paddingBottom: pad }]}>
      {children}
    </View>
  );
}
