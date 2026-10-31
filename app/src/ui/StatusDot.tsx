import { View } from "react-native";

import { denseScale, dot, space } from "@/theme/tokens";

import { LanternGlow } from "./LanternGlow";
import { Text } from "./Text";

/**
 * Status as a small dot and a word in one color: "● Working". The word carries the meaning, so
 * color is never the only cue. `lit`: the lantern glow breathes behind the dot (the working state).
 * `quiet`: the word is in the muted color and only the dot has the status color.
 */
export function StatusDot({ label, color, lit, quiet }: { label: string; color: string; lit?: boolean; quiet?: boolean }) {
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{ flexDirection: "row", alignItems: "center", gap: space.xs + 2, flexShrink: 1 }}
    >
      <View style={{ width: dot.size, height: dot.size }}>
        <LanternGlow active={!!lit} size={dot.size} />
        <View style={{ width: dot.size, height: dot.size, borderRadius: dot.size / 2, backgroundColor: color }} />
      </View>
      <Text variant="caption" bold={!quiet} muted={quiet} color={quiet ? undefined : color} numberOfLines={1} maxFontSizeMultiplier={denseScale.pill}>
        {label}
      </Text>
    </View>
  );
}
