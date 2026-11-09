/**
 * One row of saved prompt chips above the prompt box. The composer shows it while the box is empty
 * and has the focus. A tap puts the text in the box (it does not send); a long press opens a menu
 * with "Send now". Taps keep the keyboard open.
 */
import { Pressable, ScrollView, type AccessibilityActionEvent } from "react-native";

import { colors, denseScale, hitTarget, motion, radius, space } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { showActionSheet } from "@/ui/nativeSheet";
import { Text } from "@/ui/Text";

import { promptChipLabel } from "./savedPrompts";

/** The long press menu of a chip. "Send now" is there only while a send can go. */
export function openSavedPromptMenu(text: string, canSend: boolean, onPick: (t: string) => void, onSend: (t: string) => void): void {
  const options = [...(canSend ? ["Send now"] : []), "Put in the box", "Cancel"];
  showActionSheet({ title: promptChipLabel(text), options, cancelButtonIndex: options.length - 1 }, (i) => {
    if (options[i] === "Send now") onSend(text);
    else if (options[i] === "Put in the box") onPick(text);
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
  /** False while a send cannot go (offline, a send in flight): the chips still fill the box. */
  canSend: boolean;
  onPick: (text: string) => void;
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
          if (e.nativeEvent.actionName === "send" && canSend) onSend(text);
        };
        return (
          <Pressable
            key={text}
            accessibilityRole="button"
            accessibilityLabel={`Saved prompt: ${label}`}
            accessibilityHint="Puts the text in the box. Long press to send it now."
            accessibilityActions={canSend ? [{ name: "send", label: "Send now" }] : []}
            onAccessibilityAction={onAction}
            onPress={() => {
              haptics.tap();
              onPick(text);
            }}
            onLongPress={() => {
              haptics.press();
              openSavedPromptMenu(text, canSend, onPick, onSend);
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
