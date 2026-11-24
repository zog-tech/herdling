import { View, type StyleProp, type ViewStyle } from "react-native";

import { denseScale, dot, space } from "@/theme/tokens";

import { LanternGlow } from "./LanternGlow";
import { Text } from "./Text";

/**
 * The one small round dot of the app (`dot.size`): a status, an online mark, an attention mark, a
 * badge. Hidden from VoiceOver: the caller says its meaning in a word or a label.
 */
export function Dot({ color, style }: { color: string; style?: StyleProp<ViewStyle> }) {
  return <View importantForAccessibility="no" style={[{ width: dot.size, height: dot.size, borderRadius: dot.size / 2, backgroundColor: color }, style]} />;
}

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
      style={{ flexDirection: "row", alignItems: "center", gap: space.xs + space.xxs, flexShrink: 1 }}
    >
      <View style={{ width: dot.size, height: dot.size }}>
        <LanternGlow active={!!lit} size={dot.size} />
        <Dot color={color} />
      </View>
      <Text variant="caption" bold={!quiet} muted={quiet} color={quiet ? undefined : color} numberOfLines={1} maxFontSizeMultiplier={denseScale.pill}>
        {label}
      </Text>
    </View>
  );
}
