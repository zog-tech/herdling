/**
 * One row of saved prompt shortcuts (`ui/Shortcut`) above the prompt box. The composer shows it while the box is empty
 * and has the focus, so a tap puts no draft at risk. A tap sends the text at once. While a send
 * cannot go, a tap puts the text in the box, so nothing is lost. A long press opens a menu with
 * "Put in the box". Taps keep the keyboard open.
 */
import { TextCursorInput } from "lucide-react-native";
import { ScrollView, type AccessibilityActionEvent } from "react-native";

import { space } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { showMenu } from "@/ui/MenuSheet";
import { Shortcut } from "@/ui/Shortcut";

import { promptChipLabel } from "./savedPrompts";

/**
 * The long press menu of a shortcut. A tap sends, so the menu only puts the text in the box. The
 * caller gives the open haptic (the long press).
 */
export function openSavedPromptMenu(text: string, onPick: (t: string) => void): void {
  showMenu({
    title: promptChipLabel(text),
    haptic: false,
    sections: [{ items: [{ label: "Put in the box", Icon: TextCursorInput, onPick: () => onPick(text) }] }],
  });
}

export function SavedPromptRow({
  prompts,
  canSend,
  onPick,
  onSend,
}: {
  prompts: readonly string[];
  /** False while a send cannot go (offline, a send in flight, voice input): a tap then fills the box. */
  canSend: boolean;
  onPick: (text: string) => void;
  /** Sends the text. It gives the send haptic itself. */
  onSend: (text: string) => void;
}) {
  if (prompts.length === 0) return null;
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      accessibilityLabel="Saved prompts"
      contentContainerStyle={{ gap: space.sm, paddingHorizontal: space.xs }}
      style={{ flexGrow: 0 }}
    >
      {prompts.map((text) => {
        const label = promptChipLabel(text);
        const onAction = (e: AccessibilityActionEvent) => {
          if (e.nativeEvent.actionName === "fill") onPick(text);
        };
        return (
          <Shortcut
            key={text}
            label={label}
            accessibilityLabel={`Saved prompt: ${label}`}
            accessibilityHint={canSend ? "Sends the text. Long press to put it in the box." : "Puts the text in the box."}
            accessibilityActions={[{ name: "fill", label: "Put in the box" }]}
            onAccessibilityAction={onAction}
            onPress={() => {
              if (canSend) {
                onSend(text);
                return;
              }
              haptics.tap();
              onPick(text);
            }}
            onLongPress={() => {
              haptics.press();
              openSavedPromptMenu(text, onPick);
            }}
          />
        );
      })}
    </ScrollView>
  );
}
