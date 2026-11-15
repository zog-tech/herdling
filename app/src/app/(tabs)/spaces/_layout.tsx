import { Stack } from "expo-router";

import { solidHeader, tabHeader } from "@/ui/headerOptions";

export default function SpacesLayout() {
  return (
    <Stack screenOptions={tabHeader()}>
      <Stack.Screen name="index" options={{ title: "Spaces" }} />
      {/* The space screen sets its title to the space name. */}
      <Stack.Screen name="[hostId]/[workspaceId]" options={{ ...solidHeader(), title: "" }} />
    </Stack>
  );
}
