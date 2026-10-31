import { Pressable, ScrollView, View } from "react-native";

import { colors, hitTarget, radius, space, state } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { useHover } from "@/ui/hover";
import { Text } from "@/ui/Text";

import { BUCKETS, BUCKET_LABEL, toggleFilter, type Bucket, type Counts } from "./buckets";
import { BUCKET_META } from "./bucketMeta";

const PILL_H = 32;
const SCALE = 1.4;

function Chip({
  label,
  count,
  countColor,
  active,
  onPress,
}: {
  label: string;
  count?: number;
  /** Color of the count at rest: the bucket color when it wants attention, else muted. */
  countColor?: string;
  active: boolean;
  onPress: () => void;
}) {
  const { hovered, hoverProps } = useHover();
  return (
    <Pressable
      {...hoverProps}
      accessibilityRole="tab"
      accessibilityLabel={count === undefined ? label : `${label}, ${count}`}
      accessibilityState={{ selected: active }}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      // The pill is 32 pt; the touch area is the full 44 pt row.
      style={{ minHeight: hitTarget, justifyContent: "center" }}
    >
      {({ pressed }) => (
        <View
          style={{
            minHeight: PILL_H,
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs + 2,
            paddingHorizontal: space.md,
            borderRadius: radius.pill,
            // Selected: a filled pill in ivory text. At rest: text only, no edge, no icon.
            backgroundColor: active ? colors.raised : pressed ? colors.card : hovered ? state.hoverFill : "transparent",
          }}
        >
          <Text variant="small" bold={active} muted={!active} maxFontSizeMultiplier={SCALE}>
            {label}
          </Text>
          {count !== undefined ? (
            <Text
              variant="small"
              bold
              color={active ? colors.text : count === 0 ? colors.textMuted : (countColor ?? colors.textMuted)}
              maxFontSizeMultiplier={SCALE}
              style={{ fontVariant: ["tabular-nums"] }}
            >
              {count}
            </Text>
          ) : null}
        </View>
      )}
    </Pressable>
  );
}

/**
 * The filter tabs: "All" plus one tab per bucket with its live count. Quiet text tabs; the selected
 * one is a filled pill. Only the "Needs you" count keeps its ember color at rest. Tapping the active
 * tab clears the filter.
 */
export function BoardChips({
  counts,
  filter,
  onChange,
}: {
  counts: Counts;
  filter: Bucket | null;
  onChange: (f: Bucket | null) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: space.xs, paddingHorizontal: space.sm }}
      accessibilityRole="tablist"
    >
      <Chip label="All" active={filter === null} onPress={() => onChange(null)} />
      {BUCKETS.map((b) => (
        <Chip
          key={b}
          label={BUCKET_LABEL[b]}
          count={counts[b]}
          countColor={b === "needs_you" ? BUCKET_META[b].color : undefined}
          active={filter === b}
          onPress={() => onChange(toggleFilter(filter, b))}
        />
      ))}
    </ScrollView>
  );
}
