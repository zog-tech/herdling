import { branchLine, countsText, fileLabel, MAX_LINE_CHARS, parseDiff, splitPath, statusName, widestLine } from "./diff";

const SAMPLE = [
  "diff --git a/src/app.ts b/src/app.ts",
  "index 1111111..2222222 100644",
  "--- a/src/app.ts",
  "+++ b/src/app.ts",
  "@@ -1,4 +1,5 @@",
  " import x from \"x\";",
  "-const a = 1;",
  "+const a = 2;",
  "+const b = 3;",
  " ",
  " export default a;",
  "@@ -20,2 +21,2 @@ function tail() {",
  "-  return 0;",
  "+  return 1;",
  "\\ No newline at end of file",
  "diff --git a/logo.png b/logo.png",
  "index 3333333..4444444 100644",
  "Binary files a/logo.png and b/logo.png differ",
  "diff --git a/old.md b/new.md",
  "similarity index 90%",
  "rename from old.md",
  "rename to new.md",
  "diff --git a/gone.txt b/gone.txt",
  "deleted file mode 100644",
  "--- a/gone.txt",
  "+++ /dev/null",
  "@@ -1 +0,0 @@",
  "-bye",
  "",
].join("\n");

describe("parseDiff", () => {
  const files = parseDiff(SAMPLE);

  it("splits the files", () => {
    expect(files.map((f) => f.path)).toEqual(["src/app.ts", "logo.png", "new.md", "gone.txt"]);
  });

  it("types each line and numbers the old and new lines", () => {
    const f = files[0];
    expect(f.added).toBe(3);
    expect(f.deleted).toBe(2);
    const kinds = f.lines.map((l) => l.kind);
    expect(kinds).toEqual(["meta", "meta", "meta", "meta", "hunk", "ctx", "del", "add", "add", "ctx", "ctx", "hunk", "del", "add", "note"]);
    const del = f.lines.find((l) => l.kind === "del");
    expect(del).toMatchObject({ text: "-const a = 1;", oldNo: 2 });
    const adds = f.lines.filter((l) => l.kind === "add");
    expect(adds.map((l) => l.newNo)).toEqual([2, 3, 21]);
    const lastCtx = f.lines.filter((l) => l.kind === "ctx").pop();
    expect(lastCtx).toMatchObject({ oldNo: 4, newNo: 5 });
  });

  it("marks binary files", () => {
    expect(files[1].binary).toBe(true);
    expect(files[1].lines.some((l) => l.kind === "binary")).toBe(true);
  });

  it("keeps the old path of a rename and the path of a deleted file", () => {
    expect(files[2].oldPath).toBe("old.md");
    expect(files[3].path).toBe("gone.txt");
    expect(files[3].deleted).toBe(1);
  });

  it("gives nothing for empty text", () => {
    expect(parseDiff("")).toEqual([]);
  });

  it("cuts very long lines", () => {
    const long = "+" + "x".repeat(MAX_LINE_CHARS * 2);
    const [f] = parseDiff(`diff --git a/a b/a\n@@ -0,0 +1 @@\n${long}\n`);
    expect(f.lines[2].text.length).toBe(MAX_LINE_CHARS + 1);
    expect(widestLine(f.lines)).toBe(MAX_LINE_CHARS + 1);
  });

  it("reads a new untracked file (no-index diff)", () => {
    const [f] = parseDiff("diff --git a/todo.txt b/todo.txt\nnew file mode 100644\n--- /dev/null\n+++ b/todo.txt\n@@ -0,0 +1,2 @@\n+a\n+b\n");
    expect(f.path).toBe("todo.txt");
    expect(f.added).toBe(2);
  });
});

describe("labels", () => {
  const file = { path: "src/a.ts", status: "M", staged: true, unstaged: false, added: 4, deleted: 1, binary: false };

  it("names the counts and the status", () => {
    expect(countsText(file)).toBe("+4 −1");
    expect(countsText({ ...file, binary: true })).toBe("binary");
    expect(countsText({ ...file, added: null, deleted: null })).toBe("");
    expect(statusName("?")).toBe("New, not tracked");
    expect(statusName("X")).toBe("Changed");
    expect(fileLabel(file)).toBe("src/a.ts, Changed, 4 added, 1 deleted lines, staged");
  });

  it("splits a path and describes the branch", () => {
    expect(splitPath("src/app/x.ts")).toEqual(["x.ts", "src/app"]);
    expect(splitPath("x.ts")).toEqual(["x.ts", ""]);
    expect(branchLine({ branch: "main", head: "abc1234", ahead: 2, behind: 1, upstream: "origin/main" })).toBe("main · 2 ahead, 1 behind");
    expect(branchLine({ branch: null, head: "abc1234", ahead: 0, behind: 0, upstream: null })).toBe("detached at abc1234");
  });
});
