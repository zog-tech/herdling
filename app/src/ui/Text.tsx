import { Text as RNText, type TextProps } from "react-native";

import { fontFamily } from "@/theme/fonts";
import { colors, type } from "@/theme/tokens";

type Variant = "body" | "small" | "caption" | "title" | "heading";

type Props = TextProps & {
  variant?: Variant;
  muted?: boolean;
  /** JetBrains Mono, for code, IDs and keys. */
  mono?: boolean;
  bold?: boolean;
  color?: string;
};

/** System font (SF Pro) text with token sizes. Scales with Dynamic Type. */
export function Text({ variant = "body", muted, mono, bold, color, style, ...rest }: Props) {
  const size = type.size[variant];
  return (
    <RNText
      {...rest}
      style={[
        {
          color: color ?? (muted ? colors.textMuted : colors.text),
          fontSize: size,
          lineHeight: Math.round(size * type.lineHeight.body),
          fontWeight: bold || variant === "title" || variant === "heading" ? "600" : "400",
        },
        mono && { fontFamily: bold ? fontFamily.monoBold : fontFamily.mono, fontWeight: undefined },
        style,
      ]}
    />
  );
}
