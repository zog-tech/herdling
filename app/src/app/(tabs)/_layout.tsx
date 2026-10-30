import { Tabs } from "expo-router";
import { Gauge, LayoutGrid, Settings, Workflow } from "lucide-react-native";

import { colors, hitTarget, type } from "@/theme/tokens";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
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
