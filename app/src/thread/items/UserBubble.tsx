import { Image as ImageIcon } from "lucide-react-native";
import { memo, useState } from "react";
import { View } from "react-native";

import { colors, radius, space } from "@/theme/tokens";
import { Text } from "@/ui/Text";

import { MenuPressable } from "../MenuPressable";

/** Longer prompts (pasted logs, task notices) start collapsed to this many lines. */
const COLLAPSED_LINES = 8;
const LONG_CHARS = 400;

/**
 * The user's prompt: a right-aligned bubble. A long press opens the row menu (Copy, Select text,
 * Share, Quote in reply); a tap on a long prompt still shows or hides the rest. The text is not
 * `selectable`: on iOS that adds its own long press, which fights the menu.
 */
export const UserBubble = memo(function UserBubble({ text, images }: { text: string; images?: number }) {
  const long = text.length > LONG_CHARS || text.split("\n").length > COLLAPSED_LINES;
  const [open, setOpen] = useState(false);
  return (
    <MenuPressable
      menu={text ? { kind: "user", text } : null}
      feedback="scale"
      accessibilityRole={long ? "button" : undefined}
      accessibilityState={long ? { expanded: open } : undefined}
      accessibilityHint={long ? (open ? "Collapses the message" : "Shows the full message") : undefined}
      onPress={long ? () => setOpen((o) => !o) : undefined}
      style={{ alignSelf: "flex-end", maxWidth: "88%" }}
    >
      <View
        style={{
          backgroundColor: colors.raised,
          borderRadius: radius.lg,
          borderBottomRightRadius: radius.sm,
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          gap: space.xs,
        }}
      >
        {text ? <Text numberOfLines={long && !open ? COLLAPSED_LINES : undefined}>{text}</Text> : null}
        {long ? (
          <Text variant="caption" bold muted>
            {open ? "Show less" : "Show more"}
          </Text>
        ) : null}
        {images ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
            <ImageIcon size={14} color={colors.textMuted} />
            <Text variant="caption" muted>
              {images === 1 ? "1 image" : `${images} images`}
            </Text>
          </View>
        ) : null}
      </View>
    </MenuPressable>
  );
});
