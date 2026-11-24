import { space } from "@/theme/tokens";

/**
 * The bottom insets of the screen skeleton (design rule 4), as pure functions: how far the content
 * of a scroll view must end above the bottom, and where `ui/ActionBar` sits.
 *
 * `safeBottom` is `useSafeAreaInsets().bottom` in the screen. Each iOS tab has its own safe area
 * provider (expo-router native tabs), so under the tab bar it includes the tab bar height. On
 * Android the tab content already ends above the tab bar.
 */

/**
 * The bottom padding of the scroll content: `space.xl` above the bottom bar when the screen has
 * one (`barSpace`: its height plus its distance from the bottom), else above the safe area.
 */
export function screenBottomPadding({ safeBottom, barSpace = 0 }: { safeBottom: number; barSpace?: number }): number {
  return space.xl + (barSpace > 0 ? barSpace : Math.max(0, safeBottom));
}

/**
 * Where the action bar sits. `windowBottom` is the bottom safe area of the window (the home
 * indicator). A larger `safeBottom` means a tab bar: the bar sits on top of it. The screen of a
 * tab ends at the window bottom, and the tab bar floats above the home indicator, so the bar
 * moves up by the full `safeBottom`. With the keyboard up (`keyboardLift`), the bar sits on the keyboard.
 */
export function actionBarPlacement({
  safeBottom,
  windowBottom,
  keyboardLift = 0,
}: {
  safeBottom: number;
  windowBottom: number;
  keyboardLift?: number;
}): { bottom: number; paddingBottom: number } {
  if (keyboardLift > 0) return { bottom: keyboardLift, paddingBottom: space.md };
  const tabBar = Math.max(0, Math.round(safeBottom - windowBottom));
  if (tabBar > 0) return { bottom: Math.round(safeBottom), paddingBottom: space.md };
  return { bottom: 0, paddingBottom: Math.max(safeBottom, space.md) };
}
