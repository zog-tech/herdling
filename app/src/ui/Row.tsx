import type { ReactNode } from "react";
import { Pressable, View } from "react-native";

import { colors, hitTarget, space } from "@/theme/tokens";

type Props = {
  children: ReactNode;
  /** Right-aligned content. */
  trailing?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
};

/** List row, at least 44pt high. Pressable when `onPress` is set. */
export function Row({ children, trailing, onPress, accessibilityLabel }: Props) {
  const content = (
    <>
      <View style={{ flex: 1, gap: space.xs }}>{children}</View>
      {trailing}
    </>
  );
  const style = { minHeight: hitTarget, flexDirection: "row", alignItems: "center", gap: space.md } as const;
  if (!onPress) return <View style={style}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [style, pressed && { backgroundColor: colors.muted }]}
    >
      {content}
    </Pressable>
  );
}
