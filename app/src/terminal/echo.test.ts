import type { Line } from "./ansi";
import { ECHO_TIMEOUT_MS, lastFilledLine, overlayEcho, plainText, settleEchoes, type Echo } from "./echo";

const L = (...texts: string[]): Line[] => texts.map((t) => (t ? [{ text: t }] : []));

test("no_pending_keeps_the_same_array", () => {
  const lines = L("a", "$ ");
  expect(overlayEcho(lines, [])).toBe(lines);
  expect(overlayEcho(lines, [""])).toBe(lines);
});

test("echo_goes_at_the_end_of_the_last_line_with_text", () => {
  const lines = L("out", "$ ", "", "");
  const shown = overlayEcho(lines, ["ls -la"]);
  expect(shown[1]).toEqual([{ text: "$ " }, { text: "ls -la", dim: true }]);
  expect(shown).toHaveLength(4);
  expect(lines[1]).toEqual([{ text: "$ " }]);
});

test("more_echoes_go_on_new_lines_below", () => {
  const shown = overlayEcho(L("$ "), ["one", "two"], { underline: true });
  expect(shown).toEqual([
    [{ text: "$ " }, { text: "one", dim: true, underline: true }],
    [{ text: "two", dim: true, underline: true }],
  ]);
});

test("empty_screen_gets_the_echo_as_a_line", () => {
  expect(overlayEcho([], ["x"])).toEqual([[{ text: "x", dim: true }]]);
});

test("plain_text_and_last_filled_line", () => {
  const lines: Line[] = [[{ text: "a" }, { text: "b", fg: "#f00" }], [{ text: "$ x" }], [{ text: "  " }]];
  expect(plainText(lines)).toBe("ab\n$ x\n  ");
  expect(lastFilledLine(lines)).toBe("$ x");
  expect(lastFilledLine([])).toBe("");
});

describe("settleEchoes", () => {
  const e = (text: string, base = "$ ", at = 0): Echo => ({ id: 1, text, at, base });

  test("a_newer_screen_with_the_text_confirms_the_echo", () => {
    expect(settleEchoes([e("ls")], "$ ls\nfile\n$ ", 100)).toEqual([]);
  });

  test("the_screen_at_send_time_does_not_confirm", () => {
    // The same command ran before: the old screen already has the text.
    const echoes = [e("ls", "$ ls\nfile\n$ ")];
    expect(settleEchoes(echoes, "$ ls\nfile\n$ ", 100)).toBe(echoes);
  });

  test("an_echo_goes_after_the_timeout", () => {
    const echoes = [e("ls", "$ ", 0)];
    expect(settleEchoes(echoes, "$ ", ECHO_TIMEOUT_MS - 1)).toBe(echoes);
    expect(settleEchoes(echoes, "$ ", ECHO_TIMEOUT_MS)).toEqual([]);
  });
});
