# Herdling support

> Answers to common questions about Herdling and herdlingd, and how to contact us.

Web version: https://herdling.zog-tech.com/support

The step-by-step guide is at https://herdling.zog-tech.com/docs.md. It covers install, pairing, every feature and setting, the config file, voice, troubleshooting and uninstall.

## Contact

Herdling is open source. The code is at https://github.com/zog-tech/herdling.

- **Bugs and feature requests:** open an issue at https://github.com/zog-tech/herdling/issues
- **Questions and ideas:** start a discussion at https://github.com/zog-tech/herdling/discussions
- **Security problems:** do not use a public issue. Use private vulnerability reporting on GitHub (https://github.com/zog-tech/herdling/security/advisories/new) or read https://github.com/zog-tech/herdling/blob/main/SECURITY.md
- **Anything else:** write to admin@zog-tech.com.

Please tell us your phone model, your computer's system and what you tried.

## Questions and answers

### What is herdlingd?

herdlingd is the companion program for Herdling. It runs on your computer next to herdr. When the app connects over SSH, herdlingd answers its questions: which agents run, what they said and how much usage is left. It also pairs phones and sends the notifications. herdlingd only accepts the keys of phones that you paired, and those keys can only run `herdlingd rpc`.

### Do I need an account?

No. There is no sign-up and no login. You pair each phone with each computer directly.

### How do I set it up?

Install herdr, turn on SSH, then build herdlingd from source (https://github.com/zog-tech/herdling) and run `herdlingd install`. Run `herdlingd pair` and scan the QR code in the app (Settings > Hosts > Add host). The guide has each step: https://herdling.zog-tech.com/docs.md

### What must be ready before I start?

Three things on each computer: herdr is installed and runs (start it with `herdr` in a terminal); SSH is on (on a Mac: System Settings > General > Sharing > Remote Login, which is off on a new Mac); and the phone can reach the computer (the same Wi-Fi, or the same VPN). If herdr is missing, the app can install it with its official installer when you set up the computer with its SSH password.

### The app cannot connect: "Can't reach <address>:22".

SSH is off on the computer, or the phone is on another network. Tap **Turn on SSH on the computer** in the app for the steps. On a Mac: System Settings > General > Sharing, turn on **Remote Login**. On Linux: install and start the OpenSSH server (`sudo apt install openssh-server`, then `sudo systemctl enable --now ssh` on Debian and Ubuntu). Then tap **Done, check again**.

### The computer shows "herdr is not running".

herdlingd runs, but herdr does not. Open a terminal on that computer and run `herdr`. You can close the window after: herdr keeps running in the background. herdr does not start by itself after a restart.

### The computer is offline after a restart.

herdlingd starts when you log in on the computer. Log in once, or make it start at boot: on a Mac, turn on automatic login (System Settings > Users & Groups > Automatically log in as; not possible while FileVault is on). On Linux, run `sudo loginctl enable-linger $USER` once. The app shows a guide: tap **How to start at boot** on the computer in Settings > Hosts. Details: "Start at boot" in https://herdling.zog-tech.com/docs.md

### Can I use Herdling away from home?

Yes, if your phone can reach your computer. Use a VPN to your home network, such as WireGuard or Tailscale, and set the computer's address in Settings > Hosts to its VPN address. You can also add a computer with **Set up with password**, which works well over a VPN.

### Herdling cannot find my computer.

Check that herdlingd runs: on the computer, run `herdlingd install` again. It restarts the service. Check that your phone and your computer are on the same network, and that Herdling has local network access (on iPhone: Settings > Herdling > Local Network). If automatic discovery does not work on your network, tap **Add by address** and type the computer's IP address or `.local` name and the pairing code.

### Pairing fails or the code does not work.

The pairing code works once and only for 5 minutes. Run `herdlingd pair` again to get a new code. A firewall on the computer can block the pairing port (7790 by default) or SSH (port 22). Allow both on your local network. If your SSH server uses another port, set `ssh_port` in `~/.config/herdling/config.toml`.

### The app says to update herdlingd.

Update herdlingd (`git pull`, `cargo build --release` in the `companion` folder) and run `herdlingd install` again. Some features, such as automations and renames, need a recent version.

### I do not get notifications.

Allow notifications for Herdling in your phone's settings. In Herdling, open Settings and check the **Finished** and **Needs you** switches. If **Quiet at the computer** is on, Herdling stays silent while you are active in herdr at your computer and for 5 minutes after. Your computer needs an internet connection to send a notification.

### Voice input or read aloud does not work.

Allow microphone and speech recognition access for Herdling in your phone's settings. Voice input can run on your phone or on your computer. To use your computer, set `stt_command` (speech to text) or `tts_command` (text to speech) in `~/.config/herdling/config.toml`. Settings > Voice > Speech log shows the last errors.

### How do I remove a phone or a computer?

In Herdling, open Settings, tap the computer and tap the trash button. If the computer is online, it also forgets your phone's key. To stop all access, uninstall herdlingd from the computer (the guide has the commands).

### How much does it cost?

Herdling and herdlingd are free. There are no in-app purchases and no ads.

### Is my data safe?

Your phone talks only to your computers, over SSH. Zog Tech runs no server for Herdling and keeps no copy of your data. Read the privacy policy: https://herdling.zog-tech.com/privacy.md
