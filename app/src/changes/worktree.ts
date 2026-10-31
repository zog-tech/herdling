/**
 * "In a new git worktree" on New session: the default branch name and a check of the name with the
 * rules of `git check-ref-format`. herdlingd checks the name again with git itself.
 */

/** The prefix of the default branch name. */
export const BRANCH_PREFIX = "herdling/";

/** `herdling/` and 6 random lowercase letters and digits. */
export function defaultBranch(random: () => number = Math.random): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(random() * chars.length) % chars.length];
  return BRANCH_PREFIX + s;
}

/** Why `name` is not a valid branch name, or undefined when it is. */
export function branchError(name: string): string | undefined {
  const n = name.trim();
  if (!n) return "Type a branch name.";
  if (n.length > 200) return "The name is too long.";
  if (n === "@" || n === "HEAD") return `"${n}" is not a branch name.`;
  if (n.startsWith("-")) return "The name cannot start with a dash.";
  // Control chars, space, ~ ^ : ? * [ and backslash.
  if (/[\x00-\x20\x7f~^:?*[\\]/.test(n)) return "Use letters, digits, / - _ and . only. No spaces.";
  if (n.includes("..")) return 'The name cannot contain "..".';
  if (n.includes("@{")) return 'The name cannot contain "@{".';
  if (n.startsWith("/") || n.endsWith("/") || n.includes("//")) return "Check the slashes in the name.";
  if (n.endsWith(".")) return "The name cannot end with a dot.";
  for (const part of n.split("/")) {
    if (part.startsWith(".")) return "A part of the name cannot start with a dot.";
    if (part.endsWith(".lock")) return 'A part of the name cannot end with ".lock".';
  }
  return undefined;
}

/** The folder name herdlingd uses for `branch`: "/" becomes "-", other unusual chars "_". */
export function worktreeSlug(branch: string): string {
  return branch
    .trim()
    .replace(/\//g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^[.-]+/, "");
}

/** The folder herdlingd makes for `branch` in `root`: `<root>/.worktrees/<slug>`. */
export function worktreePath(root: string, branch: string): string {
  return `${root.replace(/\/+$/, "")}/.worktrees/${worktreeSlug(branch)}`;
}
