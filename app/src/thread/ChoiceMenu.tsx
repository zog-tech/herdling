import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ListChecks,
  Maximize2,
  MessagesSquare,
  PenLine,
  Square,
  SquareCheck,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";

import { fontFamily } from "@/theme/fonts";
import { colors, denseScale, hitTarget, icon, radius, space, state, type } from "@/theme/tokens";
import { useKeyboardHeight } from "@/ui/KeyboardAvoider";
import { Text } from "@/ui/Text";

import { HScrollView } from "./HScrollView";
import { approveKey, choiceView, destructiveKey, isFreeform, type Choice } from "./parseChoices";
import type { QuestionTabs, TabMove } from "./questionTabs";
import { openSelectText } from "./selectText";

/** The menu takes at most this share of the window height and scrolls inside, so the thread stays visible. */
const MAX_HEIGHT_SHARE = 0.55;
/**
 * With the keyboard up, the menu takes at most this share of the space above the keyboard. The
 * prompt box and its buttons need the rest: a long answer must not push them under the keyboard.
 */
const KEYBOARD_SHARE = 0.3;
/** The menu never gets lower than this: the header and part of one option stay visible. */
const MIN_HEIGHT = 96;

/** The highest the menu can be, in points, for a window height and a keyboard height (0: hidden). */
export function menuMaxHeight(windowHeight: number, keyboardHeight: number): number {
  if (keyboardHeight <= 0) return Math.round(windowHeight * MAX_HEIGHT_SHARE);
  return Math.max(MIN_HEIGHT, Math.round((windowHeight - keyboardHeight) * KEYBOARD_SHARE));
}
/** The line height of the prompt context. The box shows at most `CONTEXT_ROWS` lines and scrolls inside. */
const CONTEXT_LINE_HEIGHT = 18;
const CONTEXT_ROWS = 8;
/** The context box never takes more than this share of the menu: the options stay visible. */
const CONTEXT_SHARE = 0.4;

/** The highest the context box can be, in points, for the highest the menu can be. */
export function contextMaxHeight(menuMax: number): number {
  return Math.min(CONTEXT_ROWS * CONTEXT_LINE_HEIGHT + 2 * space.sm, Math.round(menuMax * CONTEXT_SHARE));
}
/** The digit keycap: one line of body text high, so it lines up with the first line of the title. */
const KEYCAP = 24;
const TITLE_LINES = 2;
const DETAIL_LINES = 2;
/** Before the first text layout: a detail longer than this is probably cut at 2 lines. */
const DETAIL_GUESS = 100;

/** The names of the agent kinds in the header ("Claude asks"). Other kinds get "The agent". */
const AGENT_NAMES: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  pi: "Pi",
  opencode: "OpenCode",
  omp: "omp",
  gemini: "Gemini",
};

/**
 * The numbered menu of an agent (a permission prompt or a question), above the composer.
 * The header shows the question from the screen and, for a permission prompt, its context (the
 * command and the warning) in a small box that scrolls inside. The box hides while the keyboard is
 * up, because the prompt box needs the space. Each option is a row in the button look of the kit
 * (no border): the digit in a keycap, the title, a "Recommended" tag and the detail (2 lines, the
 * chevron shows all). The approve option of a permission prompt (`approveKey`) is the primary
 * button (accent fill); the "No" option is the danger button; the others are secondary buttons.
 * The built-in free-text options ("Type something.", "Chat about this") are secondary buttons under
 * the rows.
 * A tap answers through `onPick` (the digit, or the arrow keys and Enter for a menu with no numbers).
 * A menu with no numbers also shows a keycap: the number is the place of the option. The terminal cursor (`selected`) has no style: it means nothing on the phone.
 * An AskUserQuestion with more than one question shows its tabs above the header (`TabStrip`): a
 * tap on a tab, or on the arrows, moves through `onTab`. A multi-select option shows a checkbox in
 * place of the keycap; a tap turns it on or off. "Next" goes to the next tab.
 */
export function ChoiceMenu({
  choices,
  question,
  context,
  agent,
  tabs,
  next,
  onPick,
  onTab,
  onType,
  disabled,
}: {
  choices: Choice[];
  question?: string;
  /** The question tabs (`parseMenu`). */
  tabs?: QuestionTabs;
  /** The "Next" row of a multi-select question (`parseMenu`). */
  next?: { selected: boolean };
  /** A move to another question tab. */
  onTab?: (move: TabMove) => void;
  /** The body of the permission prompt above the question (`parseMenu`). */
  context?: string;
  /** The herdr agent kind, for "Claude asks". */
  agent?: string;
  onPick: (c: Choice) => void;
  /** Called after a tap on "Type something.": the composer takes the focus. */
  onType?: () => void;
  disabled?: boolean;
}) {
  const { height } = useWindowDimensions();
  const keyboard = useKeyboardHeight();
  const [overflow, setOverflow] = useState({ box: 0, content: 0 });
  const danger = destructiveKey(choices);
  const approve = approveKey(choices);
  const rows = choices.filter((c) => !isFreeform(c));
  const freeform = choices.filter(isFreeform);
  const who = (agent && AGENT_NAMES[agent]) || "The agent";
  const scrolls = overflow.content > overflow.box + 1;
  const menuMax = menuMaxHeight(height, keyboard);

  return (
    <View style={{ maxHeight: menuMax, gap: space.sm, opacity: disabled ? state.disabledOpacity : 1 }}>
      {tabs && onTab ? <TabStrip tabs={tabs} disabled={disabled} onTab={onTab} /> : null}
      <View
        style={{
          gap: space.xxs,
          // A rule under the header only when the options scroll under it.
          paddingBottom: scrolls ? space.sm : 0,
          borderBottomWidth: scrolls ? 1 : 0,
          borderBottomColor: colors.divider,
        }}
      >
        {question ? (
          <>
            <Text variant="small" bold color={colors.status.blocked}>
              {who} asks
            </Text>
            <Text variant="headline" numberOfLines={keyboard > 0 ? 1 : 3} accessibilityLiveRegion="polite">
              {question}
            </Text>
          </>
        ) : (
          <Text variant="small" bold color={colors.status.blocked} accessibilityLiveRegion="polite">
            {who} asks you to choose
          </Text>
        )}
        {context && keyboard <= 0 ? <PromptContext text={context} maxHeight={contextMaxHeight(menuMax)} /> : null}
      </View>
      <ScrollView
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ gap: space.xs }}
        keyboardShouldPersistTaps="handled"
        onLayout={(e) => {
          const box = e.nativeEvent.layout.height;
          setOverflow((o) => (o.box === box ? o : { ...o, box }));
        }}
        onContentSizeChange={(_w, content) => setOverflow((o) => (o.content === content ? o : { ...o, content }))}
      >
        {rows.map((c) => (
          <OptionRow key={c.key} choice={c} role={c.key === approve ? "approve" : c.key === danger ? "destructive" : "plain"} disabled={disabled} onPick={onPick} />
        ))}
        {next && onTab ? <NextButton disabled={disabled} onPress={() => onTab({ by: 1 })} /> : null}
        {freeform.length > 0 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, paddingTop: space.xs }}>
            {freeform.map((c) => (
              <FreeformPill
                key={c.key}
                choice={c}
                disabled={disabled}
                onPress={() => {
                  onPick(c);
                  if (/^Type/i.test(c.label)) onType?.();
                }}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/**
 * The command and the warning of a permission prompt, in mono on `sunken`. It scrolls inside its
 * box; "Show all" opens the text on the "Select text" screen when it does not fit.
 */
function PromptContext({ text, maxHeight }: { text: string; maxHeight: number }) {
  const [size, setSize] = useState({ box: 0, content: 0 });
  const cut = size.content > size.box + 1;
  return (
    <View style={{ gap: space.xxs, marginTop: space.xs }}>
      <ScrollView
        nestedScrollEnabled
        style={{ flexGrow: 0, maxHeight, backgroundColor: colors.sunken, borderRadius: radius.sm }}
        contentContainerStyle={{ padding: space.sm }}
        onLayout={(e) => {
          const box = e.nativeEvent.layout.height;
          setSize((s) => (s.box === box ? s : { ...s, box }));
        }}
        onContentSizeChange={(_w, content) => setSize((s) => (s.content === content ? s : { ...s, content }))}
      >
        <Text
          selectable
          accessibilityLabel={`Prompt details: ${text}`}
          style={{ fontFamily: fontFamily.mono, fontSize: type.size.caption, lineHeight: CONTEXT_LINE_HEIGHT, color: colors.text }}
        >
          {text}
        </Text>
      </ScrollView>
      {cut ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show all of the prompt"
          onPress={() => openSelectText({ title: "Prompt", text })}
          style={({ pressed }) => ({
            alignSelf: "flex-start",
            minHeight: hitTarget,
            flexDirection: "row",
            alignItems: "center",
            gap: space.xs,
            opacity: pressed ? state.pressedOpacity : 1,
          })}
        >
          <Maximize2 size={icon.sm} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
          <Text variant="small" muted>
            Show all
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * The tabs of an AskUserQuestion with more than one question, in one row that scrolls sideways,
 * between a "previous" and a "next" arrow. The current tab has the selected style. An answered
 * tab has a check; the last tab ("Submit") has a list icon. The arrows show also while the current
 * tab is unknown: they move one tab from where the terminal is.
 */
export function TabStrip({ tabs, disabled, onTab }: { tabs: QuestionTabs; disabled?: boolean; onTab: (move: TabMove) => void }) {
  const at = tabs.current;
  const last = tabs.items.length - 1;
  const questions = tabs.items.filter((t) => !t.submit).length;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
      <ArrowButton dir={-1} disabled={disabled || at === 0} onPress={() => onTab({ by: -1 })} />
      <HScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: space.xs, alignItems: "center" }} showsHorizontalScrollIndicator={false}>
        {tabs.items.map((t, i) => {
          const current = i === at;
          const Icon = t.submit ? ListChecks : t.answered ? SquareCheck : Square;
          const tint = current ? colors.accent : t.answered ? colors.text : colors.textMuted;
          return (
            <Pressable
              key={i}
              accessibilityRole="tab"
              accessibilityLabel={tabLabel(t, i, questions)}
              accessibilityState={{ selected: current, disabled: !!disabled }}
              disabled={disabled}
              onPress={() => onTab({ to: i })}
              style={({ pressed }) => ({
                minHeight: hitTarget,
                flexDirection: "row",
                alignItems: "center",
                gap: space.xs,
                paddingHorizontal: space.md,
                // A segment look, no border: the current tab steps up one fill and has the accent text.
                borderRadius: radius.md,
                backgroundColor: current || pressed ? colors.raisedHigh : colors.raised,
              })}
            >
              <Icon size={icon.sm} color={tint} strokeWidth={icon.strokeWidth} />
              <Text variant="small" bold={current} color={current ? colors.accent : colors.text} maxFontSizeMultiplier={denseScale.row}>
                {t.title || (t.submit ? "Submit" : `Question ${i + 1}`)}
              </Text>
            </Pressable>
          );
        })}
      </HScrollView>
      <ArrowButton dir={1} disabled={disabled || at === last} onPress={() => onTab({ by: 1 })} />
    </View>
  );
}

/** "Content, question 2 of 3, answered" for VoiceOver and TalkBack. `questions`: the tabs that are not "Submit". */
export function tabLabel(tab: QuestionTabs["items"][number], i: number, questions: number): string {
  if (tab.submit) return `${tab.title || "Submit"}, review the answers`;
  return [tab.title || `Question ${i + 1}`, `question ${i + 1} of ${questions}`, tab.answered ? "answered" : "not answered"].join(", ");
}

function ArrowButton({ dir, disabled, onPress }: { dir: -1 | 1; disabled?: boolean; onPress: () => void }) {
  const Icon = dir < 0 ? ChevronLeft : ChevronRight;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={dir < 0 ? "Previous question" : "Next question"}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: hitTarget,
        minHeight: hitTarget,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? state.disabledOpacity : pressed ? state.pressedOpacity : 1,
      })}
    >
      <Icon size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
    </Pressable>
  );
}

/** The "Next" row of a multi-select question: it goes to the next tab. */
function NextButton({ disabled, onPress }: { disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Next"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        alignSelf: "flex-start",
        minHeight: hitTarget,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        paddingHorizontal: space.lg,
        borderRadius: radius.md,
        backgroundColor: pressed ? colors.accentPressed : colors.accent,
      })}
    >
      <Text bold color={colors.onAccent} maxFontSizeMultiplier={denseScale.row}>
        Next
      </Text>
      <ChevronRight size={icon.sm} color={colors.onAccent} strokeWidth={icon.strokeWidth} />
    </Pressable>
  );
}

/** "1. Title. Detail. Recommended" for VoiceOver and TalkBack. The detail is always complete here. */
export function optionLabel(choice: Choice): string {
  const v = choiceView(choice);
  return [`${choice.key}. ${v.title}`, v.detail, v.recommended ? "Recommended" : undefined]
    .filter((p): p is string => !!p)
    .map((p) => p.replace(/[.\s]+$/, ""))
    .join(". ");
}

/** The button look of an option: the approve option is primary, "No" is danger, the rest secondary. */
type OptionRole = "approve" | "destructive" | "plain";

function OptionRow({
  choice,
  role,
  disabled,
  onPick,
}: {
  choice: Choice;
  role: OptionRole;
  disabled?: boolean;
  onPick: (c: Choice) => void;
}) {
  const v = choiceView(choice);
  const approve = role === "approve";
  const fg = approve ? colors.onAccent : role === "destructive" ? colors.danger : colors.text;
  const muted = approve ? colors.onAccent : colors.textMuted;
  const checkbox = choice.checked !== undefined;
  const Box = choice.checked ? SquareCheck : Square;
  const [pressed, setPressed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [cut, setCut] = useState(() => (v.detail?.length ?? 0) > DETAIL_GUESS);
  const showMore = !!v.detail && cut;

  return (
    <View
      style={{
        flexDirection: "row",
        borderRadius: radius.md,
        // Press feedback: the fill steps (accent to `accentPressed`, `raised` to `raisedHigh`). No scale: the list must not move under the finger.
        backgroundColor: approve ? (pressed ? colors.accentPressed : colors.accent) : pressed ? colors.raisedHigh : colors.raised,
      }}
    >
      <Pressable
        accessibilityRole={checkbox ? "checkbox" : "button"}
        accessibilityLabel={optionLabel(choice)}
        accessibilityState={checkbox ? { disabled: !!disabled, checked: !!choice.checked } : { disabled: !!disabled, selected: choice.selected }}
        disabled={disabled}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        onPress={() => onPick(choice)}
        style={{
          flex: 1,
          minHeight: hitTarget,
          flexDirection: "row",
          alignItems: "flex-start",
          gap: space.sm,
          paddingVertical: (hitTarget - KEYCAP) / 2,
          paddingLeft: space.md,
          paddingRight: showMore ? 0 : space.md,
        }}
      >
        {checkbox ? (
          <View style={{ minWidth: KEYCAP, minHeight: KEYCAP, alignItems: "center", justifyContent: "center" }}>
            <Box size={icon.md} color={choice.checked ? colors.accent : muted} strokeWidth={icon.strokeWidth} />
          </View>
        ) : (
          <View
            style={{
              minWidth: KEYCAP,
              minHeight: KEYCAP,
              borderRadius: radius.sm,
              // The keycap steps one fill up from the row, or sits on the accent as a darker tone.
              backgroundColor: approve ? colors.accentPressed : colors.raisedHigh,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text variant="caption" mono color={muted} maxFontSizeMultiplier={denseScale.pill}>
              {choice.key}
            </Text>
          </View>
        )}
        <View style={{ flex: 1, gap: space.xxs }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space.sm, rowGap: space.xxs }}>
            <Text bold color={fg} numberOfLines={TITLE_LINES} style={{ flexShrink: 1 }}>
              {v.title}
            </Text>
            {v.recommended ? <RecommendedChip /> : null}
          </View>
          {v.detail ? (
            <View>
              <Text variant="small" color={muted} numberOfLines={expanded ? undefined : DETAIL_LINES}>
                {v.detail}
              </Text>
              {/* Not visible: the full detail at the same width, to count its lines. */}
              <Text
                variant="small"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                pointerEvents="none"
                style={{ position: "absolute", left: 0, right: 0, opacity: 0 }}
                onTextLayout={(e) => setCut(e.nativeEvent.lines.length > DETAIL_LINES)}
              >
                {v.detail}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
      {showMore ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show the full option"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded((x) => !x)}
          style={({ pressed: p }) => ({
            width: hitTarget,
            minHeight: hitTarget,
            alignItems: "center",
            justifyContent: "center",
            opacity: p ? state.pressedOpacity : 1,
          })}
        >
          {expanded ? <ChevronUp size={icon.sm} color={muted} /> : <ChevronDown size={icon.sm} color={muted} />}
        </Pressable>
      ) : null}
    </View>
  );
}

/** A quiet tag (the `ui/Tag` shape, radius `sm`) in the accent tint: the agent marks the option. */
function RecommendedChip() {
  return (
    <View style={{ borderRadius: radius.sm, backgroundColor: colors.accentTint, paddingHorizontal: space.sm }}>
      <Text variant="caption" bold color={colors.accent} maxFontSizeMultiplier={denseScale.pill}>
        Recommended
      </Text>
    </View>
  );
}

/** A built-in free-text option as a secondary button (`raised` fill, no border). */
function FreeformPill({ choice, disabled, onPress }: { choice: Choice; disabled?: boolean; onPress: () => void }) {
  const typing = /^Type/i.test(choice.label);
  const label = typing ? "Type an answer" : "Chat about this";
  const Icon = typing ? PenLine : MessagesSquare;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${choice.key}. ${label}`}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: hitTarget,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        backgroundColor: pressed ? colors.raisedHigh : colors.raised,
      })}
    >
      <Icon size={icon.sm} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
      <Text variant="small" maxFontSizeMultiplier={denseScale.row}>
        {label}
      </Text>
    </Pressable>
  );
}
