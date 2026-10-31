import type { CommandInfo } from "@herdling/protocol";
import { Pressable, ScrollView, View } from "react-native";

import { colors, hitTarget, radius, space } from "@/theme/tokens";
import { Text } from "@/ui/Text";

/** Rows visible before the list scrolls. */
export const MENU_ROWS = 6;

/** One command: `/name` (`$name` for a Codex skill) and a one-line muted description. */
export function CommandRow({ c, onPick }: { c: CommandInfo; onPick: (c: CommandInfo) => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${c.trigger ?? "/"}${c.name}`}
      accessibilityHint={c.description}
      onPress={() => onPick(c)}
      style={({ pressed }) => ({
        minHeight: hitTarget,
        justifyContent: "center",
        paddingHorizontal: space.md,
        backgroundColor: pressed ? colors.raised : "transparent",
      })}
    >
      <Text variant="small" mono numberOfLines={1}>
        {`${c.trigger ?? "/"}${c.name}`}
      </Text>
      {c.description ? (
        <Text variant="caption" muted numberOfLines={1}>
          {c.description}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** The list above the composer while the user types `/name`. Taps do not close the keyboard. */
export function CommandMenu({ commands, onPick }: { commands: CommandInfo[]; onPick: (c: CommandInfo) => void }) {
  return (
    <View
      accessibilityLabel="Commands"
      style={{
        maxHeight: hitTarget * MENU_ROWS,
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.divider,
        borderRadius: radius.md,
        overflow: "hidden",
      }}
    >
      <ScrollView keyboardShouldPersistTaps="always">
        {commands.map((c) => (
          <CommandRow key={c.name} c={c} onPick={onPick} />
        ))}
      </ScrollView>
    </View>
  );
}
