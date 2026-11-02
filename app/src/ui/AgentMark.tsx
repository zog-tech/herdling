import { View } from "react-native";
import Svg, { Path } from "react-native-svg";

import { colors, denseScale, radius } from "@/theme/tokens";

import { AGENT_LOGOS } from "./agentLogos";
import { Text } from "./Text";

/** Letters for the kinds with a mark of their own. Other kinds use their first two letters. */
const LETTERS: Record<string, string> = { claude: "Cl", codex: "Cx", pi: "π", opencode: "oc", omp: "om", gemini: "Ge" };

/**
 * The value of `key` in `table`, only when the table has that key itself. A kind such as
 * "constructor" must not find a property of `Object.prototype`.
 */
function own<T>(table: Record<string, T>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

/** The kind as a trimmed text. herdr sends no kind (null) while it has not detected the agent yet. */
const kindText = (kind: string | null | undefined): string => (kind ?? "").trim();

export function agentLetters(kind: string | null | undefined): string {
  const k = kindText(kind);
  return own(LETTERS, k) ?? k.charAt(0).toUpperCase() + k.charAt(1);
}

export function agentTint(kind: string | null | undefined): string {
  return own<string>(colors.agent, kindText(kind)) ?? colors.agent.other;
}

/** The logo covers this part of the tile. */
const LOGO_SHARE = 0.6;

/**
 * The mark of an agent kind on a `raised` tile: the logo of the tool in the agent's tint, or, for a
 * kind with no logo (see `agentLogos`), one or two letters. The mark only tells the agents apart
 * next to their name. Hidden from VoiceOver, because the name is always next to it. With no kind (a
 * new agent that herdr has not detected yet), the tile stays empty.
 */
export function AgentMark({ kind, size = 24 }: { kind: string | null | undefined; size?: number }) {
  const logo = own(AGENT_LOGOS, kindText(kind));
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
