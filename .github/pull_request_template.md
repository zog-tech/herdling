## What changed

<!-- One or two sentences. Say why you made the change. -->

## Related issue

<!-- For example: Fixes #123 -->

## Parts and platforms

Every feature must work on iOS and Android. Tick what you changed and tested.

- [ ] iPhone app
- [ ] Android app
- [ ] herdlingd on macOS
- [ ] herdlingd on Linux
- [ ] Not a platform change (docs, tests or tooling)

If a platform is not done, say which one and why:

## How I tested it

<!-- Steps, devices, the agent kinds and the herdr version. -->

## Checklist

- [ ] `pnpm exec tsc --noEmit` and `pnpm test` pass in `app/`, and `pnpm exec tsc --noEmit` passes in `protocol/`
- [ ] For a change in `companion/`: `cargo clippy --all-targets -- -D warnings` and `cargo test` pass
- [ ] An older app still works with this herdlingd, and the reverse (see `docs/protocol.md`)
- [ ] I said if the change needs a native build or can ship as an over-the-air update
- [ ] I added or updated tests
- [ ] I updated the docs, the README and the CHANGELOG when the app or herdlingd does something new
- [ ] The commit messages follow the style in [CONTRIBUTING.md](../CONTRIBUTING.md)
- [ ] The change has no secrets, host names, IP addresses, home folder paths or personal data
- [ ] Screenshots, if any, show the demo host only
