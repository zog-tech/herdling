import { ClipboardList, Eye, TextCursorInput } from "lucide-react-native";
import { Modal, ScrollView, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, space } from "@/theme/tokens";
import { CloseButton } from "@/ui/CloseButton";
import { showMenu } from "@/ui/MenuSheet";
import { Shortcut } from "@/ui/Shortcut";
import { Text } from "@/ui/Text";

import { pasteLabel, type PastedText } from "./pastedText";
import { RemoveButton, THUMB } from "./PlusMenu";

/** The rows of the chip menu, in order. */
export const PASTE_ACTIONS = ["View", "Insert as text"] as const;

/** Opens the chip menu: "View" or "Insert as text". */
export function openPasteMenu(p: PastedText, onView: () => void, onInsert: () => void): void {
  showMenu({
    title: pasteLabel(p),
    sections: [
      {
        items: [
          { label: PASTE_ACTIONS[0], Icon: Eye, onPick: onView },
          { label: PASTE_ACTIONS[1], Icon: TextCursorInput, onPick: onInsert },
        ],
      },
    ],
  });
}

/**
 * A long paste that waits above the prompt box: "Pasted text #1 · 240 lines" as a shortcut token
 * (`ui/Shortcut`), in the row of the attachments. A tap opens the chip menu. The "x" removes the
 * paste.
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
    // As high as a photo, so the row of attachments keeps one height; the token sits in the middle.
    <View style={{ height: THUMB, justifyContent: "center" }}>
      <View>
        <Shortcut
          label={pasteLabel(paste)}
          Icon={ClipboardList}
          accessibilityHint="View the text or put it back in the prompt"
          disabled={disabled}
          onPress={onPress}
        />
        <RemoveButton label={`Remove pasted text ${paste.n}`} disabled={disabled} onPress={onRemove} />
      </View>
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
