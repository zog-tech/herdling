import { ChevronDown, ChevronUp, Search, X } from "lucide-react-native";
import { Pressable, TextInput, View } from "react-native";

import { colors, denseScale, hitTarget, icon, radius, space, state, type } from "@/theme/tokens";
import { DelayedSpinner } from "@/ui/Delayed";
import { Text } from "@/ui/Text";

import type { Excerpt } from "./search";

function IconButton({ label, onPress, disabled, children }: { label: string; onPress: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: hitTarget,
        height: hitTarget,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? state.disabledOpacity : pressed ? state.pressedOpacity : 1,
      })}
    >
      {children}
    </Pressable>
  );
}

/**
 * The search bar of the session screen: the query box, "3 of 12", older and newer match buttons,
 * and Close. Under it: the excerpt of the current match with the match in gold, or a note.
 */
export function SearchBar({
  query,
  onQuery,
  placeholder,
  count,
  label,
  onOlder,
  onNewer,
  onClose,
  busy,
  excerpt,
  note,
  action,
}: {
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  count: number;
  /** "3 of 12", "No matches" or empty. */
  label: string;
  onOlder: () => void;
  onNewer: () => void;
  onClose: () => void;
  /** True while older messages load for the search. */
  busy?: boolean;
  excerpt?: Excerpt;
  note?: string;
  /** A text button under the bar, for example "Search older messages". */
  action?: { label: string; onPress: () => void };
}) {
  return (
    <View style={{ gap: space.xs, paddingHorizontal: space.lg }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
        <View
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            minHeight: hitTarget,
            paddingHorizontal: space.md,
            borderRadius: radius.md,
            backgroundColor: colors.raised,
          }}
        >
          <Search size={icon.sm} color={colors.textMuted} />
          <TextInput
            accessibilityLabel="Search"
            value={query}
            onChangeText={onQuery}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.accent}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            returnKeyType="search"
            onSubmitEditing={onOlder}
            submitBehavior="submit"
            style={{ flex: 1, color: colors.text, fontSize: type.size.body, paddingVertical: space.sm }}
          />
          {busy ? <DelayedSpinner color={colors.textMuted} /> : null}
          {label ? (
            <Text variant="caption" muted maxFontSizeMultiplier={denseScale.row} accessibilityLiveRegion="polite">
              {label}
            </Text>
          ) : null}
        </View>
        <IconButton label="Older match" onPress={onOlder} disabled={count === 0 && !action}>
          <ChevronUp size={icon.md} color={colors.text} />
        </IconButton>
        <IconButton label="Newer match" onPress={onNewer} disabled={count === 0}>
          <ChevronDown size={icon.md} color={colors.text} />
        </IconButton>
        <IconButton label="Close search" onPress={onClose}>
          <X size={icon.md} color={colors.text} />
        </IconButton>
      </View>
      {excerpt ? (
        <Text variant="caption" muted numberOfLines={1} accessibilityLabel={`Match: ${excerpt.before}${excerpt.match}${excerpt.after}`}>
          {excerpt.before}
          <Text variant="caption" bold color={colors.search.currentFg} style={{ backgroundColor: colors.search.currentBg }}>
            {excerpt.match}
          </Text>
          {excerpt.after}
        </Text>
      ) : note ? (
        <Text variant="caption" muted accessibilityLiveRegion="polite">
          {note}
        </Text>
      ) : null}
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          disabled={busy}
          style={({ pressed }) => ({ minHeight: hitTarget, justifyContent: "center", alignSelf: "flex-start", opacity: pressed ? state.pressedOpacity : 1 })}
        >
          <View style={{ paddingHorizontal: space.md, paddingVertical: space.xs + 2, borderRadius: radius.pill, backgroundColor: colors.raised }}>
            <Text variant="small" bold>
              {action.label}
            </Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}
