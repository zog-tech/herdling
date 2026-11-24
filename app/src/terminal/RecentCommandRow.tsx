/**
 * One row of recent shell command shortcuts (`ui/Shortcut`, mono) above the key row. A tap puts the command in the box; a
 * long press opens a menu with "Run now" and "Remove". Taps keep the keyboard open.
 */
import { Play, Trash2 } from "lucide-react-native";
import { ScrollView, View, type AccessibilityActionEvent } from "react-native";

import { denseScale, space } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { showMenu } from "@/ui/MenuSheet";
import { Shortcut } from "@/ui/Shortcut";
import { Text } from "@/ui/Text";

/** The command on one line, for a chip: the line ends show as a return mark. */
export const chipLabel = (cmd: string) => cmd.replace(/\r?\n/g, " ↵ ");

/**
 * The long press menu of a shortcut. Run now is only there while the host is online. Remove is
 * destructive, in the last section. The caller gives the open haptic (the long press).
 */
export function openChipMenu(cmd: string, canRun: boolean, onRun: (cmd: string) => void, onRemove: (cmd: string) => void): void {
  showMenu({
    title: chipLabel(cmd),
    haptic: false,
    sections: [
      { items: canRun ? [{ label: "Run now", Icon: Play, onPick: () => onRun(cmd) }] : [] },
      { items: [{ label: "Remove", Icon: Trash2, destructive: true, onPick: () => onRemove(cmd) }] },
    ],
  });
}

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
      contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.md }}
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
          <Shortcut
            key={cmd}
            label={chipLabel(cmd)}
            mono
            accessibilityLabel={`Recent command: ${chipLabel(cmd)}`}
            accessibilityHint="Puts the command in the box. Long press for more options."
            accessibilityActions={[...(canRun ? [{ name: "run", label: "Run now" }] : []), { name: "remove", label: "Remove" }]}
            onAccessibilityAction={onAction}
            onPress={() => {
              haptics.tap();
              onPick(cmd);
            }}
            onLongPress={menu}
          />
        );
      })}
    </ScrollView>
  );
}
