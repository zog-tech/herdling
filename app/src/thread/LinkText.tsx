import { useContext, type ReactNode } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";

import { colors } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";

import { openLink, openLinkMenu } from "./linkActions";
import { splitLinks } from "./links";
import { ThreadPaneContext } from "./LiveToolContext";

const link = (): TextStyle => ({ color: colors.link, textDecorationLine: "underline" });

/**
 * A link inside thread text: a tap opens it, a long press opens the link menu. It is a nested
 * Text, so it wraps with the line. A press on the text around it goes to the row as before.
 */
export function ThreadLink({ url, style, children }: { url: string; style?: StyleProp<TextStyle>; children: ReactNode }) {
  const pane = useContext(ThreadPaneContext);
  return (
    <Text
      style={[link(), style]}
      accessibilityRole="link"
      onPress={() => openLink(url, pane)}
      onLongPress={() => {
        haptics.press();
        openLinkMenu(url, pane);
      }}
    >
      {children}
    </Text>
  );
}

/**
 * Plain text with its URLs drawn as links. Put it inside a Text: it gives the strings and the
 * link parts. A text with no URL comes back as it is.
 */
export function LinkedText({ text }: { text: string }) {
  const parts = splitLinks(text);
  if (parts.length === 1 && parts[0].url === undefined) return text;
  return parts.map((p, i) =>
    p.url !== undefined ? (
      <ThreadLink key={i} url={p.url}>
        {p.text}
      </ThreadLink>
    ) : (
      p.text
    ),
  );
}
