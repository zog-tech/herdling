/**
 * The preview of a shared link: the title and the image from the Open Graph tags of the page.
 * The phone fetches the page itself (no Herdling server). `parseOpenGraph` is pure; `fetchLinkPreview`
 * takes the fetch function, so a test passes its own. Any failure gives no preview, and the share
 * screen shows the plain link.
 */

export type LinkPreview = { title?: string; description?: string; image?: string; siteName?: string };

/** Most characters of the page that the parser reads. The head of a page is near its start. */
export const MAX_HTML_CHARS = 512 * 1024;
/** The fetch stops after this time. */
export const PREVIEW_TIMEOUT_MS = 8_000;
/** Longest title and description that the preview keeps. */
const MAX_TEXT = 300;

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

/** Decodes the HTML entities of an attribute value or a title. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (all, code: string) => {
    const c = code.toLowerCase();
    if (c.startsWith("#x") || c.startsWith("#")) {
      const n = c.startsWith("#x") ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return NAMED[c] ?? all;
  });
}

/** One clean line of text: entities decoded, white space joined, cut to `MAX_TEXT`. */
function clean(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const t = decodeEntities(s).replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t;
}

/** The attributes of one tag, with lower-case names. */
function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  for (let m = re.exec(tag); m; m = re.exec(tag)) {
    out[m[1].toLowerCase()] = m[3] ?? m[4] ?? m[5] ?? "";
  }
  return out;
}

/**
 * `ref` resolved against the page `base`. Only http and https links come back: an image from
 * another scheme (`data:`, `javascript:`) is not shown.
 */
export function resolveUrl(ref: string, base: string): string | undefined {
  const r = decodeEntities(ref.trim());
  if (!r) return undefined;
  if (/^https?:\/\//i.test(r)) return r;
  const m = /^(https?:)\/\/([^/?#]+)([^?#]*)/i.exec(base);
  if (!m) return undefined;
  const [, scheme, host, path] = m;
  if (r.startsWith("//")) return `${scheme}${r}`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(r)) return undefined;
  if (r.startsWith("/")) return `${scheme}//${host}${r}`;
  const dir = path.replace(/[^/]*$/, "") || "/";
  return `${scheme}//${host}${dir}${r}`;
}

/** The preview from the HTML of a page at `url`. Open Graph first, then Twitter cards, then `<title>`. */
export function parseOpenGraph(html: string, url: string): LinkPreview {
  const head = html.slice(0, MAX_HTML_CHARS);
  const meta: Record<string, string> = {};
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attributes(m[0]);
    const key = (a.property ?? a.name ?? a.itemprop)?.toLowerCase();
    const content = a.content;
    // The first tag of a key wins: a page can list several images, the first is the main one.
    if (key && content !== undefined && meta[key] === undefined) meta[key] = content;
  }
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  const image = meta["og:image:secure_url"] ?? meta["og:image"] ?? meta["og:image:url"] ?? meta["twitter:image"] ?? meta["twitter:image:src"];
  return {
    title: clean(meta["og:title"] ?? meta["twitter:title"] ?? titleTag),
    description: clean(meta["og:description"] ?? meta["twitter:description"] ?? meta.description),
    image: image ? resolveUrl(image, url) : undefined,
    siteName: clean(meta["og:site_name"]),
  };
}

/** True when the preview has something to show. */
export const hasPreview = (p: LinkPreview | undefined): p is LinkPreview => !!p && !!(p.title || p.image);

/** "github.com" from "https://www.github.com/a/b". */
export function hostOf(url: string): string {
  const host = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(url)?.[1] ?? url;
  return host.replace(/^www\./i, "");
}

type FetchLike = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{
  ok: boolean;
  /** The URL after redirects. Relative image links resolve against it. */
  url?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

/**
 * Fetches `url` and reads its preview. Only http and https pages, only HTML, within
 * `PREVIEW_TIMEOUT_MS`. Returns undefined on any failure.
 */
export async function fetchLinkPreview(
  url: string,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
  timeoutMs = PREVIEW_TIMEOUT_MS,
): Promise<LinkPreview | undefined> {
  if (!/^https?:\/\//i.test(url)) return undefined;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { signal: abort.signal, headers: { Accept: "text/html,application/xhtml+xml" } });
    if (!res.ok) return undefined;
    const type = res.headers.get("content-type") ?? "";
    if (type && !/html/i.test(type)) return undefined;
    const preview = parseOpenGraph(await res.text(), res.url || url);
    return hasPreview(preview) ? preview : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
