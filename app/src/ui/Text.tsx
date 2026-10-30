import { Text as RNText, type TextProps } from "react-native";

import { fontFamily } from "@/theme/fonts";
import { colors, textRole, type } from "@/theme/tokens";

type Variant = "body" | "small" | "caption" | "title" | "heading";

/** Each variant is one text role from the tokens. */
const ROLE = {
  heading: textRole.largeTitle,
  title: textRole.title,
  body: textRole.body,
  small: textRole.callout,
  caption: textRole.caption,
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
  const role = ROLE[variant];
  return (
    <RNText
      {...rest}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? role.maxScale}
      style={[
        {
          color: color ?? (muted ? colors.textMuted : colors.text),
          fontSize: role.size,
          lineHeight: Math.round(role.size * type.lineHeight.body),
          fontWeight: bold ? (role.weight === "700" ? "700" : "600") : role.weight,
        },
        mono && { fontFamily: bold ? fontFamily.monoBold : fontFamily.mono, fontWeight: undefined },
        style,
      ]}
    />
  );
}
