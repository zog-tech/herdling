/**
 * The content of the start options sheet: the model, the thinking level (Pi), the extra flags, a
 * preview of the command line and "Reset to default". It reads and writes the remembered options
 * of the kind, so the screen under the sheet shows each change. The text fields keep their own
 * text while the user types and go to the store when editing ends or the sheet closes.
 */
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, View } from "react-native";

import { agentLabel } from "@/herdr/agentKinds";
import { colors, denseScale, hitTarget, space, state } from "@/theme/tokens";
import { CloseButton } from "@/ui/CloseButton";
import { Field } from "@/ui/Field";
import { glassAvailable } from "@/ui/Glass";
import * as haptics from "@/ui/haptics";
import { KeyboardAvoider } from "@/ui/KeyboardAvoider";
import { Segmented } from "@/ui/Segmented";
import { useSheetKeyboardPad } from "@/ui/sheetKeyboard";
import { Text } from "@/ui/Text";

import type { SheetFocus } from "./StartOptionsBar";
import { commandPreview, DEFAULT_THINKING_ID, optionsFor, thinkingOf, withThinking, type StartChoice } from "./startOptions";
import { choiceFor, rememberChoice, useStartOptionsMemory } from "./startOptionsMemory";

/**
 * The one detent of the sheet on Android, as a share of the largest sheet height. Android lays out
 * the sheet content at the largest detent, so one detent keeps the fields on the screen.
 */
export const START_OPTIONS_DETENT_ANDROID = 0.75;

/** The text fields of the sheet, as typed. */
type Draft = { model: string; extra: string };

/** Writes the typed fields into the remembered choice of `kind`. Mode and thinking stay as stored. */
function commit(kind: string, draft: Draft) {
  const stored = choiceFor(useStartOptionsMemory.getState().byKind, kind);
  rememberChoice(kind, { ...stored, model: draft.model.trim(), extra: draft.extra });
}

export function StartOptionsSheet({ kind, focus, onClose }: { kind: string; focus?: SheetFocus; onClose: () => void }) {
  const opts = optionsFor(kind);
  const byKind = useStartOptionsMemory((s) => s.byKind);
  const stored = choiceFor(byKind, kind);
  const [draft, setDraftState] = useState<Draft>(() => ({ model: stored.model ?? "", extra: stored.extra ?? "" }));
  /** The latest draft, for the commit when the sheet closes. */
  const latest = useRef(draft);
  const setDraft = (patch: Partial<Draft>) => {
    latest.current = { ...latest.current, ...patch };
    setDraftState(latest.current);
  };
  // Swipe-down, the close button and a route change all unmount the sheet: keep what was typed.
  useEffect(() => () => commit(kind, latest.current), [kind]);

  const live: StartChoice = { ...stored, model: draft.model, extra: draft.extra };
  const level = thinkingOf(kind, live);
  const keyboard = useSheetKeyboardPad(START_OPTIONS_DETENT_ANDROID);

  const body = (
    <>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          paddingLeft: space.lg,
          paddingRight: space.sm,
          paddingTop: space.lg,
          paddingBottom: space.sm,
        }}
      >
        <Text variant="title" numberOfLines={2} accessibilityRole="header" style={{ flex: 1 }}>
          {`Start options · ${agentLabel(kind)}`}
        </Text>
        <CloseButton onPress={onClose} />
      </View>
      <ScrollView
        style={{ flex: 1, minHeight: 0 }}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xl, gap: space.lg }}
      >
        {opts.modelFlag ? (
          <Field
            label="Model"
            mono
            value={draft.model}
            onChangeText={(t) => setDraft({ model: t })}
            onEndEditing={() => commit(kind, latest.current)}
            autoFocus={focus === "model"}
            placeholder="The agent's default"
            spellCheck={false}
            returnKeyType="done"
          />
        ) : null}
        {opts.thinking ? (
          <View style={{ gap: space.xs }}>
            <Text variant="small" muted>
              Thinking
            </Text>
            <Segmented
              label="Thinking"
              options={[{ id: DEFAULT_THINKING_ID, label: "Default" }, ...opts.thinking.levels]}
              value={level?.id ?? DEFAULT_THINKING_ID}
              onChange={(id) => {
                commit(kind, latest.current);
                rememberChoice(kind, withThinking(choiceFor(useStartOptionsMemory.getState().byKind, kind), id));
              }}
            />
          </View>
        ) : null}
        <Field
          label="Extra flags"
          mono
          value={draft.extra}
          onChangeText={(t) => setDraft({ extra: t })}
          onEndEditing={() => commit(kind, latest.current)}
          autoFocus={focus === "extra"}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="--flag value"
          spellCheck={false}
          returnKeyType="done"
        />
        <View style={{ gap: space.xs }}>
          <Text variant="small" muted>
            Command
          </Text>
          <Text variant="caption" mono muted selectable accessibilityLabel={`Command: ${commandPreview(kind, live)}`}>
            {commandPreview(kind, live)}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reset to default"
          onPress={() => {
            haptics.tap();
            setDraft({ model: "", extra: "" });
            rememberChoice(kind, {});
          }}
          style={({ pressed }) => ({
            minHeight: hitTarget,
            alignSelf: "flex-start",
            justifyContent: "center",
            opacity: pressed ? state.pressedOpacity : 1,
          })}
        >
          <Text color={colors.text} maxFontSizeMultiplier={denseScale.row}>
            Reset to default
          </Text>
        </Pressable>
      </ScrollView>
    </>
  );

  // Android: the sheet is `card`, and the keyboard pad replaces the avoiding view (see `useSheetKeyboardPad`).
  if (Platform.OS === "android") {
    return (
      <View ref={keyboard.ref} style={{ flex: 1, backgroundColor: colors.card, paddingBottom: keyboard.pad }}>
        {body}
      </View>
    );
  }
  // iOS 26 draws the sheet as Liquid Glass, so the page color stays off it.
  return (
    <KeyboardAvoider atScreenBottom style={{ backgroundColor: glassAvailable() ? "transparent" : colors.bg }}>
      {body}
    </KeyboardAvoider>
  );
}
