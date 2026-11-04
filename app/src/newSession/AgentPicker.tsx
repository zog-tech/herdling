import type { AgentsInstalled } from "@herdling/protocol";
import { useRef } from "react";
import { Pressable, ScrollView, View, type ScrollViewInstance } from "react-native";

import { agentLabel } from "@/herdr/agentKinds";
import { colors, denseScale, hitTarget, radius, space, state } from "@/theme/tokens";
import { AgentMark } from "@/ui/AgentMark";
import * as haptics from "@/ui/haptics";
import { TerminalMark } from "@/ui/TerminalMark";
import { Text } from "@/ui/Text";

import { availability, pickerChoices, SHELL_CHOICE } from "./installed";
import { revealOffset } from "./pickerScroll";

/**
 * The agent row at the top of New session: one chip per agent kind, in a row that scrolls
 * sideways. The chosen agent is gold. An agent that the host reports as not installed steps back
 * and says "Not installed"; it can still be chosen, because the check can miss a custom PATH.
 * The first chip, Shell, starts a plain terminal with no agent.
 */
export function AgentPicker({
  value,
  onChange,
  installed,
  disabled,
}: {
  value: string;
  onChange: (kind: string) => void;
  installed: AgentsInstalled | undefined;
  disabled?: boolean;
}) {
  const kinds = pickerChoices(installed);
  const scroll = useRef<ScrollViewInstance>(null);
  const chips = useRef(new Map<string, { x: number; width: number }>());
  const viewport = useRef(0);
  const shown = useRef(false);
  // Bring a remembered agent far down the row into view once, not on every tap. The parent
  // gives the picker a new key for each host, so a host change shows its agent again. Only when
  // the chip is out of view: a scroll to a chip in view hides the Shell chip before it.
  const reveal = () => {
    const chip = chips.current.get(value);
    if (shown.current || !chip || viewport.current <= 0) return;
    shown.current = true;
    const x = revealOffset(chip.x, chip.width, viewport.current, space.lg);
    if (x !== undefined) scroll.current?.scrollTo({ x, animated: false });
  };

  return (
    <ScrollView
      ref={scroll}
      horizontal
      onLayout={(e) => {
        viewport.current = e.nativeEvent.layout.width;
        reveal();
      }}
      showsHorizontalScrollIndicator={false}
      accessibilityRole="radiogroup"
      accessibilityLabel="Agent"
      // The page has side padding: let the row run to the screen edges.
      style={{ marginHorizontal: -space.lg }}
      contentContainerStyle={{ paddingHorizontal: space.lg, gap: space.sm }}
    >
      {kinds.map((k) => {
        const selected = k === value;
        const shell = k === SHELL_CHOICE;
        const missing = !shell && availability(k, installed) === "missing";
        const label = shell ? "Shell" : agentLabel(k);
        return (
          <Pressable
            key={k}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected, disabled: !!disabled }}
            accessibilityLabel={missing ? `${label}, not installed` : label}
            disabled={disabled}
            onLayout={(e) => {
              chips.current.set(k, { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width });
              if (k === value) reveal();
            }}
            onPress={() => {
              if (selected) return;
              haptics.tap();
              onChange(k);
            }}
            style={({ pressed }) => ({
              minHeight: hitTarget,
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
              paddingLeft: space.sm,
              paddingRight: space.md,
              paddingVertical: space.xs,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: selected ? colors.accent : colors.border,
              backgroundColor: selected ? (pressed ? colors.accentPressed : colors.accent) : pressed ? colors.raised : "transparent",
              opacity: missing && !selected ? state.offlineOpacity : 1,
            })}
          >
            {shell ? <TerminalMark /> : <AgentMark kind={k} />}
            <View>
              <Text bold color={selected ? colors.onAccent : colors.text} maxFontSizeMultiplier={denseScale.row} numberOfLines={1}>
                {label}
              </Text>
              {missing ? (
                <Text variant="caption" color={selected ? colors.onAccent : colors.textMuted} maxFontSizeMultiplier={denseScale.pill}>
                  Not installed
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
