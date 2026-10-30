import * as Notifications from "expo-notifications";
import { Stack, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { startConnections } from "@/hosts/connection";
import { showBannerFor, useNotificationRouting } from "@/push/useNotificationRouting";
import { useAppFonts } from "@/theme/fonts";
import { colors } from "@/theme/tokens";
import { CloseButton } from "@/ui/CloseButton";
import { refreshParakeet } from "@/voice/parakeet";

SplashScreen.preventAutoHideAsync();
startConnections();
Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const show = showBannerFor(n.request.content.data);
    return { shouldShowBanner: show, shouldShowList: true, shouldPlaySound: show, shouldSetBadge: false };
  },
});

const hostHeader = {
  headerShown: true,
  headerStyle: { backgroundColor: colors.bg },
  headerTintColor: colors.text,
  headerShadowVisible: false,
  headerBackButtonDisplayMode: "minimal",
} as const;

/** Close button of a modal screen's header, next to swipe-down. */
function ModalClose() {
  const router = useRouter();
  return <CloseButton onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} />;
}
const modalHeader = { ...hostHeader, presentation: "modal", headerLeft: () => <ModalClose /> } as const;

/** Rendered inside the root layout so the router exists; routing waits for the navigator itself. */
function NotificationRouting() {
  useNotificationRouting();
  return null;
}

export default function RootLayout() {
  const ready = useAppFonts();
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);
  // Voice input picks Parakeet only when its model is on disk: read that once at start.
  useEffect(() => {
    void refreshParakeet();
  }, []);
  if (!ready) return null;
  // Gesture-handler gestures (the swipe between agents, horizontal scroll views) need this root view.
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="hosts/discover" options={{ ...hostHeader, title: "Add host" }} />
        <Stack.Screen name="hosts/pair" options={{ ...hostHeader, title: "Pair" }} />
        <Stack.Screen name="hosts/scan" options={{ ...hostHeader, title: "Scan QR" }} />
        <Stack.Screen name="hosts/add" options={{ ...hostHeader, title: "Add manually" }} />
        <Stack.Screen name="hosts/password" options={{ ...hostHeader, title: "Set up with password" }} />
        <Stack.Screen name="new" options={{ ...modalHeader, title: "New session" }} />
        <Stack.Screen name="resume/[hostId]/[paneId]" options={{ ...modalHeader, title: "Resume session" }} />
        <Stack.Screen name="speech-log" options={{ ...hostHeader, title: "Speech log" }} />
        <Stack.Screen name="hosts/[id]" options={{ ...hostHeader, title: "Edit host" }} />
        <Stack.Screen name="tool" options={{ presentation: "modal", contentStyle: { backgroundColor: colors.bg } }} />
        <Stack.Screen
          name="peek/[hostId]/[paneId]"
          options={{
            presentation: "formSheet",
            sheetAllowedDetents: [0.6, 1],
            sheetGrabberVisible: true,
            sheetCornerRadius: 16,
            contentStyle: { backgroundColor: colors.bg },
          }}
        />
      </Stack>
      <NotificationRouting />
    </GestureHandlerRootView>
  );
}
