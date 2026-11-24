import { ListFilter, X } from "lucide-react-native";
import { View } from "react-native";

import { colors, denseScale, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

import { IconButton } from "@/ui/IconButton";

/**
 * The bar above the agent list, in both top forms: the list title and its count, one line that
 * says how the list is grouped and sorted, and one list options button (`listMenu`: status filter,
 * group and sort, all with checks). With a status filter on, the title is the status word, a
 * "Show all" button clears the filter, and the options icon is in the accent (the selected state).
 */
export function ListBar({
  title,
  count,
  arrange,
  filtered,
  onOptions,
  onClear,
}: {
  /** "All agents", or the status word of the filter. */
  title: string;
  count: number;
  /** For example "Grouped by status · Sorted by name". */
  arrange: string;
  /** True while a status filter is on. */
  filtered: boolean;
  onOptions: () => void;
  onClear: () => void;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, paddingLeft: space.lg, paddingRight: space.sm, paddingTop: space.sm }}>
      <View style={{ flex: 1, gap: space.xs }}>
        <View accessible accessibilityRole="header" style={{ flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: space.sm }}>
          <Text variant="title" maxFontSizeMultiplier={denseScale.row}>
            {title}
          </Text>
          <Text variant="small" muted maxFontSizeMultiplier={denseScale.row} style={{ fontVariant: ["tabular-nums"] }}>
            {count}
          </Text>
        </View>
        <Text variant="caption" muted maxFontSizeMultiplier={denseScale.row}>
          {arrange}
        </Text>
      </View>
      {filtered ? <Button label="Show all" variant="ghost" Icon={X} accessibilityHint="Clears the status filter" onPress={onClear} /> : null}
      <IconButton
        label="Agent list options"
        hint="Filters, groups and sorts the agent list"
        Icon={ListFilter}
        selected={filtered}
        color={colors.text}
        onPress={onOptions}
      />
    </View>
  );
}
