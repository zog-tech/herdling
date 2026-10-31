# Contributing to Herdling

Thank you for your interest. This guide tells you how to set up the project, check your work and send a change.

By taking part, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
To report a security problem, do not open an issue. Follow [SECURITY.md](SECURITY.md).

## Before you start

- Look for an existing issue or discussion first.
- For a big change, open an issue or a discussion before you write code. This saves you time.
- Small fixes (a bug, a typo, a missing test) can go straight to a pull request.

## Two rules

**Every feature works on iOS and Android.** Build the feature for both platforms in the same pull
request, or say in the pull request which platform is not done yet and why. If a platform cannot
support the feature, show a clear message in the app. Do not let the feature fail without a word.

**An old app and a new herdlingd (and the reverse) must work together.** People update the app
and the companion at different times. Follow the compatibility rules in
[docs/protocol.md](docs/protocol.md): add methods and fields only, never rename or remove them,
and make every new field optional on both sides.

## Setup

You need:

- Node 22 or later
- pnpm 10
- Rust (stable), for `herdlingd`
- Xcode, for iOS builds
- Android Studio and JDK 17, for Android builds

```sh
pnpm install                 # from the repository root
cd app
pnpm expo run:ios            # builds the development client and starts it in the simulator
pnpm expo run:android        # the same for Android
pnpm start                   # starts Metro for an installed development build
```

The app uses local native modules, so it does not run in Expo Go.
The `app/ios/` and `app/android/` folders are generated (Expo CNG) and are not in git.
Use `pnpm`, not `npm` or `yarn`.

To try the app with real agents, you need a Mac or Linux computer with herdr, an SSH server and
`herdlingd`. Build `herdlingd` with `cd companion && cargo build --release`, then run
`./target/release/herdlingd install` and `herdlingd pair`. To try the app with no computer,
open `herdling://demo` for the demo host.

## Commands

| Where | Command | What it does |
|---|---|---|
| `app/` | `pnpm exec tsc --noEmit` | Type check |
| `app/` | `pnpm test` | Jest unit tests |
| `app/` | `pnpm start` | Metro for a development build |
| `protocol/` | `pnpm exec tsc --noEmit` | Type check of the shared types |
| `companion/` | `cargo clippy --all-targets -- -D warnings` | Rust lint |
| `companion/` | `cargo test` | Rust tests |

## Releasing herdlingd

Only the maintainer releases. A release is a tag; GitHub Actions does the rest.

1. Bump `version` in `companion/Cargo.toml` (for example `0.2.0`). Run `cargo build` once so
   that `Cargo.lock` changes too, and commit both.
2. In `CHANGELOG.md`, add a section `## [herdlingd 0.2.0] - YYYY-MM-DD` with the changes. The
   workflow uses the text of this section as the release notes, and the app shows them before an update.
3. Merge to `main`. Then tag the merge commit and push the tag:

   ```sh
   git tag herdlingd-v0.2.0
   git push origin herdlingd-v0.2.0
   ```

4. `.github/workflows/release-herdlingd.yml` checks that the tag matches `companion/Cargo.toml`,
   builds `aarch64-apple-darwin`, `x86_64-apple-darwin`, `x86_64-unknown-linux-musl` and
   `aarch64-unknown-linux-musl`, and publishes the GitHub Release `herdlingd-v0.2.0` with
   `herdlingd-<target>.tar.gz`, `SHA256SUMS` and `latest.json`. It marks the release as "latest".
5. The app and `herdlingd update` find the new version through
   `https://github.com/zog-tech/herdling/releases/latest/download/latest.json`. The installer
   at `https://herdling.zog-tech.com/install.sh` downloads it.

Rules:

- Do not mark another release in this repository as "latest". The installer and the update use
  the "latest" release.
- Do not delete or change the assets of a published release. Make a new version instead.
- The `version` in `app/app.json` is a different thing. Do not change it for a herdlingd release.

## Code style

- TypeScript with `strict` on. Do not use `any`.
- Follow the code around you: file names, folder layout and naming.
- Use the design tokens from `app/src/theme/` and the rules in
  [design-system/herdling/MASTER.md](design-system/herdling/MASTER.md). Do not hard-code colors or sizes.
- Write comments that explain why the code does something. Do not describe what the code says.
- Write docs, comments and user-facing text in plain English: short sentences, active voice, one
  idea per sentence (ASD-STE100 Simplified Technical English).
- Never log push tokens, SSH keys, pairing codes or passwords.
- Do not add a new dependency without a reason. Say why in the pull request.
  A dependency with native code forces a new native build.

## Tests and checks

Run these before you push. CI runs the same checks.

```sh
cd app && pnpm exec tsc --noEmit && pnpm test
cd ../protocol && pnpm exec tsc --noEmit
cd ../companion && cargo clippy --all-targets -- -D warnings && cargo test
```

Add or update a test when you fix a bug or add logic. App tests live next to the code
(`*.test.ts`, `*.test.tsx`). Companion tests live in `companion/tests/`.
For a change to the screens, run the app and try it on iOS and Android.

## Commit style

Look at `git log` for the style.

- The first line is one short sentence: an area prefix, then what changed.
  For example "companion: tests for the Codex, Pi and OpenCode adapters" or
  "board: show the time only on working cards".
- Do not end with a period. Do not use a type prefix like `feat:`.
- Keep the first line under about 72 characters.
- Leave a blank line, then explain why you made the change and what it does.
- Make small commits. One commit does one thing.

## Pull request flow

1. Fork the repository and make a branch from `main`.
2. Make your change and run the checks above.
3. Push your branch and open a pull request against `main`. Fill in the pull request template.
4. CI must pass. A maintainer reviews your pull request and may ask for changes.
5. Answer the comments and push more commits to the same branch.
6. A maintainer merges the pull request. The branch is deleted after the merge.

Keep a pull request small and about one thing. Describe how you tested it.
Do not include secrets, personal data, host names, IP addresses, home folder paths or screenshots
of real sessions. Use the demo host for screenshots.

## License

When you contribute code, you agree that it is under the [Mozilla Public License 2.0](LICENSE).
Do not copy code from a project with an incompatible license. Do not copy GPL code into this repository.
