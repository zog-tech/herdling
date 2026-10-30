import { View } from "react-native";

import { colors, radius, space } from "@/theme/tokens";
import { Text } from "./Text";

/** Bar color by level: accent below 70, amber 70-89, danger from 90. */
export function meterColor(value: number): string {
  if (value >= 90) return colors.danger;
  if (value >= 70) return colors.status.blocked;
  return colors.accent;
}

/** Labeled bar. `value` is 0..100. The text carries the value too, so color is never the only signal. */
export function Meter({ label, value, detail }: { label: string; value: number; detail?: string }) {
  const v = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  const text = detail ?? `${Math.round(v)}%`;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v), text }}
      style={{ flex: 1, gap: space.xs }}
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.sm }}>
        <Text variant="caption" muted>
          {label}
        </Text>
        <Text variant="caption" bold numberOfLines={1}>
          {text}
        </Text>
      </View>
      <View style={{ height: 6, borderRadius: radius.pill, backgroundColor: colors.muted, overflow: "hidden" }}>
        <View style={{ width: `${v}%`, height: "100%", backgroundColor: meterColor(v) }} />
      </View>
    </View>
  );
}
