import { BRANCH_PREFIX, branchError, defaultBranch, worktreePath } from "./worktree";

describe("defaultBranch", () => {
  it("is herdling/ and 6 letters or digits", () => {
    const b = defaultBranch();
    expect(b).toMatch(/^herdling\/[a-z0-9]{6}$/);
    expect(branchError(b)).toBeUndefined();
  });

  it("uses the random source", () => {
    expect(defaultBranch(() => 0)).toBe(`${BRANCH_PREFIX}aaaaaa`);
    expect(defaultBranch(() => 0.9999)).toBe(`${BRANCH_PREFIX}999999`);
  });
});

describe("branchError", () => {
  it.each(["main", "feat/login-page", "fix_1.2", "herdling/ab12cd", "a/b/c"])("accepts %s", (n) => {
    expect(branchError(n)).toBeUndefined();
  });

  it.each([
    ["", "Type a branch name."],
    ["has space", "No spaces"],
    ["a..b", ".."],
    ["-x", "dash"],
    ["@", "not a branch"],
    ["x@{1}", "@{"],
    ["a~b", "No spaces"],
    ["a:b", "No spaces"],
    ["what?", "No spaces"],
    ["/a", "slashes"],
    ["a/", "slashes"],
    ["a//b", "slashes"],
    ["a.", "dot"],
    [".a", "dot"],
    ["a/.b", "dot"],
    ["x.lock", ".lock"],
    ["a/b.lock/c", ".lock"],
    ["tab\there", "No spaces"],
  ])("refuses %j", (n, part) => {
    expect(branchError(n)).toContain(part);
  });
});

describe("worktreePath", () => {
  it("matches the folder herdlingd makes", () => {
    expect(worktreePath("/home/sam/app", "herdling/ab12")).toBe("/home/sam/app/.worktrees/herdling-ab12");
    expect(worktreePath("/home/sam/app/", "feat/ü x")).toBe("/home/sam/app/.worktrees/feat-__x");
  });
});
