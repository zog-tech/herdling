/**
 * One row of recent shell command chips above the key row. A tap puts the command in the box; a
 * long press opens a menu with "Run now" and "Remove". Taps keep the keyboard open.
 */
import { Pressable, ScrollView, View, type AccessibilityActionEvent } from "react-native";

import { fontFamily } from "@/theme/fonts";
import { colors, denseScale, hitTarget, motion, radius, space, type } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { showActionSheet } from "@/ui/nativeSheet";
import { Text } from "@/ui/Text";

/** The command on one line, for a chip: the line ends show as a return mark. */
export const chipLabel = (cmd: string) => cmd.replace(/\r?\n/g, " ↵ ");

/** The long press menu of a chip. Run now is only there while the host is online. */
export function openChipMenu(cmd: string, canRun: boolean, onRun: (cmd: string) => void, onRemove: (cmd: string) => void): void {
  const options = [...(canRun ? ["Run now"] : []), "Remove", "Cancel"];
  const remove = options.indexOf("Remove");
  showActionSheet({ title: chipLabel(cmd), options, cancelButtonIndex: options.length - 1, destructiveButtonIndex: remove }, (i) => {
    if (options[i] === "Run now") onRun(cmd);
    else if (i === remove) onRemove(cmd);
  });
}

/** The chip is short to keep the row compact; the slop makes the touch area about a full hit target. */
const SLOP = space.sm;

export function RecentCommandRow({
  commands,
  canRun,
  onPick,
  onRun,
  onRemove,
}: {
  commands: readonly string[];
  /** False when the host is offline: the chips still fill the box, but nothing runs. */
  canRun: boolean;
  onPick: (cmd: string) => void;
  onRun: (cmd: string) => void;
  onRemove: (cmd: string) => void;
}) {
  if (commands.length === 0) {
    return (
      <View style={{ paddingHorizontal: space.md }}>
        <Text variant="caption" muted mono numberOfLines={1} maxFontSizeMultiplier={denseScale.row}>
          Commands you send show here.
        </Text>
      </View>
    );
  }
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      accessibilityLabel="Recent commands"
      contentContainerStyle={{ gap: space.xs, paddingHorizontal: space.md }}
      style={{ flexGrow: 0 }}
    >
      {commands.map((cmd) => {
        const menu = () => {
          haptics.press();
          openChipMenu(cmd, canRun, onRun, onRemove);
        };
        const onAction = (e: AccessibilityActionEvent) => {
          const name = e.nativeEvent.actionName;
          if (name === "run" && canRun) onRun(cmd);
          else if (name === "remove") onRemove(cmd);
        };
        return (
          <Pressable
            key={cmd}
            accessibilityRole="button"
            accessibilityLabel={`Recent command: ${chipLabel(cmd)}`}
            accessibilityHint="Puts the command in the box. Long press for more options."
            accessibilityActions={[...(canRun ? [{ name: "run", label: "Run now" }] : []), { name: "remove", label: "Remove" }]}
            onAccessibilityAction={onAction}
            onPress={() => {
              haptics.tap();
              onPick(cmd);
            }}
            onLongPress={menu}
            delayLongPress={motion.press.longPressMs}
            hitSlop={{ top: SLOP, bottom: SLOP }}
            style={({ pressed }) => ({
              maxWidth: hitTarget * 6,
              paddingHorizontal: space.sm,
              paddingVertical: space.xs,
              borderRadius: radius.sm,
              borderWidth: 1,
              borderColor: colors.edge,
              backgroundColor: pressed ? colors.raised : colors.card,
            })}
          >
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={denseScale.row}
              style={{ fontFamily: fontFamily.mono, fontSize: type.size.small, color: colors.text }}
            >
              {chipLabel(cmd)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
