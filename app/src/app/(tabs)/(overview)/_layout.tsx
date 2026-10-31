import { Stack } from "expo-router";

import { transparentHeader } from "@/ui/headerOptions";

/** The Overview tab: the summary at the top is the headline, so the title stays small. */
export default function OverviewLayout() {
  return (
    <Stack screenOptions={transparentHeader()}>
      <Stack.Screen name="index" options={{ title: "Overview" }} />
    </Stack>
  );
}
