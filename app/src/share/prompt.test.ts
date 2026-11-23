import { shareBody } from "./prompt";

describe("shareBody", () => {
  it("puts the note first, then the link with its title", () => {
    expect(shareBody({ note: " Summarize this ", content: { url: "https://a.dev/p" }, title: "A post" })).toBe(
      "Summarize this\n\nShared link: https://a.dev/p\nTitle: A post",
    );
    expect(shareBody({ note: "", content: { url: "https://a.dev/p" } })).toBe("Shared link: https://a.dev/p");
  });

  it("does not repeat a link that is in the text", () => {
    expect(shareBody({ note: "", content: { url: "https://a.dev", text: "look https://a.dev" } })).toBe("Shared text:\nlook https://a.dev");
  });

  it("names the text file instead of the text when the text goes as a file", () => {
    expect(shareBody({ note: "fix it", content: { url: "https://a.dev", text: "long log https://a.dev" }, textInFile: true })).toBe(
      "fix it\n\nShared link: https://a.dev\n\nShared text: in the .txt file below.",
    );
  });

  it("is empty for files with no note", () => {
    expect(shareBody({ note: "  ", content: {} })).toBe("");
    expect(shareBody({ note: "look at these", content: {} })).toBe("look at these");
  });
});
