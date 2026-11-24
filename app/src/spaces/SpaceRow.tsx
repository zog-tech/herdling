/**
 * One space on the Spaces tab: the group tile, the name, one detail line in words (the short
 * folder and the counts, so two spaces with one name differ) and the tab map under it. At the
 * right: the status word with its dot for "needs you" and "working", then a chevron.
 */
import { ChevronRight } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { colors, denseScale, hitTarget, icon, space, state } from "@/theme/tokens";
import { GroupTile } from "@/ui/GroupTile";
import { StatusDot } from "@/ui/StatusDot";
import { Text } from "@/ui/Text";

import { spaceDetail, type Space } from "./spaces";
import { TabMap } from "./TabMap";

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
      accessibilityLabel={`${spaceLabel(s)}, ${spaceDetail(s)}`}
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
        <Text variant="small" muted numberOfLines={1} ellipsizeMode="middle" maxFontSizeMultiplier={denseScale.row}>
          {spaceDetail(s)}
        </Text>
        <TabMap tabs={s.tabs} />
      </View>
      {s.attention > 0 ? <StatusDot label={`${s.attention} need${s.attention === 1 ? "s" : ""} you`} color={colors.status.blocked} /> : s.working ? <StatusDot label="Working" color={colors.status.working} lit quiet /> : null}
      <ChevronRight size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
    </Pressable>
  );
}
