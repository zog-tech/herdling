import Markdown, { type RenderRules } from "@ronradtke/react-native-markdown-display";
import { memo } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";

import { fontFamily } from "@/theme/fonts";
import { colors, radius, space, type } from "@/theme/tokens";

import { HScrollView } from "../HScrollView";

const BODY = type.size.body;
const LINE = Math.round(BODY * type.lineHeight.body);
const CODE = type.size.small - 1;
/** Width of one table column. */
const TABLE_COL = 140;

const openLink = (url: string) => {
  if (/^(https?:|mailto:)/i.test(url)) Linking.openURL(url).catch(() => {});
};

/** Code block: JetBrains Mono, scrolls sideways instead of wrapping. */
function CodeBlock({ content }: { content: string }) {
  const text = content.endsWith("\n") ? content.slice(0, -1) : content;
  return (
    <HScrollView showsHorizontalScrollIndicator={false} style={styles.codeScroll} contentContainerStyle={{ padding: space.md }}>
      <Text selectable style={styles.codeText}>
        {text}
      </Text>
    </HScrollView>
  );
}

const rules: RenderRules = {
  fence: (node) => <CodeBlock key={node.key} content={node.content} />,
  code_block: (node) => <CodeBlock key={node.key} content={node.content} />,
  // A table scrolls sideways inside its own box; it never draws outside the message.
  table: (node, children, _parent, s) => (
    <HScrollView key={node.key} showsHorizontalScrollIndicator={false} style={{ marginBottom: space.sm }}>
      <View style={s.table}>{children}</View>
    </HScrollView>
  ),
  // A Text link (not the default Pressable) so it wraps with the paragraph; opens the system browser.
  link: (node, children, _parent, s) => (
    <Text key={node.key} style={s.link} accessibilityRole="link" onPress={() => openLink(String(node.attributes.href ?? ""))}>
      {children}
    </Text>
  ),
};

const mdStyles = StyleSheet.create({
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
  link: { color: colors.status.working, textDecorationLine: "underline" },
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
});

const styles = StyleSheet.create({
  codeScroll: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.divider, marginBottom: space.sm },
  codeText: { fontFamily: fontFamily.mono, fontSize: CODE, lineHeight: 20, color: colors.text },
});

/** Assistant reply rendered as markdown, full width. */
export const AssistantMessage = memo(function AssistantMessage({ markdown }: { markdown: string }) {
  return (
    <View>
      <Markdown style={mdStyles} rules={rules}>
        {markdown}
      </Markdown>
    </View>
  );
});
