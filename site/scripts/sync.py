#!/usr/bin/env python3
"""Keeps the HTML pages and the Markdown files of site/public in sync.

The Markdown files are the source for three pages:
  docs.md    -> docs/index.html
  support.md -> support/index.html
  privacy.md -> privacy/index.html
The script writes the HTML between the markers <!-- md:start --> and <!-- md:end --> of each
page (and the contents list of /docs between <!-- toc:start --> and <!-- toc:end -->).
It also writes llms-full.txt, the join of all Markdown twins.

index.html and download/index.html are designed by hand; keep index.md and download.md in
step with them by hand.

Usage: python3 scripts/sync.py          write the files
       python3 scripts/sync.py --check  exit 1 when a file is out of date
Needs only the Python standard library. Supports the Markdown that these files use:
headings, paragraphs, lists (one nested level), tables, fenced code, **bold**, `code`,
[links](url), bare https:// links, and <!-- shot: <slot> --> for a screenshot slot.
"""
import html
import re
import sys
from pathlib import Path

PUBLIC = Path(__file__).resolve().parent.parent / "public"
SITE = "https://herdling.zog-tech.com"
PAGES = {"docs.md": "docs/index.html", "support.md": "support/index.html", "privacy.md": "privacy/index.html"}
TWINS = ["index.md", "download.md", "docs.md", "support.md", "privacy.md"]
INSTALLER = "curl -fsSL https://herdling.zog-tech.com/install.sh | sh"
SHOT_LABELS = {
    "overview": "The Overview board: agents grouped by status, with one that needs you at the top.",
    "session": "A session in the chat view, with an agent's question and answer buttons.",
    "terminal": "The live terminal of an agent, with the key bar.",
    "new-session": "The new session screen: host, folder and agent.",
    "usage": "The Usage tab with plan meters for each computer.",
    "settings": "The Settings tab: hosts, notification switches and voice settings.",
    "pair": "The pairing screen, scanning the QR code from herdlingd pair.",
}


def slug(text):
    s = re.sub(r"<[^>]+>", "", text).lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return re.sub(r"^\d+-", "", s) or "section"


def site_link(url):
    """Turns links to this site's Markdown twins into links to the HTML pages."""
    if url.startswith(SITE):
        path = url[len(SITE):] or "/"
        path = re.sub(r"^/index\.md$", "/", path)
        path = re.sub(r"\.md$", "", path)
        return path
    return url


def inline(text):
    out, pos = [], 0
    for m in re.finditer(r"`([^`]+)`", text):
        out.append(inline_plain(text[pos:m.start()]))
        out.append("<code>" + html.escape(m.group(1), quote=False) + "</code>")
        pos = m.end()
    out.append(inline_plain(text[pos:]))
    return "".join(out)


def inline_plain(text):
    links = []

    def keep(m):
        links.append((m.group(1), m.group(2)))
        return f"\x00{len(links) - 1}\x00"

    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", keep, text)
    text = html.escape(text, quote=False)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(https://[A-Za-z0-9./_#?=&%-]*[A-Za-z0-9/_#=-])",
                  lambda m: f'<a href="{html.escape(site_link(m.group(1)))}">{display(m.group(1))}</a>', text)
    text = re.sub(r"\badmin@zog-tech\.com\b", '<a href="mailto:admin@zog-tech.com">admin@zog-tech.com</a>', text)

    def put(m):
        label, url = links[int(m.group(1))]
        return f'<a href="{html.escape(site_link(url))}">{html.escape(label, quote=False)}</a>'

    return re.sub(r"\x00(\d+)\x00", put, text)


def display(url):
    """Short link text: own pages by path, others without the scheme."""
    if url.startswith(SITE):
        return SITE.removeprefix("https://") + site_link(url).rstrip("/")
    return url.removeprefix("https://").rstrip("/")


def code_block(lang, lines):
    text = "\n".join(lines)
    if text.strip() == INSTALLER:
        return ('<div class="code soon"><span class="tag" data-when="installer-soon">After the first release</span>'
                f'<pre><code data-installer-command>{html.escape(text)}</code></pre></div>')
    rows = []
    for line in lines:
        esc = html.escape(line, quote=False)
        if lang in ("sh", "toml") and line.lstrip().startswith("#") and not line.startswith("#!"):
            esc = f'<span class="c">{esc}</span>'
        rows.append(esc)
    return '<div class="code"><pre><code>' + "\n".join(rows) + "</code></pre></div>"


def table(rows):
    cells = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows]
    head, body = cells[0], cells[2:]
    out = ['<div class="table-wrap"><table>', "<thead><tr>" + "".join(f'<th scope="col">{inline(c)}</th>' for c in head) + "</tr></thead>", "<tbody>"]
    for r in body:
        out.append("<tr>" + f'<th scope="row">{inline(r[0])}</th>' + "".join(f"<td>{inline(c)}</td>" for c in r[1:]) + "</tr>")
    out.append("</tbody></table></div>")
    return "\n".join(out)


def shot(slot):
    label = SHOT_LABELS.get(slot, "A Herdling screen.")
    return (f'<figure class="doc-shot"><div class="device phone">{SCREENS.get(slot, SCREENS["overview"]).format(slot=slot, label=html.escape(label))}</div></figure>')


def lists(lines):
    """Renders list lines (with one nested level) to HTML."""
    out, i = [], 0

    def render(items, ordered):
        tag = "ol" if ordered else "ul"
        res = [f"<{tag}>"]
        for text, children, child_ordered in items:
            inner = inline(text)
            if children:
                inner += render(children, child_ordered)
            res.append(f"<li>{inner}</li>")
        res.append(f"</{tag}>")
        return "".join(res)

    items, ordered = [], None
    for line in lines:
        m = re.match(r"^( *)(-|\d+\.) (.*)$", line)
        if m:
            indent, mark, text = len(m.group(1)), m.group(2), m.group(3)
            is_ord = mark != "-"
            if indent == 0:
                if ordered is None:
                    ordered = is_ord
                items.append([text, [], False])
            else:
                items[-1][1].append((text, [], False))
                items[-1][2] = is_ord
        else:  # continuation line
            items[-1][0] += " " + line.strip()
    return render([tuple(x) for x in items], ordered)


def convert(md):
    """Returns (title, lede, body_html, toc) for a Markdown page."""
    lines = md.split("\n")
    title = lede = ""
    body, toc, seen = [], [], set()
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if line.startswith("# "):
            title = line[2:].strip()
            i += 1
            continue
        if line.startswith("> "):
            lede = line[2:].strip()
            i += 1
            continue
        if line.startswith("Web version: "):
            i += 1
            continue
        m = re.match(r"^<!-- shot: ([a-z-]+) -->$", line.strip())
        if m:
            body.append(shot(m.group(1)))
            i += 1
            continue
        if line.startswith("```"):
            lang = line[3:].strip()
            j = i + 1
            while not lines[j].startswith("```"):
                j += 1
            body.append(code_block(lang, lines[i + 1:j]))
            i = j + 1
            continue
        m = re.match(r"^(#{2,4}) (.*)$", line)
        if m:
            level, text = len(m.group(1)), m.group(2)
            hid = slug(text)
            while hid in seen:
                hid += "-2"
            seen.add(hid)
            if level == 2:
                toc.append((hid, re.sub(r"^\d+\. ", "", text)))
            body.append(f'<h{level} id="{hid}">{inline(text)}</h{level}>')
            i += 1
            continue
        if line.startswith("|"):
            j = i
            while j < len(lines) and lines[j].startswith("|"):
                j += 1
            body.append(table(lines[i:j]))
            i = j
            continue
        if re.match(r"^(-|\d+\.) ", line):
            j = i
            while j < len(lines) and lines[j].strip() and (re.match(r"^ *(-|\d+\.) ", lines[j]) or lines[j].startswith("  ")):
                j += 1
            body.append(lists(lines[i:j]))
            i = j
            continue
        j = i
        para = []
        while j < len(lines) and lines[j].strip() and not re.match(r"^(#|```|\||- |\d+\. |<!--)", lines[j]):
            para.append(lines[j].strip())
            j += 1
        body.append(f"<p>{inline(' '.join(para))}</p>")
        i = j
    return title, lede, "\n".join(body), toc


SCREENS = {}


def load_screens():
    """The placeholder screens, shared with index.html, live in scripts/screens.html."""
    src = (Path(__file__).resolve().parent / "screens.html").read_text()
    for m in re.finditer(r'<template id="([a-z-]+)">\n?(.*?)\n?</template>', src, re.S):
        SCREENS[m.group(1)] = m.group(2).strip()


def replace_between(text, start, end, new):
    a, b = text.index(start) + len(start), text.index(end)
    return text[:a] + "\n" + new + "\n" + text[b:]


def full_text():
    parts = [
        "# Herdling: full documentation\n",
        f"> Every page of {SITE} in one Markdown file, for AI assistants and offline reading. "
        f"Sources: {', '.join(SITE + '/' + t for t in TWINS)}.\n",
    ]
    for name in TWINS:
        fence = False
        out = []
        for line in (PUBLIC / name).read_text().rstrip("\n").split("\n"):
            if line.startswith("```"):
                fence = not fence
            if not fence and re.match(r"^#{1,5} ", line):
                line = "#" + line
            if not line.startswith("<!-- shot:"):
                out.append(line)
        parts.append("\n---\n\n" + "\n".join(out) + "\n")
    return "\n".join(parts)


def main():
    check = "--check" in sys.argv
    load_screens()
    stale = []
    targets = {}
    for md, page in PAGES.items():
        _, lede, body, toc = convert((PUBLIC / md).read_text())
        path = PUBLIC / page
        text = path.read_text()
        new = replace_between(text, "<!-- md:start -->", "<!-- md:end -->", body)
        if "<!-- toc:start -->" in new:
            items = "\n".join(f'<li><a href="#{hid}">{inline(t)}</a></li>' for hid, t in toc)
            new = replace_between(new, "<!-- toc:start -->", "<!-- toc:end -->", items)
        if "<!-- lede:start -->" in new:
            new = replace_between(new, "<!-- lede:start -->", "<!-- lede:end -->", inline(lede))
        targets[path] = new
    targets[PUBLIC / "llms-full.txt"] = full_text()
    for path, new in targets.items():
        if path.exists() and path.read_text() == new:
            continue
        stale.append(path.relative_to(PUBLIC))
        if not check:
            path.write_text(new)
    if check and stale:
        print("out of date (run python3 scripts/sync.py):", ", ".join(map(str, stale)), file=sys.stderr)
        sys.exit(1)
    if not check:
        print("updated:", ", ".join(map(str, stale)) or "nothing")


if __name__ == "__main__":
    main()
