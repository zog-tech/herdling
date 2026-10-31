import { View } from "react-native";

import { colors, denseScale, radius } from "@/theme/tokens";

import { Text } from "./Text";

/** Letters for the kinds with a mark of their own. Other kinds use their first two letters. */
const LETTERS: Record<string, string> = { claude: "Cl", codex: "Cx", pi: "π", opencode: "oc", omp: "om", gemini: "Ge" };

export function agentLetters(kind: string): string {
  return LETTERS[kind] ?? kind.charAt(0).toUpperCase() + kind.charAt(1);
}

export function agentTint(kind: string): string {
  return kind in colors.agent ? colors.agent[kind as keyof typeof colors.agent] : colors.agent.other;
}

/**
 * The mark of an agent kind: one or two letters in the agent's tint on a `raised` tile. No brand
 * logos: the mark only tells the agents apart next to their name. Hidden from VoiceOver, because
 * the name is always next to it.
 */
export function AgentMark({ kind, size = 24 }: { kind: string; size?: number }) {
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
      <Text variant="caption" bold color={agentTint(kind)} maxFontSizeMultiplier={denseScale.pill} numberOfLines={1}>
        {agentLetters(kind)}
      </Text>
    </View>
  );
}
