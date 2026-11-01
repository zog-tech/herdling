import { View } from "react-native";

import { colors, denseScale, space } from "@/theme/tokens";
import { Text } from "@/ui/Text";

import type { HomeTop } from "./boardPrefs";
import type { BoardItem } from "./buckets";
import { BUCKET_META } from "./bucketMeta";
import { AllAgentsBar, SpotlightCarousel } from "./Dashboard";
import type { Spotlight } from "./spotlight";
import type { BoardSummary } from "./summary";

/** The color of the headline words. Read at render time: a theme can change the colors. */
function toneColor(tone: BoardSummary["tone"]): string {
  return tone === "quiet" ? colors.textMuted : BUCKET_META[tone].color;
}

/**
 * The headline of the Summary top: one large number in ivory and the words after it in the bucket
 * color, then the other buckets in one muted line. No box.
 */
export function Summary({ summary }: { summary: BoardSummary }) {
  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={summary.spoken}
      style={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md, gap: 2 }}
    >
      <View style={{ flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: space.sm }}>
        <Text variant="display">{summary.value}</Text>
        <Text variant="title" color={toneColor(summary.tone)}>
          {summary.label}
        </Text>
      </View>
      {summary.detail ? (
        <Text variant="small" muted>
          {summary.detail}
        </Text>
      ) : null}
    </View>
  );
}

/** The Dashboard summary: one short line, "1 needs you · 1 working · 2 idle". The first part has the bucket color. */
export function SummaryLine({ summary }: { summary: BoardSummary }) {
  return (
    <Text
      accessibilityRole="summary"
      accessibilityLabel={summary.spoken}
      variant="small"
      muted
      maxFontSizeMultiplier={denseScale.row}
      style={{ paddingHorizontal: space.lg }}
    >
      <Text variant="small" bold color={toneColor(summary.tone)} maxFontSizeMultiplier={denseScale.row}>
        {`${summary.value} ${summary.label}`}
      </Text>
      {summary.detail ? ` · ${summary.detail}` : ""}
    </Text>
  );
}

/**
 * The part of the Board above the filter chips, for the top the user picked in Settings.
 * - `summary`: the large number (the native header shows "Overview").
 * - `dashboard`: the carousel (when there are agents), the summary line, and the "All agents" bar
 *   with the group and sort menus. The brand header is outside the list, so it stays in place.
 */
export function BoardTop({
  mode,
  items,
  summary,
  spot,
  room,
  focused,
  group,
  sort,
  onGroup,
  onSort,
  onOpen,
  onPeek,
  onNew,
}: {
  mode: HomeTop;
  items: BoardItem[];
  summary: BoardSummary;
  spot: Spotlight;
  room: number;
  focused: boolean;
  group: string;
  sort: string;
  onGroup: () => void;
  onSort: () => void;
  onOpen: (i: BoardItem) => void;
  onPeek: (i: BoardItem) => void;
  onNew: () => void;
}) {
  if (items.length === 0) return null;
  if (mode === "summary") return <Summary summary={summary} />;
  return (
    <View>
      {spot.items.length > 0 ? (
        <SpotlightCarousel spot={spot} room={room} focused={focused} onOpen={onOpen} onPeek={onPeek} onNew={onNew} />
      ) : null}
      <SummaryLine summary={summary} />
      <AllAgentsBar count={items.length} group={group} sort={sort} onGroup={onGroup} onSort={onSort} />
    </View>
  );
}
