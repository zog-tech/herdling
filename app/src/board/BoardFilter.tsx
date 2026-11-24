/**
 * The text filter of the Board: a magnifier button in the header and a field above the list.
 * The field filters the agents by name, terminal title, computer and folder (see `textFilter.ts`).
 * The close button clears the filter and hides the field.
 */
import { Search, SearchX, X } from "lucide-react-native";
import { View } from "react-native";

import { colors, space } from "@/theme/tokens";
import { IconButton } from "@/ui/IconButton";
import { SearchField } from "@/ui/SearchField";
import { StateNotice } from "@/ui/StateNotice";

/** The magnifier in the Board header. Selected (gold) while the field shows. */
export function FilterButton({ open, onPress }: { open: boolean; onPress: () => void }) {
  return (
    <IconButton
      label="Filter agents"
      hint="Shows a field that filters the agents by name, computer and folder"
      Icon={Search}
      expanded={open}
      color={open ? colors.accent : colors.text}
      onPress={onPress}
    />
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
      <SearchField
        value={query}
        onChangeText={onQuery}
        placeholder="Agent, computer or folder"
        accessibilityLabel="Filter agents"
        autoFocus={autoFocus}
        style={{ flex: 1 }}
      />
      <IconButton label="Close filter" hint="Clears the filter and shows all agents" Icon={X} onPress={onClose} />
    </View>
  );
}

/** The empty state when no agent matches the text filter, with a Clear action. */
export function NoMatch({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <StateNotice Icon={SearchX} message={noMatchText(query)} action="Clear" onAction={onClear} />
  );
}

/** The sentence of the empty state. */
export function noMatchText(query: string): string {
  return `No agent matches “${query.trim()}”.`;
}
