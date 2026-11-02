import { ClipboardList } from "lucide-react-native";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, space, state } from "@/theme/tokens";
import { CloseButton } from "@/ui/CloseButton";
import { showActionSheet } from "@/ui/nativeSheet";
import { Text } from "@/ui/Text";

import { pasteLabel, pasteSize, type PastedText } from "./pastedText";
import { FILE_TILE, RemoveButton, THUMB } from "./PlusMenu";

/** The rows of the chip menu, in order. */
export const PASTE_ACTIONS = ["View", "Insert as text", "Cancel"] as const;

/** Opens the chip menu: "View" or "Insert as text". */
export function openPasteMenu(p: PastedText, onView: () => void, onInsert: () => void): void {
  showActionSheet({ title: pasteLabel(p), options: [...PASTE_ACTIONS], cancelButtonIndex: 2 }, (i) => {
    if (i === 0) onView();
    else if (i === 1) onInsert();
  });
}

/**
 * A long paste that waits above the prompt box: "Pasted text #1" and its size, in a tile as high
 * as a photo. A tap opens the chip menu. The "x" removes the paste.
 */
export function PasteChip({
  paste,
  disabled,
  onPress,
  onRemove,
}: {
  paste: PastedText;
  disabled?: boolean;
  onPress: () => void;
  onRemove: () => void;
}) {
  return (
    <View style={{ width: FILE_TILE, height: THUMB }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={pasteLabel(paste)}
        accessibilityHint="View the text or put it back in the prompt"
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => ({
          flex: 1,
          borderRadius: radius.sm,
          backgroundColor: colors.raised,
          flexDirection: "row",
          alignItems: "center",
          gap: space.xs,
          paddingHorizontal: space.sm,
          opacity: pressed ? state.pressedFill : 1,
        })}
      >
        <ClipboardList size={20} color={colors.textMuted} />
        <View style={{ flex: 1 }}>
          <Text variant="caption" numberOfLines={1} maxFontSizeMultiplier={1.3}>
            Pasted text #{paste.n}
          </Text>
          <Text variant="caption" muted numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {pasteSize(paste.text)}
          </Text>
        </View>
      </Pressable>
      <RemoveButton label={`Remove pasted text ${paste.n}`} disabled={disabled} onPress={onRemove} />
    </View>
  );
}

/**
 * A read-only page sheet with the full text of a paste, in monospace. The text is selectable.
 * `paste` stays set while the sheet closes, so the text does not go blank during the slide.
 */
export function PasteViewer({
  paste,
  visible,
  onClose,
}: {
  paste: PastedText | undefined;
  visible: boolean;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  return (
    <Modal
      visible={visible && !!paste}
      animationType={reduced ? "fade" : "slide"}
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: space.md, paddingBottom: insets.bottom }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: space.lg,
            paddingBottom: space.sm,
          }}
        >
          <Text variant="title" accessibilityRole="header" numberOfLines={1} style={{ flex: 1 }}>
            {paste ? pasteLabel(paste) : ""}
          </Text>
          <CloseButton onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.lg }}>
          <Text variant="small" mono selectable>
            {paste?.text ?? ""}
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}
