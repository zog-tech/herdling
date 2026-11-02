import { Bot, Check, ChevronRight, CircleHelp, CircleX, Loader, type LucideIcon } from "lucide-react-native";
import { useRouter } from "expo-router";
import { memo } from "react";
import { View } from "react-native";

import { colors, radius, space } from "@/theme/tokens";
import { formatDuration, spokenDuration } from "@/ui/format";
import { StatusGlyph } from "@/ui/StatusGlyph";
import { Text } from "@/ui/Text";
import { TickingDuration } from "@/ui/TickingDuration";
import { TopHighlight } from "@/ui/TopHighlight";
import { MenuPressable } from "../MenuPressable";
import { subagentCopyText } from "../rowMenu";
import { useThreadLog } from "../ThreadLogContext";
import { shownSummary, subagentHref } from "../subagentState";

const ICON = 16;
/** The status icon in front of "Running" or "Completed". */
const STATUS_ICON = 12;

/** Status words from the log mapped to icon + color (never color alone). */
export function statusMeta(status: string): { color: string; Icon: LucideIcon } {
  const s = status.toLowerCase();
  if (/(running|working|pending|launched|started)/.test(s)) return { color: colors.status.working, Icon: Loader };
  if (/(completed|done|ok|success)/.test(s)) return { color: colors.status.done, Icon: Check };
  if (/(fail|error|killed|cancel)/.test(s)) return { color: colors.danger, Icon: CircleX };
  return { color: colors.textMuted, Icon: CircleHelp };
}

/** `async_launched` → `Async launched`. */
export function statusLabel(status: string): string {
  const s = status.replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "Unknown";
}

export const tools = (n: number) => `${n} tool${n === 1 ? "" : "s"}`;

/**
 * A subagent run. While it runs: the working indicator of the Working pill (`StatusGlyph`),
 * "Running", a ticking clock, its tool count and its latest step. When it stops: the status, how long it took and its summary. Tapping opens its
 * own thread once `agentId` is known, also while it runs. VoiceOver hears the description, the
 * status and the tool count, not each new step. A long press opens the row menu: Copy (the
 * description and the summary) and Select text. It works also before the thread can open.
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
  const href = subagentHref(threadLog, { agentId, description, startedAt });
  const canOpen = Boolean(href);
  const running = status === "running";
  const { color, Icon } = statusMeta(status);
  const label = statusLabel(status);
  const summary = running ? undefined : shownSummary(resultSummary);
  const tookS = !running && startedAt && finishedAt && finishedAt >= startedAt ? (finishedAt - startedAt) / 1000 : undefined;
  const spoken = [label, tookS !== undefined ? `took ${spokenDuration(tookS)}` : null, toolCount ? tools(toolCount) : null]
    .filter(Boolean)
    .join(", ");
  return (
    <MenuPressable
      menu={{ kind: "subagent", text: subagentCopyText(description, summary) }}
      accessible
      accessibilityRole={canOpen ? "button" : undefined}
      accessibilityLabel={`Subagent: ${description}. ${spoken}`}
      accessibilityHint={canOpen ? "Opens the subagent thread" : undefined}
      // Not `disabled` when it cannot open: a disabled Pressable has no long press either.
      onPress={() => href && router.push(href as never)}
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
          <Bot size={ICON} color={running ? colors.status.working : colors.textMuted} />
        </View>
        <View style={{ flex: 1, gap: space.xs }}>
          <Text variant="small" bold numberOfLines={2}>
            {description || "Subagent"}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            {/* The same animated indicator as the Working pill; a stopped subagent has a static icon. */}
            {running ? <StatusGlyph status="working" size={STATUS_ICON} /> : <Icon size={STATUS_ICON} color={color} />}
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
    </MenuPressable>
  );
});
