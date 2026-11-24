import { Stack } from "expo-router";

import { transparentHeader } from "@/ui/headerOptions";

/**
 * The Agents tab (route `(overview)`): the summary at the top is the headline, so the title stays
 * small. The route name stays, so deep links and push routing do not change.
 */
export default function OverviewLayout() {
  return (
    <Stack screenOptions={transparentHeader()}>
      <Stack.Screen name="index" options={{ title: "Agents" }} />
    </Stack>
  );
}
