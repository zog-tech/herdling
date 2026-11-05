/**
 * The content of the start options sheet: the permission mode, the model, the thinking level (Pi),
 * the extra flags, a preview of the command line and "Reset to default". It reads and writes the
 * remembered options of the kind, so the screen under the sheet shows each change. A tap on a mode
 * or a model chip goes to the store at once. The text fields keep their own text while the user
 * types and go to the store when editing ends or the sheet closes.
 */
import { Check } from "lucide-react-native";
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";

import { agentLabel } from "@/herdr/agentKinds";
import { fontFamily } from "@/theme/fonts";
import { colors, denseScale, hitTarget, icon, radius, space, type } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { CloseButton } from "@/ui/CloseButton";
import { glassAvailable } from "@/ui/Glass";
import * as haptics from "@/ui/haptics";
import { KeyboardAvoider } from "@/ui/KeyboardAvoider";
import { Segmented } from "@/ui/Segmented";
import { useSheetKeyboardPad } from "@/ui/sheetKeyboard";
import { Text } from "@/ui/Text";

import { Chip } from "./Chip";
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

/** A titled part of the sheet: a small uppercase header, the content, and an optional muted footer. */
function Part({ title, footer, children }: { title: string; footer?: string; children: ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="section" accessibilityRole="header" maxFontSizeMultiplier={denseScale.row} style={{ paddingHorizontal: space.lg }}>
        {title}
      </Text>
      {children}
      {footer ? (
        <Text variant="caption" muted maxFontSizeMultiplier={denseScale.row} style={{ paddingHorizontal: space.lg }}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

/** An inset rounded band, as in a native settings sheet. Children are split by inset hairlines. */
function Band({ children }: { children: ReactNode[] }) {
  const rows = children.filter(Boolean);
  return (
    <View style={{ backgroundColor: Platform.OS === "android" ? colors.raised : colors.card, borderRadius: radius.lg, overflow: "hidden" }}>
      {rows.map((row, i) => (
        <View key={i}>
          {i > 0 ? <View style={{ height: StyleSheet.hairlineWidth, marginLeft: space.lg, backgroundColor: colors.divider }} /> : null}
          {row}
        </View>
      ))}
    </View>
  );
}

/** One permission mode row: icon, label, one detail line, and a gold check mark on the selected mode. */
function ModeRow({ mode, selected, onPress }: { mode: PermissionMode; selected: boolean; onPress: () => void }) {
  const Icon = modeIcon(mode);
  const tint = mode.danger ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`${mode.label}. ${mode.detail}`}
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
      <Icon size={icon.md} color={mode.danger ? colors.danger : colors.textMuted} strokeWidth={icon.strokeWidth} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text color={tint} maxFontSizeMultiplier={denseScale.row}>
          {mode.label}
        </Text>
        <Text variant="small" muted maxFontSizeMultiplier={denseScale.row}>
          {mode.detail}
        </Text>
      </View>
      <View style={{ width: icon.md }}>{selected ? <Check size={icon.md} color={colors.accent} strokeWidth={2.5} /> : null}</View>
    </Pressable>
  );
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
      contentContainerStyle={{ paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xxl, gap: space.xl }}
    >
      {mode ? (
        <Part title="Permission mode">
          <Band>
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
          </Band>
        </Part>
      ) : null}
      {opts.modelFlag ? (
        <Part title="Model" footer={aliases.length > 0 ? undefined : "Empty: the default model of the agent."}>
          {aliases.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
              <Chip label="Default" accessibilityLabel="Default model" selected={model === ""} onPress={() => pickModel("")} />
              {aliases.map((a) => (
                <Chip key={a.id} label={a.label} selected={alias?.id === a.id} onPress={() => pickModel(a.id)} />
              ))}
            </View>
          ) : null}
          <Band>
            {[
              <BandField
                key="model"
                label={aliases.length > 0 ? "Custom model" : "Model"}
                value={alias ? "" : draft.model}
                onChangeText={(t) => setDraft({ model: t })}
                onEndEditing={() => commit(kind, latest.current)}
                placeholder={aliases.length > 0 ? "Custom model name" : "Model name"}
              />,
            ]}
          </Band>
        </Part>
      ) : null}
      {opts.thinking ? (
        <Part title="Thinking">
          <Segmented
            label="Thinking"
            options={[{ id: DEFAULT_THINKING_ID, label: "Default" }, ...opts.thinking.levels]}
            value={level?.id ?? DEFAULT_THINKING_ID}
            onChange={(id) => store((c) => withThinking(c, id))}
          />
        </Part>
      ) : null}
      <Part title="Extra flags" footer="Added after the other flags.">
        <Band>
          {[
            <BandField
              key="extra"
              label="Extra flags"
              value={draft.extra}
              onChangeText={(t) => setDraft({ extra: t })}
              onEndEditing={() => commit(kind, latest.current)}
              placeholder="--flag value"
            />,
          ]}
        </Band>
      </Part>
      <Part title="Command">
        <View
          style={{
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
      </Part>
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

  // Android: the sheet is `card`, and the keyboard pad replaces the avoiding view (see `useSheetKeyboardPad`).
  if (Platform.OS === "android") {
    return (
      <View ref={keyboard.ref} style={{ flex: 1, backgroundColor: colors.card, paddingBottom: keyboard.pad }}>
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
