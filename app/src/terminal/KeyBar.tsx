/**
 * The key bar of the terminal view: Esc, the one-shot modifiers Ctrl and Alt, Tab, Shift-Tab, ^C,
 * Enter, the arrows and the custom keys of Settings, in a row that pages sideways (with page dots
 * when it overflows). A drag pad at the right gives arrow keys. The rules are in `keyRules.ts`;
 * the owner encodes and sends each input. Taps keep the keyboard open.
 *
 * A key is a small secondary button (design rule 2): a `raised` fill, no edge, `raisedHigh` when
 * pressed. ^C has the `danger` label. An armed Ctrl or Alt has the accent label (the selected
 * state); a locked one also has the `accentTint` fill.
 */
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CornerDownLeft, Move, type LucideIcon } from "lucide-react-native";
import { useCallback, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { fontFamily } from "@/theme/fonts";
import { colors, denseScale, dot, hitTarget, icon, radius, space, state, type } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { Text } from "@/ui/Text";

import { keyA11y, keyLabel, useCustomKeys } from "./customKeys";
import { padStep, pageCount, pageOf, type BarInput, type Mod, type ModEvent, type ModState } from "./keyRules";

type BarKey =
  | { id: string; kind: "key"; key: string; label: string; a11y: string; Icon?: LucideIcon; danger?: boolean }
  | { id: string; kind: "mod"; mod: Mod; label: string; a11y: string };

/** The fixed keys, left to right. The a11y labels stay as the old key row had them. */
const BASE: readonly BarKey[] = [
  { id: "esc", kind: "key", key: "esc", label: "Esc", a11y: "Escape" },
  { id: "ctrl", kind: "mod", mod: "ctrl", label: "Ctrl", a11y: "Control" },
  { id: "alt", kind: "mod", mod: "alt", label: "Alt", a11y: "Alt" },
  { id: "tab", kind: "key", key: "tab", label: "Tab", a11y: "Tab" },
  { id: "shift+tab", kind: "key", key: "shift+tab", label: "⇧Tab", a11y: "Shift Tab" },
  { id: "ctrl+c", kind: "key", key: "ctrl+c", label: "^C", a11y: "Control C", danger: true },
  { id: "enter", kind: "key", key: "enter", label: "Enter", a11y: "Enter", Icon: CornerDownLeft },
  { id: "up", kind: "key", key: "up", label: "Up", a11y: "Up arrow", Icon: ArrowUp },
  { id: "down", kind: "key", key: "down", label: "Down", a11y: "Down arrow", Icon: ArrowDown },
  { id: "left", kind: "key", key: "left", label: "Left", a11y: "Left arrow", Icon: ArrowLeft },
  { id: "right", kind: "key", key: "right", label: "Right", a11y: "Right arrow", Icon: ArrowRight },
];

function KeyButton({
  label,
  a11y,
  hint,
  Icon,
  tint,
  fill,
  selected,
  disabled,
  onPress,
  onLongPress,
}: {
  label: string;
  a11y: string;
  hint?: string;
  Icon?: LucideIcon;
  tint: string;
  fill: string;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled, ...(selected === undefined ? {} : { selected }) }}
      disabled={disabled}
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => ({
        minWidth: hitTarget,
        height: hitTarget,
        paddingHorizontal: space.sm,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: radius.sm,
        backgroundColor: pressed ? colors.raisedHigh : fill,
      })}
    >
      {Icon ? (
        <Icon size={icon.md} color={tint} strokeWidth={icon.strokeWidth} />
      ) : (
        <Text maxFontSizeMultiplier={denseScale.pill} style={{ fontFamily: fontFamily.mono, fontSize: type.size.small, color: tint }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/** A square that turns a drag into arrow keys: one key per `PAD_STEP` points. */
function DragPad({ disabled, onKey }: { disabled?: boolean; onKey: (key: string) => void }) {
  const acc = useRef({ x: 0, y: 0 });
  const last = useSharedValue({ x: 0, y: 0 });
  const move = useCallback(
    (dx: number, dy: number) => {
      const r = padStep(acc.current, dx, dy);
      acc.current = r.acc;
      for (const k of r.keys) {
        haptics.tap();
        onKey(k);
      }
    },
    [onKey],
  );
  const reset = useCallback(() => {
    acc.current = { x: 0, y: 0 };
  }, []);
  const gesture = usePanGesture({
    enabled: !disabled,
    minDistance: 2,
    onActivate: () => {
      last.set({ x: 0, y: 0 });
      scheduleOnRN(reset);
    },
    onUpdate: (e) => {
      const p = last.get();
      last.set({ x: e.translationX, y: e.translationY });
      scheduleOnRN(move, e.translationX - p.x, e.translationY - p.y);
    },
  });
  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityLabel="Arrow pad"
        accessibilityHint="Drag to press the arrow keys. The arrow buttons on the key bar do the same."
        style={{
          width: hitTarget + space.lg,
          height: hitTarget,
          borderRadius: radius.sm,
          backgroundColor: colors.raised,
          alignItems: "center",
          justifyContent: "center",
          opacity: disabled ? state.disabledOpacity : 1,
        }}
      >
        <Move size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
      </View>
    </GestureDetector>
  );
}

export function KeyBar({
  mods,
  disabled,
  onMod,
  onInput,
}: {
  mods: ModState;
  disabled?: boolean;
  onMod: (e: ModEvent) => void;
  onInput: (input: BarInput) => void;
}) {
  const custom = useCustomKeys((s) => s.keys);
  const [view, setView] = useState(0);
  const [content, setContent] = useState(0);
  const [page, setPage] = useState(0);
  const pages = pageCount(content, view);
  const muted = disabled ? colors.textMuted : colors.text;
  const tap = (input: BarInput) => {
    haptics.tap();
    onInput(input);
  };
  const padKey = useCallback((key: string) => onInput({ kind: "key", key }), [onInput]);

  return (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.md }}>
        <ScrollView
          horizontal
          pagingEnabled
          keyboardShouldPersistTaps="always"
          showsHorizontalScrollIndicator={false}
          onLayout={(e) => setView(e.nativeEvent.layout.width)}
          onContentSizeChange={(w) => setContent(w)}
          onScroll={(e) => setPage(pageOf(e.nativeEvent.contentOffset.x, view))}
          scrollEventThrottle={100}
          contentContainerStyle={{ gap: space.xs }}
          style={{ flex: 1, flexGrow: 1 }}
        >
          {BASE.map((k) => {
            if (k.kind === "mod") {
              const on = mods.mod === k.mod;
              const locked = on && mods.mod !== null && mods.locked;
              return (
                <KeyButton
                  key={k.id}
                  label={k.label}
                  a11y={k.a11y}
                  hint="The next key goes with this modifier. Long press to keep it on."
                  tint={disabled ? colors.textMuted : on ? colors.accent : colors.text}
                  fill={locked ? colors.accentTint : colors.raised}
                  selected={on}
                  disabled={disabled}
                  onPress={() => {
                    haptics.tap();
                    onMod({ type: "tap", mod: k.mod });
                  }}
                  onLongPress={() => {
                    haptics.press();
                    onMod({ type: "hold", mod: k.mod });
                  }}
                />
              );
            }
            return (
              <KeyButton
                key={k.id}
                label={k.label}
                a11y={k.a11y}
                Icon={k.Icon}
                tint={disabled ? colors.textMuted : k.danger ? colors.danger : colors.text}
                fill={colors.raised}
                disabled={disabled}
                onPress={() => tap({ kind: "key", key: k.key })}
              />
            );
          })}
          {custom.map((c, i) => (
            <KeyButton
              key={`c${i}`}
              label={keyLabel(c)}
              a11y={keyA11y(c)}
              tint={muted}
              fill={colors.raised}
              disabled={disabled}
              onPress={() => tap(c.kind === "key" ? { kind: "key", key: c.key } : { kind: "text", text: c.text, enter: c.enter })}
            />
          ))}
        </ScrollView>
        <DragPad disabled={disabled} onKey={padKey} />
      </View>
      {pages > 1 ? (
        <View
          accessibilityLabel={`Key bar page ${page + 1} of ${pages}`}
          style={{ flexDirection: "row", justifyContent: "center", gap: space.xs }}
        >
          {Array.from({ length: pages }, (_, i) => (
            <View
              key={i}
              style={{ width: dot.size - 2, height: dot.size - 2, borderRadius: dot.size, backgroundColor: i === page ? colors.text : colors.divider }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
