import { useEffect, useState } from "react";
import { ActionSheetIOS, Alert, Modal, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";

import { colors, hitTarget, radius, space, type } from "@/theme/tokens";
import { Text } from "./Text";

/** The options of `ActionSheetIOS.showActionSheetWithOptions` that the app uses. */
export type SheetOptions = {
  title?: string;
  message?: string;
  options: string[];
  cancelButtonIndex?: number;
  destructiveButtonIndex?: number | number[];
};

export type PromptButton = { text: string; style?: "cancel" | "destructive" | "default"; onPress?: (text?: string) => void };

type SheetState =
  | { kind: "sheet"; o: SheetOptions; onPick: (index: number) => void }
  | { kind: "prompt"; title: string; message?: string; buttons: PromptButton[]; value: string };

/** The open sheet or prompt on Android. Only one at a time: a new one replaces the old one. */
export const useNativeSheet = create<{ open: SheetState | null }>(() => ({ open: null }));

/**
 * A list of actions: the system action sheet on iOS, a bottom sheet from `NativeSheetHost` elsewhere.
 * `onPick` gets the chosen index; a dismiss picks `cancelButtonIndex` (or -1 without one).
 */
export function showActionSheet(o: SheetOptions, onPick: (index: number) => void): void {
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(o, onPick);
    return;
  }
  useNativeSheet.setState({ open: { kind: "sheet", o, onPick } });
}

/** A text prompt: `Alert.prompt` on iOS, a dialog from `NativeSheetHost` elsewhere. */
export function promptText(title: string, message: string | undefined, buttons: PromptButton[], value = ""): void {
  if (Platform.OS === "ios") {
    Alert.prompt(title, message, buttons, "plain-text", value);
    return;
  }
  useNativeSheet.setState({ open: { kind: "prompt", title, message, buttons, value } });
}

/** The indexes a sheet shows in red. */
export function destructiveSet(o: SheetOptions): Set<number> {
  const d = o.destructiveButtonIndex;
  return new Set(d === undefined ? [] : Array.isArray(d) ? d : [d]);
}

/** Closes the open sheet and runs `then` once it is gone. */
function close(then?: () => void) {
  useNativeSheet.setState({ open: null });
  if (then) setTimeout(then, 0);
}

function SheetBody({ o, onPick }: { o: SheetOptions; onPick: (index: number) => void }) {
  const insets = useSafeAreaInsets();
  const red = destructiveSet(o);
  const cancel = o.cancelButtonIndex ?? -1;
  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderTopLeftRadius: radius.lg,
        borderTopRightRadius: radius.lg,
        paddingTop: space.sm,
        paddingBottom: insets.bottom + space.sm,
        maxHeight: "80%",
      }}
    >
      {o.title || o.message ? (
        <View style={{ paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.xs }}>
          {o.title ? (
            <Text variant="small" bold muted accessibilityRole="header">
              {o.title}
            </Text>
          ) : null}
          {o.message ? (
            <Text variant="small" muted>
              {o.message}
            </Text>
          ) : null}
        </View>
      ) : null}
      <ScrollView>
        {o.options.map((label, i) => (
          <Pressable
            key={`${i}-${label}`}
            accessibilityRole="button"
            onPress={() => close(() => onPick(i))}
            style={({ pressed }) => ({
              minHeight: hitTarget + 4,
              justifyContent: "center",
              paddingHorizontal: space.lg,
              backgroundColor: pressed ? colors.raised : "transparent",
            })}
          >
            <Text bold={i === cancel} color={red.has(i) ? colors.danger : i === cancel ? colors.textMuted : colors.text}>
              {label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

function PromptBody({ s }: { s: Extract<SheetState, { kind: "prompt" }> }) {
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
 * Shows the sheets and prompts of `showActionSheet` and `promptText` on platforms without the
 * iOS ones. Mount it once, near the root. It renders nothing on iOS.
 */
export function NativeSheetHost() {
  const open = useNativeSheet((s) => s.open);
  if (Platform.OS === "ios" || !open) return null;
  const dismiss = () => {
    if (open.kind === "sheet") {
      const cancel = open.o.cancelButtonIndex ?? -1;
      close(() => open.onPick(cancel));
    } else {
      const cancel = open.buttons.find((b) => b.style === "cancel");
      close(() => cancel?.onPress?.());
    }
  };
  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={dismiss}>
      <View style={{ flex: 1, backgroundColor: colors.scrim, justifyContent: open.kind === "sheet" ? "flex-end" : "center" }}>
        <Pressable accessibilityLabel="Close" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }} onPress={dismiss} />
        {open.kind === "sheet" ? <SheetBody o={open.o} onPick={open.onPick} /> : <PromptBody s={open} />}
      </View>
    </Modal>
  );
}
