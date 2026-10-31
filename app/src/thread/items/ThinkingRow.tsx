import { Brain, ChevronDown, ChevronRight } from "lucide-react-native";
import { memo, useState } from "react";
import { View } from "react-native";

import { colors, hitTarget, space } from "@/theme/tokens";
import { Text } from "@/ui/Text";

import { MenuPressable } from "../MenuPressable";

/**
 * Collapsed "Thought" marker. Expands to the thinking text when the log has it (null = redacted).
 * A long press opens the row menu (Copy, Select text); a tap still expands or collapses.
 */
export const ThinkingRow = memo(function ThinkingRow({ text }: { text: string | null }) {
  const [open, setOpen] = useState(false);
  const hasText = !!text?.trim();
  const Chevron = open ? ChevronDown : ChevronRight;
  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: hasText ? hitTarget : undefined }}>
      <Brain size={14} color={colors.textMuted} />
      <Text variant="small" muted style={{ fontStyle: "italic" }}>
        Thought
      </Text>
      {hasText ? <Chevron size={14} color={colors.textMuted} /> : null}
    </View>
  );
  if (!hasText || !text) return header;
  return (
    <MenuPressable
      menu={{ kind: "thinking", text }}
      accessibilityRole="button"
      accessibilityLabel={open ? "Hide thinking" : "Show thinking"}
      accessibilityState={{ expanded: open }}
      onPress={() => setOpen((o) => !o)}
    >
      {header}
      {open ? (
        <Text variant="small" muted style={{ paddingLeft: space.xl, fontStyle: "italic" }}>
          {text}
        </Text>
      ) : null}
    </MenuPressable>
  );
});
