/** One space on the Spaces tab: the group tile, the name, the tab map and the attention count or a working mark. */
import { ChevronRight } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { colors, denseScale, hitTarget, icon, radius, space, state } from "@/theme/tokens";
import { GroupTile } from "@/ui/GroupTile";
import { StatusDot } from "@/ui/StatusDot";
import { Text } from "@/ui/Text";

import type { Space } from "./spaces";
import { TabMap } from "./TabMap";

/** The ember count of agents that need you. */
export function AttentionBadge({ count }: { count: number }) {
  return (
    <View
      style={{
        minWidth: space.xl,
        paddingHorizontal: space.sm,
        paddingVertical: space.xs / 2,
        borderRadius: radius.pill,
        backgroundColor: colors.blockedTint,
        borderWidth: 1,
        borderColor: colors.status.blocked,
        alignItems: "center",
      }}
    >
      <Text variant="caption" bold color={colors.status.blocked} maxFontSizeMultiplier={denseScale.pill}>
        {String(count)}
      </Text>
    </View>
  );
}

/** The words of a space for VoiceOver: its name, tabs, agents and what needs you. */
export function spaceLabel(s: Pick<Space, "label" | "tabs" | "agents" | "attention" | "working">): string {
  const parts = [s.label, `${s.tabs.length} ${s.tabs.length === 1 ? "tab" : "tabs"}`, `${s.agents} ${s.agents === 1 ? "agent" : "agents"}`];
  if (s.attention > 0) parts.push(`${s.attention} needs you`);
  else if (s.working) parts.push("working");
  return parts.join(", ");
}

export function SpaceRow({ space: s, onPress }: { space: Space; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spaceLabel(s)}
      accessibilityHint="Opens the space"
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        minHeight: hitTarget + space.lg,
        paddingHorizontal: space.lg,
        paddingVertical: space.sm,
        opacity: pressed ? state.pressedOpacity : 1,
      })}
    >
      <GroupTile name={s.label} size={hitTarget - space.md} />
      <View style={{ flex: 1, gap: space.xs }}>
        <Text variant="headline" numberOfLines={1} maxFontSizeMultiplier={denseScale.row}>
          {s.label}
        </Text>
        <TabMap tabs={s.tabs} />
      </View>
      {s.attention > 0 ? <AttentionBadge count={s.attention} /> : s.working ? <StatusDot label="Working" color={colors.status.working} lit quiet /> : null}
      <ChevronRight size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
    </Pressable>
  );
}
