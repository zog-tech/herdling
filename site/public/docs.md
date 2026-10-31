# Herdling guide

> How to set up and use Herdling: install herdlingd on your computer, pair your phone, and watch and steer your coding agents. Covers every setting, the config file, voice, notifications, troubleshooting and uninstall.

Web version: https://herdling.zog-tech.com/docs

## What you need

- **A phone.** iPhone with iOS 17 or later, or Android 8.0 or later. Herdling is made for phones in portrait (no iPad layout).
- **One or more computers** with macOS or Linux. Each computer runs:
  - **herdr**, the terminal workspace for coding agents (https://herdr.dev). Herdling shows the agents that herdr runs.
  - **An SSH server.** The app connects to the computer over SSH.
  - **herdlingd**, the free Herdling companion. It is a single program that answers the app, pairs phones and sends notifications.
- **A network path** from the phone to the computer: the same Wi-Fi, or a VPN such as WireGuard or Tailscale.

There is no account. Zog Tech runs no server for Herdling. The phone talks only to your computers.

Herdling is made for herdr. If you do not use herdr, or you want only a terminal, another tool can fit better. The README has a dated comparison with other mobile agent apps: https://github.com/zog-tech/herdling#how-herdling-compares

## 1. Install herdr

Install herdr from https://herdr.dev and run your agents (Claude Code, Codex, Pi, OpenCode and others) inside it. herdlingd talks to herdr through its socket, `~/.config/herdr/herdr.sock`. If you run herdr with a different socket, set the `HERDR_SOCKET` environment variable for herdlingd.

## 2. Turn on SSH

- **macOS:** open System Settings > General > Sharing and turn on **Remote Login**.
- **Linux:** install and start the OpenSSH server. On Debian and Ubuntu:

```sh
sudo apt install openssh-server
sudo systemctl enable --now ssh
```

On Fedora, the service is `sshd`: `sudo systemctl enable --now sshd`.

## 3. Install herdlingd

There are three ways. The first two download a prebuilt herdlingd from the GitHub releases.

| Way | Good for |
|---|---|
| **In the app** (recommended) | Setup with no terminal. Needs SSH password login on the computer |
| **The one-line installer** | A terminal on the computer, no Rust |
| **Build from source** | Developers, and other CPU types |

### In the app (recommended)

In Herdling, tap Settings > Hosts > **Add host** > **Set up with password**. Enter the address of the computer, the SSH port (22), your user name and your SSH password, then tap **Connect**. The app shows the host key for you to check (see step 4).

When herdlingd is not on the computer, the app asks **Install herdlingd now?** and tells you what it does. Tap **Install and pair**. The app then:

1. logs in again with the same password and the same host key;
2. runs the one-line installer (below) on the computer, which downloads herdlingd from GitHub, checks its SHA-256, copies it to `~/.local/bin` and starts the user service;
3. adds the phone's restricted key (`herdlingd enroll`) and saves the computer.

It takes about a minute. It needs no admin rights and uses no sudo. The app uses the password only for these logins. It does not keep the password. herdr must be installed first: if it is missing, the app says so and links https://herdr.dev.

### The one-line installer

```sh
curl -fsSL https://herdling.zog-tech.com/install.sh | sh
```

The script is at https://herdling.zog-tech.com/install.sh. Read it before you run it, if you like. It does this:

1. It finds your system: macOS or Linux, on arm64 or x86_64. Windows is not supported.
2. It checks that herdr is installed. It does not install herdr.
3. It downloads the newest herdlingd release from https://github.com/zog-tech/herdling/releases and compares its SHA-256 with the `SHA256SUMS` file of the release.
4. It runs `herdlingd install` (see below) and prints the version.

It never uses sudo. Run it again to update or repair herdlingd. To install one version, add `--version`: `curl -fsSL https://herdling.zog-tech.com/install.sh | sh -s -- --version 0.1.0`.

### Build from source

You need:

- **git**.
- **A C compiler.** On macOS, run `xcode-select --install`. On Debian and Ubuntu, run `sudo apt install build-essential`.
- **Rust (stable).** The easy way is rustup (https://rustup.rs):

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Open a new terminal after rustup finishes, so that `cargo` is on your PATH. Then build and install herdlingd:

```sh
git clone https://github.com/zog-tech/herdling
cd herdling/companion
cargo build --release
./target/release/herdlingd install
```

The first build downloads and compiles the dependencies, so it takes a while. The program is `target/release/herdlingd`.

### What herdlingd install does

All three ways end with `herdlingd install`. It does this:

1. It copies the program to `~/.local/bin/herdlingd`.
2. It registers a background service for your user that runs `herdlingd serve`:
   - **macOS:** a launchd agent with the label `com.zogtech.herdlingd`, in `~/Library/LaunchAgents/com.zogtech.herdlingd.plist`. Its log is `~/Library/Logs/herdlingd.log`.
   - **Linux:** a systemd user service, `herdlingd.service`, in `~/.config/systemd/user/herdlingd.service`.
3. It starts the service (or restarts it, if it was running).
4. On Linux, if your user has no "linger", it prints a command to keep the service running after you log out: `sudo loginctl enable-linger <your user>`. Run it.
5. It prints the next step: `herdlingd pair`.

To see what it would do without a change to the service, run `herdlingd install --dry-run`.

The service needs no root rights. It runs as your user. herdr must be installed, and it must run when you use Herdling: herdlingd reads its socket (see step 1). Then go to step 4 and run `herdlingd pair`. If `herdlingd` is not found, add `~/.local/bin` to your PATH, or run `~/.local/bin/herdlingd pair`.

### Check that herdlingd runs

```sh
# macOS
launchctl print gui/$(id -u)/com.zogtech.herdlingd | head -20

# Linux
systemctl --user status herdlingd.service
```

## 4. Pair your phone

Pairing gives your phone its own SSH key on the computer. The key can only run `herdlingd rpc`, nothing else.

On the computer, run:

```sh
herdlingd pair
```

It shows:

- a **six-digit code**, in large digits;
- the computer's **host key fingerprint** (`SHA256:...`);
- the computer's address and the pairing port (7790 by default);
- a **QR code** that holds a `herdling://pair` link.

The pairing window stays open for 5 minutes. A code works once. After 5 wrong codes the window closes. Press Ctrl-C to close it early. When the phone pairs, the command prints `Paired <phone name>` and ends.

Keep the phone on the same network as the computer while you pair. Then use one of these ways in the app (Settings > Hosts > **Add host**):

- **Scan the QR code.** Tap **Add by address**, then **Scan QR**, and point the camera at the code. The app checks that the computer's host key matches the key in the QR code.
- **Pick the computer from the list.** Under **On this network**, the app lists the computers that run herdlingd (it finds them with Bonjour, `_herdling._tcp`). Tap one and type the code.
- **Type the address and the code.** Tap **Add by address**, type the computer's IP address or `.local` name and the six-digit code, then tap **Pair**.

<!-- shot: pair -->

When you type the code, the app shows the host key in a **Check the host key** alert. Compare it with the key that `herdlingd pair` printed, then tap **It matches**.

The QR code holds a link of this form: `herdling://pair?h=<address>&p=<port>&c=<code>&f=<fingerprint>`. Opening such a link on the phone also opens the pairing screen.

### Other ways to add a computer

- **Set up with password.** For a computer that you reach over a VPN, or when pairing on the local network does not work. Enter the host, the SSH port (22), your user name and your SSH password, then tap **Connect**. The app first shows the host key for you to check (on the computer, `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub` prints it). Then it logs in once, runs `herdlingd enroll` to add the phone's restricted key, and forgets the password. When herdlingd is not installed, the app offers to install it first (see step 3, "In the app").
- **Add manually.** Enter the SSH details yourself. The Edit host screen shows a card, **Authorize this phone**, with the phone's public key and the command. Add one line to `~/.ssh/authorized_keys` on the computer that limits the key to `herdlingd rpc`:

```text
command="<full path to herdlingd> rpc",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 <phone public key> herdling:<phone name>
```

When pairing is done, the computer and its agents show on the **Overview** tab.

## 5. Use Herdling

The app has four tabs: **Overview**, **Usage**, **Automations** and **Settings**.

### Overview: the board of agents

One board shows the agents on all of your computers. Each agent shows its status as a dot and a word:

- **Needs you** (ember): the agent waits for your answer, for example a permission question. These rows come first.
- **Ready**: the agent finished, and you did not look yet.
- **Working** (gold): the agent works now.
- **Idle**: finished and seen, or unknown.

The top shows a count and a summary. Filter chips show **All** or one group. The header button opens **Group by**: **Status**, **Host** or **Workspace**. At the bottom, each computer shows CPU and memory.

On a row:

- **Tap** to open the session.
- **Long press** to open **Peek**: the last reply, the answer buttons when the agent asks something, and a message box. **Open** goes to the full session. Closing Peek marks the agent as seen.
- **Swipe right** to mark it read. **Swipe left** for **Reply** and **Restart**.
- The **...** button has **Reply**, **Peek**, **Mark read**, **Rename** (session, tab or workspace, if the computer supports it) and **Restart**. Restart starts a new agent in a new tab and closes the old pane.

### The session: chat view and terminal

Open an agent to see its session. The toggle at the top switches between:

- **Thread** (the chat view): the session as a chat, with formatted replies, tool calls and subagents. Swipe left or right to move to the next agent in the same workspace. If the agent has no conversation log, Herdling shows the terminal.
- **Terminal**: the live terminal of the pane. A key bar has **Esc**, **Tab**, **Ctrl-C**, the arrow keys and **Enter**. Type a line and tap **Send line**. Choose **Fit to screen**, **Wrap lines** or **Scroll sideways** for wide output. Use Esc or Ctrl-C to interrupt an agent.

The message box at the bottom ("Message the agent"):

- **Send text.** The box grows to 5 lines.
- **Answer questions.** When an agent asks a numbered question (for example a permission prompt), one button shows for each choice. Tap a choice to answer.
- **Attach photos.** Tap **+**, then **Photos**, or long-press the box and paste an image. Up to 4 photos. The photos go to the computer, and their paths go at the end of your message, so the agent can read them.
- **Commands and skills.** Type `/` as the first character to see the agent's commands. For Codex, type `$` for skills. For OpenCode, type `@` for skills. Or tap **+**, then **Commands & skills**.
- **Speak.** Tap the mic to record and tap again to stop, or hold the mic and release. Slide away to cancel. The text goes into the box. Herdling does not send it until you tap send.

The header has a speaker button (**Speak replies**) and a **...** menu: **Restart**, **Resume older session**, rename, and **Close** (stops the agent and closes its pane).

### Which agents work with what

| Agent | Chat view | `/` commands | `$` | `@` | Resume older session |
|---|---|---|---|---|---|
| Claude Code | Yes | Built-in commands, your user and project commands and skills, plugin commands | No | No | Yes |
| Codex | Yes | Built-in commands, custom prompts (`prompts:<name>`) | Skills | No | Yes |
| Pi | Yes | Built-in commands, skills (`skill:<name>`), prompt templates | No | No | Yes |
| OpenCode | Yes | Built-in commands, command files, commands in `opencode.json` | No | Skills | Yes |
| omp (oh-my-pi) | Yes | No | No | No | Yes |
| Gemini CLI | Yes | No | No | No | Yes |
| Other agents in herdr (Amp and more) | Terminal only | No | No | No | No |

Every agent gets the board status, the terminal, notifications and voice input.

### Start new work

Tap **+** on the Overview tab to start a new session:

1. Choose the **host** (computer).
2. Choose the **folder**: a recent one, or **Browse**.
3. If a herdr workspace already uses the folder, choose **New tab in <workspace>** or **New workspace**.
4. Choose the **agent**: claude, codex, pi, gemini, opencode, amp, or **More**.
5. Optional: type or speak a **first prompt**.
6. Tap **Start**.

To continue an earlier conversation, open a session, tap **...**, then **Resume older session**, and pick one. It opens in a new tab.

### Usage

The Usage tab shows how much of your plan is left, for each computer:

- **Claude**: the 5-hour, 7-day and 7-day Opus windows. herdlingd reads the login that Claude Code saved on the computer (the macOS keychain item "Claude Code-credentials", or `~/.claude/.credentials.json`).
- **Codex**: the 5-hour and 7-day windows, from `~/.codex/auth.json`.

herdlingd only reads these logins. It never changes them and never sends them to the phone. If a meter says the token expired, open the CLI on the computer once.

### Automations

The Automations tab shows the automations of `herdr-automate`, if it is installed on the computer (on the PATH, in `~/.local/bin` or in `~/.cargo/bin`). You see each automation, its schedule and its last runs, and you can review and approve an automation that needs approval. Herdling does not define automations itself.

### Notifications

Herdling sends a notification when an agent:

- **finished** its turn (working to idle or done), or
- **needs you** (it waits for your input).

herdlingd waits 5 seconds before it sends, so a quick status change does not send a notification. Tap a notification to open that session.

**Quiet at the computer** (on by default): no notifications while you use herdr on the computer, and for 5 minutes after your last activity there (focus changes and typing in herdr). A message that you send from the phone does not count as activity at the computer.

What must be true for notifications to arrive:

- Notifications are allowed for Herdling in the phone's settings.
- The phone connected to the computer at least once after you allowed notifications (the app registers its push token then).
- `herdlingd serve` runs on the computer (the service that `herdlingd install` sets up).
- The computer has an internet connection. It sends each notification through Expo's push service to Apple or Google.

## 6. Settings

<!-- shot: settings -->

### Hosts

Each computer shows its status: **Online**, **Connecting** or **Offline**. Tap a computer to edit its **Name**, **Address**, **Port**, **User** and **Command** (default `herdlingd rpc`), and tap **Test connection**. To use a computer away from home, change its address to the VPN address (for example its Tailscale address).

To remove a computer, open it and tap the trash button. The app deletes the computer and its pinned key from the phone. If the computer is online, it also forgets the phone's key.

### Notifications

| Switch | Default | Meaning |
|---|---|---|
| Finished | On | A notification when an agent finished its turn. |
| Needs you | On | A notification when an agent waits for your input. |
| Quiet at the computer | On | No notifications while you use herdr on the computer, until 5 minutes after your last activity. |

These switches are saved on each computer (in its config file) when the phone connects.

### Voice

| Setting | Default | Meaning |
|---|---|---|
| Speak replies | Off | Read replies aloud in new sessions. Each session also has its own speaker button. |
| What to read | Full text | **Full text** or **Summary**. A summary comes from the phone (Apple Intelligence, iOS 26 and later), then from the computer's `summary_command`, then falls back to the full text. |
| Voice engine | iPhone (Phone on Android) | **iPhone/Phone** uses the phone's voices. **Host** uses the computer's `tts_command`, and falls back to the phone's voice if it fails. |
| Voice | System default | The phone voice to use. |
| Speed | 1.0x | 0.5x to 2.0x. Applies to host audio too. |
| Test voice | | Plays a short sample. |
| Speech log | | The last 20 speech and voice input events. Use it when a reply stays silent. |

### Voice input

| Setting | Default | Meaning |
|---|---|---|
| Engine | Parakeet if a model is downloaded, else Apple | **Parakeet** (iPhone only, on the device), **Host** (the computer's `stt_command`), **Apple** (Apple speech recognition) or **Android** (the system speech service). If the chosen engine fails, the app tries the next one. |
| Parakeet models | None | **English (Parakeet v2)**, about 465 MB, or **Multilingual (Parakeet v3)**, 25 European languages, about 485 MB. Tap Download. The model runs fully on the phone. |
| Download over cellular | Off | Off: models download on Wi-Fi only. |

### Feel

| Setting | Default | Meaning |
|---|---|---|
| Haptics | On | Taps you feel for send, approve, peek and status changes. |

## 7. The config file

herdlingd keeps its settings in `~/.config/herdling/config.toml` (folder mode 0700, file mode 0600). A missing file means all defaults. herdlingd and the app write the device entries. You can edit the top-level keys by hand. After a change to `pair_port` or `ssh_port`, restart the service (run `herdlingd install` again). The command keys take effect the next time the app connects.

### Top-level keys

| Key | Type | Default | Meaning |
|---|---|---|---|
| `pair_port` | number | `7790` | The TCP port where `herdlingd serve` listens for pairing requests (`POST /pair`). It also goes into the QR code and the Bonjour advert. |
| `ssh_port` | number | `22` | The SSH port of this computer, as the app should use it. herdlingd does not listen on it. It tells the app (in the Bonjour advert and the pairing reply). Set it when your SSH server uses another port. |
| `tts_command` | array of strings | not set | The program that makes speech audio, for the **Host** voice engine. Not set or empty: no host voice. |
| `stt_command` | array of strings | not set | The program that makes text from a recording, for the **Host** voice input engine. Not set or empty: no host speech input. |
| `summary_command` | array of strings | not set | The program that makes a short summary of a reply, for **What to read: Summary**. Not set or empty: no host summary. |

Each command is an argv array: the first item is the program, the other items are its arguments. herdlingd runs it with no shell, so `~`, `$VAR` and pipes do not work. Use absolute paths, or a small wrapper script. The PATH is short, because the app reaches herdlingd through an SSH forced command.

### Device entries (written by herdlingd and the app)

Each paired phone has a `[[devices]]` entry. Do not edit these by hand; use the app.

| Key | Meaning |
|---|---|
| `id` | A random device ID that the app made. |
| `name` | The phone's name, as the phone reports it. |
| `host_id` | The ID that the app uses for this computer. |
| `public_key` | The phone's SSH public key (ed25519). |
| `expo_token` | The phone's push token, for notifications. |
| `prefs.finished` | The **Finished** switch. Default `true`. |
| `prefs.needs_you` | The **Needs you** switch. Default `true`. |
| `prefs.quiet_at_desk` | The **Quiet at the computer** switch. Default `true`. |

### Example

```toml
pair_port = 7790
ssh_port = 22
tts_command = ["/usr/local/bin/herdling-tts"]
stt_command = ["/usr/local/bin/herdling-stt"]
summary_command = ["/usr/local/bin/ollama", "run", "llama3.2"]
```

### Other files

| Path | What |
|---|---|
| `~/.local/bin/herdlingd` | The program. |
| `~/.config/herdling/config.toml` | The config file. |
| `~/.config/herdling/pair.json` | The open pairing window (only while `herdlingd pair` runs). |
| `~/.ssh/authorized_keys` | One line per paired phone, ending in `herdling:<phone name>`, limited to `herdlingd rpc`. |
| `~/.cache/herdling/uploads/` | Photos and files that you attach. Deleted after 7 days. Maximum 25 MB each (10 MB with an older herdlingd). |
| `~/Library/LaunchAgents/com.zogtech.herdlingd.plist` | The macOS service. |
| `~/Library/Logs/herdlingd.log` | The macOS service log. |
| `~/.config/systemd/user/herdlingd.service` | The Linux service. Log: `journalctl --user -u herdlingd.service`. |

## 8. Voice on your computer

Herdling ships no AI service. By default, speech uses the phone. You can let your computer do the work with three optional commands in the config file. Any program that reads stdin and writes stdout works.

| Key | stdin | stdout | Time limit |
|---|---|---|---|
| `tts_command` | Plain text, one sentence or more, up to 8,000 characters | Audio, up to 10 MB: WAV or MP3 (Ogg may not play on iPhone) | 30 s |
| `stt_command` | WAV audio (16-bit PCM, 16 kHz, mono), up to 25 MB | The text, up to 64 KB | 120 s |
| `summary_command` | One line of instructions, a blank line, then the reply (the last 24,000 characters) | The summary as plain text, up to 16 KB | 20 s |

If a command fails or times out, the app falls back: to the phone's voice, to the next voice input engine, or to the full text.

### Example: a local TTS server

With a Kokoro-FastAPI server (an OpenAI-compatible speech endpoint) on port 8880, save this wrapper as `/usr/local/bin/herdling-tts` and make it executable (`chmod +x`):

```sh
#!/bin/sh
# Reads text on stdin, writes WAV on stdout.
jq -Rs '{model: "kokoro", voice: "af_heart", response_format: "wav", input: .}' |
  curl -sf http://127.0.0.1:8880/v1/audio/speech -H 'Content-Type: application/json' --data-binary @-
```

Then add to `~/.config/herdling/config.toml`:

```toml
tts_command = ["/usr/local/bin/herdling-tts"]
```

Piper also works directly: `tts_command = ["/usr/local/bin/piper", "--model", "/opt/piper/en_US-lessac-medium.onnx", "--output_file", "-"]`.

In the app, set Settings > Voice > **Voice engine** to **Host**, and tap **Test voice**.

### Example: speech to text with whisper.cpp

Save as `/usr/local/bin/herdling-stt` and make it executable:

```sh
#!/bin/sh
# Reads WAV on stdin, writes text on stdout.
dir=$(mktemp -d) || exit 1
trap 'rm -rf "$dir"' EXIT
cat > "$dir/in.wav"
/opt/whisper.cpp/build/bin/whisper-cli -m /opt/whisper.cpp/models/ggml-base.en.bin -f "$dir/in.wav" -nt -np 2>/dev/null
```

```toml
stt_command = ["/usr/local/bin/herdling-stt"]
```

On a Mac with Apple silicon, `parakeet-mlx` (install with `uv tool install parakeet-mlx`) works the same way through a wrapper that writes stdin to a file. In the app, set Settings > Voice input > **Engine** to **Host**.

### Example: summaries

Any command-line model works, for example:

```toml
summary_command = ["/usr/local/bin/ollama", "run", "llama3.2"]
```

Claude Code in print mode (`["<path to claude>", "-p"]`) and the `llm` CLI also work. In the app, set Settings > Voice > **What to read** to **Summary**.

## 9. Troubleshooting

### The computer shows Offline

- Check that the computer is on and that the phone can reach it (same Wi-Fi, or the VPN is on).
- Check that SSH works: Remote Login on macOS, `sshd` on Linux.
- If the computer got a new IP address, edit the host in Settings > Hosts and change the **Address**. A fixed address or a `.local` name avoids this.
- Away from home, use the computer's VPN address.
- Tap **Retry** on the board, or **Test connection** in Edit host.

### The app cannot find my computer

- Check that herdlingd runs (see "Check that herdlingd runs" above). Run `herdlingd install` again; it restarts the service.
- Keep the phone and the computer on the same network.
- Allow local network access for Herdling. On iPhone: Settings > Herdling > **Local Network**. The app shows "Local network access is off" with an **Open Settings** button when it is off.
- Some networks block Bonjour (guest Wi-Fi, some mesh systems). Use **Add by address** with the IP address and the code.

### Pairing fails

- "No pairing window": run `herdlingd pair` again. The window lasts 5 minutes.
- "Wrong code": check the six digits. After 5 wrong codes, run `herdlingd pair` again.
- "Can't reach <address>:7790": `herdlingd serve` does not run, or a firewall blocks the port. Allow TCP port 7790 (or your `pair_port`) on your local network. On macOS, allow herdlingd in System Settings > Network > Firewall if asked.
- "The host key is not the one in the QR code": stop. Someone on the network may intercept the pairing. Pair on a network you trust.
- `herdlingd pair` prints "serve is not running": run `herdlingd install`.

### The SSH port is not 22

Set `ssh_port` in `~/.config/herdling/config.toml` and run `herdlingd install` again. For a computer that you already added, change the **Port** in Settings > Hosts.

### "Update available" or "Update herdlingd on this host for all features"

The computer runs an older herdlingd. Update it (step 10). Features that the old version lacks stay hidden until then.

### "herdlingd is not on this computer"

Shown by **Set up with password**. Tap **Install and pair** to install it from the app, or install it yourself (step 3) and try again.

### The install from the app fails

The app shows the reason:

- **herdr is not installed.** Install herdr (https://herdr.dev), then try again.
- **Neither curl nor wget is installed.** Install one of them on the computer.
- **Cannot download.** The computer needs internet access to github.com. Check the network, a proxy or a firewall.
- **Windows is not supported.** herdlingd runs on macOS and Linux.
- **herdlingd install failed.** On macOS, log in to the desktop of the Mac once: launchd needs a desktop session for the user service. On Linux, check `systemctl --user status`.

### "Can't read herdr"

herdr does not run on the computer, or herdlingd cannot reach its socket. Start herdr. If herdr uses a custom socket, set `HERDR_SOCKET` for the service.

### No notifications

- Allow notifications for Herdling in the phone's settings.
- Check the **Finished** and **Needs you** switches in Settings > Notifications.
- If **Quiet at the computer** is on, notifications wait until 5 minutes after your last activity in herdr.
- Open the app once with the computer online, so it registers the push token.
- The computer needs internet access.

### Voice does not work

- Allow microphone and speech recognition for Herdling in the phone's settings.
- For a **Host** engine: check that the command key is set, that the path is absolute, and that the program runs from a terminal with input on stdin. Open Settings > Voice > **Speech log** to see the error: `no_command`, `command_failed`, `timeout` or `upstream_error` (the command wrote nothing).

### Usage shows "Not logged in" or "token expired"

Log in to Claude Code or Codex on that computer, or open the CLI once so it refreshes its login.

## 10. Update herdlingd

When a new herdlingd is out, the app shows **Update available: 0.1.0 → 0.2.0** on the computer in Settings > Hosts, and one quiet line on the Overview. The app asks each computer at most once a day.

- **From the app.** Open the computer in Settings > Hosts and tap **Update herdlingd**. The app shows the release notes. herdlingd downloads the new release from GitHub, checks its SHA-256, replaces its own program and restarts its service. The app then connects again and shows the new version.
- **An older herdlingd** cannot update itself. The app shows **Update herdlingd: sign in once with your password**. It logs in once with your SSH password and runs the one-line installer.
- **On the computer:** run `herdlingd update`. `herdlingd update --check` only shows if there is a new version. `herdlingd version` prints the installed version.
- **The one-line installer:** run it again.
- **From source:** pull the new source, build again and run `install`:

```sh
cd herdling
git pull
cd companion
cargo build --release
./target/release/herdlingd install
```

An update keeps your config and paired phones. A downgrade needs `herdlingd update --version X.Y.Z --allow-downgrade`.

## 11. Uninstall

### Remove a phone from a computer

In the app: Settings > Hosts > the computer > trash button. If the computer is online, it forgets the phone's key.

### Remove herdlingd from a computer

macOS:

```sh
launchctl bootout gui/$(id -u)/com.zogtech.herdlingd
rm ~/Library/LaunchAgents/com.zogtech.herdlingd.plist
rm ~/.local/bin/herdlingd
```

Linux:

```sh
systemctl --user disable --now herdlingd.service
rm ~/.config/systemd/user/herdlingd.service
systemctl --user daemon-reload
rm ~/.local/bin/herdlingd
```

Then, on both, remove the phone keys and the data:

```sh
sed -i.bak '/ herdling:/d' ~/.ssh/authorized_keys
rm -rf ~/.config/herdling ~/.cache/herdling
```

The `sed` command keeps a copy of the old file as `~/.ssh/authorized_keys.bak`.

### Remove the app

Delete Herdling from the phone. On iPhone, the system can keep the app's Keychain entry until you reset the phone.

## 12. Privacy in short

- No account, no analytics, no ads, no tracking.
- The phone connects straight to your computers over SSH. Sessions, prompts, photos and recordings never pass through Zog Tech.
- The SSH key is made on the phone. The private key stays in the iOS Keychain or the Android Keystore.
- Notifications go from your computer through Expo's push service to Apple or Google. They hold the agent's name, its kind, its terminal title and internal IDs, not your prompts or the replies.

Full policy: https://herdling.zog-tech.com/privacy

## Contact

Write to admin@zog-tech.com. Tell us your phone model, your computer's system and what you tried.
