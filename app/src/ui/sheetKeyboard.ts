import { useEffect, useRef, useState, type ComponentRef } from "react";
import { Keyboard, Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * The upward shift that react-native-screens gives an Android form sheet with one detent when the
 * keyboard opens (`SheetAnimationCoordinator.calculateKeyboardShiftHidingBottomInset`): the sheet
 * moves up by the keyboard height, but not past its largest height, and the navigation bar
 * area slides behind the keyboard.
 */
export function sheetKeyboardShift(sheetHeight: number, detent: number, keyboard: number, navBar: number): number {
  const room = sheetHeight / detent - sheetHeight;
  return Math.max(0, Math.min(room, keyboard) - navBar);
}

/**
 * Android only: the space the keyboard covers at the bottom of a form sheet with one `detent`.
 *
 * The sheet moves up with the keyboard only until it is at its largest height, so the bottom of a
 * tall sheet stays under the keyboard. `KeyboardAvoidingView` does not see this: it measures its
 * frame relative to the sheet. This hook measures the sheet content in the window (the layout,
 * without the native shift), takes out the shift, and returns the rest. On iOS it returns 0.
 */
export function useSheetKeyboardPad(detent: number): { ref: React.RefObject<ComponentRef<typeof View> | null>; pad: number } {
  const ref = useRef<ComponentRef<typeof View> | null>(null);
  const [pad, setPad] = useState(0);
  const navBar = useSafeAreaInsets().bottom;
  useEffect(() => {
    if (Platform.OS !== "android") return;
    let cancelled = false;
    const show = Keyboard.addListener("keyboardDidShow", (e) => {
      const keyboardTop = e.endCoordinates.screenY;
      ref.current?.measureInWindow((_x, y, _w, h) => {
        if (cancelled) return;
        // The pad is inside the measured view, so its bottom edge does not move with the pad.
        const covered = y + h - keyboardTop;
        const next = covered - sheetKeyboardShift(h, detent, covered, navBar);
        setPad(Math.max(0, Math.round(next)) || 0);
      });
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => setPad(0));
    return () => {
      cancelled = true;
      show.remove();
      hide.remove();
    };
  }, [detent, navBar]);
  return { ref, pad };
}
