import { Stack } from "expo-router";

import { tabHeader, transparentHeader } from "@/ui/headerOptions";

/**
 * The More tab (route `settings`, so old links still work): the index with a large title, then one
 * page per topic in the same stack, so the tab bar stays. Usage, Automations and the deeper
 * screens (Theme, Key bar, Saved prompts, the logs) are root stack screens.
 */
/** The index sits under a page that opens from elsewhere (the computers button opens `/settings/computers`), so Back leads to More. */
export const unstable_settings = { initialRouteName: "index" };

export default function SettingsLayout() {
  // A page title stays small, as in the system Settings app.
  const page = { ...transparentHeader(), headerLargeTitle: false };
  return (
    <Stack screenOptions={tabHeader()}>
      <Stack.Screen name="index" options={{ title: "More" }} />
      <Stack.Screen name="computers" options={{ ...page, title: "Computers" }} />
      <Stack.Screen name="appearance" options={{ ...page, title: "Appearance" }} />
      <Stack.Screen name="voice" options={{ ...page, title: "Voice" }} />
      <Stack.Screen name="notifications" options={{ ...page, title: "Notifications" }} />
      <Stack.Screen name="terminal" options={{ ...page, title: "Terminal" }} />
      <Stack.Screen name="general" options={{ ...page, title: "General" }} />
      <Stack.Screen name="diagnostics" options={{ ...page, title: "Diagnostics" }} />
      <Stack.Screen name="about" options={{ ...page, title: "About" }} />
    </Stack>
  );
}
