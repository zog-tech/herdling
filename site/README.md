# Herdling website

The static site at `https://herdling.zog-tech.com`, on Cloudflare Pages (project `herdling-site`).
The App Store and Google Play listings link to `/`, `/support` and `/privacy`.

| Path | File | Markdown twin |
|---|---|---|
| `/` | `public/index.html` | `public/index.md` |
| `/download` | `public/download/index.html` | `public/download.md` |
| `/docs` | `public/docs/index.html` (the guide) | `public/docs.md` |
| `/support` | `public/support/index.html` | `public/support.md` |
| `/privacy` | `public/privacy/index.html` | `public/privacy.md` |
| `/llms.txt` | `public/llms.txt` (llmstxt.org index for AI assistants) | |
| `/llms-full.txt` | `public/llms-full.txt` (all twins in one file, generated) | |
| any other path | `public/404.html` | |

The pages are plain HTML with one stylesheet (`public/style.css`), no build step and no
external requests. Fonts are self-hosted (`public/fonts/`, Inter, SIL OFL; used only where the
system font is not SF). Colors follow the app's "Night Watch" design
(`design-system/herdling/MASTER.md`): warm black, ivory text, lantern gold used sparingly, ember
for "needs you". Dark and light follow the system; the header toggle stores the choice in
`localStorage` (`public/theme.js`, `public/site.js`). Scripts load from the same origin only, and
the Content-Security-Policy in `public/_headers` allows nothing else (no inline scripts or
inline `style` attributes).

Rules: no personal names, personal email, host names, LAN IPs or home-folder paths. The owner
is Zog Tech, Inc. The contact is admin@zog-tech.com. `scripts/check.sh` greps for these.

## One place for links: `public/config.js`

- `appStoreUrl`, `playUrl`: set them when the listings are live. Until then the buttons say
  "coming soon". `testFlightUrl`: a public beta link, shown while `appStoreUrl` is empty.
- `installer.command` and `installer.ready`: the one-line herdlingd installer (see "The installer"
  below). While `ready` is `false`, the command shows with an "After the first release" tag.
- `screenshots`: see below.

## The installer

`public/install.sh` is the herdlingd installer, served at `https://herdling.zog-tech.com/install.sh`
as `text/plain` (`public/_headers`). The app runs it over SSH for "Install and pair", and people
run it with `curl -fsSL https://herdling.zog-tech.com/install.sh | sh`. It downloads the newest
GitHub release (`herdlingd-v*`, made by `.github/workflows/release-herdlingd.yml`), so it works
only after the first release. Its `--quiet` output is a contract with the app
(`app/src/hosts/installer.ts`): change both together.

Test it against a fake release with `HERDLING_RELEASE_BASE` (for tests only), for example a
folder with `latest/download/herdlingd-<target>.tar.gz` and `SHA256SUMS`, served with
`python3 -m http.server 8799`:
`HERDLING_RELEASE_BASE=http://127.0.0.1:8799 sh public/install.sh --quiet`.

After the first release:

1. Set `installer.ready: true` in `public/config.js`.
2. Remove the "after the first release" sentences in `docs.md` (section 3), `download.md`,
   `index.md` (Get Herdling) and `llms.txt` (key facts), and in `index.html` (questions) and
   `download/index.html` (the `data-when="installer-soon"` lines hide by themselves).
3. Run `python3 scripts/sync.py` and `scripts/check.sh`, then deploy.

## Screenshots

Every phone frame shows a drawn placeholder until its screenshot exists. To add one:

1. Take the screenshot in the app's demo mode (iPhone 6.9" simulator, 1320 x 2868 portrait, or any
   screenshot with the same 1320:2868 ratio). Show only demo content.
2. Save two WebP files in `public/img/`: `<slot>-360.webp` (360 x 782) and `<slot>-720.webp`
   (720 x 1564). For example:
   `sips -z 1564 720 shot.png --out tmp.png && cwebp -q 82 tmp.png -o public/img/overview-720.webp`
   (and the same with `-z 782 360` for the 360 file).
3. Add the slot name to `screenshots` in `public/config.js`. `site.js` then replaces the
   placeholder with the image, with the right `srcset` and alt text.

| Slot | Where it shows | What to capture |
|---|---|---|
| `overview` | Home hero (center), "The board" section | The Overview board with a "Needs you" agent at the top, some Working and Ready rows |
| `session` | Home hero (left), "Chat view" section | A session in Thread view, ideally with a question and its answer buttons |
| `terminal` | Home hero (right), "Terminal" section | The Terminal view with the key bar |
| `new-session` | Home "New session and usage" section | The new session screen: host, folder, agent |
| `usage` | Home "New session and usage" section | The Usage tab with Claude and Codex meters |
| `settings` | `/docs`, section 6 | The Settings tab: hosts and notification switches |
| `pair` | `/docs`, section 4 | The Pair screen or the QR scanner |

`public/img/og.png` (1200 x 630) is the social card; it uses the app icon, not a screenshot.

## Keep the HTML and the Markdown in sync

The Markdown files are what AI assistants read (`/llms.txt` links them), so they must say the
same as the pages.

- `docs.md`, `support.md` and `privacy.md` are the **source** of `/docs`, `/support` and
  `/privacy`. Edit the Markdown, then run `python3 scripts/sync.py`. It rewrites the part of each
  HTML page between `<!-- md:start -->` and `<!-- md:end -->` (and the `/docs` contents list
  and the page lede), and regenerates `llms-full.txt`. Python standard library only.
  `<!-- shot: <slot> -->` in a Markdown file places a phone frame for that screenshot slot.
- `index.html` and `download/index.html` are designed by hand. When you change their text,
  change `index.md` or `download.md` the same way, then run `python3 scripts/sync.py` (for
  `llms-full.txt`).
- `llms.txt` is written by hand. Update its "key facts" when the install, pairing or config
  changes.
- `scripts/check.sh` fails when a generated file is out of date, when a page does not link its
  Markdown twin or `llms.txt`, or when it finds personal data. `scripts/deploy.sh` runs it first.

When herdlingd changes (a new config key in `companion/src/config.rs`, a new command in
`companion/src/main.rs`, new paths in `companion/src/install.rs`) or the app's Settings screen
changes, update `docs.md` sections 3 to 8 and the key facts in `llms.txt`.

## Headers and redirects

- `public/_headers`: security headers and CSP for every path; `no-cache` for pages and
  `config.js`; `text/markdown; charset=utf-8` for `*.md` and `text/plain; charset=utf-8` for
  `llms.txt` and `llms-full.txt` (both with `Access-Control-Allow-Origin: *`); long caching for
  `/img/*` and `/fonts/*`.
- `public/_redirects`: serves `/download`, `/docs`, `/support`, `/privacy` with status 200 (no
  trailing-slash redirect), and a few old or guessed addresses. Add a line for a new page.

## Run and deploy

- Local: `pnpm dlx wrangler@4.151.2 pages dev public` in this folder (port 8788). It applies
  `_headers` and `_redirects`. Any static server also works for a quick look.
- Deploy: `scripts/deploy.sh`. It runs `scripts/check.sh`, creates the Pages project on the
  first run, and deploys `public/` to the `main` branch. It reads `CLOUDFLARE_API_TOKEN`
  (Account > Cloudflare Pages > Edit) and `CLOUDFLARE_ACCOUNT_ID` from the environment or from
  the env file in `HERDLING_SITE_ENV` (default: the same file the Zoggyfin site uses). Not in git.
- Custom domain: `herdling.zog-tech.com` is a custom domain of the Pages project, with a
  proxied DNS CNAME `herdling` -> `herdling-site.pages.dev` in the `zog-tech.com` zone (the
  same setup as `zoggyfin.zog-tech.com`).
- The old pages `zog-tech.com/herdling/` and `zog-tech.com/herdling/privacy.html` forward to
  this site.
