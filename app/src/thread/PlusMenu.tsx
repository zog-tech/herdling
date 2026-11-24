import { ClipboardPaste, FileText, Film, ImagePlus, Paperclip, Plus, SquareSlash, X } from "lucide-react-native";
import type { ReactNode } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";

import { colors, denseScale, hitTarget, icon, radius, space, state } from "@/theme/tokens";
import { GlassSurface, glassAvailable } from "@/ui/Glass";
import { MenuRow } from "@/ui/MenuSheet";
import { Text } from "@/ui/Text";

import { InlineMenu } from "./InlineMenu";

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
  const glyph = open ? <X size={icon.header} color={colors.text} strokeWidth={icon.strokeWidth} /> : <Plus size={icon.header} color={colors.text} strokeWidth={icon.strokeWidth} />;
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

/**
 * The menu that the "+" button opens, above the prompt box, in the menu row look (`InlineMenu`).
 * A missing handler hides its row. "Paste image" is for builds without the native paste hook.
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
    <InlineMenu label="Add menu">
      {onPhotos ? <MenuRow item={{ label: "Photos and videos", Icon: ImagePlus }} onPress={onPhotos} /> : null}
      {onFiles ? <MenuRow item={{ label: "Files", Icon: Paperclip }} onPress={onFiles} /> : null}
      {onPaste ? <MenuRow item={{ label: "Paste image", Icon: ClipboardPaste }} onPress={onPaste} /> : null}
      {onCommands ? <MenuRow item={{ label: "Commands & skills", Icon: SquareSlash }} onPress={onCommands} /> : null}
    </InlineMenu>
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
      {video ? <Film size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} /> : <FileText size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />}
      <View style={{ flex: 1 }}>
        <Text variant="caption" numberOfLines={2} ellipsizeMode="middle" maxFontSizeMultiplier={denseScale.pill}>
          {name}
        </Text>
        {caption ? (
          <Text variant="caption" muted numberOfLines={1} maxFontSizeMultiplier={denseScale.pill}>
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
        width: icon.header,
        height: icon.header,
        borderRadius: icon.header / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.raisedHigh,
      }}
    >
      <X size={icon.sm - 2} color={colors.text} strokeWidth={icon.strokeWidth} />
    </Pressable>
  );
}
