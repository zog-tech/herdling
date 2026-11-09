/**
 * The text filter of the Board: a magnifier button in the header and a field above the chips.
 * The field filters the agents by name, terminal title, computer and folder (see `textFilter.ts`).
 * The close button clears the filter and hides the field.
 */
import { Search, SearchX, X } from "lucide-react-native";
import { Pressable, TextInput, View } from "react-native";

import { colors, hitTarget, icon, radius, space, state, type } from "@/theme/tokens";
import { StateNotice } from "@/ui/StateNotice";

/** The magnifier in the Board header. Selected (gold) while the field shows. */
export function FilterButton({ open, onPress }: { open: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Filter agents"
      accessibilityHint="Shows a field that filters the agents by name, computer and folder"
      accessibilityState={{ expanded: open }}
      onPress={onPress}
      style={({ pressed }) => ({
        width: hitTarget,
        height: hitTarget,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? state.pressedOpacity : 1,
      })}
    >
      <Search size={icon.md} color={open ? colors.accent : colors.text} strokeWidth={icon.strokeWidth} />
    </Pressable>
  );
}

/** The filter field: the query box and a close button that clears it. */
export function FilterField({
  query,
  onQuery,
  onClose,
  autoFocus,
}: {
  query: string;
  onQuery: (q: string) => void;
  onClose: () => void;
  /** Focus the box (and raise the keyboard) when it shows. */
  autoFocus?: boolean;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, paddingLeft: space.lg, paddingRight: space.xs, paddingTop: space.xs }}>
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
          accessibilityLabel="Filter agents"
          value={query}
          onChangeText={onQuery}
          placeholder="Agent, computer or folder"
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.accent}
          autoFocus={autoFocus}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
          style={{ flex: 1, color: colors.text, fontSize: type.size.body, paddingVertical: space.sm }}
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close filter"
        accessibilityHint="Clears the filter and shows all agents"
        onPress={onClose}
        style={({ pressed }) => ({
          width: hitTarget,
          height: hitTarget,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? state.pressedOpacity : 1,
        })}
      >
        <X size={icon.md} color={colors.text} />
      </Pressable>
    </View>
  );
}

/** The empty state when no agent matches the text filter, with a Clear action. */
export function NoMatch({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <View style={{ paddingHorizontal: space.lg, paddingTop: space.sm }}>
      <StateNotice Icon={SearchX} message={noMatchText(query)} action="Clear" onAction={onClear} />
    </View>
  );
}

/** The sentence of the empty state. */
export function noMatchText(query: string): string {
  return `No agent matches “${query.trim()}”.`;
}
