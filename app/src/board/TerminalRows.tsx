import { Pressable, View } from "react-native";

import { statusLabel, useTerminalStatus, type TerminalStatus } from "@/herdr/terminalStatus";
import { terminalDetail, type BoardTerminal } from "@/herdr/terminals";
import { colors, denseScale, hitTarget, space, state } from "@/theme/tokens";
import { Divider } from "@/ui/Group";
import * as haptics from "@/ui/haptics";
import { StatusDot } from "@/ui/StatusDot";
import { TerminalMark } from "@/ui/TerminalMark";
import { Text } from "@/ui/Text";

/**
 * "Terminals" at the end of the board: one compact row per pane with no agent (a plain shell).
 * It stays out of the agent groups, the filters and the spotlight. A tap opens the terminal.
 * Each row shows "Running: <command>" or "Idle" when the board polls the status (see `useTerminalStatusPolling`).
 */
export function TerminalRows({
  terminals,
  multiHost,
  selectedKey,
  onOpen,
}: {
  terminals: BoardTerminal[];
  multiHost: boolean;
  selectedKey?: string;
  onOpen: (t: BoardTerminal) => void;
}) {
  const statuses = useTerminalStatus((s) => s.byKey);
  if (terminals.length === 0) return null;
  return (
    <View style={{ paddingTop: space.xl }}>
      <View accessible accessibilityRole="header" style={{ flexDirection: "row", gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.xs }}>
        <Text variant="section" maxFontSizeMultiplier={denseScale.row}>
          Terminals
        </Text>
        <Text variant="section" maxFontSizeMultiplier={denseScale.row} style={{ fontVariant: ["tabular-nums"] }}>
          {terminals.length}
        </Text>
      </View>
      {terminals.map((t, i) => {
        const detail = terminalDetail(t, multiHost);
        const selected = t.key === selectedKey;
        const status = statuses[t.key];
        const label = [t.title, status ? statusLabel(status) : undefined, detail].filter(Boolean).join(", ");
        return (
          <View key={t.key}>
            {i > 0 ? <Divider /> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Terminal ${label}`}
              accessibilityHint="Opens the terminal"
              accessibilityState={selected ? { selected: true } : undefined}
              onPress={() => {
                haptics.tap();
                onOpen(t);
              }}
              style={({ pressed }) => ({
                minHeight: hitTarget,
                flexDirection: "row",
                alignItems: "center",
                gap: space.md,
                paddingHorizontal: space.lg,
                paddingVertical: space.sm,
                backgroundColor: selected ? state.selectedFill : pressed ? colors.raised : "transparent",
              })}
            >
              <TerminalMark />
              <View style={{ flex: 1, gap: 2 }}>
                <Text numberOfLines={1} maxFontSizeMultiplier={denseScale.row}>
                  {t.title}
                </Text>
                {status ? <TerminalStatusDot status={status} /> : null}
                {detail ? (
                  <Text variant="caption" muted mono numberOfLines={1} ellipsizeMode="middle" maxFontSizeMultiplier={denseScale.row}>
                    {detail}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

/** "● Running: pnpm dev" with a gold dot, or "● Idle" with a stone dot. The word carries the meaning. */
export function TerminalStatusDot({ status }: { status: TerminalStatus }) {
  return <StatusDot label={statusLabel(status)} color={status.kind === "running" ? colors.status.working : colors.status.idle} quiet />;
}
