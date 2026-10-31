# Download Herdling

> Get the Herdling app for iPhone or Android, and the free herdlingd companion for each Mac or Linux computer that runs your agents.

Web version: https://herdling.zog-tech.com/download

## The app

- **iPhone:** coming soon to the App Store. Needs iOS 17 or later.
- **Android:** coming soon to Google Play. Needs Android 8.0 or later.

The app is free, with no account, no ads and no tracking.

## herdlingd for your computer

herdlingd is the free companion that runs on each computer next to herdr. It runs on macOS and Linux, as your user, as a background service.

Before you install it, the computer needs:

- herdr (https://herdr.dev), with your agents running in it;
- an SSH server: on macOS, System Settings > General > Sharing > Remote Login; on Linux, the OpenSSH server.

### The one-line installer (coming soon)

```sh
curl -fsSL https://releases.zog-tech.com/herdlingd/install.sh | sh
```

The installer is not live yet. Until it is, write to admin@zog-tech.com and we send you a herdlingd build for your system.

### Install a build by hand

```sh
chmod +x ./herdlingd
./herdlingd install
herdlingd pair
```

`herdlingd install` copies the program to `~/.local/bin/herdlingd` and starts it as a user service: the launchd agent `com.zogtech.herdlingd` on macOS, the systemd user service `herdlingd.service` on Linux. On Linux it can ask you to run `sudo loginctl enable-linger <user>` so the service keeps running after you log out.

`herdlingd pair` shows a QR code. Scan it in the app (Settings > Hosts > Add host).

The full guide: https://herdling.zog-tech.com/docs.md
