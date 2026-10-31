<p align="center">
  <img src="app/assets/images/icon.png" alt="The Herdling app icon" width="128" height="128">
</p>

<h1 align="center">Herdling</h1>

<p align="center">
  Watch and steer the AI coding agents on your own computers from your phone.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MPL-2.0" src="https://img.shields.io/badge/license-MPL--2.0-blue"></a>
  <a href="https://github.com/zog-tech/herdling/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/zog-tech/herdling/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="Platforms: iOS, Android" src="https://img.shields.io/badge/platforms-iOS%20%7C%20Android-lightgrey">
  <img alt="App Store: coming soon" src="https://img.shields.io/badge/App%20Store-coming%20soon-orange">
</p>

<p align="center">
  <a href="https://herdling.zog-tech.com">Website</a> ·
  <a href="https://herdling.zog-tech.com/docs">Guide</a> ·
  <a href="https://herdling.zog-tech.com/download">Download</a> ·
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

<!-- screenshots: demo-mode images go here.
     When site/public/img/ has overview-720.webp, session-720.webp and terminal-720.webp
     (see site/README.md, "Screenshots"), add them here, 200 px wide, like this:
     <p align="center">
       <img src="site/public/img/session-720.webp" alt="A session in the chat view." width="200">
       <img src="site/public/img/overview-720.webp" alt="The board with an agent that needs you at the top." width="200">
       <img src="site/public/img/terminal-720.webp" alt="The terminal view with the key row." width="200">
     </p>
     The screenshots show the demo host. -->

Herdling is a phone app for [herdr](https://herdr.dev), the terminal workspace for AI coding agents.
It shows every agent on every computer you own: Claude Code, Codex, Pi, OpenCode and the other
agents that herdr runs. It tells you when an agent finishes or needs you, and you answer from the phone.

The phone connects straight to your computers over SSH. On each computer, a small companion
program, `herdlingd`, answers the app and sends the notifications. There is no account, and
Zog Tech runs no server for Herdling.

Herdling is not made by or affiliated with the makers of herdr, Claude Code, Codex, Pi or OpenCode.

## Features

- **One board for every agent.** The agents of all your computers in one list, grouped by status:
  Needs you, Ready, Working and Idle. The agents that need an answer come first. A long press
  shows the last reply.
- **A chat view.** Read a session as a clean chat, with formatted replies, tool calls, subagents
  and permission buttons. It works with Claude Code, Codex, Pi and OpenCode, with their command
  lists (`/`, `$` and `@`) and session resume.
- **The real terminal.** Switch to the live terminal of any agent, with Esc, Tab, Ctrl-C, the
  arrow keys and Enter. It works with every agent that herdr runs.
- **A notification when it matters.** `herdlingd` sends a push when an agent finishes or waits
  for you. A tap opens that session.
- **Quiet at the computer.** No pushes while you use herdr at your desk, and for 5 minutes after.
- **Voice in and out.** Speak a prompt: speech becomes text on the phone (also with a private
  on-device model) or on your own computer. Herdling can read replies out loud, in full or as a
  short summary.
- **Start new work.** Start an agent in any folder on any computer, restart or resume a session,
  rename sessions, tabs and workspaces, and review your automations.
- **Meters.** The plan usage of Claude and Codex, and the CPU and memory of each computer.
- **Pairing with a QR code.** `herdlingd pair` shows a one-time code. The phone gets its own SSH
  key that can only run `herdlingd rpc`, and the app pins the host key of the computer.
- **No accounts, no servers.** Session traffic goes only between the phone and your computers.
  A push holds only the agent name, the agent kind and the terminal title.
- **A demo mode.** The app has a demo host with made-up agents, so you can try it with no computer.

## Get it

- **iPhone** (iOS 17 or later): on the App Store soon.
- **Android** (Android 8.0 or later): on Google Play soon.
- **herdlingd** for macOS and Linux: build it from source (below). The one-line installer is
  coming soon. See also the [download page](https://herdling.zog-tech.com/download).
- **Setup guide:** [herdling.zog-tech.com/docs](https://herdling.zog-tech.com/docs).

Each computer needs herdr (installed and running), an SSH server and `herdlingd`. The phone must
reach the computer: on the same Wi-Fi, or through a VPN such as WireGuard or Tailscale.

### Install herdlingd from source

The steps are the same on macOS and Linux. You need:

- git;
- a C compiler (macOS: `xcode-select --install`; Debian and Ubuntu: `sudo apt install build-essential`);
- Rust (stable), for example from [rustup](https://rustup.rs):
  `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`. Open a new terminal afterwards.

```sh
git clone https://github.com/zog-tech/herdling
cd herdling/companion
cargo build --release
./target/release/herdlingd install   # copies itself to ~/.local/bin and starts the user service
herdlingd pair                       # shows the pairing code and QR code for the app
```

`herdlingd install` registers a launchd agent (`com.zogtech.herdlingd`) on macOS or a systemd
user service (`herdlingd.service`) on Linux. The service runs as your user, not as root.
`herdlingd install --dry-run` shows what it would do. If `herdlingd` is not found, add
`~/.local/bin` to your PATH. herdlingd talks to the herdr socket
(`~/.config/herdr/herdr.sock`, or the path in `HERDR_SOCKET`), so herdr must run.

To update, run `git pull`, then `cargo build --release` and `./target/release/herdlingd install`
again in `companion/`. Your config and paired phones stay.
The [guide](https://herdling.zog-tech.com/docs) explains every step, the config file and how to uninstall.

## How it works

```
Phone (Herdling app, Expo)
   │  SSH, with a restricted ed25519 key per phone
   │  the key can only run `herdlingd rpc`: one JSON object per line
   ▼
herdlingd (Rust, one binary per computer)
   ├─ rpc:   one process per SSH channel. It talks to the herdr socket, reads the agent
   │         transcripts, and reports host stats and plan usage.
   └─ serve: the user service. It watches herdr events, sends pushes, advertises
             itself on the local network (Bonjour) and opens the pairing window.
   ▼
herdr (unchanged), through its socket ~/.config/herdr/herdr.sock
```

- **Transport.** The app opens one SSH connection per computer. The native SSH client is
  Citadel (SwiftNIO SSH) on iOS and sshj on Android. The private key stays on the phone: in the
  Keychain on iOS, and encrypted with a Keystore key on Android.
- **Protocol.** Requests, responses and streamed events are newline-delimited JSON. The rules
  are in [docs/protocol.md](docs/protocol.md). The shared TypeScript types are in [protocol/](protocol/).
- **Transcripts.** `herdlingd` reads the session logs of Claude Code, Codex, Pi and OpenCode and
  turns them into one agent-neutral thread format.
- **Push.** The app registers an Expo push token with `herdlingd`. When an agent finishes or
  needs you, `herdlingd serve` posts a short message to the Expo push service, which sends it
  through Apple or Google.
- **Voice.** Speech recognition and speech run on the phone by default. A computer can add its
  own commands for speech to text, text to speech and summaries. See [docs/voice.md](docs/voice.md).
- **Updates.** The app gets JavaScript updates over the air with `expo-updates`. An app and a
  computer can run different versions: the protocol only adds methods and fields.

## Development

You need Node 22 or later, pnpm 10 and Rust (stable). For the iOS app you need Xcode; for the
Android app you need Android Studio and JDK 17.

The repository is a pnpm workspace (`app`, `protocol`) and a Cargo crate (`companion`).

```sh
pnpm install                 # from the repository root

cd app
pnpm exec tsc --noEmit       # type check
pnpm test                    # Jest unit tests

cd ../protocol
pnpm exec tsc --noEmit

cd ../companion
cargo clippy --all-targets -- -D warnings
cargo test
```

### Run the app

The app uses local native modules, so it does not run in Expo Go. Build a development client:

```sh
cd app
pnpm expo run:ios            # builds the native app and starts it in the simulator
pnpm expo run:android        # the same for Android
pnpm start                   # starts Metro for an installed development build
```

The `app/ios/` and `app/android/` folders are generated (Expo CNG) and are not in git.
To try the app with no computer, open `herdling://demo`: it adds the demo host.

### Local native modules

| Module | iOS | Android |
|---|---|---|
| `app/modules/ssh` | SSH client (Citadel, SwiftNIO SSH), keys in the Keychain, Bonjour browser, on-device Parakeet transcription (FluidAudio) | SSH client (sshj, BouncyCastle), the key encrypted with a Keystore key, Bonjour browser (NsdManager) |
| `app/modules/voice` | WAV recording and live speech recognition (Speech), on-device reply summaries (FoundationModels on iOS 26) | WAV recording and speech recognition (Android APIs) |
| `app/modules/paste` | Paste an image from the edit menu into the prompt box | Not needed |

A change in `app/modules/` needs a new native build. A change in JavaScript only can ship as an
over-the-air update. [AGENTS.md](AGENTS.md) has the rules.

## Repository layout

| Path | What it holds |
|---|---|
| `app/` | The Expo app (Expo SDK 58, Expo Router, TypeScript) for iOS and Android |
| `app/src/app/` | Screens and routes |
| `app/src/hosts/`, `app/src/rpc/`, `app/src/pairing/` | Saved computers, the SSH connection manager, the RPC client and pairing |
| `app/src/board/`, `app/src/thread/`, `app/src/terminal/` | The board, the chat view and the terminal view |
| `app/src/herdr/`, `app/src/push/`, `app/src/voice/` | herdr actions, push registration and voice |
| `app/src/theme/`, `app/src/ui/` | Design tokens and shared UI parts |
| `app/src/demo/` | The demo host |
| `app/modules/` | Local native modules (Swift, Kotlin) |
| `companion/` | `herdlingd`, the Rust companion for macOS and Linux |
| `protocol/` | Shared TypeScript types for the RPC |
| `docs/` | The protocol, voice, design specs and plans |
| `design-system/herdling/` | The design system of the app |
| `site/` | The website at herdling.zog-tech.com |
| `store/` | App Store and Google Play listing text |

## Contributing

Bug reports, ideas and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first.
Please follow the [Code of Conduct](CODE_OF_CONDUCT.md). For help, see [SUPPORT.md](SUPPORT.md).

## Security

Do not report a security problem in a public issue. Follow [SECURITY.md](SECURITY.md), or write
to [admin@zog-tech.com](mailto:admin@zog-tech.com).

## License

Herdling is under the [Mozilla Public License 2.0](LICENSE). Copyright Zog Tech, Inc.
The third-party software it uses is listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
