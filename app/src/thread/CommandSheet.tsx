import type { CommandInfo } from "@herdling/protocol";
import { useMemo, useState } from "react";
import { Modal, SectionList, StyleSheet, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, denseScale, space } from "@/theme/tokens";
import { CloseButton } from "@/ui/CloseButton";
import { Divider } from "@/ui/Group";
import { SearchField } from "@/ui/SearchField";
import { Text } from "@/ui/Text";
import { DelayedSpinner } from "@/ui/Delayed";

import { CommandRow } from "./CommandMenu";
import { filterCommands } from "./commands";

/** Section order and titles. */
const SECTIONS: { source: CommandInfo["source"]; title: string }[] = [
  { source: "builtin", title: "Built-in" },
  { source: "project", title: "Project" },
  { source: "user", title: "User" },
  { source: "plugin", title: "Plugins" },
];

/** Groups `list` by source in section order. Empty groups are left out. */
export function groupCommands(list: CommandInfo[]): { title: string; data: CommandInfo[] }[] {
  return SECTIONS.map((s) => ({ title: s.title, data: list.filter((c) => c.source === s.source) })).filter(
    (s) => s.data.length > 0,
  );
}

/**
 * Full list of commands and skills, with a search box, grouped by source. The rows are menu rows
 * (`MenuRow`) in grouped bands, the same look as the menu sheet.
 */
export function CommandSheet({
  visible,
  commands,
  onPick,
  onClose,
  onDismiss,
}: {
  visible: boolean;
  /** `undefined` while the list loads. */
  commands: CommandInfo[] | undefined;
  onPick: (c: CommandInfo) => void;
  onClose: () => void;
  /** iOS: runs after the sheet is gone. */
  onDismiss?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const [search, setSearch] = useState("");
  const sections = useMemo(() => groupCommands(filterCommands(commands ?? [], search.trim())), [commands, search]);

  return (
    // A native page sheet: swipe-down closes it (onRequestClose), and so does the close button.
    <Modal
      visible={visible}
      animationType={reduced ? "fade" : "slide"}
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onDismiss={onDismiss}
    >
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: space.md, paddingBottom: insets.bottom }}>
        <View style={{ paddingHorizontal: space.lg, gap: space.sm, paddingBottom: space.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text variant="title" accessibilityRole="header">
              Commands & skills
            </Text>
            <CloseButton onPress={onClose} />
          </View>
          <SearchField value={search} onChangeText={setSearch} placeholder="Search" accessibilityLabel="Search commands" autoFocus />
        </View>
        {commands === undefined ? (
          <View style={{ marginTop: space.xl, alignItems: "center" }}>
            <DelayedSpinner color={colors.textMuted} />
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(c) => c.name}
            keyboardShouldPersistTaps="handled"
            stickySectionHeadersEnabled
            contentInsetAdjustmentBehavior="never"
            renderSectionHeader={({ section }) => (
              <Text
                variant="section"
                accessibilityRole="header"
                maxFontSizeMultiplier={denseScale.row}
                style={{ backgroundColor: colors.bg, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm }}
              >
                {section.title}
              </Text>
            )}
            // A band per section: `card` rows with inset hairlines, a hairline at the top and the bottom.
            renderItem={({ item, index, section }) => (
              <View
                style={{
                  backgroundColor: colors.card,
                  borderColor: colors.divider,
                  borderTopWidth: index === 0 ? StyleSheet.hairlineWidth : 0,
                  borderBottomWidth: index === section.data.length - 1 ? StyleSheet.hairlineWidth : 0,
                }}
              >
                <CommandRow c={item} onPick={onPick} />
              </View>
            )}
            ItemSeparatorComponent={() => (
              <View style={{ backgroundColor: colors.card }}>
                <Divider />
              </View>
            )}
            ListEmptyComponent={
              <Text variant="small" muted style={{ padding: space.lg }}>
                {search.trim() ? "No match." : "No commands on this computer."}
              </Text>
            }
          />
        )}
      </View>
    </Modal>
  );
}
