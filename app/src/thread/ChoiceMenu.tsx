import { ChevronDown, ChevronUp, MessagesSquare, PenLine } from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";

import { colors, denseScale, hitTarget, icon, radius, space, state } from "@/theme/tokens";
import { Text } from "@/ui/Text";

import { choiceView, destructiveKey, isFreeform, type Choice } from "./parseChoices";

/** The menu takes at most this share of the window height and scrolls inside, so the thread stays visible. */
const MAX_HEIGHT_SHARE = 0.55;
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
 * The header shows the question from the screen. Each option is a row: the digit in a keycap, the
 * title, a "Recommended" chip and the detail (2 lines, the chevron shows all). The built-in
 * free-text options ("Type something.", "Chat about this") are small pills under the rows.
 * A tap sends the digit through `onPick`. The terminal cursor (`selected`) has no style: it means nothing on the phone.
 */
export function ChoiceMenu({
  choices,
  question,
  agent,
  onPick,
  onType,
  disabled,
}: {
  choices: Choice[];
  question?: string;
  /** The herdr agent kind, for "Claude asks". */
  agent?: string;
  onPick: (c: Choice) => void;
  /** Called after a tap on "Type something.": the composer takes the focus. */
  onType?: () => void;
  disabled?: boolean;
}) {
  const { height } = useWindowDimensions();
  const [overflow, setOverflow] = useState({ box: 0, content: 0 });
  const danger = destructiveKey(choices);
  const rows = choices.filter((c) => !isFreeform(c));
  const freeform = choices.filter(isFreeform);
  const who = (agent && AGENT_NAMES[agent]) || "The agent";
  const scrolls = overflow.content > overflow.box + 1;

  return (
    <View style={{ maxHeight: height * MAX_HEIGHT_SHARE, gap: space.sm, opacity: disabled ? state.disabledOpacity : 1 }}>
      <View
        style={{
          gap: space.xs / 2,
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
            <Text variant="headline" numberOfLines={3} accessibilityLiveRegion="polite">
              {question}
            </Text>
          </>
        ) : (
          <Text variant="small" bold color={colors.status.blocked} accessibilityLiveRegion="polite">
            {who} asks you to choose
          </Text>
        )}
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
          <OptionRow key={c.key} choice={c} destructive={c.key === danger} disabled={disabled} onPick={onPick} />
        ))}
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

/** "1. Title. Detail. Recommended" for VoiceOver and TalkBack. The detail is always complete here. */
export function optionLabel(choice: Choice): string {
  const v = choiceView(choice);
  return [`${choice.key}. ${v.title}`, v.detail, v.recommended ? "Recommended" : undefined]
    .filter((p): p is string => !!p)
    .map((p) => p.replace(/[.\s]+$/, ""))
    .join(". ");
}

function OptionRow({
  choice,
  destructive,
  disabled,
  onPick,
}: {
  choice: Choice;
  destructive: boolean;
  disabled?: boolean;
  onPick: (c: Choice) => void;
}) {
  const v = choiceView(choice);
  const [pressed, setPressed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [cut, setCut] = useState(() => (v.detail?.length ?? 0) > DETAIL_GUESS);
  const showMore = !!v.detail && cut;

  return (
    <View
      style={{
        flexDirection: "row",
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: v.recommended ? colors.accent : colors.divider,
        // Press feedback: the row dims to the raised fill. No scale: the list must not move under the finger.
        backgroundColor: pressed ? colors.raised : colors.card,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={optionLabel(choice)}
        accessibilityState={{ disabled: !!disabled, selected: choice.selected }}
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
        <View
          style={{
            minWidth: KEYCAP,
            minHeight: KEYCAP,
            borderRadius: radius.sm,
            backgroundColor: colors.raised,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text variant="caption" mono muted maxFontSizeMultiplier={denseScale.pill}>
            {choice.key}
          </Text>
        </View>
        <View style={{ flex: 1, gap: space.xs / 2 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space.sm, rowGap: space.xs / 2 }}>
            <Text bold color={destructive ? colors.danger : colors.text} numberOfLines={TITLE_LINES} style={{ flexShrink: 1 }}>
              {v.title}
            </Text>
            {v.recommended ? <RecommendedChip /> : null}
          </View>
          {v.detail ? (
            <View>
              <Text variant="small" muted numberOfLines={expanded ? undefined : DETAIL_LINES}>
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
          {expanded ? <ChevronUp size={icon.sm} color={colors.textMuted} /> : <ChevronDown size={icon.sm} color={colors.textMuted} />}
        </Pressable>
      ) : null}
    </View>
  );
}

function RecommendedChip() {
  return (
    <View style={{ borderRadius: radius.pill, backgroundColor: colors.accentTint, paddingHorizontal: space.sm }}>
      <Text variant="caption" bold color={colors.accent} maxFontSizeMultiplier={denseScale.pill}>
        Recommended
      </Text>
    </View>
  );
}

/** A built-in free-text option as a small secondary pill. */
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
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: pressed ? colors.raised : colors.card,
      })}
    >
      <Icon size={icon.sm} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
      <Text variant="small" maxFontSizeMultiplier={denseScale.row}>
        {label}
      </Text>
    </Pressable>
  );
}
