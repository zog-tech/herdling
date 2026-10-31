import {
  breadcrumbs,
  completeInput,
  completionTarget,
  displayPath,
  expandHome,
  filterDirs,
  parentOf,
  resolveInput,
} from "./paths";

const HOME = "/home/sam";

describe("paths", () => {
  it("expands ~ to the home folder", () => {
    expect(expandHome("~", HOME)).toBe(HOME);
    expect(expandHome("~/apps", HOME)).toBe("/home/sam/apps");
    // "~x" is a name, not home.
    expect(expandHome("~x", HOME)).toBe("~x");
    expect(expandHome("/etc", HOME)).toBe("/etc");
  });

  it("resolves typed text to a clean absolute path", () => {
    expect(resolveInput("~/apps/", HOME, "/tmp")).toBe("/home/sam/apps");
    expect(resolveInput("src", HOME, "/home/sam/proj")).toBe("/home/sam/proj/src");
    expect(resolveInput("../other//x/.", HOME, "/home/sam/proj")).toBe("/home/sam/other/x");
    expect(resolveInput("/../..", HOME, "/")).toBe("/");
    expect(resolveInput("  ~  ", HOME, "/")).toBe(HOME);
  });

  it("splits typed text into the folder to list and the name prefix", () => {
    expect(completionTarget("~/apps/he", HOME, "/")).toEqual({ dir: "/home/sam/apps", prefix: "he" });
    expect(completionTarget("~/apps/", HOME, "/")).toEqual({ dir: "/home/sam/apps", prefix: "" });
    expect(completionTarget("~", HOME, "/")).toEqual({ dir: HOME, prefix: "" });
    expect(completionTarget("/et", HOME, "/home/sam")).toEqual({ dir: "/", prefix: "et" });
    // A bare name is relative to the open folder.
    expect(completionTarget("sr", HOME, "/home/sam/proj")).toEqual({ dir: "/home/sam/proj", prefix: "sr" });
  });

  it("filters by prefix, case-insensitive, exact case first", () => {
    const names = ["Herdling", "helpers", "api", ".hidden", "HELP"];
    expect(filterDirs(names, "he")).toEqual(["helpers", "Herdling", "HELP"]);
    expect(filterDirs(names, "HE")).toEqual(["HELP", "Herdling", "helpers"]);
    expect(filterDirs(names, "")).toEqual(["Herdling", "helpers", "api", "HELP"]);
    // Hidden names: with the toggle, or when the prefix starts with a dot.
    expect(filterDirs(names, ".")).toEqual([".hidden"]);
    expect(filterDirs(names, "", true)).toContain(".hidden");
  });

  it("completes to the common start, or the whole name with a slash", () => {
    expect(completeInput("~/apps/he", ["herdling"])).toBe("~/apps/herdling/");
    expect(completeInput("~/apps/h", ["herdling", "herdr"])).toBe("~/apps/herd");
    // Nothing to add.
    expect(completeInput("~/apps/herd", ["herdling", "herdr"])).toBeUndefined();
    expect(completeInput("~/apps/x", [])).toBeUndefined();
    expect(completeInput("sr", ["src"])).toBe("src/");
  });

  it("shows the home folder as ~", () => {
    expect(displayPath(HOME, HOME)).toBe("~");
    expect(displayPath("/home/sam/apps", HOME)).toBe("~/apps");
    expect(displayPath("/home/samuel", HOME)).toBe("/home/samuel");
    expect(displayPath("/etc", HOME)).toBe("/etc");
  });

  it("builds breadcrumbs from ~ inside home and from / outside", () => {
    expect(breadcrumbs("/home/sam/apps/herdling", HOME)).toEqual([
      { label: "~", path: HOME },
      { label: "apps", path: "/home/sam/apps" },
      { label: "herdling", path: "/home/sam/apps/herdling" },
    ]);
    expect(breadcrumbs(HOME, HOME)).toEqual([{ label: "~", path: HOME }]);
    expect(breadcrumbs("/etc/nginx", HOME)).toEqual([
      { label: "/", path: "/" },
      { label: "etc", path: "/etc" },
      { label: "nginx", path: "/etc/nginx" },
    ]);
    expect(breadcrumbs("/", HOME)).toEqual([{ label: "/", path: "/" }]);
  });

  it("goes up to the parent, and stops at the root", () => {
    expect(parentOf("/home/sam/apps")).toBe("/home/sam");
    expect(parentOf("/home")).toBe("/");
    expect(parentOf("/")).toBe("/");
  });
});
