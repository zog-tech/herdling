import type { LucideIcon } from "lucide-react-native";
import { Pressable, type StyleProp, type ViewStyle } from "react-native";

import { colors, hitTarget, icon, radius, state } from "@/theme/tokens";

import { GlassSurface, glassAvailable } from "./Glass";
import { Text } from "./Text";

type Props = {
  /** Read by VoiceOver. With `title`, also the visible text. */
  label: string;
  onPress: () => void;
  Icon?: LucideIcon;
  /** Visible text: makes a capsule instead of a circle. */
  title?: string;
  /** Gold glass for the primary action. */
  primary?: boolean;
  /** Diameter of the circle (or the height of the capsule). At least 44. */
  size?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
  /** The button sits on a glass sheet: a solid raised fill instead of glass. */
  onGlass?: boolean;
};

/**
 * A round (or capsule) button on Liquid Glass. Liquid Glass gives its own press response; the
 * fallback dims to `state.pressedOpacity`, or deepens the gold for the primary button.
 */
export function GlassButton({ label, onPress, Icon, title, primary, size = hitTarget, disabled, style, accessibilityHint, onGlass }: Props) {
  const fg = primary ? colors.onAccent : colors.text;
  const glass = glassAvailable() && !onGlass;
  const d = Math.max(size, hitTarget);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={4}
      style={[{ opacity: disabled ? state.disabledOpacity : 1 }, style]}
    >
      {({ pressed }) => (
        <GlassSurface
          interactive
          solid={onGlass}
          tint={primary ? colors.accent : undefined}
          fallback={primary ? (pressed ? colors.accentPressed : colors.accent) : onGlass ? colors.raisedHigh : undefined}
          pointerEvents="none"
          style={{
            height: d,
            minWidth: d,
            paddingHorizontal: title ? d / 2.6 : 0,
            borderRadius: radius.pill,
            flexDirection: "row",
            gap: 6,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed && !glass && !primary ? state.pressedOpacity : 1,
          }}
        >
          {Icon ? <Icon size={d >= 52 ? icon.lg + 2 : icon.md} color={fg} strokeWidth={icon.strokeWidth} /> : null}
          {title ? (
            <Text variant="small" bold color={fg} maxFontSizeMultiplier={1.4}>
              {title}
            </Text>
          ) : null}
        </GlassSurface>
      )}
    </Pressable>
  );
}
