/**
 * One pane of a space screen: its name, its status and the end of its screen in small mono text.
 * A pane that needs you has an ember edge. A tap opens the session.
 */
import { SquareTerminal } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { colors, denseScale, hitTarget, icon, radius, space, state, type } from "@/theme/tokens";
import { StatusDot } from "@/ui/StatusDot";
import { statusMeta } from "@/ui/StatusIcon";
import { Text } from "@/ui/Text";

import type { SpacePane } from "./spaces";
import { thumbText } from "./thumbPoll";

/** The rows of screen text in a thumbnail, and its height. */
const ROWS = 10;
export const THUMB_HEIGHT = hitTarget * 4;

export function PaneThumb({ pane, text, onPress }: { pane: SpacePane; text: string | undefined; onPress: () => void }) {
  const blocked = pane.status === "blocked";
  const meta = pane.status === "terminal" ? undefined : statusMeta(pane.status);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${pane.title}, ${meta?.label ?? "Terminal"}`}
      accessibilityHint="Opens the session"
      onPress={onPress}
      style={({ pressed }) => ({
        height: THUMB_HEIGHT,
        borderRadius: radius.md,
        borderWidth: blocked ? 2 : 1,
        borderColor: blocked ? colors.status.blocked : colors.divider,
        backgroundColor: colors.terminal.bg,
        overflow: "hidden",
        opacity: pressed ? state.pressedOpacity : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.xs, backgroundColor: colors.card }}>
        {meta ? null : <SquareTerminal size={icon.sm} color={colors.textMuted} strokeWidth={icon.strokeWidth} />}
        <Text variant="caption" bold numberOfLines={1} maxFontSizeMultiplier={denseScale.row} style={{ flex: 1 }}>
          {pane.title}
        </Text>
        {meta ? <StatusDot label={meta.label} color={meta.color} lit={pane.status === "working"} quiet={!blocked} /> : null}
      </View>
      <Text
        mono
        numberOfLines={ROWS}
        maxFontSizeMultiplier={1}
        color={colors.terminal.fg}
        style={{ fontSize: type.size.caption * 0.75, lineHeight: type.size.caption, paddingHorizontal: space.sm, paddingTop: space.xs }}
      >
        {text === undefined ? "" : thumbText(text, ROWS)}
      </Text>
    </Pressable>
  );
}
