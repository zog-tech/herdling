import type { LucideIcon } from "lucide-react-native";
import { View } from "react-native";

import { radius, space } from "@/theme/tokens";
import { STATUS_META, type BadgeStatus } from "./StatusIcon";
import { Text } from "./Text";

export type { BadgeStatus } from "./StatusIcon";

export function statusLabel(status: BadgeStatus): string {
  return STATUS_META[status].label;
}

type BadgeProps = { label: string; color: string; Icon: LucideIcon };

/** Pill with icon + label in one color. */
export function Badge({ label, color, Icon }: BadgeProps) {
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{
        flexDirection: "row",
        alignItems: "center",
        alignSelf: "flex-start",
        gap: space.xs,
        paddingHorizontal: space.sm,
        paddingVertical: space.xs,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: color,
      }}
    >
      <Icon size={14} color={color} />
      <Text variant="caption" color={color} bold maxFontSizeMultiplier={1.5}>
        {label}
      </Text>
    </View>
  );
}

/** Status as icon + label + color, never color alone. */
export function StatusBadge({ status }: { status: BadgeStatus }) {
  return <Badge {...STATUS_META[status]} />;
}
