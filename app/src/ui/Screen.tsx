import type { ReactNode } from "react";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, space } from "@/theme/tokens";

/**
 * Scrolling page on the app background. Pass `top` when no navigation header covers the status bar
 * (the tab headers do, the add-host modal does not).
 */
export function Screen({ children, top }: { children: ReactNode; top?: boolean }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        padding: space.lg,
        gap: space.lg,
        paddingTop: space.lg + (top ? insets.top : 0),
        paddingBottom: space.lg + insets.bottom,
      }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      {children}
    </ScrollView>
  );
}
