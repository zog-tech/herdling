import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";

import { startConnections } from "@/hosts/connection";
import { useAppFonts } from "@/theme/fonts";
import { colors } from "@/theme/tokens";

SplashScreen.preventAutoHideAsync();
startConnections();

const hostHeader = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.bg },
  headerTintColor: colors.text,
  headerShadowVisible: false,
  headerBackButtonDisplayMode: "minimal",
} as const;

export default function RootLayout() {
  const ready = useAppFonts();
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;
  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="hosts/add" options={{ ...hostHeader, title: "Add host" }} />
        <Stack.Screen name="new" options={{ ...hostHeader, title: "New session", presentation: "modal" }} />
        <Stack.Screen name="hosts/[id]" options={{ ...hostHeader, title: "Edit host" }} />
      </Stack>
    </>
  );
}
