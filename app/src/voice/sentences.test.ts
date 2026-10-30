import { splitSentences } from "./sentences";

describe("splitSentences", () => {
  it("splits on . ! ? followed by a space", () => {
    expect(splitSentences("I edited main.rs today. Should I run the tests? Yes, do it now!")).toEqual([
      "I edited main.rs today.",
      "Should I run the tests?",
      "Yes, do it now!",
    ]);
  });

  it("splits on newlines", () => {
    expect(splitSentences("First line here\nSecond line here")).toEqual(["First line here", "Second line here"]);
  });

  it("keeps abbreviations, initials, versions and file names inside a sentence", () => {
    expect(splitSentences("Use a tool, e.g. ripgrep, for this. Ask Dr. Smith or J. Doe about v1.2 now.")).toEqual([
      "Use a tool, e.g. ripgrep, for this.",
      "Ask Dr. Smith or J. Doe about v1.2 now.",
    ]);
  });

  it("keeps closing quotes and brackets with the sentence", () => {
    expect(splitSentences('He said "all tests pass." Then he left the room.')).toEqual([
      'He said "all tests pass."',
      "Then he left the room.",
    ]);
  });

  it("joins short pieces so no clip is a single word", () => {
    expect(splitSentences("Done. The tests pass now. OK.")).toEqual(["Done. The tests pass now. OK."]);
    expect(splitSentences("Yes.")).toEqual(["Yes."]);
  });

  it("gives nothing for blank text", () => {
    expect(splitSentences("  \n ")).toEqual([]);
  });
});
