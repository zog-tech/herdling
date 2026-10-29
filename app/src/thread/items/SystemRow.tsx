import { Info } from "lucide-react-native";
import { memo } from "react";
import { View } from "react-native";

import { colors, space } from "@/theme/tokens";
import { Text } from "@/ui/Text";

/** Compaction, interrupt and error notes: a quiet centered line. */
export const SystemRow = memo(function SystemRow({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs, paddingHorizontal: space.lg }}>
      <Info size={12} color={colors.textMuted} />
      <Text variant="caption" muted numberOfLines={3} style={{ flexShrink: 1, textAlign: "center" }}>
        {text}
      </Text>
    </View>
  );
});
