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

import { keyboardLine, logDisplay } from "./displayLog";

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

/** Points of rounding that a keyboard frame can have past the window bottom. */
const EDGE_SLACK = 2;

/**
 * The top edge of the keyboard on the screen. Normally this is `screenY`, and the keyboard ends at
 * the window bottom. When the frame does not fit the window, the top is the window height minus
 * the keyboard height. This occurs when `screenY` is 0 (cross-fade transitions, some keyboard
 * changes), or when the frame is in a different coordinate space (seen while the screen is shared
 * with AirPlay). A keyboard at the window bottom with its top at the window bottom is hidden: the
 * result is the window height. A keyboard higher than the window gives a top of 1, so the overlap
 * stays real. Gives 0 when neither value is real.
 */
export function keyboardTopOf(screenY: number, height: number, windowHeight: number): number {
  const h = height > 0 ? Math.min(height, windowHeight) : 0;
  const fromHeight = h > 0 ? Math.max(1, Math.round(windowHeight - h)) : 0;
  if (!(screenY > 0)) return fromHeight;
  // A hidden keyboard: its top is at the window bottom.
  if (Math.abs(screenY - windowHeight) <= EDGE_SLACK) return screenY;
  // The frame does not fit in the window: use the height only.
  if (screenY > windowHeight || screenY + h > windowHeight + EDGE_SLACK) return fromHeight || screenY;
  return screenY;
}

/**
 * The keyboard height to use when a show event has no frame at all (`screenY` and `height` both 0).
 * React Native converts the keyboard frame with the key window. With no key window (seen while the
 * screen is shared with AirPlay) the frame is all zeros. Then the last real height is the best
 * value. With no real height yet, it is 42 % of the window height: a phone keyboard with its
 * suggestion bar is about that high. More padding is better than a hidden composer.
 */
export function fallbackKeyboardHeight(lastHeight: number | undefined, windowHeight: number): number {
  if (lastHeight != null && lastHeight > 0) return Math.min(lastHeight, windowHeight);
  return Math.round(windowHeight * 0.42);
}

/** The last real keyboard height in this app session, for frames with no values. */
let lastKeyboardHeight: number | undefined;

/** Tests only: forgets the last real keyboard height. */
export function resetKeyboardMemory(): void {
  lastKeyboardHeight = undefined;
}

const SHOW_EVENTS = new Set(["keyboardWillShow", "keyboardDidShow"]);

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
    /**
     * Measures the view and sets the padding. `name` is the event name. `retry` is true for the
     * second measure after `keyboardDidShow` (see below).
     */
    const measure = (name: string, e: KeyboardEvent, retry = false) => {
      const win = Dimensions.get("window");
      const screen = Dimensions.get("screen");
      const { screenY } = e.endCoordinates;
      let { height } = e.endCoordinates;
      let note: string | undefined = retry ? "metrics" : undefined;
      if (height > 0) lastKeyboardHeight = height;
      if (!(screenY > 0) && !(height > 0)) {
        // No frame at all. A show event still means the keyboard is up; other events tell nothing.
        if (!SHOW_EVENTS.has(name)) {
          logDisplay(keyboardLine({ event: name, screenY, height, window: win, screen, top: 0, note: "empty frame, ignored" }));
          return;
        }
        height = fallbackKeyboardHeight(lastKeyboardHeight, win.height);
        note = "empty frame, estimated height";
      }
      const top = keyboardTopOf(screenY, height, win.height);
      const view = ref.current;
      if (!view) return;
      view.measureInWindow((_x, y, _w, h) => {
        const viewY = atScreenBottom ? win.height - h : y;
        const next = keyboardOverlap(viewY, h, top);
        logDisplay(keyboardLine({ event: name, screenY, height: e.endCoordinates.height, window: win, screen, viewY, viewHeight: h, top, pad: next, note }));
        apply(next, e);
        // The keyboard is up but the padding is 0: measure again with the keyboard metrics, in
        // case this event had a frame that the metrics correct.
        if (name === "keyboardDidShow" && !retry && next === 0 && Keyboard.isVisible()) {
          const m = Keyboard.metrics();
          if (m && m.height > 0) measure(name, { ...e, endCoordinates: m }, true);
        }
      });
    };
    const on = (name: "keyboardWillShow" | "keyboardWillChangeFrame" | "keyboardDidShow") =>
      Keyboard.addListener(name, (e) => measure(name, e));
    const hide = (name: "keyboardWillHide" | "keyboardDidHide") =>
      Keyboard.addListener(name, (e) => {
        logDisplay(`kb ${name}`);
        apply(0, Platform.OS === "ios" ? e : undefined);
      });
    const subs =
      Platform.OS === "ios"
        ? [on("keyboardWillShow"), on("keyboardWillChangeFrame"), on("keyboardDidShow"), hide("keyboardWillHide")]
        : [on("keyboardDidShow"), hide("keyboardDidHide")];
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
