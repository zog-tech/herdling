/**
 * Links in thread text, with no native parts: find the URLs in plain text, tell a dev server of
 * the computer from a web page, and build the routes that open them. `linkActions.ts` does the I/O.
 *
 * Only URLs with a scheme are links (`http:`, `https:`, `mailto:`). `foo.com` and file names such
 * as `main.rs` stay plain text. Trailing punctuation and an unpaired closing bracket are not part
 * of a URL, so "see (https://example.com)." links `https://example.com`.
 */
import MarkdownIt from "markdown-it";

import { validPort } from "@/preview/preview";

/** The URL body: it stops at white space, angle brackets, a double quote or a backtick. */
const BODY = /^[^\s<>"`]+/;
/** Characters that end a sentence or a quote, not a URL. */
const TRAILING = ".,;:!?'*";
const PAIRS: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
const START = /(https?:\/\/|mailto:)/gi;

const count = (s: string, c: string) => s.split(c).length - 1;

/** Removes trailing punctuation and closing brackets that have no opening bracket in the URL. */
function trimUrl(url: string): string {
  let s = url;
  for (;;) {
    const last = s[s.length - 1];
    if (last === undefined) return s;
    if (TRAILING.includes(last)) {
      s = s.slice(0, -1);
      continue;
    }
    const open = PAIRS[last];
    if (open && count(s, last) > count(s, open)) {
      s = s.slice(0, -1);
      continue;
    }
    return s;
  }
}

/** True for a URL that can open: an http(s) URL with a host, or a mailto URL with an address. */
function complete(url: string): boolean {
  return /^https?:\/\/[^/?#\s]+/i.test(url) || /^mailto:[^@\s]+@[^@\s]+$/i.test(url);
}

/**
 * The end index of the URL that starts at `start`, or -1 when no URL starts there. A letter or a
 * digit just before `start` means the scheme is part of a word, so it is not a URL.
 */
function urlEnd(text: string, start: number): number {
  if (start > 0 && /[A-Za-z0-9]/.test(text[start - 1])) return -1;
  const body = BODY.exec(text.slice(start));
  if (!body) return -1;
  const url = trimUrl(body[0]);
  return complete(url) ? start + url.length : -1;
}

export type LinkMatch = { start: number; end: number; url: string };

/** The URLs in plain text, in order. */
export function findLinks(text: string): LinkMatch[] {
  const out: LinkMatch[] = [];
  START.lastIndex = 0;
  for (let m = START.exec(text); m; m = START.exec(text)) {
    const end = urlEnd(text, m.index);
    if (end < 0) continue;
    out.push({ start: m.index, end, url: text.slice(m.index, end) });
    START.lastIndex = end;
  }
  return out;
}

/** One part of a text: plain text, or a link with its URL. */
export type TextPart = { text: string; url?: string };

/** The text cut into plain parts and link parts. A text with no URL is one plain part. */
export function splitLinks(text: string): TextPart[] {
  const out: TextPart[] = [];
  let at = 0;
  for (const m of findLinks(text)) {
    if (m.start > at) out.push({ text: text.slice(at, m.start) });
    out.push({ text: m.url, url: m.url });
    at = m.end;
  }
  if (at < text.length || out.length === 0) out.push({ text: text.slice(at) });
  return out;
}

/** The parser of assistant replies: the default options, plus links for URLs with a scheme. */
export function replyMarkdownIt(): MarkdownIt {
  const md = MarkdownIt({ typographer: true, linkify: true });
  // The same rule as plain text: no fuzzy links, and our end of URL for http and https
  // (linkify-it does not know `[::1]`). `//` and `ftp:` are not links.
  const scheme = (name: string) => ({
    validate: (text: string, pos: number) => {
      const start = pos - name.length;
      if (text.slice(start, pos).toLowerCase() !== name) return 0;
      const end = urlEnd(text, start);
      return end > pos ? end - pos : 0;
    },
  });
  md.linkify
    .set({ fuzzyLink: false, fuzzyEmail: false, fuzzyIP: false })
    .add("http:", scheme("http:"))
    .add("https:", scheme("https:"))
    .add("ftp:", null)
    .add("//", null);
  return md;
}

/** What a tap on a link opens. */
export type LinkTarget =
  /** A dev server of the computer: it opens in the browser preview, through the SSH tunnel. */
  | { kind: "local"; url: string; port: number; path: string }
  /** A web page: it opens in the in-app browser. */
  | { kind: "web"; url: string }
  /** An email address: it opens in the mail app. */
  | { kind: "mail"; url: string };

// markdown-it writes `[::1]` as `%5B::1%5D` in an href.
const LOCAL = /^(https?):\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|%5B::1%5D)(?::(\d{1,5}))?([/?#][^]*)?$/i;

/**
 * What the URL is. A loopback host (`localhost`, `127.0.0.1`, `0.0.0.0`, `[::1]`) is on the
 * user's computer, not on the phone: the phone cannot reach it without the preview. A URL with no
 * port uses the scheme's port. Null for a URL that the app does not open.
 */
export function linkTarget(url: string): LinkTarget | null {
  const u = url.trim();
  const local = LOCAL.exec(u);
  if (local) {
    const port = local[2] !== undefined ? Number(local[2]) : local[1].toLowerCase() === "https" ? 443 : 80;
    if (!validPort(port)) return null;
    const rest = local[3] ?? "/";
    return { kind: "local", url: u, port, path: rest.startsWith("/") ? rest : `/${rest}` };
  }
  if (/^https?:\/\/[^/?#\s]+/i.test(u)) return { kind: "web", url: u };
  if (/^mailto:[^@\s]+@[^@\s]+$/i.test(u)) return { kind: "mail", url: u };
  return null;
}

/** The route of the browser preview for a port and a path of the host. */
export function previewHref(hostId: string, port: number, path = "/"): string {
  const base = `/preview/${encodeURIComponent(hostId)}/${port}`;
  return path === "/" || path === "" ? base : `${base}?path=${encodeURIComponent(path)}`;
}

/** The route of the in-app browser. */
export function browserHref(url: string): string {
  return `/browser?url=${encodeURIComponent(url)}`;
}

/** The path that the preview loads: always on the preview origin, so it cannot change the host. */
export function previewPath(param: string | undefined): string {
  const p = (param ?? "").trim();
  if (!p) return "/";
  return p.startsWith("/") ? p : `/${p}`;
}

export type LinkAction = "open" | "system" | "copy" | "share";

/**
 * The items of the link menu, in menu order. A local URL has no "Open in Safari": the phone's
 * browser cannot reach the computer. A web link has "Open in Herdling" only with the web view.
 */
export function linkActions(t: LinkTarget, o: { webView: boolean; canCopy: boolean }): LinkAction[] {
  const out: LinkAction[] = [];
  if (t.kind !== "web" || o.webView) out.push("open");
  if (t.kind === "web") out.push("system");
  if (o.canCopy) out.push("copy");
  out.push("share");
  return out;
}

export function linkActionLabel(a: LinkAction, t: LinkTarget, os: string): string {
  switch (a) {
    case "open":
      return t.kind === "local" ? "Open preview" : t.kind === "mail" ? "Write email" : "Open in Herdling";
    case "system":
      return os === "ios" ? "Open in Safari" : "Open in browser";
    case "copy":
      return t.kind === "mail" ? "Copy address" : "Copy link";
    case "share":
      return "Share";
  }
}

/** The text that Copy and Share give: the address for an email link, the URL otherwise. */
export function linkText(t: LinkTarget): string {
  return t.kind === "mail" ? t.url.replace(/^mailto:/i, "") : t.url;
}
