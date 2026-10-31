import { ClipboardPaste, FileText, ImagePlus, Paperclip, Plus, SquareSlash, X } from "lucide-react-native";
import type { ReactNode } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";

import { colors, hitTarget, radius, space, state } from "@/theme/tokens";
import { GlassSurface, glassAvailable } from "@/ui/Glass";
import { Text } from "@/ui/Text";

import { formatBytes, isFile, type Attachment } from "./attachments";

/** Size of a photo thumbnail above the prompt box. */
export const THUMB = 56;

/** The "+" button of the composer. Same size as the send button. */
export function PlusButton({ open, disabled, onPress }: { open: boolean; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add"
      accessibilityHint="Attach photos or files, or insert a command"
      accessibilityState={{ disabled: !!disabled, expanded: open }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: hitTarget,
        height: hitTarget,
        opacity: disabled ? state.disabledOpacity : pressed && !glassAvailable() ? state.pressedFill : 1,
      })}
    >
      <GlassSurface
        interactive
        pointerEvents="none"
        style={{ flex: 1, borderRadius: hitTarget / 2, alignItems: "center", justifyContent: "center" }}
      >
        {open ? <X size={22} color={colors.text} /> : <Plus size={22} color={colors.text} />}
      </GlassSurface>
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

/**
 * The menu that the "+" button opens, above the prompt box. A missing handler hides its row.
 * "Paste image" is for builds without the native paste hook.
 */
export function PlusMenu({
  onPhotos,
  onFiles,
  onPaste,
  onCommands,
}: {
  onPhotos?: () => void;
  onFiles?: () => void;
  onPaste?: () => void;
  onCommands?: () => void;
}) {
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
      {onFiles ? <MenuRow label="Files" icon={<Paperclip size={20} color={colors.text} />} onPress={onFiles} /> : null}
      {onPaste ? <MenuRow label="Paste image" icon={<ClipboardPaste size={20} color={colors.text} />} onPress={onPaste} /> : null}
      {onCommands ? (
        <MenuRow label="Commands & skills" icon={<SquareSlash size={20} color={colors.text} />} onPress={onCommands} />
      ) : null}
    </View>
  );
}

/** Width of a file tile: room for a short name. */
const FILE_TILE = THUMB * 2.4;

/** A picked file: an icon, the name and the size, in a tile as high as a photo. */
function FileTile({ name, size, label }: { name: string; size?: number; label: string }) {
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={{
        width: FILE_TILE,
        height: THUMB,
        borderRadius: radius.sm,
        backgroundColor: colors.raised,
        flexDirection: "row",
        alignItems: "center",
        gap: space.xs,
        paddingHorizontal: space.sm,
      }}
    >
      <FileText size={20} color={colors.textMuted} />
      <View style={{ flex: 1 }}>
        <Text variant="caption" numberOfLines={2} ellipsizeMode="middle" maxFontSizeMultiplier={1.3}>
          {name}
        </Text>
        {size != null ? (
          <Text variant="caption" muted numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {formatBytes(size)}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Thumbnails of the picked photos and tiles of the picked files, each with a remove button. */
export function PhotoStrip({ photos, onRemove, disabled }: { photos: Attachment[]; onRemove: (p: Attachment) => void; disabled?: boolean }) {
  return (
    <ScrollView horizontal keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: space.sm, paddingTop: space.xs }}>
      {photos.map((p, i) => (
        <View key={`${p.uri}:${i}`} style={{ width: isFile(p) ? FILE_TILE : THUMB, height: THUMB }}>
          {isFile(p) ? (
            <FileTile name={p.name} size={p.size} label={`File ${p.name}${p.size != null ? `, ${formatBytes(p.size)}` : ""}`} />
          ) : (
            <Image
              source={{ uri: p.uri }}
              accessibilityLabel={`Photo ${i + 1}`}
              style={{ width: THUMB, height: THUMB, borderRadius: radius.sm, backgroundColor: colors.raised }}
            />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isFile(p) ? `Remove ${p.name}` : `Remove photo ${i + 1}`}
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
