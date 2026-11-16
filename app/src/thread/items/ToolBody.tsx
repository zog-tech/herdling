import type { ReactNode } from "react";
import { View } from "react-native";

import { DIFF_PAGE_LINES, MAX_LINE_CHARS, splitPath, type DiffLine } from "@/changes/diff";
import { fontFamily } from "@/theme/fonts";
import { colors, radius, space, type } from "@/theme/tokens";
import { Text } from "@/ui/Text";

import { HScrollView } from "../HScrollView";
import { LinkedText } from "../LinkText";
import { splitLines, type ToolShape } from "../toolKinds";
import { lastLines, type ToolResult } from "../toolView";

/**
 * The designed body of a tool call: an edit as diff rows, a new file as a preview, a command as
 * `$ command` with its output. The card and the full tool screen ("full") share it, so both look
 * the same. The rows keep the "+" and "-" signs, so color is never the only cue.
 */

/** Lines of output a card shows: the live output of a running tool, and the output of a command. */
export const LIVE_LINES = 30;
/** Diff rows a card shows over all files. More rows make a long card slow to draw. */
export const CARD_DIFF_ROWS = 400;

const CARD_LINE_HEIGHT = 18;

type Metrics = { fontSize: number; lineHeight: number };

const KIND_WORD: Partial<Record<DiffLine["kind"], string>> = { add: "Added", del: "Deleted", ctx: "Unchanged" };

function rowColors(kind: DiffLine["kind"]): { bg?: string; fg: string } {
  switch (kind) {
    case "add":
      return { bg: colors.diff.addBg, fg: colors.diff.add };
    case "del":
      return { bg: colors.diff.delBg, fg: colors.diff.del };
    case "ctx":
      return { fg: colors.text };
    default:
      return { fg: colors.textMuted };
  }
}

function Row({ l, m }: { l: DiffLine; m: Metrics }) {
  const c = rowColors(l.kind);
  const word = KIND_WORD[l.kind];
  const body = word ? l.text.slice(1) : l.text;
  return (
    <Text
      accessibilityLabel={word ? `${word}: ${body.trim() || "empty"}` : body}
      style={{
        fontFamily: fontFamily.mono,
        fontSize: m.fontSize,
        lineHeight: m.lineHeight,
        color: c.fg,
        backgroundColor: c.bg,
        paddingHorizontal: space.sm,
      }}
    >
      {l.text || " "}
    </Text>
  );
}

/** The rows on `sunken`. The card scrolls them sideways; the full screen already scrolls both ways. */
function Rows({ lines, m, card }: { lines: DiffLine[]; m: Metrics; card: boolean }) {
  const column = (
    <View style={{ flexGrow: 1, paddingVertical: space.xs }}>
      {lines.map((l, i) => (
        <Row key={i} l={l} m={m} />
      ))}
    </View>
  );
  if (!card) return <View style={{ backgroundColor: colors.sunken, borderRadius: radius.sm }}>{column}</View>;
  return (
    <HScrollView
      showsHorizontalScrollIndicator={false}
      style={{ backgroundColor: colors.sunken, borderRadius: radius.sm }}
      contentContainerStyle={{ flexGrow: 1 }}
    >
      {column}
    </HScrollView>
  );
}

/** The file name, then its folder in the muted color. */
function PathLine({ path }: { path: string }) {
  if (!path) return null;
  const [name, dir] = splitPath(path);
  return (
    <Text variant="caption" bold numberOfLines={1} ellipsizeMode="middle" style={{ fontFamily: fontFamily.monoBold }}>
      {name}
      {dir ? <Text variant="caption" muted style={{ fontFamily: fontFamily.mono }}>{`  ${dir}`}</Text> : null}
    </Text>
  );
}

function MoreNote({ hidden, card }: { hidden: number; card: boolean }) {
  if (hidden <= 0) return null;
  return (
    <Text variant="caption" muted>
      {card ? `${hidden} more lines. Tap Expand to see all.` : `${hidden} more lines are not shown.`}
    </Text>
  );
}

function cut(line: string): string {
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line;
}

/** The body of an open tool card, or of the full tool screen ("full"). Null for kinds "lookup" and "other". */
export function ToolBody({
  shape,
  result,
  variant,
  fontSize,
}: {
  shape: ToolShape;
  result?: ToolResult;
  variant: "card" | "full";
  /** Full screen font size; the card uses the caption size. */
  fontSize?: number;
}): React.ReactElement | null {
  const card = variant === "card";
  const m: Metrics =
    card || fontSize === undefined
      ? { fontSize: type.size.caption, lineHeight: CARD_LINE_HEIGHT }
      : { fontSize, lineHeight: Math.round(fontSize * 1.4) };
  const cap = card ? CARD_DIFF_ROWS : DIFF_PAGE_LINES;

  if (shape.kind === "diff") {
    let left = cap;
    let hidden = 0;
    const parts: ReactNode[] = [];
    shape.files.forEach((f, i) => {
      const shown = f.lines.slice(0, Math.max(0, left));
      left -= shown.length;
      hidden += f.lines.length - shown.length;
      if (shown.length === 0 && f.lines.length > 0) return;
      parts.push(
        <View key={i} style={{ gap: space.xs }}>
          <PathLine path={f.path} />
          {shown.length > 0 ? <Rows lines={shown} m={m} card={card} /> : null}
        </View>,
      );
    });
    return (
      <View style={{ gap: space.sm }}>
        {parts}
        <MoreNote hidden={hidden} card={card} />
      </View>
    );
  }

  if (shape.kind === "write") {
    const all = splitLines(shape.content);
    const shown: DiffLine[] = all.slice(0, cap).map((l) => ({ kind: "add", text: cut(`+${l}`) }));
    return (
      <View style={{ gap: space.xs }}>
        <PathLine path={shape.path} />
        <Text variant="caption" muted>
          {`New file · ${shape.lineCount} ${shape.lineCount === 1 ? "line" : "lines"}`}
        </Text>
        {shown.length > 0 ? <Rows lines={shown} m={m} card={card} /> : null}
        <MoreNote hidden={all.length - shown.length} card={card} />
      </View>
    );
  }

  if (shape.kind === "shell") {
    const failed = !!result && !result.ok;
    const raw = result ? (card ? lastLines(result.text, LIVE_LINES) : result.text) : "";
    const out = raw || "(no output)";
    const outStyle = {
      fontFamily: fontFamily.mono,
      fontSize: m.fontSize,
      lineHeight: m.lineHeight,
      color: failed ? colors.danger : colors.text,
    };
    return (
      <View style={{ gap: space.xs }}>
        <Text selectable style={{ fontFamily: fontFamily.monoBold, fontSize: m.fontSize, lineHeight: m.lineHeight, color: colors.text }}>
          {`$ ${shape.command}`}
        </Text>
        {shape.description ? (
          <Text variant="caption" muted>
            {shape.description}
          </Text>
        ) : null}
        {result ? (
          <>
            <Text variant="caption" muted style={{ marginTop: space.xs }}>
              {result.truncated ? "Output (truncated)" : "Output"}
            </Text>
            {card ? (
              <HScrollView showsHorizontalScrollIndicator={false} style={{ backgroundColor: colors.sunken, borderRadius: radius.sm }}>
                <Text selectable style={[outStyle, { padding: space.sm }]}>
                  <LinkedText text={out} />
                </Text>
              </HScrollView>
            ) : (
              <Text selectable style={outStyle}>
                <LinkedText text={out} />
              </Text>
            )}
          </>
        ) : null}
      </View>
    );
  }

  return null;
}
