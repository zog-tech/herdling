import { ClipboardPaste, ImagePlus, Plus, SquareSlash, X } from "lucide-react-native";
import type { ReactNode } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";

import { colors, hitTarget, radius, space, state } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { Text } from "@/ui/Text";

import type { Photo } from "./attachments";

/** Size of a photo thumbnail above the prompt box. */
export const THUMB = 56;

/** The "+" button of the composer. Same size as the send button. */
export function PlusButton({ open, disabled, onPress }: { open: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add"
      accessibilityHint="Attach photos or insert a command"
      accessibilityState={{ disabled: !!disabled, expanded: open }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: hitTarget,
        height: hitTarget,
        borderRadius: hitTarget / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.raised,
        opacity: disabled ? state.disabledOpacity : pressed ? state.pressedFill : 1,
      })}
    >
      {open ? <X size={22} color={colors.text} /> : <Plus size={22} color={colors.text} />}
    </Pressable>
  );
}

function MenuRow({ label, icon, onPress }: { label: string; icon: ReactNode; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: hitTarget,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        paddingHorizontal: space.md,
        backgroundColor: pressed ? colors.raised : "transparent",
      })}
    >
      {icon}
      <Text>{label}</Text>
    </Pressable>
  );
}

/** The menu that the "+" button opens, above the prompt box. A missing handler hides its row. */
export function PlusMenu({ onPhotos, onPaste, onCommands }: { onPhotos?: () => void; onPaste?: () => void; onCommands?: () => void }) {
  return (
    <View
      accessibilityLabel="Add menu"
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.divider,
        borderRadius: radius.md,
        overflow: "hidden",
      }}
    >
      {onPhotos ? <MenuRow label="Photos" icon={<ImagePlus size={20} color={colors.text} />} onPress={onPhotos} /> : null}
      {onPaste ? <MenuRow label="Paste image" icon={<ClipboardPaste size={20} color={colors.text} />} onPress={onPaste} /> : null}
      {onCommands ? (
        <MenuRow label="Commands & skills" icon={<SquareSlash size={20} color={colors.text} />} onPress={onCommands} />
      ) : null}
    </View>
  );
}

/** A chip above the prompt box that pastes the clipboard image as a photo. */
export function PasteChip({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Paste image"
      accessibilityHint="Attaches the image from the clipboard"
      disabled={disabled}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={({ pressed }) => ({
        alignSelf: "flex-start",
        minHeight: hitTarget,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        paddingHorizontal: space.md,
        borderRadius: hitTarget / 2,
        backgroundColor: colors.raised,
        opacity: disabled ? state.disabledOpacity : pressed ? state.pressedFill : 1,
      })}
    >
      <ClipboardPaste size={20} color={colors.text} />
      <Text>Paste image</Text>
    </Pressable>
  );
}

/** Thumbnails of the picked photos, each with a remove button. */
export function PhotoStrip({ photos, onRemove, disabled }: { photos: Photo[]; onRemove: (p: Photo) => void; disabled?: boolean }) {
  return (
    <ScrollView horizontal keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: space.sm, paddingTop: space.xs }}>
      {photos.map((p, i) => (
        <View key={`${p.uri}:${i}`} style={{ width: THUMB, height: THUMB }}>
          <Image
            source={{ uri: p.uri }}
            accessibilityLabel={`Photo ${i + 1}`}
            style={{ width: THUMB, height: THUMB, borderRadius: radius.sm, backgroundColor: colors.raised }}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove photo ${i + 1}`}
            disabled={disabled}
            onPress={() => onRemove(p)}
            hitSlop={12}
            style={{
              position: "absolute",
              top: -space.xs,
              right: -space.xs,
              width: 22,
              height: 22,
              borderRadius: 11,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.bg,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <X size={14} color={colors.text} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}
