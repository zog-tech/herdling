import { decodeEntities, fetchLinkPreview, hasPreview, hostOf, parseOpenGraph, resolveUrl } from "./openGraph";

const PAGE = `<!doctype html><html><head>
<title>Fallback &amp; title</title>
<meta charset="utf-8">
<meta content="The &quot;real&quot; title" property="og:title" />
<meta property='og:image' content='/img/cover.png'>
<meta property="og:image" content="https://cdn.example.com/second.png">
<meta name="description" content="A page   about
things">
<meta property="og:site_name" content="Example">
</head><body><meta property="og:title" content="not this"></body></html>`;

describe("parseOpenGraph", () => {
  it("reads the Open Graph tags in any attribute order, the first tag of a key wins", () => {
    expect(parseOpenGraph(PAGE, "https://example.com/blog/post")).toEqual({
      title: 'The "real" title',
      description: "A page about things",
      image: "https://example.com/img/cover.png",
      siteName: "Example",
    });
  });

  it("falls back to the Twitter tags and to the title tag", () => {
    const twitter = `<meta name="twitter:title" content="Tw"><meta name="twitter:image" content="//img.example.com/t.jpg">`;
    expect(parseOpenGraph(twitter, "https://example.com/")).toMatchObject({ title: "Tw", image: "https://img.example.com/t.jpg" });
    expect(parseOpenGraph("<title>\n Only  a title </title>", "https://example.com/")).toEqual({
      title: "Only a title",
      description: undefined,
      image: undefined,
      siteName: undefined,
    });
  });

  it("gives an empty preview for a page with no tags", () => {
    const p = parseOpenGraph("<html><body>hi</body></html>", "https://example.com/");
    expect(hasPreview(p)).toBe(false);
    expect(hasPreview(undefined)).toBe(false);
    expect(hasPreview({ image: "https://x.dev/i.png" })).toBe(true);
  });

  it("cuts a very long title", () => {
    const p = parseOpenGraph(`<meta property="og:title" content="${"a".repeat(400)}">`, "https://example.com/");
    expect(p.title).toHaveLength(300);
    expect(p.title?.endsWith("…")).toBe(true);
  });
});

describe("helpers", () => {
  it("resolves image links and refuses other schemes", () => {
    const base = "https://example.com/a/b/page.html?x=1";
    expect(resolveUrl("https://cdn.dev/i.png", base)).toBe("https://cdn.dev/i.png");
    expect(resolveUrl("//cdn.dev/i.png", base)).toBe("https://cdn.dev/i.png");
    expect(resolveUrl("/i.png", base)).toBe("https://example.com/i.png");
    expect(resolveUrl("i.png", base)).toBe("https://example.com/a/b/i.png");
    expect(resolveUrl("i.png", "https://example.com")).toBe("https://example.com/i.png");
    expect(resolveUrl("data:image/png;base64,AAAA", base)).toBeUndefined();
    expect(resolveUrl("javascript:alert(1)", base)).toBeUndefined();
    expect(resolveUrl("/i.png", "not a url")).toBeUndefined();
    expect(resolveUrl("  ", base)).toBeUndefined();
  });

  it("decodes entities and names the host", () => {
    expect(decodeEntities("a &amp; b &#39;c&#x27; &lt;d&gt; &unknown;")).toBe("a & b 'c' <d> &unknown;");
    expect(hostOf("https://www.github.com/a/b")).toBe("github.com");
    expect(hostOf("http://localhost:3000/x")).toBe("localhost");
  });
});

describe("fetchLinkPreview", () => {
  const response = (body: string, over: { ok?: boolean; type?: string; url?: string } = {}) => ({
    ok: over.ok ?? true,
    url: over.url,
    headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? (over.type ?? "text/html; charset=utf-8") : null) },
    text: async () => body,
  });

  it("fetches the page and reads its preview, resolving against the final URL", async () => {
    const fetchFn = jest.fn(async () => response(PAGE, { url: "https://example.com/moved/post" }));
    await expect(fetchLinkPreview("https://example.com/p", fetchFn)).resolves.toMatchObject({
      title: 'The "real" title',
      image: "https://example.com/img/cover.png",
    });
    expect(fetchFn).toHaveBeenCalledWith("https://example.com/p", expect.objectContaining({ headers: expect.any(Object) }));
  });

  it("gives undefined for a failure, a non-HTML page, a page without tags or another scheme", async () => {
    await expect(fetchLinkPreview("https://x.dev", async () => response(PAGE, { ok: false }))).resolves.toBeUndefined();
    await expect(fetchLinkPreview("https://x.dev", async () => response(PAGE, { type: "application/pdf" }))).resolves.toBeUndefined();
    await expect(fetchLinkPreview("https://x.dev", async () => response("<p>hi</p>"))).resolves.toBeUndefined();
    await expect(fetchLinkPreview("https://x.dev", async () => Promise.reject(new Error("offline")))).resolves.toBeUndefined();
    const never = jest.fn();
    await expect(fetchLinkPreview("ftp://x.dev", never)).resolves.toBeUndefined();
    expect(never).not.toHaveBeenCalled();
  });

  it("stops at the timeout", async () => {
    const fetchFn = (_url: string, init: { signal: AbortSignal }) =>
      new Promise<never>((_, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    await expect(fetchLinkPreview("https://slow.dev", fetchFn, 10)).resolves.toBeUndefined();
  });
});
