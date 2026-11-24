import { View } from "react-native";

import { colors, denseScale, hitTarget, radius, space } from "@/theme/tokens";
import { useInGroup } from "@/ui/Group";
import { meterColor } from "@/ui/Meter";
import { Text } from "@/ui/Text";

/** The height of the bar in points: a thin line under the row text. */
const BAR = space.xs + 2;

/**
 * One meter as a row of a `Group` (design rule 1): the label at the left, the value at the right,
 * one muted detail line (for example "Resets in 3h"), and a thin bar under them. The value is in
 * the text too, so color is never the only cue. VoiceOver reads it as one progress bar.
 */
export function MeterRow({ label, value, valueText, detail }: { label: string; value: number; valueText?: string; detail?: string }) {
  const inGroup = useInGroup();
  const v = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  const text = valueText ?? `${Math.round(v)}%`;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v), text }}
      style={{
        minHeight: hitTarget,
        justifyContent: "center",
        gap: space.sm,
        paddingHorizontal: inGroup ? space.lg : 0,
        paddingVertical: inGroup ? space.md : 0,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text>{label}</Text>
          {detail ? (
            <Text variant="small" muted>
              {detail}
            </Text>
          ) : null}
        </View>
        <Text bold numberOfLines={1} maxFontSizeMultiplier={denseScale.row} style={{ fontVariant: ["tabular-nums"] }}>
          {text}
        </Text>
      </View>
      <View style={{ height: BAR, borderRadius: radius.sm, backgroundColor: colors.raised, overflow: "hidden" }}>
        <View style={{ width: `${v}%`, height: "100%", backgroundColor: meterColor(v) }} />
      </View>
    </View>
  );
}
