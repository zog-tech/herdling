import { NativeTabs } from "expo-router/native-tabs";
import { Platform } from "react-native";

import { colors } from "@/theme/tokens";

/**
 * Android: a Material bottom bar on `card`, a faint gold pill behind the selected icon, and the
 * labels always visible. iOS ignores these props, but they stay out of the iOS bar on purpose.
 */
const androidBar =
  Platform.OS === "android"
    ? ({
        backgroundColor: colors.card,
        indicatorColor: "rgba(212,168,87,0.16)",
        rippleColor: "rgba(212,168,87,0.12)",
        labelVisibilityMode: "labeled",
      } as const)
    : {};

/**
 * The system tab bar (UITabBarController): Liquid Glass on iOS 26, a blurred bar before.
 * SF Symbols, gold for the selected tab. Each tab has its own native stack for its header.
 * Android has no SF Symbols: `src` gives it Material Symbols images (white, tinted by the bar).
 * `sidebarAdaptable` (iOS 18+): on iPad the tab bar can turn into a sidebar. iPhone keeps the
 * tab bar (iOS 27 shows the sidebar only on large iPhones in landscape, and Herdling is portrait).
 */
export default function TabsLayout() {
  return (
    <NativeTabs
      sidebarAdaptable
      tintColor={colors.accent}
      iconColor={{ default: colors.textMuted, selected: colors.accent }}
      labelStyle={{ default: { color: colors.textMuted }, selected: { color: colors.accent } }}
      blurEffect="systemChromeMaterialDark"
      {...androidBar}
    >
      <NativeTabs.Trigger name="(overview)">
        <NativeTabs.Trigger.Icon
          sf={{ default: "square.grid.2x2", selected: "square.grid.2x2.fill" }}
          src={{ default: require("../../../assets/images/tabs/overview.png"), selected: require("../../../assets/images/tabs/overview-fill.png") }}
        />
        <NativeTabs.Trigger.Label>Overview</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="usage">
        <NativeTabs.Trigger.Icon
          sf="gauge.with.dots.needle.67percent"
          src={{ default: require("../../../assets/images/tabs/usage.png"), selected: require("../../../assets/images/tabs/usage-fill.png") }}
        />
        <NativeTabs.Trigger.Label>Usage</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="automations">
        <NativeTabs.Trigger.Icon
          sf={{ default: "flowchart", selected: "flowchart.fill" }}
          src={{
            default: require("../../../assets/images/tabs/automations.png"),
            selected: require("../../../assets/images/tabs/automations-fill.png"),
          }}
        />
        <NativeTabs.Trigger.Label>Automations</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon
          sf={{ default: "gearshape", selected: "gearshape.fill" }}
          src={{ default: require("../../../assets/images/tabs/settings.png"), selected: require("../../../assets/images/tabs/settings-fill.png") }}
        />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
