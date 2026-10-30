import type { AgentStatus } from "@zogssh/protocol";
import { Check, CircleHelp, CircleSlash, Hand, Loader } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { View } from "react-native";

import { colors, radius, space } from "@/theme/tokens";
import { Text } from "./Text";

export type BadgeStatus = AgentStatus | "offline";

const META = {
  working: { label: "Working", color: colors.status.working, Icon: Loader },
  blocked: { label: "Needs you", color: colors.status.blocked, Icon: Hand },
  idle: { label: "Idle", color: colors.status.idle, Icon: Check },
  done: { label: "Done", color: colors.status.done, Icon: Check },
  unknown: { label: "Unknown", color: colors.status.unknown, Icon: CircleHelp },
  offline: { label: "Offline", color: colors.textMuted, Icon: CircleSlash },
} as const;

export function statusLabel(status: BadgeStatus): string {
  return META[status].label;
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
  return <Badge {...META[status]} />;
}
