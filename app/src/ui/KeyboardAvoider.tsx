import { useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import {
  Dimensions,
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
 * The top edge of the keyboard on the screen. Some keyboard events (cross-fade transitions, some
 * keyboard changes) give `screenY` 0 with a real height. Then the top is the window height minus
 * the keyboard height. Gives 0 when neither value is real.
 */
export function keyboardTopOf(screenY: number, height: number, windowHeight: number): number {
  if (screenY > 0) return screenY;
  return height > 0 ? Math.max(0, windowHeight - height) : 0;
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
 *
 * `atScreenBottom`: the view ends at the bottom of the window, for example in a form sheet. The
 * native sheet sets the sheet position, so `measureInWindow` gives y = 0 for the sheet content.
 * With this prop, only the measured height is used, and the top is the window height minus it.
 */
export function KeyboardAvoider({
  style,
  atScreenBottom = false,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  atScreenBottom?: boolean;
  children: ReactNode;
}) {
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
      const top = keyboardTopOf(e.endCoordinates.screenY, e.endCoordinates.height, Dimensions.get("window").height);
      const view = ref.current;
      if (!view) return;
      view.measureInWindow((_x, y, _w, h) => {
        const viewY = atScreenBottom ? Dimensions.get("window").height - h : y;
        apply(keyboardOverlap(viewY, h, top), e);
      });
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
  }, [atScreenBottom]);

  return (
    <View ref={ref} style={[{ flex: 1 }, style, { paddingBottom: pad }]}>
      {children}
    </View>
  );
}

/** True while the software keyboard is up (iOS: from the moment it starts to come up). */
export function useKeyboardShown(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setShown(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return shown;
}
