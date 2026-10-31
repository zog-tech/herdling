import { colors } from "@/theme/tokens";

import { glassAvailable } from "./Glass";

/**
 * A native stack header that shows the content under it. iOS 26 draws the scroll edge effect and
 * puts bar buttons on Liquid Glass; before iOS 26 the bar is a dark blur. No bottom line.
 */
export function transparentHeader() {
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

/** The header of a tab's root screen: a large title that collapses on scroll. */
export function tabHeader() {
  return { ...transparentHeader(), headerLargeTitle: true, headerLargeTitleShadowVisible: false };
}

/** A plain header on the page color, for screens whose content does not scroll under it. */
export function solidHeader() {
  return {
    headerShown: true,
    headerStyle: { backgroundColor: colors.bg },
    headerShadowVisible: false,
    headerTintColor: colors.text,
    // Bar buttons on dark glass, whatever the system appearance.
    headerUserInterfaceStyle: "dark" as const,
    headerTitleStyle: { color: colors.text },
    headerBackButtonDisplayMode: "minimal" as const,
    contentStyle: { backgroundColor: colors.bg },
  };
}
