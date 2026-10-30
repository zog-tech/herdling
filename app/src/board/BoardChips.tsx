import { LayoutGrid } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { Pressable, ScrollView } from "react-native";

import { colors, hitTarget, radius, space, state } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { Text } from "@/ui/Text";

import { BUCKETS, BUCKET_LABEL, toggleFilter, type Bucket, type Counts } from "./buckets";
import { BUCKET_META } from "./bucketMeta";

function Chip({
  label,
  count,
  color,
  Icon,
  active,
  onPress,
}: {
  label: string;
  count?: number;
  color: string;
  Icon: LucideIcon;
  active: boolean;
  onPress: () => void;
}) {
  const fg = active ? colors.onAccent : count === 0 ? colors.textMuted : color;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count === undefined ? label : `${label}, ${count}`}
      accessibilityState={{ selected: active }}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => ({
        minHeight: hitTarget,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        paddingHorizontal: space.md,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: active ? color : colors.edge,
        backgroundColor: active ? color : colors.card,
        opacity: pressed ? state.pressedFill : 1,
      })}
    >
      <Icon size={14} color={fg} />
      <Text variant="small" bold color={fg} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
      {count !== undefined ? (
        <Text variant="small" mono bold color={fg} maxFontSizeMultiplier={1.4}>
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** "All" plus one chip per bucket with its live count. Tapping the active chip clears the filter. */
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
      contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.sm }}
      accessibilityRole="tablist"
    >
      <Chip label="All" color={colors.text} Icon={LayoutGrid} active={filter === null} onPress={() => onChange(null)} />
      {BUCKETS.map((b) => (
        <Chip
          key={b}
          label={BUCKET_LABEL[b]}
          count={counts[b]}
          color={BUCKET_META[b].color}
          Icon={BUCKET_META[b].Icon}
          active={filter === b}
          onPress={() => onChange(toggleFilter(filter, b))}
        />
      ))}
    </ScrollView>
  );
}
