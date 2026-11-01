import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { colors, denseScale, radius } from "@/theme/tokens";

import { AGENT_LOGOS } from "./agentLogos";
import { Text } from "./Text";

/** Letters for the kinds with a mark of their own. Other kinds use their first two letters. */
const LETTERS: Record<string, string> = { claude: "Cl", codex: "Cx", pi: "π", opencode: "oc", omp: "om", gemini: "Ge" };

export function agentLetters(kind: string): string {
  return LETTERS[kind] ?? kind.charAt(0).toUpperCase() + kind.charAt(1);
}

export function agentTint(kind: string): string {
  return kind in colors.agent ? colors.agent[kind as keyof typeof colors.agent] : colors.agent.other;
}

/** The logo covers this part of the tile. */
const LOGO_SHARE = 0.6;

/**
 * The mark of an agent kind on a `raised` tile: the logo of the tool in the agent's tint, or, for a
 * kind with no logo (see `agentLogos`), one or two letters. The mark only tells the agents apart
 * next to their name. Hidden from VoiceOver, because the name is always next to it.
 */
export function AgentMark({ kind, size = 24 }: { kind: string; size?: number }) {
  const logo = AGENT_LOGOS[kind];
  const side = Math.round(size * LOGO_SHARE);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: radius.sm,
        backgroundColor: colors.raised,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {logo ? (
        <Svg width={side} height={side} viewBox={logo.viewBox}>
          <Path d={logo.path} fill={agentTint(kind)} />
        </Svg>
      ) : (
        <Text variant="caption" bold color={agentTint(kind)} maxFontSizeMultiplier={denseScale.pill} numberOfLines={1}>
          {agentLetters(kind)}
        </Text>
      )}
    </View>
  );
}
