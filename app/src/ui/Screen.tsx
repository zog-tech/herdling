import { useState, type ReactNode } from "react";
import { ScrollView, View, type ScrollViewProps } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, space } from "@/theme/tokens";

import { ActionBarSpaceContext } from "./ActionBar";
import { screenBottomPadding } from "./screenInsets";

/**
 * The screen skeleton (design rule 4): a scrolling page on `bg` under the native header.
 *
 * - Side inset `space.lg`. `flush`: no side inset, for full-width grouped bands (`Section` +
 *   `Group`); the gap between sections is then `space.xl`.
 * - The header covers the top safe area (`contentInsetAdjustmentBehavior="automatic"`).
 * - The last content ends `space.xl` above the bottom: above the home indicator, the tab bar (each
 *   iOS tab has its own safe area, which includes the tab bar), and the `footer` bar.
 * - `footer`: a `ui/ActionBar`. It is pinned at the bottom, and the content ends above it.
 *
 * ```tsx
 * <Screen flush footer={<ActionBar primary={{ label: "Pair", onPress: pair }} />}>
 *   <Section title="Computer"><Group>…</Group></Section>
 * </Screen>
 * ```
 *
 * A screen with its own list (`FlatList`) uses `useScreenBottomPadding()` for the same end inset.
 */
export function Screen({
  children,
  refreshControl,
  flush,
  footer,
}: {
  children: ReactNode;
  refreshControl?: ScrollViewProps["refreshControl"];
  flush?: boolean;
  /** A `ui/ActionBar`, pinned at the bottom. */
  footer?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const [barSpace, setBarSpace] = useState(0);
  const scroll = (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        paddingHorizontal: flush ? 0 : space.lg,
        gap: flush ? space.xl : space.lg,
        paddingTop: space.lg,
        paddingBottom: screenBottomPadding({ safeBottom: insets.bottom, barSpace: footer ? barSpace : 0 }),
      }}
      contentInsetAdjustmentBehavior="automatic"
      refreshControl={refreshControl}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      // iOS: the keyboard adds to the bottom inset, so a focused field near the bottom can scroll above it.
      automaticallyAdjustKeyboardInsets
    >
      {children}
    </ScrollView>
  );
  if (!footer) return scroll;
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {scroll}
      <ActionBarSpaceContext.Provider value={setBarSpace}>{footer}</ActionBarSpaceContext.Provider>
    </View>
  );
}

/** The bottom padding of a screen's own scroll content (a `FlatList`): the same end inset as `Screen`. */
export function useScreenBottomPadding(barSpace = 0): number {
  return screenBottomPadding({ safeBottom: useSafeAreaInsets().bottom, barSpace });
}
