import { plainText } from "./plainText";

test("plain_text_drops_marks_and_keeps_structure", () => {
  const md = [
    "# Done",
    "",
    "I fixed **two** bugs in `app.ts`, see [the docs](https://example.com).",
    "",
    "- first",
    "- second",
    "",
    "1. one",
    "2. two",
    "",
    "```ts",
    "const a = 1;",
    "```",
    "",
    "| a | b |",
    "|---|---|",
    "| 1 | 2 |",
  ].join("\n");
  expect(plainText(md)).toBe(
    [
      "Done",
      "",
      "I fixed two bugs in app.ts, see the docs.",
      "",
      "• first",
      "• second",
      "",
      "1. one",
      "2. two",
      "",
      "const a = 1;",
      "",
      "a\tb",
      "1\t2",
    ].join("\n"),
  );
});

test("plain_text_of_plain_text_is_unchanged", () => {
  expect(plainText("just words\nand a second line")).toBe("just words\nand a second line");
});
