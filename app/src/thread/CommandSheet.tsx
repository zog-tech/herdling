import type { CommandInfo } from "@zogssh/protocol";
import { useMemo, useState } from "react";
import { ActivityIndicator, Modal, Pressable, SectionList, TextInput, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, hitTarget, radius, space, type } from "@/theme/tokens";
import { Text } from "@/ui/Text";

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

/** Full list of commands and skills, with a search box, grouped by source. */
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
    <Modal
      visible={visible}
      animationType={reduced ? "none" : "slide"}
      transparent
      onRequestClose={onClose}
      onDismiss={onDismiss}
    >
      <Pressable accessibilityRole="button" accessibilityLabel="Close" style={{ flex: 1, backgroundColor: colors.scrim }} onPress={onClose} />
      <View
        style={{
          backgroundColor: colors.bg,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          height: "75%",
          paddingTop: space.lg,
          paddingBottom: insets.bottom,
        }}
      >
        <View style={{ paddingHorizontal: space.lg, gap: space.sm, paddingBottom: space.sm }}>
          <Text variant="title">Commands & skills</Text>
          <TextInput
            value={search}
            onChangeText={setSearch}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Search"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Search commands"
            style={{
              minHeight: hitTarget,
              color: colors.text,
              fontSize: type.size.body,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.md,
              paddingHorizontal: space.md,
            }}
          />
        </View>
        {commands === undefined ? (
          <ActivityIndicator color={colors.textMuted} style={{ marginTop: space.xl }} />
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(c) => c.name}
            keyboardShouldPersistTaps="handled"
            stickySectionHeadersEnabled
            renderSectionHeader={({ section }) => (
              <Text
                variant="caption"
                muted
                bold
                accessibilityRole="header"
                style={{ backgroundColor: colors.bg, paddingHorizontal: space.md, paddingVertical: space.xs }}
              >
                {section.title}
              </Text>
            )}
            renderItem={({ item }) => <CommandRow c={item} onPick={onPick} />}
            ListEmptyComponent={
              <Text variant="small" muted style={{ padding: space.lg }}>
                {search.trim() ? "No match." : "No commands on this host."}
              </Text>
            }
          />
        )}
      </View>
    </Modal>
  );
}
