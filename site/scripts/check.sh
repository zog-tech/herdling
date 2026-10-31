#!/usr/bin/env bash
# Checks site/public before a deploy:
#  1. The HTML pages and llms-full.txt match the Markdown files (python3 scripts/sync.py).
#  2. Every HTML page has its Markdown twin and links it.
#  3. No personal data or local paths in public files.
set -euo pipefail
cd "$(dirname "$0")/../public"

python3 ../scripts/sync.py --check

for page in index.html download/index.html docs/index.html support/index.html privacy/index.html; do
  case "$page" in index.html) md=index.md ;; *) md="${page%%/*}.md" ;; esac
  [ -f "$md" ] || { echo "missing $md for $page" >&2; exit 1; }
  grep -q "href=\"/$md\"" "$page" || { echo "$page does not link /$md" >&2; exit 1; }
  grep -q 'rel="alternate" type="text/markdown" href="/llms.txt"' "$page" || { echo "$page has no llms.txt link" >&2; exit 1; }
done

# Personal data and local infrastructure must never ship.
PATTERN='/Users/|/home/|@gmail\.|192\.168\.|\.internal\b'
if grep -rInE "$PATTERN" . --exclude-dir=fonts; then
  echo "personal data or a local path found (above)" >&2; exit 1
fi
echo "site check: ok"
