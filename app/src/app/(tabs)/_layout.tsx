import { Tabs } from "expo-router";
import { Gauge, LayoutGrid, Settings, Workflow } from "lucide-react-native";
import { View } from "react-native";

import { colors, denseScale, hitTarget, type } from "@/theme/tokens";
import { HorizonLine } from "@/ui/HorizonLine";
import { Text } from "@/ui/Text";

/** Header of a main screen: the night page with the horizon hairline at the bottom. */
function HeaderBackground() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: "flex-end" }}>
      <HorizonLine />
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        headerBackground: HeaderBackground,
        // The header bar has a fixed height: its title grows with Dynamic Type only up to the row cap.
        headerTitle: ({ children }) => (
          <Text variant="title" accessibilityRole="header" numberOfLines={1} maxFontSizeMultiplier={denseScale.row}>
            {children}
          </Text>
        ),
        tabBarAllowFontScaling: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.divider, minHeight: hitTarget },
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
