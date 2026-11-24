/**
 * The one icon button of the app (design rule 4): a 44 pt target with no fill and no edge.
 * - In a native stack header: pass it in `headerRight`; iOS 26 puts it on Liquid Glass. Use
 *   `size="header"` there, the same icon size as `CloseButton`. At most two at the right.
 * - In the session's own header row: `glass` draws a `GlassSurface` circle, the same look as the
 *   native header buttons (before iOS 26 and on Android: the `glassFallback` fill).
 * - In content (a row's "⋯", a dismiss, the filter field's close): the plain form, `size="md"`.
 * Pressed: `state.pressedOpacity` (the system glass response on iOS 26 glass). Disabled:
 * `state.disabledOpacity` and no action. `selected` paints the icon in the accent (the selected
 * state). `dot` draws a small badge at the top right, for example "a dev server is found".
 */
import type { LucideIcon } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View, type Insets, type StyleProp, type ViewStyle } from "react-native";

import { colors, hitTarget, icon, radius, space, state } from "@/theme/tokens";
import { GlassSurface, glassAvailable } from "@/ui/Glass";
import { Dot } from "@/ui/StatusDot";

export type IconButtonProps = {
  label: string;
  hint?: string;
  Icon?: LucideIcon;
  /** In place of the icon, for example a spinner. */
  children?: ReactNode;
  onPress: () => void;
  onLongPress?: () => void;
  /** `md` (20 pt) in content, `header` (22 pt) in a header row. */
  size?: "md" | "header";
  /** The icon color. Default `text`. `selected` overrides it with the accent. */
  color?: string;
  disabled?: boolean;
  busy?: boolean;
  /** The accent icon and `accessibilityState.selected`. */
  selected?: boolean;
  /** For a button that shows or hides a part: `accessibilityState.expanded`. */
  expanded?: boolean;
  /** A small badge at the top right. Say what it means in `label`. */
  dot?: boolean;
  /** A glass circle: only for the session's own header row (glass is never in content). */
  glass?: boolean;
  hitSlop?: number | Insets;
  style?: StyleProp<ViewStyle>;
};

export function IconButton({
  label,
  hint,
  Icon,
  children,
  onPress,
  onLongPress,
  size = "md",
  color = colors.text,
  disabled,
  busy,
  selected,
  expanded,
  dot,
  glass,
  hitSlop,
  style,
}: IconButtonProps) {
  const tint = selected ? colors.accent : color;
  const glyph = children ?? (Icon ? <Icon size={size === "header" ? icon.header : icon.md} color={tint} strokeWidth={icon.strokeWidth} /> : null);
  const systemGlass = glass && glassAvailable();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{
        disabled: !!disabled,
        ...(busy !== undefined ? { busy } : null),
        ...(selected !== undefined ? { selected } : null),
        ...(expanded !== undefined ? { expanded } : null),
      }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={hitSlop}
      style={[{ width: hitTarget, height: hitTarget, alignItems: "center", justifyContent: "center", opacity: disabled ? state.disabledOpacity : 1 }, style]}
    >
      {({ pressed }) => (
        <>
          {glass ? (
            <GlassSurface
              interactive
              pointerEvents="none"
              style={{
                width: hitTarget,
                height: hitTarget,
                borderRadius: radius.pill,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed && !systemGlass ? state.pressedOpacity : 1,
              }}
            >
              {glyph}
            </GlassSurface>
          ) : (
            <View style={{ opacity: pressed ? state.pressedOpacity : 1 }}>{glyph}</View>
          )}
          {dot ? (
            <Dot color={colors.text} style={{ position: "absolute", top: space.sm, right: space.sm }} />
          ) : null}
        </>
      )}
    </Pressable>
  );
}
