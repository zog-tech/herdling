import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";

import { colors, radius, space } from "@/theme/tokens";

/**
 * A quiet block of content: one fill, no edge. Lists use `Group` and `Row`; a card is for a block
 * that is not a list (a form, a command to copy).
 */
export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <View
      style={[
        {
          backgroundColor: colors.card,
          borderRadius: radius.lg,
          padding: space.lg,
          gap: space.md,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
