import type { ReactNode } from "react";
import { View, type ViewStyle } from "react-native";

import { colors, radius, space } from "@/theme/tokens";

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return (
    <View
      style={[
        {
          backgroundColor: colors.card,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.divider,
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
