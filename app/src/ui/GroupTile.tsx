import { View } from "react-native";

import { groupLetter, groupTone } from "@/board/tasks";
import { mix } from "@/theme/contrast";
import { colors, denseScale, radius } from "@/theme/tokens";

import { Text } from "./Text";

/** The share of the tone in the tile fill, over `card`. The theme test checks the letter contrast at this value. */
export const GROUP_TILE_FILL = 0.18;

/** The tone of a group: one stable color per group name (`colors.groupTile`). */
export function groupColor(name: string): string {
  const tones = colors.groupTile;
  return tones[groupTone(name, tones.length)] ?? colors.textMuted;
}

/**
 * The letter tile of a Herdr 2 group: the first letter of the group in its tone, on the tone at
 * 18% over `card`. It only tells the groups apart next to their name, so VoiceOver skips it.
 */
export function GroupTile({ name, size = 24 }: { name: string; size?: number }) {
  const tone = groupColor(name);
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: radius.sm,
        backgroundColor: mix(tone, colors.card, GROUP_TILE_FILL),
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text variant="caption" bold color={tone} maxFontSizeMultiplier={denseScale.pill} numberOfLines={1}>
        {groupLetter(name)}
      </Text>
    </View>
  );
}
