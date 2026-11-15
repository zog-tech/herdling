/**
 * The tiny map of a space's tabs on the Spaces tab: one small box per tab, one cell per pane,
 * colored by the pane status. Decorative: the row says the attention count in words.
 */
import { View } from "react-native";

import { space } from "@/theme/tokens";
import { Text } from "@/ui/Text";

import type { SpaceTab } from "./spaces";
import { paneCellColor } from "./statusColor";

/** The most tabs that the map draws. More show as "+n". */
const MAX_TABS = 6;
const CELL_H = space.md;
const CELL_W = space.sm;
const CELL_GAP = space.xs / 2;

export function TabMap({ tabs }: { tabs: SpaceTab[] }) {
  const shown = tabs.slice(0, MAX_TABS);
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
      {shown.map((t) => (
        <View key={t.tabId} style={{ flexDirection: "row", gap: CELL_GAP }}>
          {(t.panes.length > 0 ? t.panes : [{ paneId: "empty", status: "terminal" as const }]).map((p) => (
            <View key={p.paneId} style={{ width: CELL_W, height: CELL_H, borderRadius: CELL_GAP, backgroundColor: paneCellColor(p.status) }} />
          ))}
        </View>
      ))}
      {tabs.length > MAX_TABS ? (
        <Text variant="caption" muted>
          {`+${tabs.length - MAX_TABS}`}
        </Text>
      ) : null}
    </View>
  );
}
