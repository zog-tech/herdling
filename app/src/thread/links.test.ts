import {
  browserHref,
  findLinks,
  linkActionLabel,
  linkActions,
  linkTarget,
  linkText,
  previewHref,
  previewPath,
  replyMarkdownIt,
  splitLinks,
} from "./links";

const urls = (text: string) => findLinks(text).map((m) => m.url);

test("findLinks_drops_trailing_punctuation", () => {
  expect(urls("See https://example.com/a.")).toEqual(["https://example.com/a"]);
  expect(urls("https://example.com/a, then https://example.com/b;")).toEqual(["https://example.com/a", "https://example.com/b"]);
  expect(urls("Is it https://example.com/x?")).toEqual(["https://example.com/x"]);
  expect(urls("\"https://example.com/q\" and 'https://example.com/r'")).toEqual(["https://example.com/q", "https://example.com/r"]);
  expect(urls("**https://example.com/bold**")).toEqual(["https://example.com/bold"]);
});

test("findLinks_keeps_a_query_and_a_fragment", () => {
  expect(urls("Open http://localhost:5173/app?tab=1#top.")).toEqual(["http://localhost:5173/app?tab=1#top"]);
});

test("findLinks_handles_brackets", () => {
  expect(urls("(see https://example.com/x)")).toEqual(["https://example.com/x"]);
  expect(urls("[https://example.com/y]")).toEqual(["https://example.com/y"]);
  // A pair inside the URL stays.
  expect(urls("https://en.example.com/wiki/Foo_(bar).")).toEqual(["https://en.example.com/wiki/Foo_(bar)"]);
  expect(urls("[label](https://example.com/md)")).toEqual(["https://example.com/md"]);
});

test("findLinks_finds_several_urls", () => {
  const m = findLinks("a http://localhost:3000 b https://example.com c mailto:sam@example.com");
  expect(m.map((x) => x.url)).toEqual(["http://localhost:3000", "https://example.com", "mailto:sam@example.com"]);
  expect(m[0]).toMatchObject({ start: 2, end: 23 });
});

test("findLinks_ignores_text_without_a_scheme_and_other_schemes", () => {
  expect(urls("foo.com main.rs sam@example.com localhost:5173 www.example.com")).toEqual([]);
  expect(urls("ftp://example.com file:///etc/hosts //example.com javascript:alert(1)")).toEqual([]);
  expect(urls("http:// https://")).toEqual([]);
  // A scheme inside a word is not a link.
  expect(urls("xhttps://example.com")).toEqual([]);
});

test("findLinks_finds_ipv6_loopback", () => {
  expect(urls("at http://[::1]:8000/x.")).toEqual(["http://[::1]:8000/x"]);
});

test("splitLinks_cuts_text_into_parts", () => {
  expect(splitLinks("no links")).toEqual([{ text: "no links" }]);
  expect(splitLinks("")).toEqual([{ text: "" }]);
  expect(splitLinks("go https://example.com.")).toEqual([
    { text: "go " },
    { text: "https://example.com", url: "https://example.com" },
    { text: "." },
  ]);
  expect(splitLinks("https://example.com")).toEqual([{ text: "https://example.com", url: "https://example.com" }]);
});

test("linkTarget_finds_local_dev_servers", () => {
  expect(linkTarget("http://localhost:5173")).toEqual({ kind: "local", url: "http://localhost:5173", port: 5173, path: "/" });
  expect(linkTarget("http://localhost:5173/app/x?a=1&b=2#h")).toMatchObject({ port: 5173, path: "/app/x?a=1&b=2#h" });
  expect(linkTarget("http://localhost:3000?q=1")).toMatchObject({ port: 3000, path: "/?q=1" });
  expect(linkTarget("http://127.0.0.1:8080/")).toMatchObject({ kind: "local", port: 8080, path: "/" });
  expect(linkTarget("http://0.0.0.0:4000/api")).toMatchObject({ kind: "local", port: 4000, path: "/api" });
  expect(linkTarget("http://[::1]:8000")).toMatchObject({ kind: "local", port: 8000 });
  expect(linkTarget("https://localhost:8443/x")).toMatchObject({ kind: "local", port: 8443, path: "/x" });
  expect(linkTarget("HTTP://LOCALHOST:5173")).toMatchObject({ kind: "local", port: 5173 });
});

test("linkTarget_uses_the_scheme_port_without_a_port", () => {
  expect(linkTarget("http://localhost")).toMatchObject({ kind: "local", port: 80, path: "/" });
  expect(linkTarget("http://localhost/docs")).toMatchObject({ kind: "local", port: 80, path: "/docs" });
  expect(linkTarget("https://localhost")).toMatchObject({ kind: "local", port: 443 });
});

test("linkTarget_rejects_bad_ports_and_other_schemes", () => {
  expect(linkTarget("http://localhost:0")).toBeNull();
  expect(linkTarget("http://localhost:70000")).toBeNull();
  expect(linkTarget("ftp://localhost:21")).toBeNull();
  expect(linkTarget("javascript:alert(1)")).toBeNull();
  expect(linkTarget("file:///etc/hosts")).toBeNull();
  expect(linkTarget("foo.com")).toBeNull();
  expect(linkTarget("mailto:")).toBeNull();
});

test("linkTarget_tells_web_pages_and_email", () => {
  expect(linkTarget("https://example.com/a")).toEqual({ kind: "web", url: "https://example.com/a" });
  // Only the exact loopback names are local.
  expect(linkTarget("http://localhost.example.com:5173")).toMatchObject({ kind: "web" });
  expect(linkTarget("http://127.0.0.10:80")).toMatchObject({ kind: "web" });
  expect(linkTarget("mailto:sam@example.com")).toEqual({ kind: "mail", url: "mailto:sam@example.com" });
});

test("previewHref_adds_the_path_only_when_it_is_not_the_root", () => {
  expect(previewHref("h1", 5173)).toBe("/preview/h1/5173");
  expect(previewHref("h1", 5173, "/")).toBe("/preview/h1/5173");
  expect(previewHref("h 1", 3000, "/a?b=1#c")).toBe("/preview/h%201/3000?path=%2Fa%3Fb%3D1%23c");
  expect(browserHref("https://example.com/?a=1")).toBe("/browser?url=https%3A%2F%2Fexample.com%2F%3Fa%3D1");
});

test("previewPath_always_starts_with_a_slash", () => {
  expect(previewPath(undefined)).toBe("/");
  expect(previewPath("")).toBe("/");
  expect(previewPath("/a?b=1")).toBe("/a?b=1");
  expect(previewPath("@example.com/x")).toBe("/@example.com/x");
});

test("linkActions_hide_safari_for_local_urls", () => {
  const local = linkTarget("http://localhost:5173")!;
  const web = linkTarget("https://example.com")!;
  const mail = linkTarget("mailto:sam@example.com")!;
  expect(linkActions(local, { webView: true, canCopy: true })).toEqual(["open", "copy", "share"]);
  expect(linkActions(web, { webView: true, canCopy: true })).toEqual(["open", "system", "copy", "share"]);
  expect(linkActions(web, { webView: false, canCopy: false })).toEqual(["system", "share"]);
  expect(linkActions(mail, { webView: true, canCopy: true })).toEqual(["open", "copy", "share"]);
  expect(linkActionLabel("open", local, "ios")).toBe("Open preview");
  expect(linkActionLabel("open", web, "ios")).toBe("Open in Herdling");
  expect(linkActionLabel("system", web, "ios")).toBe("Open in Safari");
  expect(linkActionLabel("system", web, "android")).toBe("Open in browser");
  expect(linkText(mail)).toBe("sam@example.com");
  expect(linkText(web)).toBe("https://example.com");
});

test("replyMarkdownIt_links_urls_with_a_scheme_only", () => {
  const md = replyMarkdownIt();
  const html = md.render("Open http://localhost:5173/x. Read main.rs and foo.com, or (https://example.com/a).");
  expect(html).toContain('<a href="http://localhost:5173/x">http://localhost:5173/x</a>.');
  expect(html).toContain('(<a href="https://example.com/a">https://example.com/a</a>)');
  expect(html).not.toContain('href="http://main.rs"');
  expect(html).not.toContain('href="http://foo.com"');
  // markdown-it encodes the brackets of the href; the target is still local.
  expect(md.render("at http://[::1]:8000/")).toContain('href="http://%5B::1%5D:8000/"');
  expect(linkTarget("http://%5B::1%5D:8000/")).toMatchObject({ kind: "local", port: 8000 });
  expect(md.render("ftp://example.com //example.com")).not.toContain("<a ");
  expect(md.render("`http://localhost:3000`")).not.toContain("<a ");
});
