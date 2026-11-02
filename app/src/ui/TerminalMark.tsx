import { SquareTerminal } from "lucide-react-native";
import { View } from "react-native";

import { colors, icon, radius } from "@/theme/tokens";

/** The icon covers this part of the tile, as the logo does in `AgentMark`. */
const ICON_SHARE = 0.7;

/**
 * The mark of a terminal (a pane with no agent): a terminal icon on the same `raised` tile as
 * `AgentMark`, so terminals and agents line up. Hidden from VoiceOver: the name is always next to it.
 */
export function TerminalMark({ size = 24, color = colors.agent.other }: { size?: number; color?: string }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, borderRadius: radius.sm, backgroundColor: colors.raised, alignItems: "center", justifyContent: "center" }}
    >
      <SquareTerminal size={Math.round(size * ICON_SHARE)} color={color} strokeWidth={icon.strokeWidth} />
    </View>
  );
}
