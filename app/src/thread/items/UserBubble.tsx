import { Image as ImageIcon } from "lucide-react-native";
import { memo, useState } from "react";
import { Pressable, View } from "react-native";

import { colors, radius, space } from "@/theme/tokens";
import { Text } from "@/ui/Text";

/** Longer prompts (pasted logs, task notices) start collapsed to this many lines. */
const COLLAPSED_LINES = 8;
const LONG_CHARS = 400;

/** The user's prompt: a right-aligned bubble. */
export const UserBubble = memo(function UserBubble({ text, images }: { text: string; images?: number }) {
  const long = text.length > LONG_CHARS || text.split("\n").length > COLLAPSED_LINES;
  const [open, setOpen] = useState(false);
  const body = text ? (
    <Text selectable={!long || open} numberOfLines={long && !open ? COLLAPSED_LINES : undefined}>
      {text}
    </Text>
  ) : null;
  return (
    <View
      style={{
        alignSelf: "flex-end",
        maxWidth: "88%",
        backgroundColor: colors.raised,
        borderRadius: radius.lg,
        borderBottomRightRadius: radius.sm,
        paddingHorizontal: space.md,
        paddingVertical: space.sm,
        gap: space.xs,
      }}
    >
      {long ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityHint={open ? "Collapses the message" : "Shows the full message"}
          onPress={() => setOpen((o) => !o)}
          style={{ gap: space.xs }}
        >
          {body}
          <Text variant="caption" bold color={colors.status.working}>
            {open ? "Show less" : "Show more"}
          </Text>
        </Pressable>
      ) : (
        body
      )}
      {images ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
          <ImageIcon size={14} color={colors.textMuted} />
          <Text variant="caption" muted>
            {images === 1 ? "1 image" : `${images} images`}
          </Text>
        </View>
      ) : null}
    </View>
  );
});
