import { Pointer, X } from "lucide-react-native";
import { Pressable, View } from "react-native";

import { colors, hitTarget, icon, radius, space, state } from "@/theme/tokens";
import { Text } from "@/ui/Text";

export const HINT_TEXT = "Tap an agent to see its chat and talk to it.";
/** A little rounder than a control, a little less round than a card. */
const HINT_RADIUS = radius.md + 4;

/**
 * The first-run hint above the first agent: a new user does not see that a row opens the session.
 * It shows until the user opens a session from the Board or closes it (see `showHint`).
 */
export function BoardHint({ onClose }: { onClose: () => void }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        marginHorizontal: space.md,
        marginTop: space.xs,
        marginBottom: space.sm,
        paddingLeft: space.md,
        borderRadius: HINT_RADIUS,
        borderWidth: 1,
        borderColor: colors.hintEdge,
        backgroundColor: colors.hintFill,
      }}
    >
      <Pointer size={icon.md} color={colors.accent} strokeWidth={icon.strokeWidth} />
      <Text variant="small" style={{ flex: 1, paddingVertical: space.sm + 2 }}>
        {HINT_TEXT}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss hint"
        onPress={onClose}
        style={({ pressed }) => ({
          width: hitTarget,
          height: hitTarget,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? state.pressedOpacity : 1,
        })}
      >
        <X size={icon.sm} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
      </Pressable>
    </View>
  );
}
