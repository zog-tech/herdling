import { Search } from "lucide-react-native";
import type { ReactNode } from "react";
import { TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";

import { colors, hitTarget, icon, radius, space, type } from "@/theme/tokens";

/**
 * The one search or filter field of the app: a `raised` fill with no edge, radius `md`, a 44 pt
 * minimum height and a magnifier at the left (MASTER.md, elevation level 2). The menu sheet, the
 * Board filter, "Jump to a terminal", the command sheet and the session search all use it.
 *
 * - `style` places the field (margins, `flex: 1` in a row). The field has no outer inset itself.
 * - `trailing` sits inside the field at the right, for example a spinner or "3 of 12". With it,
 *   the system clear button is off, so the two never overlap.
 * - The text input never capitalizes or corrects: a search is a name, a path or a command.
 */
export function SearchField({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  autoFocus,
  onSubmitEditing,
  submitBehavior,
  trailing,
  style,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  /** Default: the placeholder. */
  accessibilityLabel?: string;
  autoFocus?: boolean;
  onSubmitEditing?: () => void;
  submitBehavior?: TextInputProps["submitBehavior"];
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        {
          flexDirection: "row",
          alignItems: "center",
          gap: space.sm,
          minHeight: hitTarget,
          paddingHorizontal: space.md,
          borderRadius: radius.md,
          backgroundColor: colors.raised,
        },
        style,
      ]}
    >
      <Search size={icon.sm} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accent}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        clearButtonMode={trailing ? "never" : "while-editing"}
        returnKeyType="search"
        onSubmitEditing={onSubmitEditing}
        submitBehavior={submitBehavior}
        style={{ flex: 1, minHeight: hitTarget, color: colors.text, fontSize: type.size.body, paddingVertical: space.sm }}
      />
      {trailing}
    </View>
  );
}
