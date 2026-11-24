/**
 * The content of the start options sheet: the permission mode, the model, the thinking level (Pi),
 * the extra flags, a preview of the command line and "Reset to default". It reads and writes the
 * remembered options of the kind, so the screen under the sheet shows each change. The choices are
 * rows of grouped bands with a check on the current one (design rule 2). A tap on a mode or a model
 * row goes to the store at once. The text fields keep their own text while the user
 * types and go to the store when editing ends or the sheet closes.
 */
import { Check, type LucideIcon } from "lucide-react-native";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { Platform, Pressable, ScrollView, TextInput, View } from "react-native";

import { agentLabel } from "@/herdr/agentKinds";
import { fontFamily } from "@/theme/fonts";
import { colors, denseScale, hitTarget, icon, radius, space, type } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { CloseButton } from "@/ui/CloseButton";
import { glassAvailable } from "@/ui/Glass";
import { Group, Section } from "@/ui/Group";
import * as haptics from "@/ui/haptics";
import { KeyboardAvoider } from "@/ui/KeyboardAvoider";
import { Segmented } from "@/ui/Segmented";
import { useSheetKeyboardPad } from "@/ui/sheetKeyboard";
import { Text } from "@/ui/Text";

import { modeIcon } from "./modeIcon";
import {
  commandPreview,
  DEFAULT_THINKING_ID,
  isDefaultChoice,
  modeOf,
  modelAliases,
  optionsFor,
  thinkingOf,
  withMode,
  withThinking,
  type PermissionMode,
  type StartChoice,
} from "./startOptions";
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

/**
 * One choice row with a check on the selected one: an optional icon, the label, an optional detail
 * line. A radio for VoiceOver. `accessibilityLabel` is the label, with the detail after it.
 */
function CheckRow({
  label,
  detail,
  Icon,
  danger,
  selected,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  detail?: string;
  Icon?: LucideIcon;
  danger?: boolean;
  selected: boolean;
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={accessibilityLabel ?? (detail ? `${label}. ${detail}` : label)}
      accessibilityState={{ selected, checked: selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: hitTarget,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        backgroundColor: pressed ? colors.raised : "transparent",
      })}
    >
      {Icon ? <Icon size={icon.md} color={danger ? colors.danger : colors.textMuted} strokeWidth={icon.strokeWidth} /> : null}
      <View style={{ flex: 1, gap: space.xxs }}>
        <Text color={danger ? colors.danger : colors.text} maxFontSizeMultiplier={denseScale.row}>
          {label}
        </Text>
        {detail ? (
          <Text variant="small" muted maxFontSizeMultiplier={denseScale.row}>
            {detail}
          </Text>
        ) : null}
      </View>
      <View style={{ width: icon.md }}>{selected ? <Check size={icon.md} color={colors.accent} strokeWidth={icon.strokeWidth} /> : null}</View>
    </Pressable>
  );
}

/** One permission mode row: the mode icon, the label and its detail line. */
function ModeRow({ mode, selected, onPress }: { mode: PermissionMode; selected: boolean; onPress: () => void }) {
  return <CheckRow label={mode.label} detail={mode.detail} Icon={modeIcon(mode)} danger={mode.danger} selected={selected} onPress={onPress} />;
}

/** A mono text field inside a band, with no frame of its own (the band is the frame). */
function BandField(props: ComponentProps<typeof TextInput> & { label: string }) {
  const { label, ...rest } = props;
  return (
    <TextInput
      accessibilityLabel={label}
      placeholderTextColor={colors.textMuted}
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      selectionColor={colors.accent}
      returnKeyType="done"
      maxFontSizeMultiplier={denseScale.row}
      {...rest}
      style={{
        minHeight: hitTarget,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        color: colors.text,
        fontSize: type.size.body,
        fontFamily: fontFamily.mono,
      }}
    />
  );
}

export function StartOptionsSheet({ kind, onClose }: { kind: string; onClose: () => void }) {
  const opts = optionsFor(kind);
  const aliases = modelAliases(kind);
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
  const mode = modeOf(kind, live);
  const level = thinkingOf(kind, live);
  const model = draft.model.trim();
  const alias = aliases.find((a) => a.id === model);
  const command = commandPreview(kind, live);
  const keyboard = useSheetKeyboardPad(START_OPTIONS_DETENT_ANDROID);

  /** Stores one change that is not typed, with the typed text as it is now. */
  const store = (change: (c: StartChoice) => StartChoice) => {
    commit(kind, latest.current);
    rememberChoice(kind, change(choiceFor(useStartOptionsMemory.getState().byKind, kind)));
  };
  const pickModel = (id: string) => {
    setDraft({ model: id });
    commit(kind, latest.current);
  };

  const header = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingLeft: space.lg,
        paddingRight: space.sm,
        // Clear of the grabber on iOS.
        paddingTop: Platform.OS === "ios" ? space.xl : space.lg,
        paddingBottom: space.md,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="title" numberOfLines={1} accessibilityRole="header" maxFontSizeMultiplier={denseScale.row}>
          Start options
        </Text>
        <Text variant="small" muted numberOfLines={1} maxFontSizeMultiplier={denseScale.row}>
          {agentLabel(kind)}
        </Text>
      </View>
      <CloseButton onPress={onClose} />
    </View>
  );

  const scroller = (
    <ScrollView
      style={{ flex: 1 }}
      contentInsetAdjustmentBehavior="never"
      automaticallyAdjustContentInsets={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      // Flush: the grouped bands run full width (design rule 4); free content has its own side inset.
      contentContainerStyle={{ paddingTop: space.sm, paddingBottom: space.xxl, gap: space.xl }}
    >
      {mode ? (
        <Section title="Permission mode">
          <Group>
            {opts.modes.map((m) => (
              <ModeRow
                key={m.id}
                mode={m}
                selected={m.id === mode.id}
                onPress={() => {
                  if (m.id === mode.id) return;
                  haptics.tap();
                  store((c) => withMode(c, m.id));
                }}
              />
            ))}
          </Group>
        </Section>
      ) : null}
      {opts.modelFlag ? (
        <Section title="Model" footer={aliases.length > 0 ? undefined : "Empty: the default model of the agent."}>
          <Group>
            {aliases.length > 0 ? (
              <CheckRow
                label="Default"
                accessibilityLabel="Default model"
                selected={model === ""}
                onPress={() => {
                  if (model === "") return;
                  haptics.tap();
                  pickModel("");
                }}
              />
            ) : null}
            {aliases.map((a) => (
              <CheckRow
                key={a.id}
                label={a.label}
                selected={alias?.id === a.id}
                onPress={() => {
                  if (alias?.id === a.id) return;
                  haptics.tap();
                  pickModel(a.id);
                }}
              />
            ))}
            <BandField
              label={aliases.length > 0 ? "Custom model" : "Model"}
              value={alias ? "" : draft.model}
              onChangeText={(t) => setDraft({ model: t })}
              onEndEditing={() => commit(kind, latest.current)}
              placeholder={aliases.length > 0 ? "Custom model name" : "Model name"}
            />
          </Group>
        </Section>
      ) : null}
      {opts.thinking ? (
        <Section title="Thinking">
          <View style={{ paddingHorizontal: space.lg }}>
            <Segmented
              label="Thinking"
              options={[{ id: DEFAULT_THINKING_ID, label: "Default" }, ...opts.thinking.levels]}
              value={level?.id ?? DEFAULT_THINKING_ID}
              onChange={(id) => store((c) => withThinking(c, id))}
            />
          </View>
        </Section>
      ) : null}
      <Section title="Extra flags" footer="Added after the other flags.">
        <Group>
          <BandField
            label="Extra flags"
            value={draft.extra}
            onChangeText={(t) => setDraft({ extra: t })}
            onEndEditing={() => commit(kind, latest.current)}
            placeholder="--flag value"
          />
        </Group>
      </Section>
      <Section title="Command">
        <View
          style={{
            marginHorizontal: space.lg,
            backgroundColor: colors.sunken,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: colors.divider,
            paddingHorizontal: space.md,
            paddingVertical: space.md,
          }}
        >
          <Text mono selectable maxFontSizeMultiplier={denseScale.row} accessibilityLabel={`Command: ${command}`}>
            {`$ ${command}`}
          </Text>
        </View>
      </Section>
      <View style={{ paddingHorizontal: space.lg }}>
        <Button
          label="Reset to default"
          variant="secondary"
          disabled={isDefaultChoice(kind, live)}
          onPress={() => {
            haptics.tap();
            setDraft({ model: "", extra: "" });
            rememberChoice(kind, {});
          }}
        />
      </View>
    </ScrollView>
  );
  // react-native-screens looks for a scroll view among the top views of a form sheet and sets its
  // frame to the whole sheet. With the header as a sibling, the scroll view then covered the header
  // and ignored the keyboard padding. This wrapper is a real native view (`collapsable={false}`,
  // `overflow: "hidden"`), so the search does not find the scroll view and the flex layout sets its frame.
  const content = (
    <View collapsable={false} style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
      {scroller}
    </View>
  );

  // Android: the sheet is `bg`, so the `card` bands read on it. The keyboard pad replaces the
  // avoiding view (see `useSheetKeyboardPad`).
  if (Platform.OS === "android") {
    return (
      <View ref={keyboard.ref} style={{ flex: 1, backgroundColor: colors.bg, paddingBottom: keyboard.pad }}>
        {header}
        {content}
      </View>
    );
  }
  // iOS 26 draws the sheet as Liquid Glass, so the page color stays off it.
  return (
    <KeyboardAvoider atScreenBottom style={{ backgroundColor: glassAvailable() ? "transparent" : colors.bg }}>
      {header}
      {content}
    </KeyboardAvoider>
  );
}
