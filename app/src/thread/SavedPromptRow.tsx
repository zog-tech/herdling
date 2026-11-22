/**
 * One row of saved prompt chips above the prompt box. The composer shows it while the box is empty
 * and has the focus, so a tap puts no draft at risk. A tap sends the text at once. While a send
 * cannot go, a tap puts the text in the box, so nothing is lost. A long press opens a menu with
 * "Put in the box". Taps keep the keyboard open.
 */
import { Pressable, ScrollView, type AccessibilityActionEvent } from "react-native";

import { colors, denseScale, hitTarget, motion, radius, space } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { showActionSheet } from "@/ui/nativeSheet";
import { Text } from "@/ui/Text";

import { promptChipLabel } from "./savedPrompts";

/** The long press menu of a chip. A tap sends, so the menu only puts the text in the box. */
export function openSavedPromptMenu(text: string, onPick: (t: string) => void): void {
  const options = ["Put in the box", "Cancel"];
  showActionSheet({ title: promptChipLabel(text), options, cancelButtonIndex: options.length - 1 }, (i) => {
    if (options[i] === "Put in the box") onPick(text);
  });
}

/** The chip is short to keep the row compact; the slop makes the touch area about a full hit target. */
const SLOP = space.sm;

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
      contentContainerStyle={{ gap: space.xs, paddingHorizontal: space.xs }}
      style={{ flexGrow: 0 }}
    >
      {prompts.map((text) => {
        const label = promptChipLabel(text);
        const onAction = (e: AccessibilityActionEvent) => {
          if (e.nativeEvent.actionName === "fill") onPick(text);
        };
        return (
          <Pressable
            key={text}
            accessibilityRole="button"
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
            delayLongPress={motion.press.longPressMs}
            hitSlop={{ top: SLOP, bottom: SLOP }}
            style={({ pressed }) => ({
              maxWidth: hitTarget * 6,
              paddingHorizontal: space.md,
              paddingVertical: space.xs,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: colors.edge,
              backgroundColor: pressed ? colors.raised : colors.card,
            })}
          >
            <Text variant="small" numberOfLines={1} maxFontSizeMultiplier={denseScale.row}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
