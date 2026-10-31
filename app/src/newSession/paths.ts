/**
 * Path rules of the New session folder picker: `~` expansion, the parent and the prefix that
 * autocomplete lists, the completion of a typed path and the breadcrumb segments. Pure: the
 * host's home folder comes in as a parameter (the `path` of `fs.dirs` with no path).
 */

/** `a/b` with one slash between, also when `base` is the root. */
export const joinPath = (base: string, name: string) => (base.endsWith("/") ? base : base + "/") + name;

/** The parent folder. The parent of the root is the root. */
export const parentOf = (p: string) => p.replace(/\/[^/]+\/?$/, "") || "/";

/** The last segment of a path, or "/" for the root. */
export const baseName = (p: string) => p.replace(/\/+$/, "").split("/").pop() || "/";

const insideHome = (path: string, home: string) => home !== "/" && (path === home || path.startsWith(home + "/"));

/** `~` and `~/x` become the home folder and `home/x`. Other text stays as it is. */
export function expandHome(input: string, home: string): string {
  if (input === "~") return home;
  if (input.startsWith("~/")) return joinPath(home, input.slice(2));
  return input;
}

/**
 * An absolute, clean path for typed text: `~` expands, a relative path is relative to `cwd`,
 * `.` and `..` segments resolve, double and trailing slashes go.
 */
export function resolveInput(input: string, home: string, cwd: string): string {
  const t = expandHome(input.trim(), home);
  const abs = t.startsWith("/") ? t : joinPath(cwd, t);
  const out: string[] = [];
  for (const seg of abs.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return "/" + out.join("/");
}

/**
 * What autocomplete lists for typed text: the folder (`dir`) and the start of the name
 * (`prefix`). "~/apps/he" gives `home/apps` and "he"; "~/apps/" gives `home/apps` and "".
 */
export function completionTarget(input: string, home: string, cwd: string): { dir: string; prefix: string } {
  const t = input.trim();
  if (t === "" || t === "~" || t.endsWith("/")) return { dir: resolveInput(t || ".", home, cwd), prefix: "" };
  const cut = t.lastIndexOf("/");
  if (cut < 0) return { dir: cwd, prefix: t };
  return { dir: resolveInput(t.slice(0, cut + 1), home, cwd), prefix: t.slice(cut + 1) };
}

/**
 * The folder names that start with `prefix`, case-insensitive. An exact case match sorts first.
 * Hidden names (".x") show only when `hidden` is on or the prefix itself starts with a dot.
 */
export function filterDirs(names: readonly string[], prefix: string, hidden = false): string[] {
  const p = prefix.toLowerCase();
  const showDot = hidden || prefix.startsWith(".");
  const hits = names.filter((n) => (showDot || !n.startsWith(".")) && n.toLowerCase().startsWith(p));
  const exact = hits.filter((n) => n.startsWith(prefix));
  return [...exact, ...hits.filter((n) => !n.startsWith(prefix))];
}

/**
 * The text after a "complete" action: the typed folder part plus the longest common start of
 * the matches. One match completes the whole name and adds "/", so the next level lists at once.
 * Undefined when nothing can be added.
 */
export function completeInput(input: string, matches: readonly string[]): string | undefined {
  if (matches.length === 0) return undefined;
  const t = input.trim();
  const cut = t.lastIndexOf("/");
  const head = cut < 0 ? "" : t.slice(0, cut + 1);
  const typed = cut < 0 ? t : t.slice(cut + 1);
  if (matches.length === 1) return head + matches[0] + "/";
  let common = matches[0];
  for (const m of matches.slice(1)) {
    let i = 0;
    while (i < common.length && i < m.length && common[i].toLowerCase() === m[i].toLowerCase()) i++;
    common = common.slice(0, i);
  }
  return common.length > typed.length ? head + common : undefined;
}

/** A path for display: the home folder is `~`, a folder inside it starts with `~/`. */
export function displayPath(path: string, home: string): string {
  if (!insideHome(path, home)) return path;
  return path === home ? "~" : "~/" + path.slice(home.length + 1);
}

export type Crumb = { label: string; path: string };

/**
 * The breadcrumb segments of `path`, from the top. Inside the home folder they start at `~`,
 * else at `/`. Each segment opens its own folder.
 */
export function breadcrumbs(path: string, home: string): Crumb[] {
  const inHome = insideHome(path, home);
  const root = inHome ? home : "/";
  const crumbs: Crumb[] = [{ label: inHome ? "~" : "/", path: root }];
  const rest = path.slice(root.length).split("/").filter(Boolean);
  let at = root;
  for (const seg of rest) {
    at = joinPath(at, seg);
    crumbs.push({ label: seg, path: at });
  }
  return crumbs;
}
