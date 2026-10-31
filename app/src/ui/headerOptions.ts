import { Platform } from "react-native";

import { colors, textRole } from "@/theme/tokens";

import { glassAvailable } from "./Glass";

/**
 * Android has no large titles, and its content does not move under a transparent header (iOS
 * moves it with `contentInsetAdjustmentBehavior`). So every Android header is solid.
 */
const android = Platform.OS === "android";

/**
 * A native stack header that shows the content under it. iOS 26 draws the scroll edge effect and
 * puts bar buttons on Liquid Glass; before iOS 26 the bar is a dark blur. No bottom line.
 * Android: the solid header.
 */
export function transparentHeader() {
  if (android) return solidHeader();
  return {
    headerShown: true,
    headerTransparent: true,
    headerBlurEffect: glassAvailable() ? undefined : ("systemChromeMaterialDark" as const),
    headerShadowVisible: false,
    headerTintColor: colors.text,
    // Bar buttons on dark glass, whatever the system appearance.
    headerUserInterfaceStyle: "dark" as const,
    headerTitleStyle: { color: colors.text },
    headerLargeTitleStyle: { color: colors.text },
    headerBackButtonDisplayMode: "minimal" as const,
    contentStyle: { backgroundColor: colors.bg },
  };
}

/** The header of a tab's root screen: a large title that collapses on scroll. Android: the solid header. */
export function tabHeader() {
  if (android) return solidHeader();
  return { ...transparentHeader(), headerLargeTitle: true, headerLargeTitleShadowVisible: false };
}

/** The title of an Android header: the app's title role (20, semibold) in ivory. iOS keeps the system font. */
const androidTitleStyle = { color: colors.text, fontSize: textRole.title.size, fontWeight: textRole.title.weight };

/** A plain header on the page color, for screens whose content does not scroll under it. */
export function solidHeader() {
  return {
    headerShown: true,
    headerStyle: { backgroundColor: colors.bg },
    headerShadowVisible: false,
    headerTintColor: colors.text,
    // Bar buttons on dark glass, whatever the system appearance.
    headerUserInterfaceStyle: "dark" as const,
    headerTitleStyle: android ? androidTitleStyle : { color: colors.text },
    headerBackButtonDisplayMode: "minimal" as const,
    contentStyle: { backgroundColor: colors.bg },
  };
}
