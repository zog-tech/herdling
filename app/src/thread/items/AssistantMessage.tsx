import Markdown, { type RenderRules } from "@ronradtke/react-native-markdown-display";
import { Play } from "lucide-react-native";
import { createContext, memo, useContext } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useHostConn } from "@/hosts/connection";
import { fontFamily } from "@/theme/fonts";
import { colors, hitTarget, icon, radius, space, state, themed, type } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { HScrollView } from "../HScrollView";
import { ThreadLink } from "../LinkText";
import { findLinks, replyMarkdownIt } from "../links";
import { ThreadPaneContext } from "../LiveToolContext";
import { MenuPressable } from "../MenuPressable";
import type { MenuTarget } from "../rowMenu";
import { openRunSheet, runnableCommand } from "../runCommand";

const BODY = type.size.body;
const LINE = Math.round(BODY * type.lineHeight.body);
const CODE = type.size.small - 1;
/** Width of one table column. */
const TABLE_COL = 140;
/** The visible box of the Run button; `hitSlop` makes the touch area `hitTarget`. */
const RUN_BOX = 28;
const RUN_SLOP = (hitTarget - RUN_BOX) / 2;

/** The reply parser: it also links bare URLs that have a scheme (see `links.ts`). */
const markdownit = replyMarkdownIt();

/** The URL when inline code is one URL and nothing more, as in `http://localhost:5173`. */
function codeUrl(content: string): string | undefined {
  const m = findLinks(content);
  return m.length === 1 && m[0].start === 0 && m[0].end === content.length ? m[0].url : undefined;
}

/** The menu target of the reply being drawn: its code blocks open the same menu. Links have their own menu. */
const ReplyMenu = createContext<MenuTarget | null>(null);

/**
 * Code block: JetBrains Mono, scrolls sideways instead of wrapping. A long press opens the reply
 * menu with "Copy code" (this block only) on top. The text is not `selectable`: on iOS that adds
 * its own long press, which fights the menu. "Select text" in the menu is the way to copy a part.
 * A shell block in a live session thread also gets a Run button (top right) and "Run in shell…".
 */
function CodeBlock({ content, lang }: { content: string; lang?: string }) {
  const reply = useContext(ReplyMenu);
  const pane = useContext(ThreadPaneContext);
  const online = useHostConn(pane?.hostId ?? "").status === "online";
  const text = content.endsWith("\n") ? content.slice(0, -1) : content;
  const command = pane ? runnableCommand(lang, text) : null;
  const run = command !== null && online ? command : undefined;
  return (
    <MenuPressable menu={reply ? { ...reply, code: text, run } : null} accessible={false}>
      <View>
        <HScrollView
          showsHorizontalScrollIndicator={false}
          style={styles().codeScroll}
          // Room on the right so the end of a long first line can scroll out from under the button.
          contentContainerStyle={{ padding: space.md, paddingRight: command !== null ? space.md + RUN_BOX : space.md }}
        >
          <Text style={styles().codeText}>{text}</Text>
        </HScrollView>
        {pane && command !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Run command"
            accessibilityHint="Opens the run sheet"
            accessibilityState={{ disabled: !online }}
            disabled={!online}
            hitSlop={RUN_SLOP}
            onPress={() => {
              haptics.tap();
              openRunSheet({ hostId: pane.hostId, paneId: pane.paneId, command });
            }}
            style={({ pressed }) => [styles().runButton, { opacity: !online ? state.offlineOpacity : pressed ? state.pressedOpacity : 1 }]}
          >
            <Play size={icon.sm} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
          </Pressable>
        ) : null}
      </View>
    </MenuPressable>
  );
}

const rules: RenderRules = {
  fence: (node) => <CodeBlock key={node.key} content={node.content} lang={node.sourceInfo} />,
  code_block: (node) => <CodeBlock key={node.key} content={node.content} />,
  // A table scrolls sideways inside its own box; it never draws outside the message.
  table: (node, children, _parent, s) => (
    <HScrollView key={node.key} showsHorizontalScrollIndicator={false} style={{ marginBottom: space.sm }}>
      <View style={s.table}>{children}</View>
    </HScrollView>
  ),
  // A Text link (not the default Pressable) so it wraps with the paragraph. A tap opens it, a long
  // press opens the link menu (see `linkActions.ts`).
  link: (node, children, _parent, s) => (
    <ThreadLink key={node.key} style={s.link} url={String(node.attributes.href ?? "")}>
      {children}
    </ThreadLink>
  ),
  // Inline code that is one URL is a link too: agents often put a dev server URL in backticks.
  code_inline: (node, _children, _parent, s, inherited = {}) => {
    const url = codeUrl(node.content);
    if (url === undefined) {
      return (
        <Text key={node.key} style={[inherited, s.code_inline]}>
          {node.content}
        </Text>
      );
    }
    return (
      <ThreadLink key={node.key} style={[inherited, s.code_inline, { color: colors.link }]} url={url}>
        {node.content}
      </ThreadLink>
    );
  },
};

/** Built again after a theme change: the colors are read when the styles are built. */
const mdStyles = themed(() =>
  StyleSheet.create({
  body: { color: colors.text, fontSize: BODY, lineHeight: LINE },
  paragraph: { marginTop: 0, marginBottom: space.sm, flexWrap: "wrap", flexDirection: "row", alignItems: "flex-start" },
  heading1: { fontSize: type.size.title + 2, lineHeight: 30, fontWeight: "700", marginTop: space.sm, marginBottom: space.sm },
  heading2: { fontSize: type.size.title, lineHeight: 28, fontWeight: "700", marginTop: space.sm, marginBottom: space.sm },
  heading3: { fontSize: BODY + 1, lineHeight: LINE, fontWeight: "700", marginTop: space.xs, marginBottom: space.xs },
  heading4: { fontSize: BODY, lineHeight: LINE, fontWeight: "700" },
  heading5: { fontSize: BODY, lineHeight: LINE, fontWeight: "600" },
  heading6: { fontSize: BODY, lineHeight: LINE, fontWeight: "600" },
  strong: { fontWeight: "700" },
  em: { fontStyle: "italic" },
  link: { color: colors.link, textDecorationLine: "underline" },
  code_inline: {
    fontFamily: fontFamily.mono,
    fontSize: CODE,
    backgroundColor: colors.raised,
    color: colors.text,
    borderRadius: radius.sm,
    paddingHorizontal: 4,
  },
  bullet_list: { marginBottom: space.sm },
  ordered_list: { marginBottom: space.sm },
  list_item: { marginBottom: space.xs },
  // iOS draws a middle dot; make it read as a bullet.
  bullet_list_icon: { color: colors.textMuted, marginLeft: space.xs, marginRight: space.sm, fontSize: BODY + 10, fontWeight: "900", lineHeight: LINE },
  ordered_list_icon: { color: colors.textMuted, marginLeft: 0, marginRight: space.sm, lineHeight: LINE },
  blockquote: {
    backgroundColor: "transparent",
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
    paddingHorizontal: space.md,
    marginLeft: 0,
    marginBottom: space.sm,
  },
  hr: { backgroundColor: colors.divider, height: 1, marginVertical: space.md },
  table: { borderWidth: 1, borderColor: colors.divider, borderRadius: radius.sm, overflow: "hidden" },
  thead: { backgroundColor: colors.card },
  tr: { borderBottomWidth: 1, borderColor: colors.divider, flexDirection: "row" },
  // Fixed column width: the table scrolls sideways, and the columns of all rows line up.
  th: { width: TABLE_COL, padding: space.sm, fontWeight: "700" },
  td: { width: TABLE_COL, padding: space.sm },
  }),
);

const styles = themed(() =>
  StyleSheet.create({
    codeScroll: { backgroundColor: colors.sunken, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider, marginBottom: space.sm },
    codeText: { fontFamily: fontFamily.mono, fontSize: CODE, lineHeight: 20, color: colors.text },
    runButton: {
      position: "absolute",
      top: space.xs,
      right: space.xs,
      width: RUN_BOX,
      height: RUN_BOX,
      borderRadius: radius.sm,
      backgroundColor: colors.raised,
      alignItems: "center",
      justifyContent: "center",
    },
  }),
);

/**
 * Assistant reply rendered as markdown, full width. A long press opens the reply menu; Copy copies
 * the markdown source, the way the chat apps copy. `id` is the thread item id (for Read aloud).
 */
export const AssistantMessage = memo(function AssistantMessage({ markdown, id }: { markdown: string; id?: string }) {
  const menu: MenuTarget = { kind: "assistant", text: markdown, id };
  return (
    <ReplyMenu.Provider value={menu}>
      <MenuPressable menu={menu} feedback="dim">
        <Markdown style={mdStyles()} rules={rules} markdownit={markdownit}>
          {markdown}
        </Markdown>
      </MenuPressable>
    </ReplyMenu.Provider>
  );
});
