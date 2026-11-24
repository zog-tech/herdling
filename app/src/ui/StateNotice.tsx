import type { LucideIcon } from "lucide-react-native";
import { View } from "react-native";

import { colors, icon, space } from "@/theme/tokens";

import { Button } from "./Button";
import { Text } from "./Text";

/**
 * An empty, error or offline state: an icon, one sentence that says what is true, and an action
 * when one exists (Retry, Add a computer) as a secondary `Button`. Announced politely to VoiceOver.
 *
 * - Default: the empty state of a screen or a list (design rule 4). It takes the full width, adds
 *   the screen side inset, and centers itself in the free height of its parent (`flexGrow`). The
 *   caller needs no wrapper.
 * - `inline`: one line inside a band (`Group` + `Pad`) or a banner: the icon, the sentence and the
 *   action in a row, with no inset of its own.
 */
export function StateNotice({
  Icon,
  message,
  color = colors.textMuted,
  action,
  onAction,
  inline,
}: {
  Icon: LucideIcon;
  message: string;
  color?: string;
  action?: string;
  onAction?: () => void;
  inline?: boolean;
}) {
  const button = action && onAction ? <Button label={action} variant="secondary" onPress={onAction} /> : null;
  if (inline) {
    return (
      <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
        <Icon size={icon.sm} color={color} strokeWidth={icon.strokeWidth} />
        <Text variant="small" color={color} style={{ flex: 1 }}>
          {message}
        </Text>
        {button}
      </View>
    );
  }
  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        alignSelf: "stretch",
        flexGrow: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.xl,
      }}
    >
      <Icon size={icon.lg} color={color} strokeWidth={icon.strokeWidth} />
      <Text color={color} style={{ textAlign: "center" }}>
        {message}
      </Text>
      {button}
    </View>
  );
}
