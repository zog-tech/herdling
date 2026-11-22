import { ClipboardPaste, FileText, Film, ImagePlus, Paperclip, Plus, SquareSlash, X } from "lucide-react-native";
import type { ReactNode } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";

import { colors, hitTarget, radius, space, state } from "@/theme/tokens";
import { GlassSurface, glassAvailable } from "@/ui/Glass";
import { Text } from "@/ui/Text";

import { formatBytes, isFile, isPhoto, isVideo, videoCaption, type Attachment } from "./attachments";

/** Size of a photo thumbnail above the prompt box. */
export const THUMB = 56;

/**
 * The "+" button of the composer. Same size as the send button.
 * `bare`: no glass of its own, for a button inside the prompt pill. The touch target stays 44 pt.
 */
export function PlusButton({
  open,
  disabled,
  onPress,
  size = hitTarget,
  bare = false,
}: {
  open: boolean;
  disabled?: boolean;
  onPress: () => void;
  size?: number;
  bare?: boolean;
}) {
  const slop = Math.max(0, (hitTarget - size) / 2);
  const glyph = open ? <X size={22} color={colors.text} /> : <Plus size={22} color={colors.text} />;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Add"
      accessibilityHint="Attach photos or files, or insert a command"
      accessibilityState={{ disabled: !!disabled, expanded: open }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={slop}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: bare && pressed ? colors.raised : "transparent",
        opacity: disabled ? state.disabledOpacity : pressed && !bare && !glassAvailable() ? state.pressedFill : 1,
      })}
    >
      {bare ? (
        glyph
      ) : (
        <GlassSurface
          interactive
          pointerEvents="none"
          style={{ width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center" }}
        >
          {glyph}
        </GlassSurface>
      )}
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
      {onPhotos ? <MenuRow label="Photos and videos" icon={<ImagePlus size={20} color={colors.text} />} onPress={onPhotos} /> : null}
      {onFiles ? <MenuRow label="Files" icon={<Paperclip size={20} color={colors.text} />} onPress={onFiles} /> : null}
      {onPaste ? <MenuRow label="Paste image" icon={<ClipboardPaste size={20} color={colors.text} />} onPress={onPaste} /> : null}
      {onCommands ? (
        <MenuRow label="Commands & skills" icon={<SquareSlash size={20} color={colors.text} />} onPress={onCommands} />
      ) : null}
    </View>
  );
}

/** Width of a file tile: room for a short name. */
export const FILE_TILE = THUMB * 2.4;

/**
 * A picked file or video: an icon, the name and a caption (the size; for a video also the length),
 * in a tile as high as a photo.
 */
function FileTile({ name, caption, label, video }: { name: string; caption?: string; label: string; video?: boolean }) {
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
      {video ? <Film size={20} color={colors.textMuted} /> : <FileText size={20} color={colors.textMuted} />}
      <View style={{ flex: 1 }}>
        <Text variant="caption" numberOfLines={2} ellipsizeMode="middle" maxFontSizeMultiplier={1.3}>
          {name}
        </Text>
        {caption ? (
          <Text variant="caption" muted numberOfLines={1} maxFontSizeMultiplier={1.3}>
            {caption}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** The words that a screen reader says for a file or video tile. */
function tileLabel(p: Attachment): string {
  if (isVideo(p)) {
    const caption = videoCaption(p);
    return `Video ${p.name}${caption ? `, ${caption}` : ""}`;
  }
  return `File ${p.name}${isFile(p) && p.size != null ? `, ${formatBytes(p.size)}` : ""}`;
}

/**
 * Thumbnails of the picked photos and tiles of the picked files and videos, each with a remove button.
 * `children` (the pasted text chips) come after the attachments in the same row.
 */
export function PhotoStrip({
  photos,
  onRemove,
  disabled,
  children,
}: {
  photos: Attachment[];
  onRemove: (p: Attachment) => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <ScrollView horizontal keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: space.sm, paddingTop: space.xs }}>
      {photos.map((p, i) => (
        <View key={`${p.uri}:${i}`} style={{ width: isPhoto(p) ? THUMB : FILE_TILE, height: THUMB }}>
          {!isPhoto(p) ? (
            <FileTile
              name={p.name}
              caption={isVideo(p) ? videoCaption(p) : isFile(p) && p.size != null ? formatBytes(p.size) : undefined}
              label={tileLabel(p)}
              video={isVideo(p)}
            />
          ) : (
            <Image
              source={{ uri: p.uri }}
              accessibilityLabel={`Photo ${i + 1}`}
              style={{ width: THUMB, height: THUMB, borderRadius: radius.sm, backgroundColor: colors.raised }}
            />
          )}
          <RemoveButton
            label={isPhoto(p) ? `Remove photo ${i + 1}` : `Remove ${p.name}`}
            disabled={disabled}
            onPress={() => onRemove(p)}
          />
        </View>
      ))}
      {children}
    </ScrollView>
  );
}

/** The small "x" at the top right corner of an attachment tile. */
export function RemoveButton({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
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
  );
}
