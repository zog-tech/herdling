import { Text as RNText, type TextProps } from "react-native";

import { fontFamily } from "@/theme/fonts";
import { colors, textRole, type } from "@/theme/tokens";

type Variant = "body" | "small" | "caption" | "title" | "heading" | "section";

/** Each variant is one text role from the tokens. */
const ROLE = {
  heading: textRole.largeTitle,
  title: textRole.title,
  body: textRole.body,
  small: textRole.callout,
  caption: textRole.caption,
  section: textRole.section,
} as const;

type Props = TextProps & {
  variant?: Variant;
  muted?: boolean;
  /** JetBrains Mono, for code, IDs and keys. */
  mono?: boolean;
  bold?: boolean;
  color?: string;
};

/**
 * System font (SF Pro) text in one of the token roles. Scales with Dynamic Type up to the role's
 * cap; a dense row can pass a lower `maxFontSizeMultiplier`.
 */
export function Text({ variant = "body", muted, mono, bold, color, style, maxFontSizeMultiplier, ...rest }: Props) {
  return (
    <RNText
      {...rest}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? ROLE[variant].maxScale}
      style={[textStyle({ variant, muted, bold, color }), mono && { fontFamily: bold ? fontFamily.monoBold : fontFamily.mono, fontWeight: undefined }, style]}
    />
  );
}

export type TextVariant = Variant;

/** The style of one text role, for a view that is not a `Text` (for example a read-only TextInput). */
export function textStyle({ variant = "body", muted, bold, color }: { variant?: Variant; muted?: boolean; bold?: boolean; color?: string }) {
  const role = ROLE[variant];
  const section = variant === "section";
  return {
    color: color ?? (muted || section ? colors.textMuted : colors.text),
    fontSize: role.size,
    lineHeight: Math.round(role.size * type.lineHeight.body),
    fontWeight: bold ? (role.weight === "700" ? "700" : "600") : role.weight,
    letterSpacing: "letterSpacing" in role ? role.letterSpacing : undefined,
    // Section headers read as small caps: uppercase with open tracking.
    textTransform: section ? "uppercase" : undefined,
  } as const;
}

/** The Dynamic Type cap of one text role. */
export const maxScaleOf = (variant: Variant = "body") => ROLE[variant].maxScale;
