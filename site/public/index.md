# Herdling

> Herdling puts the coding agents on your own computers in your pocket. See which agent works, which one is done and which one needs you, then answer from your phone. For iPhone and Android, with the free herdlingd companion on macOS or Linux. No account, no servers.

Web version: https://herdling.zog-tech.com/

Your coding agents keep working when you leave your desk. Herdling is a phone app for herdr, the terminal workspace for coding agents. It shows every agent on every computer you own, tells you when one finishes or needs an answer, and lets you reply in a few taps.

## How it works

1. **Install herdlingd on your computer.** herdlingd is the free Herdling companion for macOS and Linux. One command sets it up as a background service: `herdlingd install`.
2. **Pair with a QR code.** Run `herdlingd pair` on the computer and scan the code with the app. The phone gets its own SSH key, limited to Herdling.
3. **Watch and steer your agents.** Your computers and their agents show on one board. Open one to read, reply, answer a question or start new work.

Step-by-step guide: https://herdling.zog-tech.com/docs.md

## Features

- **One board for every agent.** Agents on all your computers in one list, grouped by status: Needs you, Ready, Working, Idle. The ones that need an answer come first. Peek at the last reply with a long press.
- **A chat view for your agents.** Read a session as a clean chat, with formatted replies, tool calls and subagents. Works with Claude Code, Codex, Pi and OpenCode. Type `/` for commands, `$` for Codex skills and `@` for OpenCode skills.
- **The real terminal.** Switch to the live terminal of any agent, with Esc, Tab, Ctrl-C, arrow keys and Enter. Works with every agent that herdr runs.
- **A notification when it matters.** Herdling tells you when an agent finishes or needs you. Tap the notification to open that session.
- **Quiet while you are at the computer.** No notifications while you use herdr at your desk, and for 5 minutes after.
- **Voice in and out.** Speak a prompt; speech becomes text on your phone (including a private on-device model) or on your own computer. Herdling can read replies out loud, in full or as a short summary.
- **Start new work.** Start an agent in any folder on any computer, resume an earlier session, and review automations.
- **Usage meters.** See how much of your Claude or Codex plan is left, and the CPU and memory of each computer.
- **Your own network, over SSH.** The phone connects straight to your computers, on your Wi-Fi or through your VPN. Encrypted by SSH.
- **No accounts, no servers.** There is nothing to sign up for. Zog Tech runs no server for Herdling and never sees your sessions.

## Questions

**What do I need?**
An iPhone (iOS 17 or later) or an Android phone (Android 8.0 or later), and one or more Mac or Linux computers that run herdr, an SSH server and herdlingd.

**What does it cost?**
Herdling and herdlingd are free. There are no ads and no in-app purchases.

**Which agents work?**
Every agent that herdr runs shows on the board, with its status, its terminal and notifications. Claude Code, Codex, Pi and OpenCode also get the chat view, command lists and session resume.

**Can I use it away from home?**
Yes, if your phone can reach your computer, for example through WireGuard or Tailscale. Pair at home, then set the computer's address to its VPN address. You can also add a computer once with its SSH password.

**Does Herdling see my code or my prompts?**
No. Everything goes between your phone and your computer over SSH. Notifications go through Expo, Apple or Google and hold only the agent's name, kind and terminal title.

**Is herdlingd safe to run?**
It runs as your user, not as root. The phone's key can only run `herdlingd rpc`; it cannot open a shell. Pairing needs a six-digit code that works once, for 5 minutes, and the app checks the computer's host key.

**Who makes Herdling?**
Zog Tech, Inc. Herdling is not made by or affiliated with the makers of herdr, Claude Code, Codex, Pi or OpenCode.

## Get Herdling

- iPhone: on the App Store soon.
- Android: on Google Play soon.
- herdlingd for macOS and Linux: see https://herdling.zog-tech.com/download.md

Contact: admin@zog-tech.com
