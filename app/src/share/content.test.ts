import { MAX_FILE_BYTES, MAX_VIDEO_BYTES } from "@/thread/attachments";

import {
  droppedText,
  firstUrl,
  fromText,
  isEmpty,
  kindOf,
  ownCopies,
  parseShare,
  planFiles,
  SHARED_TEXT_NAME,
  shareSummary,
  textAsFile,
  type SharedFile,
} from "./content";

jest.mock("expo", () => ({ requireOptionalNativeModule: () => null }));

describe("firstUrl", () => {
  it("finds the first link and drops the punctuation after it", () => {
    expect(firstUrl("see https://example.com/a.")).toBe("https://example.com/a");
    expect(firstUrl("(see https://example.com/a)")).toBe("https://example.com/a");
    expect(firstUrl("https://en.wikipedia.org/wiki/Rust_(language)")).toBe("https://en.wikipedia.org/wiki/Rust_(language)");
    expect(firstUrl("one http://a.dev two https://b.dev")).toBe("http://a.dev");
    expect(firstUrl("no link here")).toBeUndefined();
    expect(firstUrl("https://")).toBeUndefined();
  });
});

describe("fromText", () => {
  it("makes a text that is only a link a link share", () => {
    expect(fromText("  https://example.com/post \n", "A post")).toEqual({ url: "https://example.com/post", title: "A post", files: [] });
  });
  it("keeps the text when it has more than the link", () => {
    expect(fromText("Read this https://example.com/post", undefined)).toEqual({
      url: "https://example.com/post",
      text: "Read this https://example.com/post",
      title: undefined,
      files: [],
    });
  });
  it("gives a plain text without a link, and nothing for blank text", () => {
    expect(fromText("hello", undefined)).toEqual({ url: undefined, text: "hello", title: undefined, files: [] });
    expect(fromText("   ")).toBeUndefined();
  });
});

describe("kindOf", () => {
  it("reads the MIME type first, then the name, then the iOS hint", () => {
    expect(kindOf("image/heic", "x")).toBe("image");
    expect(kindOf("video/quicktime", "x")).toBe("video");
    expect(kindOf("application/pdf", "x.png")).toBe("file");
    expect(kindOf(undefined, "IMG_1.HEIC")).toBe("image");
    expect(kindOf("application/octet-stream", "clip.MOV")).toBe("video");
    expect(kindOf(undefined, "ABC", 1)).toBe("video");
    expect(kindOf(undefined, "notes.txt")).toBe("file");
  });
});

describe("parseShare", () => {
  it("reads an iOS text share (a JSON string)", () => {
    expect(parseShare('{"text":"https://example.com","type":"text"}')).toEqual({ url: "https://example.com", title: undefined, files: [] });
  });

  it("reads an iOS web page share with its meta tags", () => {
    const meta = JSON.stringify({ title: "Doc title", "og:title": "OG title", "og:image": "https://example.com/i.png" });
    expect(parseShare(JSON.stringify({ weburls: [{ url: "https://example.com/p", meta }], type: "weburl" }))).toEqual({
      url: "https://example.com/p",
      title: "OG title",
      image: "https://example.com/i.png",
      files: [],
    });
    expect(parseShare(JSON.stringify({ weburls: [{ url: "https://example.com/p", meta: "" }] }))).toEqual({
      url: "https://example.com/p",
      title: undefined,
      image: undefined,
      files: [],
    });
  });

  it("reads iOS media with paths, sizes and the media type", () => {
    const value = JSON.stringify({
      files: [
        { path: "file:///private/var/Shared/AppGroup/X/A.HEIC", fileName: "IMG_1.HEIC", fileSize: 2048, mimeType: "image/heic", type: 0 },
        { path: "/private/var/mobile/clip.mov", fileName: "clip.mov", fileSize: 9, duration: 4200, mimeType: "video/quicktime", type: 1 },
      ],
      type: "media",
    });
    expect(parseShare(value)).toEqual({
      files: [
        { kind: "image", uri: "file:///private/var/Shared/AppGroup/X/A.HEIC", name: "IMG_1.HEIC", size: 2048, mime: "image/heic", duration: undefined },
        { kind: "video", uri: "file:///private/var/mobile/clip.mov", name: "clip.mov", size: 9, mime: "video/quicktime", duration: 4200 },
      ],
    });
  });

  it("reads an Android text share with its title", () => {
    expect(parseShare({ text: "https://example.com/x", type: "text", meta: { title: "X" } })).toEqual({
      url: "https://example.com/x",
      title: "X",
      files: [],
    });
  });

  it("prefers the Android content URI and skips entries without a path", () => {
    const value = {
      files: [
        { contentUri: "content://media/external/images/1", filePath: "/storage/emulated/0/DCIM/a.jpg", fileName: "a.jpg", mimeType: "image/jpeg", fileSize: "10" },
        { type: "file" },
        "junk",
        { filePath: "/data/user/0/app/cache/report.pdf", mimeType: "application/pdf" },
      ],
      type: "file",
    };
    expect(parseShare(value)).toEqual({
      files: [
        { kind: "image", uri: "content://media/external/images/1", name: "a.jpg", size: 10, mime: "image/jpeg", duration: undefined },
        { kind: "file", uri: "file:///data/user/0/app/cache/report.pdf", name: "report.pdf", size: undefined, mime: "application/pdf", duration: undefined },
      ],
    });
  });

  it("gives undefined for values it cannot read", () => {
    expect(parseShare(undefined)).toBeUndefined();
    expect(parseShare("not json")).toBeUndefined();
    expect(parseShare("[]")).toBeUndefined();
    expect(parseShare({ files: [] })).toBeUndefined();
    expect(parseShare({ text: "  " })).toBeUndefined();
    expect(parseShare({ weburls: [{ url: "" }] })).toBeUndefined();
  });
});

const file = (name: string, kind: SharedFile["kind"], size?: number): SharedFile => ({ kind, uri: `file:///s/${name}`, name, size });

describe("planFiles", () => {
  it("makes attachments in order: images without data, videos and files", () => {
    const plan = planFiles([file("a.jpg", "image"), file("b.mp4", "video", 5), file("c.pdf", "file", 7)], true);
    expect(plan.items).toEqual([
      { uri: "file:///s/a.jpg", name: "a.jpg", base64: "" },
      { kind: "video", uri: "file:///s/b.mp4", name: "b.mp4", size: 5, duration: undefined, mime: undefined },
      { kind: "file", uri: "file:///s/c.pdf", name: "c.pdf", size: 7, mime: undefined },
    ]);
    expect(plan.tooLarge).toEqual([]);
    expect(plan.extra).toEqual([]);
  });

  it("leaves out files over the host limit", () => {
    const files = [file("big.pdf", "file", MAX_FILE_BYTES + 1), file("huge.mov", "video", MAX_VIDEO_BYTES + 1), file("big.jpg", "image", MAX_FILE_BYTES + 1)];
    expect(planFiles(files, false).tooLarge).toEqual(["big.pdf", "huge.mov", "big.jpg"]);
    // A host that takes uploads in parts takes the large PDF, not the huge video or the large photo.
    expect(planFiles(files, true).tooLarge).toEqual(["huge.mov", "big.jpg"]);
  });

  it("keeps the composer limits: 4 photos and 6 items", () => {
    const photos = Array.from({ length: 5 }, (_, i) => file(`p${i}.jpg`, "image"));
    const docs = Array.from({ length: 3 }, (_, i) => file(`d${i}.txt`, "file"));
    const plan = planFiles([...photos, ...docs], true);
    expect(plan.items.map((a) => a.name)).toEqual(["p0.jpg", "p1.jpg", "p2.jpg", "p3.jpg", "d0.txt", "d1.txt"]);
    expect(plan.extra).toEqual(["p4.jpg", "d2.txt"]);
    expect(droppedText(plan, true)).toBe("Up to 6 items and 4 photos go with one prompt. Left out: p4.jpg, d2.txt.");
  });

  it("says nothing when every file goes, and names the size limit", () => {
    expect(droppedText({ tooLarge: [], extra: [] }, true)).toBeUndefined();
    expect(droppedText({ tooLarge: ["a.pdf"], extra: [] }, false)).toBe("Too large (max 25.0 MB): a.pdf.");
  });
});

describe("textAsFile", () => {
  it("sends a long text as a file only when the host takes files", () => {
    const long = "line\n".repeat(20);
    expect(textAsFile(long, true)).toEqual({ kind: "text", n: 1, name: SHARED_TEXT_NAME, text: long });
    expect(textAsFile(long, false)).toBeUndefined();
    expect(textAsFile("short", true)).toBeUndefined();
    expect(textAsFile(undefined, true)).toBeUndefined();
  });
});

describe("summary and copies", () => {
  it("names what was shared", () => {
    expect(shareSummary({ url: "https://a.dev", files: [] })).toBe("Link");
    expect(shareSummary({ url: "https://a.dev", text: "see https://a.dev", files: [] })).toBe("Text with a link");
    expect(shareSummary({ text: "hi", files: [] })).toBe("Text");
    expect(shareSummary({ files: [file("a.jpg", "image")] })).toBe("1 photo");
    expect(shareSummary({ files: [file("a.jpg", "image"), file("b.jpg", "image"), file("c.mp4", "video"), file("d.pdf", "file")] })).toBe(
      "2 photos, 1 video and 1 file",
    );
    expect(isEmpty({ files: [] })).toBe(true);
    expect(isEmpty({ text: "x", files: [] })).toBe(false);
  });

  it("deletes only the copies of the iOS extension", () => {
    const files: SharedFile[] = [
      { kind: "image", uri: "file:///private/var/mobile/Containers/Shared/AppGroup/ID/A.jpg", name: "A.jpg" },
      { kind: "image", uri: "content://media/external/images/1", name: "b.jpg" },
      { kind: "file", uri: "file:///storage/emulated/0/DCIM/c.jpg", name: "c.jpg" },
    ];
    expect(ownCopies(files)).toEqual(["file:///private/var/mobile/Containers/Shared/AppGroup/ID/A.jpg"]);
  });
});
