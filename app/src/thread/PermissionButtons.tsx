import { TriangleAlert } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { colors, hitTarget, radius, space, state } from "@/theme/tokens";
import { Text } from "@/ui/Text";

import { destructiveKey, type Choice } from "./choices";

/** One button per permission-menu choice. The choice the agent has highlighted gets an accent border; the last "No" choice is red. */
export function PermissionButtons({
  choices,
  onPick,
  disabled,
}: {
  choices: Choice[];
  onPick: (c: Choice) => void;
  disabled?: boolean;
}) {
  const danger = destructiveKey(choices);
  return (
    <View style={{ gap: space.xs }} accessibilityLabel="Agent needs a choice">
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <TriangleAlert size={14} color={colors.status.blocked} />
        <Text variant="small" color={colors.status.blocked} accessibilityLiveRegion="polite">
          Agent needs a choice
        </Text>
      </View>
      {choices.map((c) => {
        const destructive = c.key === danger;
        const fg = destructive ? colors.danger : colors.text;
        return (
          <Pressable
            key={c.key}
            accessibilityRole="button"
            accessibilityLabel={`${c.key}. ${c.label}`}
            accessibilityState={{ disabled: !!disabled, selected: c.selected }}
            disabled={disabled}
            onPress={() => onPick(c)}
            style={({ pressed }) => ({
              minHeight: hitTarget,
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
              paddingHorizontal: space.md,
              paddingVertical: space.sm,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: destructive ? colors.danger : c.selected ? colors.accent : colors.border,
              backgroundColor: pressed ? colors.raised : colors.card,
              opacity: disabled ? state.disabledOpacity : 1,
            })}
          >
            <Text mono bold color={fg}>
              {c.key}
            </Text>
            <Text color={fg} style={{ flex: 1 }} numberOfLines={3}>
              {c.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
