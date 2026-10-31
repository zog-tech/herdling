import { Bot, Check, ChevronRight, CircleHelp, CircleX, Loader, type LucideIcon } from "lucide-react-native";
import { useRouter } from "expo-router";
import { memo } from "react";
import { Pressable, View } from "react-native";

import { colors, radius, space } from "@/theme/tokens";
import { formatDuration, spokenDuration } from "@/ui/format";
import { LanternGlow } from "@/ui/LanternGlow";
import { Text } from "@/ui/Text";
import { TickingDuration } from "@/ui/TickingDuration";
import { TopHighlight } from "@/ui/TopHighlight";
import { useThreadLog } from "../ThreadLogContext";
import { shownSummary } from "../subagentState";

const ICON = 16;

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

const tools = (n: number) => `${n} tool${n === 1 ? "" : "s"}`;

/**
 * A subagent run. While it runs: the lantern glow, "Running", a ticking clock, its tool count and
 * its latest step. When it stops: the status, how long it took and its summary. Tapping opens its
 * own thread once `agentId` is known, also while it runs. VoiceOver hears the description, the
 * status and the tool count, not each new step.
 */
export const SubagentCard = memo(function SubagentCard({
  description,
  status,
  resultSummary,
  agentId,
  startedAt,
  finishedAt,
  activity,
  toolCount,
}: {
  description: string;
  status: string;
  resultSummary?: string;
  agentId?: string;
  startedAt?: number;
  finishedAt?: number;
  activity?: string;
  toolCount?: number;
}) {
  const router = useRouter();
  const threadLog = useThreadLog();
  const canOpen = Boolean(agentId && threadLog);
  const running = status === "running";
  const { color, Icon } = statusMeta(status);
  const label = statusLabel(status);
  const summary = running ? undefined : shownSummary(resultSummary);
  const tookS = !running && startedAt && finishedAt && finishedAt >= startedAt ? (finishedAt - startedAt) / 1000 : undefined;
  const spoken = [label, tookS !== undefined ? `took ${spokenDuration(tookS)}` : null, toolCount ? tools(toolCount) : null]
    .filter(Boolean)
    .join(", ");
  return (
    <Pressable
      accessible
      accessibilityRole={canOpen ? "button" : undefined}
      accessibilityLabel={`Subagent: ${description}. ${spoken}`}
      accessibilityHint={canOpen ? "Opens the subagent thread" : undefined}
      disabled={!canOpen}
      onPress={() =>
        threadLog &&
        agentId &&
        router.push({
          pathname: "/subagent/[hostId]/[agentId]",
          params: {
            hostId: threadLog.hostId,
            agentId,
            log: threadLog.logPath,
            title: description,
            ...(startedAt ? { since: String(startedAt) } : {}),
          },
        } as never)
      }
      style={({ pressed }) => ({
        borderWidth: 1,
        borderColor: colors.edge,
        backgroundColor: pressed && canOpen ? colors.raised : colors.card,
        borderRadius: radius.md,
        padding: space.md,
        gap: space.xs,
      })}
    >
      <TopHighlight inset={radius.md} />
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
        <View style={{ paddingTop: 2 }}>
          <View style={{ width: ICON, height: ICON }}>
            <LanternGlow active={running} size={ICON} />
            <Bot size={ICON} color={running ? colors.status.working : colors.textMuted} />
          </View>
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
            {running && startedAt ? <TickingDuration since={startedAt} accessible={false} /> : null}
            {tookS !== undefined ? (
              <Text variant="caption" muted>
                {formatDuration(tookS)}
              </Text>
            ) : null}
            {toolCount ? (
              <Text variant="caption" muted numberOfLines={1}>
                {`· ${tools(toolCount)}`}
              </Text>
            ) : null}
          </View>
          {running && activity ? (
            <Text variant="caption" muted numberOfLines={1}>
              {activity}
            </Text>
          ) : null}
          {summary ? (
            <Text variant="small" muted numberOfLines={3}>
              {summary}
            </Text>
          ) : null}
        </View>
        {canOpen ? (
          <View style={{ alignSelf: "center" }}>
            <ChevronRight size={18} color={colors.textMuted} />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
});
