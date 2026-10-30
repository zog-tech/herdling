import { Tabs } from "expo-router";
import { Gauge, LayoutGrid, Settings, Workflow } from "lucide-react-native";

import { colors, denseScale, hitTarget, type } from "@/theme/tokens";
import { Text } from "@/ui/Text";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        // The header bar has a fixed height: its title grows with Dynamic Type only up to the row cap.
        headerTitle: ({ children }) => (
          <Text variant="title" accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={denseScale.row}>
            {children}
          </Text>
        ),
        tabBarAllowFontScaling: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border, minHeight: hitTarget },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: type.size.caption },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Overview", tabBarIcon: ({ color, size }) => <LayoutGrid color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="usage"
        options={{ title: "Usage", tabBarIcon: ({ color, size }) => <Gauge color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="automations"
        options={{ title: "Automations", tabBarIcon: ({ color, size }) => <Workflow color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: "Settings", tabBarIcon: ({ color, size }) => <Settings color={color} size={size} /> }}
      />
    </Tabs>
  );
}
