import { View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { colors } from "@/theme/tokens";

/**
 * The horizon hairline: the 1 pt bottom edge of a main screen header. Gold at 35% on the left
 * fades to clear on the right. Main screens only.
 */
export function HorizonLine({ style }: { style?: object }) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[{ height: 1, alignSelf: "stretch" }, style]}
    >
      <Svg width="100%" height={1}>
        <Defs>
          <LinearGradient id="horizon" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={colors.accent} stopOpacity={colors.horizonOpacity} />
            <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="1" fill="url(#horizon)" />
      </Svg>
    </View>
  );
}
