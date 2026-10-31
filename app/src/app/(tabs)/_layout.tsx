import { NativeTabs } from "expo-router/native-tabs";

import { colors } from "@/theme/tokens";

/**
 * The system tab bar (UITabBarController): Liquid Glass on iOS 26, a blurred bar before.
 * SF Symbols, gold for the selected tab. Each tab has its own native stack for its header.
 */
export default function TabsLayout() {
  return (
    <NativeTabs
      tintColor={colors.accent}
      iconColor={{ default: colors.textMuted, selected: colors.accent }}
      labelStyle={{ default: { color: colors.textMuted }, selected: { color: colors.accent } }}
      blurEffect="systemChromeMaterialDark"
    >
      <NativeTabs.Trigger name="(overview)">
        <NativeTabs.Trigger.Icon sf={{ default: "square.grid.2x2", selected: "square.grid.2x2.fill" }} />
        <NativeTabs.Trigger.Label>Overview</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="usage">
        <NativeTabs.Trigger.Icon sf="gauge.with.dots.needle.67percent" />
        <NativeTabs.Trigger.Label>Usage</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="automations">
        <NativeTabs.Trigger.Icon sf={{ default: "flowchart", selected: "flowchart.fill" }} />
        <NativeTabs.Trigger.Label>Automations</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf={{ default: "gearshape", selected: "gearshape.fill" }} />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
