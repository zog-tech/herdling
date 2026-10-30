import { Bot, Check, CircleHelp, CircleX, Loader, type LucideIcon } from "lucide-react-native";
import { useRouter } from "expo-router";
import { memo } from "react";
import { Pressable, View } from "react-native";

import { colors, radius, space } from "@/theme/tokens";
import { Text } from "@/ui/Text";
import { useThreadLog } from "../ThreadLogContext";

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

/** A subagent run: description and status. Tapping opens its own thread once `agentId` is known. */
export const SubagentCard = memo(function SubagentCard({
  description,
  status,
  resultSummary,
  agentId,
}: {
  description: string;
  status: string;
  resultSummary?: string;
  agentId?: string;
}) {
  const router = useRouter();
  const threadLog = useThreadLog();
  const canOpen = Boolean(agentId && threadLog);
  const { color, Icon } = statusMeta(status);
  const label = statusLabel(status);
  return (
    <Pressable
      accessible
      accessibilityRole={canOpen ? "button" : undefined}
      accessibilityLabel={`Subagent: ${description}. ${label}`}
      accessibilityHint={canOpen ? "Opens the subagent thread" : undefined}
      disabled={!canOpen}
      onPress={() =>
        threadLog &&
        agentId &&
        router.push({
          pathname: "/subagent/[hostId]/[agentId]",
          params: { hostId: threadLog.hostId, agentId, log: threadLog.logPath, title: description },
        } as never)
      }
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
    </Pressable>
  );
});
