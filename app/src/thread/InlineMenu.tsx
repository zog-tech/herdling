/**
 * A menu that opens in place above the composer (the "+" menu, the command list while the user
 * types `/name`). It uses the rows of the menu sheet (`MenuRow` of `ui/MenuSheet`), so the app has
 * one menu look: a `card` surface with the top highlight, radius `lg`, and rows split by inset
 * hairlines. It is not a bottom sheet: the keyboard stays up and the box keeps its text.
 * `maxHeight`: the list scrolls inside past it. Taps do not close the keyboard.
 */
import { Children, type ReactNode } from "react";
import { ScrollView, View } from "react-native";

import { colors, radius } from "@/theme/tokens";
import { Divider } from "@/ui/Group";
import { TopHighlight } from "@/ui/TopHighlight";

export function InlineMenu({ label, maxHeight, children }: { label: string; maxHeight?: number; children: ReactNode }) {
  const rows = Children.toArray(children);
  const body = rows.map((row, i) => (
    <View key={i}>
      {i > 0 ? <Divider /> : null}
      {row}
    </View>
  ));
  return (
    <View accessibilityLabel={label} style={{ maxHeight, backgroundColor: colors.card, borderRadius: radius.lg, overflow: "hidden" }}>
      <TopHighlight inset={radius.lg} />
      {maxHeight ? <ScrollView keyboardShouldPersistTaps="always">{body}</ScrollView> : body}
    </View>
  );
}
