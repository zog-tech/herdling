import { ChevronRight } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, View, type AccessibilityActionEvent, type AccessibilityActionInfo } from "react-native";

import { colors, hitTarget, icon, space } from "@/theme/tokens";

import { useInGroup } from "./Group";
import { Text } from "./Text";

type Props = {
  /** Free content of the text column. With `title` it goes under the title and the detail. */
  children?: ReactNode;
  /** The row title: plain body text. */
  title?: string;
  /** One plain-language line under the title, in the muted color. */
  detail?: string;
  /** Title in the danger color (a destructive row). */
  destructive?: boolean;
  /** Left of the text, for example a status dot. */
  leading?: ReactNode;
  /** Right-aligned content: a switch, a value, a small button. */
  trailing?: ReactNode;
  /** A muted chevron at the end: the row opens a screen. */
  chevron?: boolean;
  /** Full-width content under the text, for example a segmented control. */
  below?: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityActions?: AccessibilityActionInfo[];
  onAccessibilityAction?: (e: AccessibilityActionEvent) => void;
};

/**
 * List row, at least 44 pt high: title, one detail line, the control on the right. Pressable when
 * `onPress` is set (pressed: the `raised` fill). Inside a `Group` it pads itself to the band inset.
 */
export function Row({
  children,
  title,
  detail,
  destructive,
  leading,
  trailing,
  chevron,
  below,
  onPress,
  onLongPress,
  accessibilityLabel,
  accessibilityHint,
  accessibilityActions,
  onAccessibilityAction,
}: Props) {
  const inGroup = useInGroup();
  const content = (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        {leading}
        <View style={{ flex: 1, gap: 2 }}>
          {title ? <Text color={destructive ? colors.danger : undefined}>{title}</Text> : null}
          {detail ? (
            <Text variant="small" muted>
              {detail}
            </Text>
          ) : null}
          {children}
        </View>
        {trailing}
        {chevron ? <ChevronRight size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} /> : null}
      </View>
      {below}
    </>
  );
  const style = {
    minHeight: hitTarget,
    justifyContent: "center",
    gap: space.md,
    paddingHorizontal: inGroup ? space.lg : 0,
    paddingVertical: inGroup ? space.md : 0,
  } as const;
  if (!onPress) return <View style={style}>{content}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [style, pressed && { backgroundColor: colors.raised }]}
    >
      {content}
    </Pressable>
  );
}
