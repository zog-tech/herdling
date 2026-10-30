import type { ReactNode } from "react";
import { ScrollView, type ScrollViewProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, space } from "@/theme/tokens";

/** Scrolling page on the app background. Navigation headers cover the top safe area. */
export function Screen({ children, refreshControl }: { children: ReactNode; refreshControl?: ScrollViewProps["refreshControl"] }) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        padding: space.lg,
        gap: space.lg,
        paddingTop: space.lg,
        paddingBottom: space.lg + insets.bottom,
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
