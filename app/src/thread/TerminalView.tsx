import { useRef } from "react";
import { ScrollView, type ScrollViewInstance } from "react-native";

import { fontFamily } from "@/theme/fonts";
import { colors, space, type } from "@/theme/tokens";
import { Text } from "@/ui/Text";
import { useTerminalText } from "./useTerminalText";

/** Recent pane text (herdr `agent.read`), monospace, kept scrolled to the end. */
export function TerminalView({ hostId, paneId }: { hostId: string; paneId: string }) {
  const { text, error } = useTerminalText(hostId, paneId, true);
  const scroll = useRef<ScrollViewInstance>(null);
  return (
    <ScrollView
      ref={scroll}
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: space.md }}
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
      keyboardDismissMode="interactive"
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text
          selectable
          style={{ fontFamily: fontFamily.mono, fontSize: type.size.caption, lineHeight: 17, color: colors.text }}
        >
          {text ?? (error ? `Can't read the terminal: ${error}` : "Loading…")}
        </Text>
      </ScrollView>
    </ScrollView>
  );
}
