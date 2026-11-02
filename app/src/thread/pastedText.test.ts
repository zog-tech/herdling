import {
  detectPaste,
  insertAt,
  insertedBlock,
  isLongPaste,
  lineCount,
  makePaste,
  PASTE_MAX_CHARS,
  pasteLabel,
  pasteSize,
  utf8Base64,
} from "./pastedText";

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n");

test("lineCount ignores one line break at the end", () => {
  expect(lineCount("a")).toBe(1);
  expect(lineCount("a\nb\n")).toBe(2);
  expect(lineCount("a\r\nb\rc")).toBe(3);
});

test("isLongPaste uses the line and character limits", () => {
  expect(isLongPaste(lines(10))).toBe(false);
  expect(isLongPaste(lines(11))).toBe(true);
  expect(isLongPaste("x".repeat(PASTE_MAX_CHARS))).toBe(false);
  expect(isLongPaste("x".repeat(PASTE_MAX_CHARS + 1))).toBe(true);
});

test("insertedBlock finds the inserted part and the replaced length", () => {
  expect(insertedBlock("hello world", "hello big world")).toEqual({ at: 6, block: "big ", removed: 0 });
  expect(insertedBlock("abcXYZdef", "abc123def")).toEqual({ at: 3, block: "123", removed: 3 });
  expect(insertedBlock("aaa", "aaaa")).toEqual({ at: 3, block: "a", removed: 0 });
  expect(insertedBlock("", "new")).toEqual({ at: 0, block: "new", removed: 0 });
});

test("detectPaste cuts a long block out of the text", () => {
  const block = lines(20);
  expect(detectPaste("Fix this: ", `Fix this: ${block}`)).toEqual({ text: "Fix this: ", pasted: block, at: 10 });
  // In the middle, over a short selection.
  expect(detectPaste("see SEL here", `see ${block} here`)).toEqual({ text: "see  here", pasted: block, at: 4 });
});

test("detectPaste ignores typing, deletes and short pastes", () => {
  const long = lines(30);
  expect(detectPaste("", "a")).toBeUndefined();
  expect(detectPaste(long, `${long}x`)).toBeUndefined();
  expect(detectPaste(long, long.slice(1))).toBeUndefined();
  expect(detectPaste("ab", `a${lines(5)}b`)).toBeUndefined();
});

test("detectPaste ignores a change that rewrites the text in place", () => {
  expect(detectPaste("y".repeat(900), "z".repeat(950))).toBeUndefined();
});

test("chip labels show lines, or characters for one line", () => {
  expect(pasteSize(lines(240))).toBe("240 lines");
  expect(pasteSize("x".repeat(1200))).toBe("1,200 chars");
  expect(pasteLabel(makePaste(1, lines(240)))).toBe("Pasted text #1 · 240 lines");
  expect(makePaste(3, "t").name).toBe("pasted-text-3.txt");
});

test("insertAt puts text at the cursor or at the end", () => {
  expect(insertAt("ab", "X", 1)).toBe("aXb");
  expect(insertAt("ab", "X")).toBe("abX");
  expect(insertAt("ab", "X", 9)).toBe("abX");
});

test("utf8Base64 matches Buffer for ASCII, accents, CJK and emoji", () => {
  for (const s of ["", "a", "ab", "abc", "héllo wörld", "日本語のテキスト", "rocket 🚀 ok\n", lines(50)]) {
    expect(utf8Base64(s)).toBe(Buffer.from(s, "utf8").toString("base64"));
  }
  // A lone surrogate becomes U+FFFD.
  expect(utf8Base64("a\ud800b")).toBe(Buffer.from("a�b", "utf8").toString("base64"));
});
