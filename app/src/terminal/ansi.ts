/** A run of text with one style. Only set attributes are present. */
export type Span = {
  text: string;
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
};
export type Line = Span[];

type Style = Omit<Span, "text">;

const ESC = "\x1b";
const BEL = "\x07";
const TAB_STOP = 8;
const CUBE = [0, 95, 135, 175, 215, 255];

const hex2 = (n: number) => n.toString(16).padStart(2, "0");
const rgb = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;
const byte = (n: number | undefined): n is number => n !== undefined && Number.isInteger(n) && n >= 0 && n <= 255;

/** xterm 256-color index: 0–15 from the palette, 16–231 the 6×6×6 cube, 232–255 the gray ramp. */
function color256(n: number, palette: readonly string[]): string {
  if (n < 16) return palette[n];
  if (n < 232) {
    const i = n - 16;
    return rgb(CUBE[Math.floor(i / 36)], CUBE[Math.floor(i / 6) % 6], CUBE[i % 6]);
  }
  const v = 8 + (n - 232) * 10;
  return rgb(v, v, v);
}

/**
 * Applies `38;5;n` / `38;2;r;g;b` (and the 48 forms) starting at `codes[i]` (the 38 or 48).
 * Returns the color (or undefined when malformed) and the index of the last code it used.
 */
function extended(codes: number[], i: number, palette: readonly string[]): { color?: string; end: number } {
  const mode = codes[i + 1];
  if (mode === 5) {
    const n = codes[i + 2];
    return { color: byte(n) ? color256(n, palette) : undefined, end: i + 2 };
  }
  if (mode === 2) {
    const [r, g, b] = [codes[i + 2], codes[i + 3], codes[i + 4]];
    return { color: byte(r) && byte(g) && byte(b) ? rgb(r, g, b) : undefined, end: i + 4 };
  }
  return { end: codes.length };
}

function applySgr(params: string, style: Style, palette: readonly string[]): Style {
  const codes = params === "" ? [0] : params.split(";").map((p) => (p === "" ? 0 : Number(p)));
  let s: Style = { ...style };
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    if (c === 0) s = {};
    else if (c === 1) s.bold = true;
    else if (c === 2) s.dim = true;
    else if (c === 3) s.italic = true;
    else if (c === 4) s.underline = true;
    else if (c === 7) s.inverse = true;
    else if (c === 22) {
      delete s.bold;
      delete s.dim;
    }
    else if (c === 23) delete s.italic;
    else if (c === 24) delete s.underline;
    else if (c === 27) delete s.inverse;
    else if (c >= 30 && c <= 37) s.fg = palette[c - 30];
    else if (c === 39) delete s.fg;
    else if (c >= 40 && c <= 47) s.bg = palette[c - 40];
    else if (c === 49) delete s.bg;
    else if (c >= 90 && c <= 97) s.fg = palette[c - 90 + 8];
    else if (c >= 100 && c <= 107) s.bg = palette[c - 100 + 8];
    else if (c === 38 || c === 48) {
      const { color, end } = extended(codes, i, palette);
      if (color) s[c === 38 ? "fg" : "bg"] = color;
      i = end;
    }
  }
  return s;
}

const sameStyle = (a: Style, b: Style) =>
  a.fg === b.fg &&
  a.bg === b.bg &&
  a.bold === b.bold &&
  a.dim === b.dim &&
  a.italic === b.italic &&
  a.underline === b.underline &&
  a.inverse === b.inverse;

/**
 * Splits terminal text with ANSI escapes into lines of styled spans.
 * Keeps SGR styles (they carry across line breaks); drops every other CSI, OSC and escape sequence,
 * `\r` and other control characters, and a truncated sequence at the end. Tabs expand to 8-column stops.
 */
export function parseAnsi(text: string, palette: readonly string[]): Line[] {
  const lines: Line[] = [];
  let line: Line = [];
  let style: Style = {};
  let buf = "";
  let col = 0;

  const flush = () => {
    if (buf) {
      const last = line[line.length - 1];
      if (last && sameStyle(last, style)) last.text += buf;
      else line.push({ text: buf, ...style });
    }
    buf = "";
  };
  const setStyle = (next: Style) => {
    flush();
    style = next;
  };

  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (ch === ESC) {
      const kind = text[i + 1];
      if (kind === undefined) break;
      if (kind === "[") {
        // CSI: parameter/intermediate bytes, then one final byte 0x40–0x7E.
        let j = i + 2;
        while (j < n && (text.charCodeAt(j) < 0x40 || text.charCodeAt(j) > 0x7e)) j++;
        if (j >= n) break;
        if (text[j] === "m") {
          const params = text.slice(i + 2, j);
          if (/^[\d;]*$/.test(params)) setStyle(applySgr(params, style, palette));
        }
        i = j + 1;
      } else if (kind === "]" || kind === "P" || kind === "_" || kind === "^" || kind === "X") {
        // OSC / DCS / APC / PM / SOS: up to BEL or ESC \.
        let j = i + 2;
        while (j < n && text[j] !== BEL && !(text[j] === ESC && text[j + 1] === "\\")) j++;
        if (j >= n) break;
        i = text[j] === BEL ? j + 1 : j + 2;
      } else {
        // Other escapes: optional intermediates 0x20–0x2F, then one final byte.
        let j = i + 1;
        while (j < n && text.charCodeAt(j) >= 0x20 && text.charCodeAt(j) <= 0x2f) j++;
        if (j >= n) break;
        i = j + 1;
      }
      continue;
    }
    if (ch === "\n") {
      flush();
      lines.push(line);
      line = [];
      col = 0;
    } else if (ch === "\t") {
      const pad = TAB_STOP - (col % TAB_STOP);
      buf += " ".repeat(pad);
      col += pad;
    } else if (ch.charCodeAt(0) >= 0x20 && ch !== "\x7f") {
      buf += ch;
      col++;
    }
    i++;
  }
  flush();
  lines.push(line);
  return lines;
}
