import { parseAnsi } from "./ansi";

const palette = [
  "#c0", "#c1", "#c2", "#c3", "#c4", "#c5", "#c6", "#c7",
  "#c8", "#c9", "#c10", "#c11", "#c12", "#c13", "#c14", "#c15",
] as const;

test("plain_text_one_span", () => {
  expect(parseAnsi("hello world", palette)).toEqual([[{ text: "hello world" }]]);
});

test("sgr_color_and_reset", () => {
  expect(parseAnsi("\x1b[31mred\x1b[0m ok", palette)).toEqual([[{ text: "red", fg: palette[1] }, { text: " ok" }]]);
});

test("bright_and_bg", () => {
  expect(parseAnsi("\x1b[92;44mhi\x1b[39mx\x1b[49my\x1b[102;97mz", palette)).toEqual([
    [
      { text: "hi", fg: palette[10], bg: palette[4] },
      { text: "x", bg: palette[4] },
      { text: "y" },
      { text: "z", fg: palette[15], bg: palette[10] },
    ],
  ]);
});

test("color_256_and_truecolor", () => {
  expect(parseAnsi("\x1b[38;5;196ma\x1b[38;2;1;2;3mb\x1b[48;5;2mc\x1b[0;48;2;255;128;0md\x1b[38;5;232me", palette)).toEqual([
    [
      { text: "a", fg: "#ff0000" },
      { text: "b", fg: "#010203" },
      { text: "c", fg: "#010203", bg: palette[2] },
      { text: "d", bg: "#ff8000" },
      { text: "e", fg: "#080808", bg: "#ff8000" },
    ],
  ]);
});

test("attributes_on_and_off", () => {
  expect(parseAnsi("\x1b[1;2;3;4;7ma\x1b[22mb\x1b[23;24mc\x1b[27md", palette)).toEqual([
    [
      { text: "a", bold: true, dim: true, italic: true, underline: true, inverse: true },
      { text: "b", italic: true, underline: true, inverse: true },
      { text: "c", inverse: true },
      { text: "d" },
    ],
  ]);
});

test("empty_sgr_resets", () => {
  expect(parseAnsi("\x1b[31ma\x1b[mb", palette)).toEqual([[{ text: "a", fg: palette[1] }, { text: "b" }]]);
});

test("drops_osc_and_cursor_moves", () => {
  expect(parseAnsi("\x1b]0;title\x07a\x1b[2Kb", palette)).toEqual([[{ text: "ab" }]]);
  expect(parseAnsi("\x1b]8;;http://x\x1b\\c\x1b[?25l\x1b(Bd\x1b[10;3He", palette)).toEqual([[{ text: "cde" }]]);
});

test("split_lines_keep_style", () => {
  expect(parseAnsi("\x1b[32mone\r\ntwo\x1b[0m\n\nthree", palette)).toEqual([
    [{ text: "one", fg: palette[2] }],
    [{ text: "two", fg: palette[2] }],
    [],
    [{ text: "three" }],
  ]);
});

test("truncated_escape_at_end_is_dropped", () => {
  expect(parseAnsi("ok\x1b[38;5", palette)).toEqual([[{ text: "ok" }]]);
  expect(parseAnsi("ok\x1b]0;tit", palette)).toEqual([[{ text: "ok" }]]);
  expect(parseAnsi("ok\x1b", palette)).toEqual([[{ text: "ok" }]]);
});

test("tabs_expand_and_controls_drop", () => {
  expect(parseAnsi("a\tb\x07\x08c", palette)).toEqual([[{ text: "a       bc" }]]);
});

test("bad_extended_colors_are_ignored", () => {
  expect(parseAnsi("\x1b[38;5;300ma\x1b[38;2;1;2mb", palette)).toEqual([[{ text: "ab" }]]);
});

test("malformed_csi_keeps_text_after_newline", () => {
  expect(parseAnsi("a\x1b[3\nbcd", palette)).toEqual([[{ text: "a" }], [{ text: "bcd" }]]);
  expect(parseAnsi("a\x1b[3\x07b", palette)).toEqual([[{ text: "ab" }]]);
});

test("unterminated_osc_drops_only_to_end_of_line", () => {
  expect(parseAnsi("a\x1b]0;title\nb\x1b[31mc", palette)).toEqual([[{ text: "a" }], [{ text: "b" }, { text: "c", fg: palette[1] }]]);
});
