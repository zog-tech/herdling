import { memo } from "react";
import { Text, type TextStyle } from "react-native";

import { fontFamily } from "@/theme/fonts";
import { colors } from "@/theme/tokens";

import type { Line, Span } from "./ansi";

/** Alpha suffix for dim text on a #rrggbb color. */
const DIM_ALPHA = "99";

function spanStyle(s: Span): TextStyle | undefined {
  if (!s.fg && !s.bg && !s.bold && !s.dim && !s.italic && !s.underline && !s.inverse) return undefined;
  let fg = s.fg;
  let bg = s.bg;
  if (s.inverse) {
    fg = s.bg ?? colors.terminal.bg;
    bg = s.fg ?? colors.terminal.fg;
  }
  if (s.dim) fg = `${fg ?? colors.terminal.fg}${DIM_ALPHA}`;
  return {
    color: fg,
    backgroundColor: bg,
    fontFamily: s.bold ? fontFamily.monoBold : undefined,
    fontStyle: s.italic ? "italic" : undefined,
    textDecorationLine: s.underline ? "underline" : undefined,
  };
}

/**
 * Styled terminal lines in one selectable monospace text. Memoized on `lines`:
 * the parent passes the same array while the screen is unchanged, so nothing re-renders.
 */
export const AnsiText = memo(function AnsiText({ lines, style }: { lines: Line[]; style?: TextStyle }) {
  const last = lines.length - 1;
  return (
    <Text selectable style={[{ fontFamily: fontFamily.mono, color: colors.terminal.fg }, style]}>
      {lines.map((line, i) => [
        ...line.map((s, j) => {
          const st = spanStyle(s);
          return st ? (
            <Text key={`${i}.${j}`} style={st}>
              {s.text}
            </Text>
          ) : (
            s.text
          );
        }),
        i < last ? "\n" : null,
      ])}
    </Text>
  );
});
