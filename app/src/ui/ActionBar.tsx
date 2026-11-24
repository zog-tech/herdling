import type { LucideIcon } from "lucide-react-native";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { initialWindowMetrics, useSafeAreaInsets } from "react-native-safe-area-context";

import { actionBar, hitTarget, space } from "@/theme/tokens";

import { Button } from "./Button";
import { GlassSurface } from "./Glass";
import { useKeyboardHeight } from "./KeyboardAvoider";
import { sheetLift } from "./menuRules";
import { actionBarPlacement, screenBottomPadding } from "./screenInsets";

/**
 * The bottom bar of a screen (design rule 4): the one primary action, and at most one secondary
 * action, pinned at the bottom. Liquid Glass on iOS 26 (`ui/Glass`), the `glassFallback` fill
 * before and on Android. It sits above the home indicator, on top of a tab bar, and with
 * `keyboard` on top of the keyboard. Buttons never float in the middle of an empty page.
 *
 * In a `Screen`, pass it as `footer`: the screen then ends its content above the bar.
 *
 * ```tsx
 * <Screen
 *   flush
 *   footer={
 *     <ActionBar
 *       primary={{ label: "New agent", Icon: Plus, onPress: newAgent }}
 *       secondary={{ label: "Terminal", Icon: SquareTerminal, onPress: openShell }}
 *     />
 *   }
 * >
 *   …
 * </Screen>
 * ```
 *
 * With an own scroll view (a `FlatList`), use `useActionBarSpace()`:
 *
 * ```tsx
 * const bar = useActionBarSpace();
 * <FlatList contentContainerStyle={{ paddingBottom: bar.contentPadding }} … />
 * <ActionBar onSpace={bar.onSpace} primary={…} />
 * ```
 *
 * `children` go above the buttons, full width (for example the first prompt box of New session).
 * The buttons sit side by side (secondary at the left); from `actionBar.stackFontScale` they stack.
 */

export type ActionBarButton = {
  label: string;
  onPress: () => void;
  Icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  accessibilityHint?: string;
};

/** Gets the space the bar takes at the bottom. `Screen` gives it when the bar is its `footer`. */
export const ActionBarSpaceContext = createContext<((points: number) => void) | null>(null);

/** A first guess of the space of a bar with one row of buttons, until it measures itself. */
export function actionBarEstimate(safeBottom: number): number {
  return hitTarget + space.md + Math.max(safeBottom, space.md);
}

/**
 * For a screen with its own scroll view: `onSpace` goes to the `ActionBar`, `contentPadding` to the
 * bottom padding of the scroll content.
 */
export function useActionBarSpace(): { space: number; onSpace: (points: number) => void; contentPadding: number } {
  const safeBottom = useSafeAreaInsets().bottom;
  const [barSpace, setBarSpace] = useState(() => actionBarEstimate(safeBottom));
  const onSpace = useCallback((n: number) => setBarSpace(n), []);
  return { space: barSpace, onSpace, contentPadding: screenBottomPadding({ safeBottom, barSpace }) };
}

export function ActionBar({
  primary,
  secondary,
  secondaryVariant = "secondary",
  children,
  keyboard = false,
  onSpace,
}: {
  primary?: ActionBarButton;
  secondary?: ActionBarButton;
  /** The look of the secondary button. A destructive second action uses `danger`. */
  secondaryVariant?: "secondary" | "ghost" | "danger";
  children?: ReactNode;
  /** Sit on top of the keyboard while it is up (a screen with a text field in the bar or above it). */
  keyboard?: boolean;
  /** Gets the space the bar takes at the bottom: its height plus its distance from the bottom. */
  onSpace?: (points: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const kb = useKeyboardHeight();
  const fromContext = useContext(ActionBarSpaceContext);
  const anchor = useRef<ComponentRef<typeof View> | null>(null);
  // The bottom of the screen area in the window. iOS: the screen ends at the window bottom (also a
  // form sheet, where a measure gives a wrong top). Android: measured, because a window can shrink for the keyboard.
  const [areaBottom, setAreaBottom] = useState(win.height);
  const [height, setHeight] = useState(0);

  const measure = useCallback(() => {
    if (Platform.OS === "ios") return;
    anchor.current?.measureInWindow((_x, y, _w, h) => {
      if (h > 0) setAreaBottom(y + h);
    });
  }, []);
  useEffect(() => {
    if (keyboard) measure();
  }, [keyboard, kb, measure]);

  const lift = keyboard ? sheetLift(Platform.OS === "ios" ? win.height : areaBottom, kb, win.height) : 0;
  const place = actionBarPlacement({ safeBottom: insets.bottom, windowBottom: initialWindowMetrics?.insets.bottom ?? insets.bottom, keyboardLift: lift });

  useEffect(() => {
    if (height <= 0) return;
    const total = height + place.bottom;
    onSpace?.(total);
    fromContext?.(total);
  }, [height, place.bottom, onSpace, fromContext]);

  const stacked = win.fontScale >= actionBar.stackFontScale;
  const second = secondary ? <Button {...secondary} variant={secondaryVariant} style={stacked ? undefined : { flex: 1 }} /> : null;
  const first = primary ? <Button {...primary} variant="primary" style={stacked ? undefined : { flex: secondary ? 2 : 1 }} /> : null;

  return (
    <>
      <View ref={anchor} pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={measure} />
      <GlassSurface
        pointerEvents="box-none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: place.bottom,
          paddingTop: space.md,
          paddingBottom: place.paddingBottom,
          paddingLeft: space.lg + insets.left,
          paddingRight: space.lg + insets.right,
          gap: space.md,
          borderWidth: 0,
          borderTopWidth: StyleSheet.hairlineWidth,
        }}
      >
        <View style={{ gap: space.md }}>
          {children}
          {first || second ? (
            <View style={{ flexDirection: stacked ? "column" : "row", gap: space.sm }}>
              {second}
              {first}
            </View>
          ) : null}
        </View>
        {/* Measures the whole bar, padding included. */}
        <View
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          onLayout={(e) => setHeight(Math.round(e.nativeEvent.layout.height))}
        />
      </GlassSurface>
    </>
  );
}
