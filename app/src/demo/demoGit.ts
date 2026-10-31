import type { GitChangedFile, GitDiff, GitStatus, GitWorktree } from "@herdling/protocol";

import { DemoError } from "./scenario";

/**
 * Git answers of the demo host: a plausible branch and changed files for each demo project, and
 * their diffs. The counts come from the diff lines, so the list and the diff view agree.
 */

type DemoFile = {
  path: string;
  status: string;
  staged: boolean;
  binary?: boolean;
  /** Hunks: a header line, then lines that start with " ", "+" or "-". */
  hunks?: string[][];
};

const WEBAPP_FILES: DemoFile[] = [
  {
    path: "src/components/Dashboard.tsx",
    status: "M",
    staged: false,
    hunks: [
      [
        "@@ -1,9 +1,11 @@",
        ' import { useEffect, useState } from "react";',
        ' import { fetchStats } from "../api/client";',
        '+import { useLoading } from "../hooks/useLoading";',
        '+import { Spinner } from "./Spinner";',
        " ",
        " export function Dashboard() {",
        "   const [stats, setStats] = useState(null);",
        "-  useEffect(() => {",
        "-    fetchStats().then(setStats);",
        "-  }, []);",
        "+  const { loading, run } = useLoading();",
        "+  useEffect(() => void run(() => fetchStats().then(setStats)), [run]);",
        "+  if (loading) return <Spinner label=\"Loading the stats\" />;",
        "   return (",
        '     <section className="dashboard">',
      ],
      [
        "@@ -24,6 +26,8 @@ export function Dashboard() {",
        "       <StatCard title=\"Users\" value={stats?.users} />",
        "       <StatCard title=\"Orders\" value={stats?.orders} />",
        "-      <StatCard title=\"Revenue\" value={stats?.revenue} />",
        "+      <StatCard title=\"Revenue\" value={formatMoney(stats?.revenue)} />",
        "+      {/* A very long line, so the diff view scrolls sideways: the quick brown fox jumps over the lazy dog again and again. */}",
        "+      <LastUpdated at={stats?.updatedAt} />",
        "     </section>",
        "   );",
        " }",
      ],
    ],
  },
  {
    path: "src/hooks/useLoading.ts",
    status: "A",
    staged: true,
    hunks: [
      [
        "@@ -0,0 +1,14 @@",
        '+import { useCallback, useState } from "react";',
        "+",
        "+/** True while `run` waits for its promise. */",
        "+export function useLoading() {",
        "+  const [loading, setLoading] = useState(false);",
        "+  const run = useCallback(async (fn: () => Promise<unknown>) => {",
        "+    setLoading(true);",
        "+    try {",
        "+      await fn();",
        "+    } finally {",
        "+      setLoading(false);",
        "+    }",
        "+  }, []);",
        "+  return { loading, run };",
      ],
    ],
  },
  {
    path: "src/api/client.ts",
    status: "M",
    staged: false,
    hunks: [
      [
        "@@ -8,7 +8,9 @@ const BASE = \"/api\";",
        " export async function fetchStats() {",
        "-  const r = await fetch(`${BASE}/stats`);",
        "+  const r = await fetch(`${BASE}/stats`, { headers: { accept: \"application/json\" } });",
        "+  if (!r.ok) throw new Error(`stats: ${r.status}`);",
        "   return r.json();",
        " }",
      ],
    ],
  },
  {
    path: "tests/dashboard.test.tsx",
    status: "?",
    staged: false,
    hunks: [
      [
        "@@ -0,0 +1,9 @@",
        '+import { render, screen } from "@testing-library/react";',
        '+import { Dashboard } from "../src/components/Dashboard";',
        "+",
        '+test("shows a spinner while the stats load", () => {',
        "+  render(<Dashboard />);",
        '+  expect(screen.getByLabelText("Loading the stats")).toBeTruthy();',
        "+});",
        "+",
        "+// More tests follow.",
      ],
    ],
  },
  { path: "public/logo.png", status: "M", staged: false, binary: true },
];

const API_FILES: DemoFile[] = [
  {
    path: "src/routes/users.ts",
    status: "M",
    staged: false,
    hunks: [
      [
        "@@ -12,8 +12,10 @@ router.get(\"/users\", async (req, res) => {",
        "   const page = Number(req.query.page ?? 1);",
        "-  const users = await db.users.findMany();",
        "+  const users = await db.users.findMany({ skip: (page - 1) * PAGE, take: PAGE });",
        "+  const total = await db.users.count();",
        "-  res.json(users);",
        "+  res.json({ users, total, page });",
        " });",
      ],
    ],
  },
  {
    path: "migrations/004_users_email_index.sql",
    status: "A",
    staged: true,
    hunks: [["@@ -0,0 +1,2 @@", "+-- Faster login by email.", "+CREATE INDEX users_email_idx ON users (email);"]],
  },
];

const PROJECTS: Record<string, { branch: string; ahead: number; behind: number; files: DemoFile[] }> = {
  webapp: { branch: "feat/dashboard-loading", ahead: 2, behind: 0, files: WEBAPP_FILES },
  "api-server": { branch: "main", ahead: 0, behind: 1, files: API_FILES },
};

/** Branches made by `git.worktree_add` in this demo session. */
const worktrees = new Set<string>();

function project(cwd: string | null | undefined) {
  if (!cwd) return undefined;
  const name = Object.keys(PROJECTS).find((n) => cwd.endsWith(`/${n}`) || cwd.includes(`/${n}/`));
  return name ? { name, root: cwd.slice(0, cwd.indexOf(name) + name.length), ...PROJECTS[name] } : undefined;
}

function counts(f: DemoFile): Pick<GitChangedFile, "added" | "deleted"> {
  if (f.binary) return { added: null, deleted: null };
  const lines = (f.hunks ?? []).flatMap((h) => h.slice(1));
  return { added: lines.filter((l) => l.startsWith("+")).length, deleted: lines.filter((l) => l.startsWith("-")).length };
}

export function demoGitStatus(cwd: string | null | undefined): GitStatus {
  const p = project(cwd);
  if (!p) return { is_repo: false, branch: null, head: null, upstream: null, ahead: 0, behind: 0, files: [], truncated: false };
  const wt = cwd?.includes("/.worktrees/");
  return {
    is_repo: true,
    root: wt && cwd ? cwd : p.root,
    branch: wt && cwd ? cwd.slice(cwd.lastIndexOf("/") + 1) : p.branch,
    head: "3f9c2ab",
    upstream: wt ? null : `origin/${p.branch}`,
    ahead: wt ? 0 : p.ahead,
    behind: wt ? 0 : p.behind,
    files: wt
      ? []
      : p.files.map((f) => ({
          path: f.path,
          status: f.status,
          staged: f.staged,
          unstaged: !f.staged,
          binary: !!f.binary,
          ...counts(f),
        })),
    truncated: false,
  };
}

function fileDiff(f: DemoFile): string {
  const isNew = f.status === "A" || f.status === "?";
  const head = [
    `diff --git a/${f.path} b/${f.path}`,
    ...(isNew ? ["new file mode 100644", "index 0000000..8d1e2f4"] : ["index 5a7b0c1..8d1e2f4 100644"]),
  ];
  if (f.binary) return [...head, `Binary files a/${f.path} and b/${f.path} differ`].join("\n") + "\n";
  return [...head, isNew ? "--- /dev/null" : `--- a/${f.path}`, `+++ b/${f.path}`, ...(f.hunks ?? []).flat()].join("\n") + "\n";
}

export function demoGitDiff(cwd: string | null | undefined, path: string | undefined): GitDiff {
  const p = project(cwd);
  if (!p) throw new DemoError("not_a_repo", "the folder is not in a git repo");
  if (path !== undefined && (path.startsWith("/") || path.split("/").includes("..")))
    throw new DemoError("bad_request", "path must be a relative path inside the repo");
  const files = cwd?.includes("/.worktrees/") ? [] : p.files.filter((f) => path === undefined || f.path === path);
  return { diff: files.map(fileDiff).join(""), truncated: false, root: p.root };
}

export function demoWorktreeAdd(cwd: string | null | undefined, branch: string): GitWorktree {
  const p = project(cwd);
  if (!p) throw new DemoError("not_a_repo", "the folder is not in a git repo");
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith("-") || branch.includes("..") || branch.endsWith(".lock"))
    throw new DemoError("bad_request", `"${branch}" is not a valid branch name`);
  if (worktrees.has(branch) || branch === p.branch) throw new DemoError("already_exists", `a branch named "${branch}" already exists`);
  worktrees.add(branch);
  return { path: `${p.root}/.worktrees/${branch.replace(/\//g, "-")}`, branch, root: p.root };
}
