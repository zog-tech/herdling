import { useEffect, useState } from "react";
import { Alert, Modal, Platform, Pressable, TextInput, View } from "react-native";
import { create } from "zustand";

import { colors, hitTarget, radius, space, type } from "@/theme/tokens";

import { showMenu } from "./MenuSheet";
import { planActionSheet, type SheetOptions } from "./menuRules";
import { Text } from "./Text";

/**
 * The old system-style entry points: `showActionSheet` (a list of actions) and `promptText` (a text
 * prompt). `showActionSheet` now draws through `ui/MenuSheet` on both platforms. New code uses
 * `showMenu` for icons and sections, and `showPicker` for a choice.
 */

export type { SheetOptions } from "./menuRules";
export { destructiveSet } from "./menuRules";

export type PromptButton = { text: string; style?: "cancel" | "destructive" | "default"; onPress?: (text?: string) => void };

type PromptState = { kind: "prompt"; title: string; message?: string; buttons: PromptButton[]; value: string };

/** The open text prompt on Android. Only one at a time: a new one replaces the old one. */
export const useNativeSheet = create<{ open: PromptState | null }>(() => ({ open: null }));

/**
 * A list of actions in the menu sheet, on iOS and Android. `title` and `message` are the header.
 * The cancel option is not a row: a close with no pick (tap outside, swipe, close button, back)
 * calls `onPick(cancelButtonIndex)`, or `onPick(-1)` without one. Destructive options go to a last
 * section. `onPick` runs after the sheet is gone. No haptic on open: the callers give their own.
 */
export function showActionSheet(o: SheetOptions, onPick: (index: number) => void): void {
  const plan = planActionSheet(o);
  if (plan.sections.length === 0) {
    // Only a cancel option: nothing to choose, as if the user closed the sheet.
    setTimeout(() => onPick(plan.cancelIndex), 0);
    return;
  }
  showMenu({
    title: plan.title,
    detail: plan.detail,
    haptic: false,
    sections: plan.sections.map((s) => ({
      items: s.items.map((r) => ({ label: r.label, destructive: r.destructive, onPick: () => onPick(r.index) })),
    })),
    onClose: () => onPick(plan.cancelIndex),
  });
}

/** A text prompt: `Alert.prompt` on iOS, a dialog from `NativeSheetHost` elsewhere. */
export function promptText(title: string, message: string | undefined, buttons: PromptButton[], value = ""): void {
  if (Platform.OS === "ios") {
    Alert.prompt(title, message, buttons, "plain-text", value);
    return;
  }
  useNativeSheet.setState({ open: { kind: "prompt", title, message, buttons, value } });
}

/** Closes the open prompt and runs `then` once it is gone. */
function close(then?: () => void) {
  useNativeSheet.setState({ open: null });
  if (then) setTimeout(then, 0);
}

function PromptBody({ s }: { s: PromptState }) {
  const [text, setText] = useState(s.value);
  useEffect(() => setText(s.value), [s]);
  return (
    <View style={{ flex: 1, justifyContent: "center", padding: space.xl }}>
      <View style={{ backgroundColor: colors.card, borderRadius: radius.lg, padding: space.lg, gap: space.md }}>
        <Text variant="title" accessibilityRole="header">
          {s.title}
        </Text>
        {s.message ? (
          <Text variant="small" muted>
            {s.message}
          </Text>
        ) : null}
        <TextInput
          value={text}
          onChangeText={setText}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          selectionColor={colors.accent}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={s.title}
          style={{
            minHeight: hitTarget,
            paddingHorizontal: space.md,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.raised,
            color: colors.text,
            fontSize: type.size.body,
          }}
        />
        <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: space.sm }}>
          {s.buttons.map((b, i) => (
            <Pressable
              key={`${i}-${b.text}`}
              accessibilityRole="button"
              onPress={() => close(() => b.onPress?.(b.style === "cancel" ? undefined : text))}
              style={{ minHeight: hitTarget, minWidth: hitTarget, justifyContent: "center", paddingHorizontal: space.md }}
            >
              <Text bold color={b.style === "destructive" ? colors.danger : b.style === "cancel" ? colors.textMuted : colors.accent}>
                {b.text}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

/**
 * Shows the text prompts of `promptText` on platforms without `Alert.prompt` (Android). Mount it
 * once, near the root. It renders nothing on iOS. The menus of `showActionSheet` draw in `MenuSheetHost`.
 */
export function NativeSheetHost() {
  const open = useNativeSheet((s) => s.open);
  if (Platform.OS === "ios" || !open) return null;
  const dismiss = () => {
    const cancel = open.buttons.find((b) => b.style === "cancel");
    close(() => cancel?.onPress?.());
  };
  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={dismiss}>
      <View style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: "center" }}>
        <Pressable accessibilityLabel="Close" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={dismiss} />
        <PromptBody s={open} />
      </View>
    </Modal>
  );
}
