import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { startDemo } from "@/demo/demoHost";
import { colors } from "@/theme/tokens";

/**
 * Deep link `herdling://demo`: adds the demo host (when it is not saved yet) and opens the Overview.
 * For App Review notes: one tap starts the demo.
 */
export default function DemoLink() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void startDemo().then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);
  if (ready) return <Redirect href="/" />;
  return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
}
