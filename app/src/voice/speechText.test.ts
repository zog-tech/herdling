import { speechText } from "./speechText";

describe("speechText", () => {
  it("code_block_becomes_marker", () => {
    expect(speechText("Run this:\n```sh\nls\n```\nDone.")).toBe("Run this: code block. Done.");
  });
  it("multi_line_code_block_is_one_marker", () => {
    expect(speechText("Run:\n```sh\nnpm i\n\nnpm test\nnpm run build\n```\nDone.")).toBe("Run: code block. Done.");
    expect(speechText("A\n~~~\nx\ny\n~~~\nB\n```\nz\nw")).toBe("A code block. B code block.");
  });
  it("table_becomes_marker", () => {
    expect(speechText("Totals:\n| a | b |\n|---|---|\n| 1 | 2 |\nEnd")).toBe("Totals: a table. End");
  });
  it("link_keeps_text", () => {
    expect(speechText("See [the docs](https://x.dev) now")).toBe("See the docs now");
  });
  it("strips_emphasis_and_headings", () => {
    expect(speechText("## Plan\n**Bold** and _it_\n- one\n- two")).toBe("Plan. Bold and it one. two.");
  });
  it("handles inline code, bare urls, images, quotes and an unclosed fence", () => {
    expect(speechText("Use `pnpm test` at https://x.dev/a?b=1 ![shot](a.png)\n> quoted\n1. first")).toBe(
      "Use pnpm test at a link quoted first.",
    );
    expect(speechText("Start\n```\nls")).toBe("Start code block.");
  });
  it("keeps snake_case words", () => {
    expect(speechText("set my_var_name now")).toBe("set my_var_name now");
  });
});

test("list items read as separate sentences and keep their own end marks", () => {
  expect(speechText("Changes:\n1. Fixed the pill\n2. Added a stop button!\n- Removed the timer")).toBe(
    "Changes: Fixed the pill. Added a stop button! Removed the timer.",
  );
});
