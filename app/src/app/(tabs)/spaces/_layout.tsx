import { Stack } from "expo-router";

import { solidHeader, tabHeader } from "@/ui/headerOptions";

export default function SpacesLayout() {
  return (
    <Stack screenOptions={tabHeader()}>
      <Stack.Screen name="index" options={{ title: "Spaces" }} />
      {/*
        The space screen sets its title to the space name. `solidHeader` does not reset the large
        title and the transparent bar of `tabHeader`, so this screen turns them off here. Else the
        empty large title hides the name, and the content slides under the bar.
      */}
      <Stack.Screen
        name="[hostId]/[workspaceId]"
        options={{ ...solidHeader(), headerLargeTitle: false, headerTransparent: false, headerBlurEffect: undefined, title: "" }}
      />
    </Stack>
  );
}
