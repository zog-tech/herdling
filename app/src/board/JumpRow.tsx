/**
 * One task of "Jump to a terminal": the group tile, the group and branch, the task and its place,
 * the status, and its helpers under it with a tree line. A tap on the task or a helper opens it.
 * Pressed: the row fill steps up to `raised`, as every row in a list does.
 */
import { SquareTerminal } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";

import { statusMeta as agentStatusMeta } from "@/ui/StatusIcon";
import { colors, denseScale, hitTarget, icon, space } from "@/theme/tokens";
import { GroupTile } from "@/ui/GroupTile";
import { StatusDot } from "@/ui/StatusDot";
import { Text } from "@/ui/Text";

import { jumpDetail, type JumpTask } from "./jump";

const TILE = 28;

function Status({ status }: { status: JumpTask["status"] }) {
  if (status === "terminal") return <SquareTerminal size={icon.sm} color={colors.textMuted} strokeWidth={icon.strokeWidth} />;
  const m = agentStatusMeta(status);
  return <StatusDot label={m.label} color={m.color} lit={status === "working"} quiet={status === "idle" || status === "unknown"} />;
}

export function JumpRow({ task, multiHost, onOpen }: { task: JumpTask; multiHost: boolean; onOpen: (paneId: string) => void }) {
  const detail = jumpDetail(task, multiHost);
  const head = [task.group, task.branch].filter(Boolean).join(" · ");
  return (
    <View style={{ paddingVertical: space.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={[head, task.title, detail].filter(Boolean).join(", ")}
        accessibilityHint="Opens the session"
        onPress={() => onOpen(task.paneId)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          minHeight: hitTarget,
          paddingHorizontal: space.lg,
          backgroundColor: pressed ? colors.raised : "transparent",
        })}
      >
        {task.group ? (
          <GroupTile name={task.group} size={TILE} />
        ) : (
          <View style={{ width: TILE, height: TILE, alignItems: "center", justifyContent: "center" }}>
            <SquareTerminal size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
          </View>
        )}
        <View style={{ flex: 1, gap: 2 }}>
          {head ? (
            <Text variant="small" bold numberOfLines={1} maxFontSizeMultiplier={denseScale.row}>
              {head}
            </Text>
          ) : null}
          <Text variant="small" numberOfLines={1} maxFontSizeMultiplier={denseScale.row}>
            {task.title}
            {detail ? <Text variant="small" muted>{`  ${detail}`}</Text> : null}
          </Text>
        </View>
        <Status status={task.status} />
      </Pressable>
      {task.helpers.map((h, i) => (
        <Pressable
          key={h.paneId}
          accessibilityRole="button"
          accessibilityLabel={`Helper ${h.title}, ${agentStatusMeta(h.status).label}`}
          onPress={() => onOpen(h.paneId)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            minHeight: hitTarget,
            paddingHorizontal: space.lg,
            backgroundColor: pressed ? colors.raised : "transparent",
          })}
        >
          {/* The tree line: from the tile of the task down to each helper. */}
          <View style={{ width: TILE, alignSelf: "stretch", alignItems: "center" }}>
            <View
              style={{
                position: "absolute",
                top: 0,
                bottom: i === task.helpers.length - 1 ? "50%" : 0,
                width: StyleSheet.hairlineWidth * 2,
                backgroundColor: colors.divider,
              }}
            />
          </View>
          <View style={{ width: space.md, height: StyleSheet.hairlineWidth * 2, backgroundColor: colors.divider }} />
          <Text variant="small" muted numberOfLines={1} maxFontSizeMultiplier={denseScale.row} style={{ flex: 1, marginLeft: space.sm }}>
            {h.title}
          </Text>
          <Status status={h.status} />
        </Pressable>
      ))}
    </View>
  );
}
