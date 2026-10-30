import { View } from "react-native";

import { colors } from "@/theme/tokens";

/**
 * The 1 pt top highlight of a card, like brushed metal under a lantern. Put it as the first child of
 * a card. It is inset by the corner radius, so it never draws over a rounded corner.
 */
export function TopHighlight({ inset }: { inset: number }) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ position: "absolute", top: 0, left: inset, right: inset, height: 1, backgroundColor: colors.hairline }}
    />
  );
}
