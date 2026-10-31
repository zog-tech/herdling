import { Info } from "lucide-react-native";
import { memo } from "react";
import { View } from "react-native";

import { colors, space } from "@/theme/tokens";
import { Text } from "@/ui/Text";

import { MenuPressable } from "../MenuPressable";

/** Compaction, interrupt and error notes: a quiet centered line. A long press offers Copy. */
export const SystemRow = memo(function SystemRow({ text }: { text: string }) {
  return (
    <MenuPressable menu={{ kind: "system", text }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.xs, paddingHorizontal: space.lg }}>
        <Info size={12} color={colors.textMuted} />
        <Text variant="caption" muted numberOfLines={3} style={{ flexShrink: 1, textAlign: "center" }}>
          {text}
        </Text>
      </View>
    </MenuPressable>
  );
});
