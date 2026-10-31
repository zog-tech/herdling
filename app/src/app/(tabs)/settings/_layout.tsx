import { Stack } from "expo-router";

import { tabHeader } from "@/ui/headerOptions";

export default function SettingsLayout() {
  return (
    <Stack screenOptions={tabHeader()}>
      <Stack.Screen name="index" options={{ title: "Settings" }} />
    </Stack>
  );
}
