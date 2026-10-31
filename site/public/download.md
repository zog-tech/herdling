# Download Herdling

> Get the Herdling app for iPhone or Android, and the free herdlingd companion for each Mac or Linux computer that runs your agents.

Web version: https://herdling.zog-tech.com/download

## The app

- **iPhone:** coming soon to the App Store. Needs iOS 17 or later.
- **Android:** coming soon to Google Play. Needs Android 8.0 or later.

The app is free, with no account, no ads and no tracking.

## herdlingd for your computer

herdlingd is the free companion that runs on each computer next to herdr. It runs on macOS and Linux, as your user, as a background service. Herdling is open source under the MPL-2.0 license: https://github.com/zog-tech/herdling

Before you start, check these on the computer:

- **herdr is installed and runs**, with your agents in it (herdlingd talks to the herdr socket). Install it with `curl -fsSL https://herdr.dev/install.sh | sh`, or let the app install it (below). Start it with `herdr` in a terminal.
- **SSH is on.** On macOS: System Settings > General > Sharing > **Remote Login** (it is off on a new Mac). On Linux: the OpenSSH server.
- **The phone can reach the computer:** the same network (Wi-Fi), or the same VPN.

herdlingd starts when you log in on the computer. To start it at boot, turn on automatic login on a Mac, or lingering on Linux (`sudo loginctl enable-linger $USER`). See "Start at boot" in the guide: https://herdling.zog-tech.com/docs.md

### Set it up from the app (recommended)

In Herdling, tap Settings > Hosts > Add host > **Set up with password**. Enter the address of the computer, your user name and your SSH password. When herdlingd is missing, the app offers **Install and pair**: it runs the one-line installer over SSH, then pairs. When herdr is missing too, the app asks before it installs herdr (**Install herdr and herdlingd**). No terminal and no admin rights. The app uses the password once and does not keep it. This works after the first herdlingd release. Until then, build from source.

### The one-line installer

```sh
curl -fsSL https://herdling.zog-tech.com/install.sh | sh
```

It downloads herdlingd for your system from the GitHub release, checks its SHA-256, copies it to `~/.local/bin` and starts the user service. It does not use sudo. Install herdr first, or add `--with-herdr` to run the official herdr installer first: `curl -fsSL https://herdling.zog-tech.com/install.sh | sh -s -- --with-herdr`. The installer works after the first herdlingd release. Until then, build from source as below.

### Build from source

You need git, a C compiler (macOS: `xcode-select --install`; Debian and Ubuntu: `sudo apt install build-essential`) and Rust (stable), for example from rustup:

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

Open a new terminal. Then:

```sh
git clone https://github.com/zog-tech/herdling
cd herdling/companion
cargo build --release
./target/release/herdlingd install
herdlingd pair
```

`herdlingd install` copies the program to `~/.local/bin/herdlingd` and starts it as a user service: the launchd agent `com.zogtech.herdlingd` on macOS, the systemd user service `herdlingd.service` on Linux. On Linux it can ask you to run `sudo loginctl enable-linger <user>` so the service keeps running after you log out. If `herdlingd` is not found, add `~/.local/bin` to your PATH.

`herdlingd pair` shows a QR code. Scan it in the app (Settings > Hosts > Add host).

### Update

The app shows **Update available** when a new herdlingd is out. Tap **Update herdlingd** on the host screen. On the computer, `herdlingd update` does the same. From source: `git pull`, then `cargo build --release` and `./target/release/herdlingd install` in `companion`. Your config and paired phones stay.

## Source code

The source code of the app and herdlingd is at https://github.com/zog-tech/herdling (MPL-2.0). Report a problem: https://github.com/zog-tech/herdling/issues

The full guide: https://herdling.zog-tech.com/docs.md
