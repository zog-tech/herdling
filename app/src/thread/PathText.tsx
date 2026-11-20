import { useContext, type ReactNode } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";

import { openFile, useCanOpenFiles } from "@/files/open";
import { splitPaths } from "@/files/paths";
import { colors } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";

import { RunHostContext, ThreadPaneContext } from "./LiveToolContext";

/** The host and pane of the thread on screen: a session thread, the peek sheet or a subagent. */
function useThreadHost(): { hostId?: string; paneId?: string } {
  const pane = useContext(ThreadPaneContext);
  const runHost = useContext(RunHostContext);
  return pane ?? runHost ?? {};
}

const pathStyle = (): TextStyle => ({ color: colors.link, textDecorationLine: "underline" });

/**
 * A file path in thread text. A tap opens it in the file viewer of the thread's host. The text
 * stays plain when the host cannot show files (no host, or a herdlingd without `files.get`).
 */
export function PathLink({ path, style, children }: { path: string; style?: StyleProp<TextStyle>; children: ReactNode }) {
  const { hostId, paneId } = useThreadHost();
  const can = useCanOpenFiles(hostId);
  if (!can || !hostId) return <Text style={style}>{children}</Text>;
  return (
    <Text
      style={[style, pathStyle()]}
      accessibilityRole="link"
      accessibilityHint="Opens the file on the computer"
      onPress={() => {
        haptics.tap();
        openFile(hostId, path, paneId);
      }}
    >
      {children}
    </Text>
  );
}

/** Plain text with its absolute and `~/` paths drawn as path links. Put it inside a Text. */
export function PathText({ text, style }: { text: string; style?: StyleProp<TextStyle> }) {
  const parts = splitPaths(text);
  return (
    <Text style={style}>
      {parts.map((p, i) =>
        p.path !== undefined ? (
          <PathLink key={i} path={p.path}>
            {p.text}
          </PathLink>
        ) : (
          p.text
        ),
      )}
    </Text>
  );
}
