import type { ReactNode } from "react";
import { ScrollView, type ScrollViewProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, space } from "@/theme/tokens";

/**
 * Scrolling page on the app background. Navigation headers cover the top safe area; the content
 * insets follow the header and the tab bar. `flush`: no side padding, for full-width grouped bands.
 */
export function Screen({
  children,
  refreshControl,
  flush,
}: {
  children: ReactNode;
  refreshControl?: ScrollViewProps["refreshControl"];
  flush?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        paddingHorizontal: flush ? 0 : space.lg,
        gap: flush ? space.xl : space.lg,
        paddingTop: space.lg,
        paddingBottom: space.xl + insets.bottom,
      }}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={refreshControl}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
    >
      {children}
    </ScrollView>
  );
}
