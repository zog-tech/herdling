/**
 * File paths in thread text, with no native parts. The agent writes paths such as
 * `/home/sam/proj/docs/`, `~/apps/proj`, `src/content/` or `README.md`; a tap opens them in the
 * file viewer (`app/file/[hostId].tsx`).
 *
 * Inline code is checked as one whole path ([`codePath`]): there a relative path is allowed. In
 * plain text ([`findPaths`]) only absolute and `~/` paths count, because prose has many words
 * with a slash ("and/or", "TCP/IP"). Both reject URLs, dates, version numbers and slash commands.
 */

/** The chars of one path part. No spaces, quotes, brackets or shell marks. */
const PART = /^[A-Za-z0-9._@+%,=-]+$/;
/** A file name with an extension that has a letter: `a.ts`, `notes.v2.md`, not `1.2` or `v1.2.3`. */
const EXT = /\.([A-Za-z][A-Za-z0-9]{0,9})$/;
/** Endings that make a dotted word a domain name, not a file: `example.com` stays text. */
const DOMAINS = new Set(["com", "org", "net", "io", "ai", "co", "edu", "gov", "uk", "de", "fr", "nl", "app", "dev"]);
/**
 * Extensions of a bare file name (no slash) in inline code. A bare name needs a known extension:
 * inline code also holds calls and fields such as `console.log` or `files.put`.
 */
const FILE_EXTS = new Set(
  (
    "md mdx txt rst json jsonc json5 yaml yml toml ini cfg conf env lock log csv tsv xml html htm css scss sass less " +
    "js jsx mjs cjs ts tsx mts cts vue svelte astro rs go py rb php java kt kts swift m mm c h cc cpp hpp cs fs ex exs " +
    "erl hs lua pl r dart scala clj sql sh bash zsh fish ps1 bat cmd gradle properties plist pbxproj podspec gemspec " +
    "png jpg jpeg gif webp heic heif bmp svg ico pdf zip tar gz tgz wasm patch diff proto graphql gql tf hcl nix"
  ).split(" "),
);
/** Names before a dot that make a bare name a call or a field, not a file: `console.log`, `self.env`. */
const CODE_OWNERS = new Set(["console", "process", "window", "document", "self", "this", "Math", "JSON", "Object", "Array", "Promise", "os", "sys", "fs", "path"]);
/** File names without an extension that inline code names often. */
const BARE_FILES = new Set(["Dockerfile", "Makefile", "Gemfile", "Rakefile", "Procfile", "Justfile", "LICENSE", "README", "CHANGELOG"]);

/** Removes a `:line` or `:line:col` suffix, as in `src/a.ts:42:7`. */
function stripLine(s: string): string {
  return s.replace(/:\d+(?::\d+)?$/, "");
}

/** The parts between slashes, without empty parts from a leading or trailing slash. */
function partsOf(s: string): string[] {
  return s.split("/").filter((p) => p !== "");
}

/** True when every part has only path chars, and no part is empty in the middle (`a//b`). */
function cleanParts(body: string): boolean {
  const inner = body.replace(/^\/+/, "").replace(/\/+$/, "");
  if (inner === "") return false;
  return inner.split("/").every((p) => p !== "" && PART.test(p));
}

/** True when the last part looks like a file name with an extension that is not a domain. */
function hasFileExt(last: string): boolean {
  const m = EXT.exec(last);
  if (!m || m.index === 0) return false;
  return !DOMAINS.has(m[1].toLowerCase());
}

/**
 * An absolute path (`/a/b`, `/tmp/`) or a home path (`~`, `~/a`). An absolute path needs two parts
 * or a slash at the end: `/compact` and `/help` are slash commands of the agents.
 */
function absolute(s: string): boolean {
  if (s === "~" || s === "~/") return true;
  if (s.startsWith("~/")) return cleanParts(s.slice(1));
  if (!s.startsWith("/") || s.startsWith("//")) return false;
  if (!cleanParts(s)) return false;
  const parts = partsOf(s);
  return parts.length >= 2 || s.endsWith("/") || hasFileExt(parts[0]);
}

/**
 * A relative path in inline code: `./x`, `../x`, `src/content/`, `src/a.ts`, `a/b/c` or a file
 * name such as `README.md`. A path with no extension needs a slash at the end or three parts, so
 * `and/or` stays text. A path with only digits and dots, such as `2026/11/20`, stays text.
 */
function relative(s: string): boolean {
  if (s.startsWith("./") || s.startsWith("../")) return cleanParts(s.replace(/^(\.\.?\/)+/, "/")) || s === "./" || s === "../";
  if (!cleanParts(s)) return false;
  if (!/[A-Za-z]/.test(s)) return false;
  const parts = partsOf(s);
  const last = parts[parts.length - 1];
  if (parts.length === 1) {
    if (s.endsWith("/")) return true;
    if (BARE_FILES.has(last)) return true;
    const m = EXT.exec(last);
    if (!m || m.index === 0 || CODE_OWNERS.has(last.slice(0, m.index))) return false;
    return FILE_EXTS.has(m[1].toLowerCase());
  }
  // A dotted first part is a domain name (`example.com/docs`), unless it starts with a dot (`.github/`).
  if (!parts[0].startsWith(".") && /\.[A-Za-z]{2,}$/.test(parts[0]) && DOMAINS.has(parts[0].split(".").pop()!.toLowerCase())) return false;
  return s.endsWith("/") || hasFileExt(last) || parts.length >= 3;
}

/** The path when inline code is one file path and nothing more, else null. */
export function codePath(content: string): string | null {
  const s = stripLine(content.trim());
  if (s === "" || s.length > 1024 || /\s/.test(s)) return null;
  // A URL or a scheme (`http:`, `file:`, `C:`) is not a path here.
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(s)) return null;
  if (absolute(s) || relative(s)) return s;
  return null;
}

export type PathMatch = { start: number; end: number; path: string };

/** Chars that can stand before a path in prose: start, space, or an opening mark. */
const BEFORE = /[\s([{"'“‘]/;
/** Marks that end a sentence or close a quote, not a path. */
const TRAILING = /[.,;:!?)\]}"'”’]+$/;

/** The absolute and home paths in plain text, in order. Relative paths are left out (see the module doc). */
export function findPaths(text: string): PathMatch[] {
  const out: PathMatch[] = [];
  const re = /[~/][^\s"'`<>()[\]{}“”‘’]*/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const start = m.index;
    if (start > 0 && !BEFORE.test(text[start - 1])) continue;
    let token = m[0].replace(TRAILING, "");
    token = stripLine(token);
    if (token !== "~" && absolute(token)) out.push({ start, end: start + token.length, path: token });
  }
  return out;
}

/** One part of a text: plain text, or a path. */
export type PathPart = { text: string; path?: string };

/** The text cut into plain parts and path parts. A text with no path is one plain part. */
export function splitPaths(text: string): PathPart[] {
  const out: PathPart[] = [];
  let at = 0;
  for (const m of findPaths(text)) {
    if (m.start > at) out.push({ text: text.slice(at, m.start) });
    out.push({ text: text.slice(m.start, m.end), path: m.path });
    at = m.end;
  }
  if (at < text.length || out.length === 0) out.push({ text: text.slice(at) });
  return out;
}

/** The last part of a path, for a title: `/a/b/` gives `b`, `/` gives `/`, `~` gives `~`. */
export function baseName(path: string): string {
  const parts = partsOf(path);
  return parts.length === 0 ? (path.startsWith("~") ? "~" : "/") : parts[parts.length - 1];
}

/** The folder that holds an absolute path, or null for `/`. */
export function parentPath(path: string): string | null {
  const trimmed = path.replace(/\/+$/, "");
  if (trimmed === "") return null;
  const i = trimmed.lastIndexOf("/");
  if (i < 0) return null;
  return i === 0 ? "/" : trimmed.slice(0, i);
}

/** The path of an entry in a folder. */
export function childPath(dir: string, name: string): string {
  return dir.endsWith("/") ? `${dir}${name}` : `${dir}/${name}`;
}

/** True when the path starts at the session folder, so the call needs the folder. */
export function isRelativePath(path: string): boolean {
  return !path.startsWith("/") && !path.startsWith("~");
}
