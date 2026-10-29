import { Bot, Check, CircleHelp, CircleX, Loader, type LucideIcon } from "lucide-react-native";
import { memo } from "react";
import { View } from "react-native";

import { colors, radius, space } from "@/theme/tokens";
import { Text } from "@/ui/Text";

/** Status words from the log mapped to icon + color (never color alone). */
function statusMeta(status: string): { color: string; Icon: LucideIcon } {
  const s = status.toLowerCase();
  if (/(running|working|pending|launched|started)/.test(s)) return { color: colors.status.working, Icon: Loader };
  if (/(completed|done|ok|success)/.test(s)) return { color: colors.status.done, Icon: Check };
  if (/(fail|error|killed|cancel)/.test(s)) return { color: colors.danger, Icon: CircleX };
  return { color: colors.textMuted, Icon: CircleHelp };
}

/** `async_launched` → `Async launched`. */
function statusLabel(status: string): string {
  const s = status.replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "Unknown";
}

/** A subagent run: description and status. Opening its own thread comes later (Phase 4). */
export const SubagentCard = memo(function SubagentCard({
  description,
  status,
  resultSummary,
}: {
  description: string;
  status: string;
  resultSummary?: string;
}) {
  const { color, Icon } = statusMeta(status);
  const label = statusLabel(status);
  return (
    <View
      accessible
      accessibilityLabel={`Subagent: ${description}. ${label}`}
      style={{
        borderWidth: 1,
        borderColor: colors.muted,
        backgroundColor: colors.card,
        borderRadius: radius.md,
        padding: space.md,
        gap: space.xs,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
        <View style={{ paddingTop: 2 }}>
          <Bot size={16} color={colors.textMuted} />
        </View>
        <View style={{ flex: 1, gap: space.xs }}>
          <Text variant="small" bold numberOfLines={2}>
            {description || "Subagent"}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <Icon size={12} color={color} />
            <Text variant="caption" bold color={color}>
              {label}
            </Text>
          </View>
          {resultSummary ? (
            <Text variant="small" muted numberOfLines={3}>
              {resultSummary}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
});
