#!/usr/bin/env python3
"""Checks the store text in store/*.md against the App Store and Google Play limits.

Each field is the fenced code block under its heading, or the backticked value on a
"- **Field**" line. Exit code 1 when a field is missing or over its limit.
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def block(md: str, heading: str) -> str:
    """The first fenced block after the heading line that starts with `heading`."""
    m = re.search(r"^#+ " + re.escape(heading) + r".*?\n```\n(.*?)\n```", md, re.S | re.M)
    if not m:
        raise SystemExit(f"missing block: {heading}")
    return m.group(1)


def inline(md: str, field: str) -> str:
    m = re.search(r"^- \*\*" + re.escape(field) + r"\*\*[^`]*`([^`]*)`", md, re.M)
    if not m:
        raise SystemExit(f"missing field: {field}")
    return m.group(1)


ios = (HERE / "app-store.md").read_text()
play = (HERE / "google-play.md").read_text()

checks = [
    ("App Store name", inline(ios, "Name"), 30),
    ("App Store subtitle", inline(ios, "Subtitle"), 30),
    ("App Store promotional text", block(ios, "Promotional text"), 170),
    ("App Store description", block(ios, "Description"), 4000),
    ("App Store keywords", block(ios, "Keywords"), 100),
    ("App Store review notes", block(ios, "Notes for the reviewer"), 4000),
    ("Play app name", inline(play, "App name"), 30),
    ("Play short description", block(play, "Short description"), 80),
    ("Play full description", block(play, "Full description"), 4000),
    ("Play release notes", block(play, "Release details"), 500),
]

ok = True
for name, text, limit in checks:
    n = len(text)
    flag = "OK  " if n <= limit else "OVER"
    ok &= n <= limit
    print(f"{flag} {name:30} {n:5} / {limit}")

kw = block(ios, "Keywords")
if ", " in kw or kw != kw.strip():
    print("FAIL keywords: no spaces after commas")
    ok = False
banned = ["claude", "codex", "openai", "anthropic", "chatgpt", "tmux", "opencode"]
hits = [b for b in banned if b in kw.lower()]
if hits:
    print(f"FAIL keywords contain trademarks: {hits}")
    ok = False

sys.exit(0 if ok else 1)
