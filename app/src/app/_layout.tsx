import * as Notifications from "expo-notifications";
import { DarkTheme, Stack, ThemeProvider, useRouter } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { PEEK_DETENT_ANDROID } from "@/board/peekDetent";
import { startConnections } from "@/hosts/connection";
import { UpdateChecks } from "@/hosts/UpdateChecks";
import { showBannerFor, useNotificationRouting } from "@/push/useNotificationRouting";
import { useAppFonts } from "@/theme/fonts";
import { colors } from "@/theme/tokens";
import { CloseButton } from "@/ui/CloseButton";
import { glassAvailable } from "@/ui/Glass";
import { solidHeader } from "@/ui/headerOptions";
import { NativeSheetHost } from "@/ui/nativeSheet";
import { NoticeHost } from "@/ui/notice";
import { refreshParakeet } from "@/voice/parakeet";

SplashScreen.preventAutoHideAsync();
startConnections();
Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const show = showBannerFor(n.request.content.data);
    return { shouldShowBanner: show, shouldShowList: true, shouldPlaySound: show, shouldSetBadge: false };
  },
});

/** A native header on the page color. iOS 26 puts its back and bar buttons on Liquid Glass. */
const hostHeader = solidHeader();

/**
 * The navigation theme: dark, in the Night Watch colors. Native headers, glass bar buttons and
 * the tab bar read their appearance from it.
 */
const NAV_THEME = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.bg,
    card: colors.card,
    text: colors.text,
    border: colors.divider,
    notification: colors.status.blocked,
  },
};

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
      <ThemeProvider value={NAV_THEME}>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="hosts/discover" options={{ ...hostHeader, title: "Add host" }} />
        <Stack.Screen name="hosts/pair" options={{ ...hostHeader, title: "Pair" }} />
        <Stack.Screen name="hosts/scan" options={{ ...hostHeader, title: "Scan QR" }} />
        <Stack.Screen name="hosts/add" options={{ ...hostHeader, title: "Add manually" }} />
        <Stack.Screen name="hosts/password" options={{ ...hostHeader, title: "Set up with password" }} />
        <Stack.Screen name="hosts/update" options={{ ...hostHeader, title: "Update herdlingd" }} />
        <Stack.Screen name="hosts/ssh-help" options={{ ...hostHeader, title: "Turn on SSH" }} />
        <Stack.Screen name="hosts/boot-help" options={{ ...hostHeader, title: "Start at boot" }} />
        <Stack.Screen name="new" options={{ ...modalHeader, title: "New session" }} />
        <Stack.Screen name="resume/[hostId]/[paneId]" options={{ ...modalHeader, title: "Resume session" }} />
        <Stack.Screen name="speech-log" options={{ ...hostHeader, title: "Speech log" }} />
        <Stack.Screen name="select-text" options={{ ...modalHeader, title: "Select text" }} />
        {/* The session screen sets its own title view and bar buttons. */}
        <Stack.Screen name="session/[hostId]/[paneId]" options={{ ...hostHeader, title: "" }} />
        <Stack.Screen name="hosts/[id]" options={{ ...hostHeader, title: "Edit host" }} />
        <Stack.Screen name="tool" options={{ presentation: "modal", contentStyle: { backgroundColor: colors.bg } }} />
        <Stack.Screen
          name="peek/[hostId]/[paneId]"
          options={
            Platform.OS === "android"
              ? {
                  // Android lays out the sheet content at the largest detent, so at a lower detent the
                  // composer is off the screen. One detent keeps the composer visible. `card` lifts the sheet off the page.
                  presentation: "formSheet",
                  sheetAllowedDetents: [PEEK_DETENT_ANDROID],
                  sheetCornerRadius: 16,
                  contentStyle: { backgroundColor: colors.card },
                }
              : {
                  presentation: "formSheet",
                  sheetAllowedDetents: [0.6, 1],
                  sheetGrabberVisible: true,
                  // iOS 26 draws the sheet as Liquid Glass with the system corner radius; before, the page color.
                  ...(glassAvailable() ? {} : { sheetCornerRadius: 16 }),
                  contentStyle: { backgroundColor: glassAvailable() ? "transparent" : colors.bg },
                }
          }
        />
      </Stack>
      </ThemeProvider>
      <NotificationRouting />
      <UpdateChecks />
      <NativeSheetHost />
      <NoticeHost />
    </GestureHandlerRootView>
  );
}
