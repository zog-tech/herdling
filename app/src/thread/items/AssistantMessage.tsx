import Markdown, { type RenderRules } from "@ronradtke/react-native-markdown-display";
import { Check, Copy, Play } from "lucide-react-native";
import { createContext, memo, useContext, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useHostConn } from "@/hosts/connection";
import { fontFamily } from "@/theme/fonts";
import { colors, hitTarget, icon, radius, space, state, themed, type } from "@/theme/tokens";
import * as haptics from "@/ui/haptics";
import { HScrollView } from "../HScrollView";
import { ThreadLink } from "../LinkText";
import { findLinks, linkTarget, replyMarkdownIt } from "../links";
import { RunHostContext, ThreadPaneContext, type RunHost } from "../LiveToolContext";
import { MenuPressable } from "../MenuPressable";
import { copyText, type MenuTarget } from "../rowMenu";
import { runAt, runnableCommand } from "../runCommand";

// The package reads these two props (src/index.js) but its types leave them out.
declare module "@ronradtke/react-native-markdown-display" {
  interface MarkdownProps {
    allowedImageHandlers?: string[];
    defaultImageHandler?: string | null;
  }
}

const BODY = type.size.body;
const LINE = Math.round(BODY * type.lineHeight.body);
const CODE = type.size.small - 1;
/** Width of one table column. */
const TABLE_COL = 140;
/** The visible box of the Run and Copy buttons; `hitSlop` makes the touch area `hitTarget`. */
const BTN_BOX = 28;
const BTN_SLOP = (hitTarget - BTN_BOX) / 2;
/** Space between the two buttons: their touch areas meet but do not overlap. */
const BTN_GAP = BTN_SLOP * 2;
/** How long the Copy button shows its check mark after a copy. */
const COPIED_MS = 1500;

/** No image source loads: see the `image` rule. */
const NO_IMAGE_HANDLERS: string[] = [];

/** The reply parser: it also links bare URLs that have a scheme (see `links.ts`). */
const markdownit = replyMarkdownIt();

/** The URL when inline code is one URL and nothing more, as in `http://localhost:5173`. */
function codeUrl(content: string): string | undefined {
  const m = findLinks(content);
  return m.length === 1 && m[0].start === 0 && m[0].end === content.length ? m[0].url : undefined;
}

/** The menu target of the reply being drawn: its code blocks open the same menu. Links have their own menu. */
const ReplyMenu = createContext<MenuTarget | null>(null);

/** The Copy button of a code block: a check mark for `COPIED_MS` after a copy. No notice. */
function CopyButton({ text }: { text: string }) {
  // A count, not a flag: a second copy while the check shows starts the time again.
  const [copied, setCopied] = useState(0);
  useEffect(() => {
    if (copied === 0) return;
    const id = setTimeout(() => setCopied(0), COPIED_MS);
    return () => clearTimeout(id);
  }, [copied]);
  const Icon = copied > 0 ? Check : Copy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Copy code"
      accessibilityValue={copied > 0 ? { text: "Copied" } : undefined}
      hitSlop={BTN_SLOP}
      onPress={() => {
        void copyText(text, "Code copied", { quiet: true }).then((ok) => {
          if (ok) setCopied((c) => c + 1);
        });
      }}
      style={({ pressed }) => [styles().codeButton, { opacity: pressed ? state.pressedOpacity : 1 }]}
    >
      <Icon size={icon.sm} color={copied > 0 ? colors.status.done : colors.textMuted} strokeWidth={icon.strokeWidth} />
    </Pressable>
  );
}

/**
 * Code block: JetBrains Mono, scrolls sideways instead of wrapping. A long press opens the reply
 * menu with "Copy code" (this block only) on top. The text is not `selectable`: on iOS that adds
 * its own long press, which fights the menu. "Select text" in the menu is the way to copy a part.
 * Every block has a Copy button (top right). A shell block also gets a Run button and "Run in
 * shell…" when the host is known: a session thread, the peek sheet or a subagent thread.
 */
function CodeBlock({ content, lang }: { content: string; lang?: string }) {
  const reply = useContext(ReplyMenu);
  const pane = useContext(ThreadPaneContext);
  const runHost = useContext(RunHostContext);
  const at: RunHost | null = pane ?? runHost;
  const online = useHostConn(at?.hostId ?? "").status === "online";
  const text = content.endsWith("\n") ? content.slice(0, -1) : content;
  const command = at ? runnableCommand(lang, text) : null;
  const run = command !== null && online ? command : undefined;
  const buttons = command !== null ? 2 : 1;
  const menu: MenuTarget | null = reply ? { ...reply, code: text, run, ...(pane ? {} : runHost ? { runAt: runHost } : {}) } : null;
  return (
    <MenuPressable menu={menu} accessible={false}>
      <View>
        <HScrollView
          showsHorizontalScrollIndicator={false}
          style={styles().codeScroll}
          // Room on the right so the end of a long first line can scroll out from under the buttons.
          contentContainerStyle={{ padding: space.md, paddingRight: space.md + buttons * BTN_BOX + (buttons - 1) * BTN_GAP }}
        >
          <Text style={styles().codeText}>{text}</Text>
        </HScrollView>
        {/* box-none: a drag in the gap between the buttons still scrolls the code. */}
        <View pointerEvents="box-none" style={styles().codeButtons}>
          {at && command !== null ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Run command"
              accessibilityHint="Opens the run sheet"
              accessibilityState={{ disabled: !online }}
              disabled={!online}
              hitSlop={BTN_SLOP}
              onPress={() => {
                haptics.tap();
                runAt(at, command);
              }}
              style={({ pressed }) => [styles().codeButton, { opacity: !online ? state.offlineOpacity : pressed ? state.pressedOpacity : 1 }]}
            >
              <Play size={icon.sm} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
            </Pressable>
          ) : null}
          <CopyButton text={text} />
        </View>
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
  // An image never loads by itself: a fetch on view tells the image host the phone's address and
  // the view time. It shows as a link with its alt text (or its URL), and a tap opens it as a link.
  // A source that the app does not open (data:, javascript: or no scheme) shows as plain text.
  image: (node, _children, _parent, s) => {
    const src = String(node.attributes.src ?? "");
    const alt = String(node.attributes.alt ?? "").trim();
    if (linkTarget(src) === null) {
      return (
        <Text key={node.key} style={s.text}>
          {alt || "Image"}
        </Text>
      );
    }
    return (
      <Text key={node.key}>
        <ThreadLink style={s.link} url={src}>
          {alt || src}
        </ThreadLink>
      </Text>
    );
  },
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
    codeButtons: { position: "absolute", top: space.xs, right: space.xs, flexDirection: "row", gap: BTN_GAP },
    codeButton: {
      width: BTN_BOX,
      height: BTN_BOX,
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
        <Markdown
          style={mdStyles()}
          rules={rules}
          markdownit={markdownit}
          // Defense in depth: if the image rule goes away, the default rule loads nothing.
          allowedImageHandlers={NO_IMAGE_HANDLERS}
          defaultImageHandler={null}
        >
          {markdown}
        </Markdown>
      </MenuPressable>
    </ReplyMenu.Provider>
  );
});
