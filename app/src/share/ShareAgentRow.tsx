/**
 * One agent in the list of the share screen: the group tile, the group and branch, the task, its
 * place and its status, as in "Jump to a terminal". A tap selects it; the selected row has a gold check.
 */
import { CircleCheck, Circle, SquareTerminal } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { jumpDetail, type JumpTask } from "@/board/jump";
import { colors, denseScale, hitTarget, icon, space, state } from "@/theme/tokens";
import { GroupTile } from "@/ui/GroupTile";
import { StatusDot } from "@/ui/StatusDot";
import { statusMeta } from "@/ui/StatusIcon";
import { Text } from "@/ui/Text";

const TILE = 28;

export function ShareAgentRow({
  task,
  multiHost,
  selected,
  disabled,
  onSelect,
}: {
  task: JumpTask;
  multiHost: boolean;
  selected: boolean;
  disabled?: boolean;
  onSelect: () => void;
}) {
  const detail = jumpDetail(task, multiHost);
  const head = [task.group, task.branch].filter(Boolean).join(" · ");
  const m = task.status === "terminal" ? undefined : statusMeta(task.status);
  const Check = selected ? CircleCheck : Circle;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: !!disabled }}
      accessibilityLabel={[head, task.title, detail, m?.label].filter(Boolean).join(", ")}
      disabled={disabled}
      onPress={onSelect}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        minHeight: hitTarget,
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
        opacity: pressed ? state.pressedOpacity : 1,
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
      {m ? <StatusDot label={m.label} color={m.color} lit={task.status === "working"} quiet={task.status === "idle" || task.status === "unknown"} /> : null}
      <Check size={icon.md} color={selected ? colors.accent : colors.textMuted} strokeWidth={icon.strokeWidth} />
    </Pressable>
  );
}
