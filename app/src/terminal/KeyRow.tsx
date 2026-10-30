import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CornerDownLeft, type LucideIcon } from "lucide-react-native";
import { Pressable, ScrollView } from "react-native";

import { fontFamily } from "@/theme/fonts";
import { colors, hitTarget, radius, space, type } from "@/theme/tokens";
import { Text } from "@/ui/Text";

import { KEYS } from "./keys";
import * as haptics from "@/ui/haptics";

const ICONS: Record<string, LucideIcon> = {
  up: ArrowUp,
  down: ArrowDown,
  left: ArrowLeft,
  right: ArrowRight,
  enter: CornerDownLeft,
};

const A11Y: Record<string, string> = {
  up: "Up arrow",
  down: "Down arrow",
  left: "Left arrow",
  right: "Right arrow",
  "ctrl+c": "Control C",
  esc: "Escape",
};

/** One row of terminal keys (Esc, Tab, Ctrl-C, arrows, Enter). Taps keep the keyboard open. */
export function KeyRow({ onKey, disabled }: { onKey: (key: string) => void; disabled?: boolean }) {
  return (
    <ScrollView
      horizontal
      keyboardShouldPersistTaps="always"
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: space.xs, paddingHorizontal: space.md }}
      style={{ flexGrow: 0 }}
    >
      {KEYS.map(({ label, key }) => {
        const Icon = ICONS[key];
        const tint = disabled ? colors.textMuted : key === "ctrl+c" ? colors.danger : colors.text;
        return (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={A11Y[key] ?? label}
            accessibilityState={{ disabled: !!disabled }}
            disabled={disabled}
            onPress={() => {
              haptics.tap();
              onKey(key);
            }}
            style={({ pressed }) => ({
              minWidth: hitTarget,
              height: hitTarget,
              paddingHorizontal: space.sm,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: radius.sm,
              borderWidth: 1,
              borderColor: key === "ctrl+c" && !disabled ? colors.danger : colors.edge,
              backgroundColor: pressed ? colors.raised : colors.card,
            })}
          >
            {Icon ? (
              <Icon size={18} color={tint} />
            ) : (
              <Text maxFontSizeMultiplier={1.3} style={{ fontFamily: fontFamily.mono, fontSize: type.size.small, color: tint }}>{label}</Text>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
