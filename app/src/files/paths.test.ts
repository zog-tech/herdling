import { baseName, childPath, codePath, findPaths, isRelativePath, parentPath, splitPaths } from "./paths";

describe("codePath", () => {
  it.each([
    ["/home/sam/proj/docs/screens/", "/home/sam/proj/docs/screens/"],
    ["/home/sam/proj/docs/screens/home-dark.png", "/home/sam/proj/docs/screens/home-dark.png"],
    ["~/apps/proj", "~/apps/proj"],
    ["~", "~"],
    ["src/content/", "src/content/"],
    ["src/a.ts", "src/a.ts"],
    ["src/a.ts:42", "src/a.ts"],
    ["src/a.ts:42:7", "src/a.ts"],
    ["a/b/c", "a/b/c"],
    ["./scripts", "./scripts"],
    ["../other/x.md", "../other/x.md"],
    ["CONTENT.md", "CONTENT.md"],
    ["package.json", "package.json"],
    ["Dockerfile", "Dockerfile"],
    [".github/workflows/ci.yml", ".github/workflows/ci.yml"],
    ["/tmp/", "/tmp/"],
    ["/notes.md", "/notes.md"],
    ["docs/", "docs/"],
  ])("finds %s", (input, path) => {
    expect(codePath(input)).toBe(path);
  });

  it.each([
    "https://example.com/a/b",
    "file:///etc/hosts",
    "C:/Users",
    "and/or",
    "TCP/IP",
    "2026/11/20",
    "1/2",
    "1.2.3",
    "v1.2",
    "console.log",
    "files.put",
    "example.com",
    "example.com/docs",
    "/compact",
    "/help",
    "/",
    "//x/y",
    "a b/c.md",
    "src/*.ts",
    "foo()",
    "$HOME/x",
    "a//b/c",
    "",
    "e.g.",
  ])("ignores %s", (input) => {
    expect(codePath(input)).toBeNull();
  });
});

describe("findPaths", () => {
  it("finds absolute and home paths in prose, without the trailing marks", () => {
    const text = "Saved to /home/sam/proj/out.png. See ~/apps/proj, or (/var/log/app/).";
    expect(findPaths(text).map((m) => m.path)).toEqual(["/home/sam/proj/out.png", "~/apps/proj", "/var/log/app/"]);
  });

  it("gives the exact place of each path", () => {
    const text = "open ~/a/b now";
    const [m] = findPaths(text);
    expect(text.slice(m.start, m.end)).toBe("~/a/b");
  });

  it("leaves relative paths, slash words and commands", () => {
    expect(findPaths("use and/or the src/content/ folder, then /compact")).toEqual([]);
    expect(findPaths("10 req/s and km/h")).toEqual([]);
    expect(findPaths("a~/x")).toEqual([]);
  });

  it("splits text into parts", () => {
    expect(splitPaths("in /a/b ok")).toEqual([{ text: "in " }, { text: "/a/b", path: "/a/b" }, { text: " ok" }]);
    expect(splitPaths("no paths")).toEqual([{ text: "no paths" }]);
    expect(splitPaths("")).toEqual([{ text: "" }]);
  });
});

describe("path helpers", () => {
  it("names and parents", () => {
    expect(baseName("/a/b/")).toBe("b");
    expect(baseName("/")).toBe("/");
    expect(baseName("~")).toBe("~");
    expect(parentPath("/a/b/")).toBe("/a");
    expect(parentPath("/a")).toBe("/");
    expect(parentPath("/")).toBeNull();
    expect(childPath("/a", "b")).toBe("/a/b");
    expect(childPath("/", "b")).toBe("/b");
    expect(isRelativePath("src/a")).toBe(true);
    expect(isRelativePath("~/a")).toBe(false);
    expect(isRelativePath("/a")).toBe(false);
  });
});
