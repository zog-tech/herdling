# Herdling privacy policy

> How the Herdling app and the herdlingd companion handle your information. Short version: your phone talks only to your own computers, and Zog Tech collects no data.

Web version: https://herdling.zog-tech.com/privacy

**Effective date:** October 31, 2026

This policy explains how the Herdling app for iPhone and Android handles your information. Herdling is made by Zog Tech, Inc. ("Zog Tech," "we," "us"). The short version: Herdling connects your phone to your own computers. Zog Tech does not run servers for Herdling, does not collect your data and cannot see your sessions.

## No account, no analytics, no ads

Herdling has no sign-up and no login. The app contains no analytics, no crash reporting service, no advertising and no tracking. We do not sell or share your data, because we do not have it.

## How Herdling works

Herdling works with herdr, a terminal program for AI coding agents. You install a companion program called herdlingd on your own computers. The app connects straight to those computers over SSH, on your network or through your own VPN. Everything you see and send in the app travels between your phone and your computer, encrypted by SSH. This includes agent sessions, terminal output, your prompts, photos you attach and voice recordings you choose to send to your computer. None of it passes through Zog Tech.

## What stays on your phone

Herdling keeps these items on your phone:

- The list of computers you added: their names, addresses, SSH user names and host key fingerprints.
- An SSH key that the app makes on your phone. The private key stays in the phone's secure storage (the iOS Keychain or the Android Keystore). It never leaves the phone. Only the public key goes to your computer.
- A random device ID that the app makes, so that your computer can tell your phones apart.
- Your settings, such as voice and notification choices.

If you add a computer by its SSH password, the app uses the password once to log in and add its key. The app does not save the password.

## What is kept on your computer

herdlingd runs on your computer, under your control. For each paired phone it keeps the device ID, the phone's name as the system reports it, the phone's public key, the phone's push token and your notification choices. It keeps these in `~/.config/herdling/config.toml`. Photos that you attach are saved in a cache folder on your computer so that your agent can read them. herdlingd deletes them after seven days.

Pairing sends one request on your local network from the phone to your computer. It contains the pairing code, the device ID, the phone's name and the public key. It contains no password and no private key.

## Push notifications

Notifications are optional. If you allow them, the app asks Expo's push service for a push token. Expo is the service that delivers notifications for apps built with the Expo tools. The app gives the token to your own computer over SSH. When an agent finishes or needs your input, herdlingd on your computer sends a message to Expo's push service. Expo passes it to Apple Push Notification service (on iPhone) or Firebase Cloud Messaging by Google (on Android), which shows it on your phone.

Each notification contains:

- a title with the agent's name, the pane's label or the workspace name, followed by "finished" or "needs you";
- a short text with the kind of agent (for example, "Claude Code") and the agent's terminal title, which can describe the current task;
- internal IDs of the computer and the pane, so that a tap opens the right session.

Expo, Apple and Google handle these messages to deliver them, under their own privacy policies. Zog Tech does not receive them. Notifications do not include the agent's replies or your prompts. You can turn notifications off in Herdling's Settings or in your phone's settings. When you remove a computer from the app, that computer forgets your phone's key.

## Voice input

The microphone is used only while you record with the mic button. You choose where your speech becomes text:

- **On the phone.** On iPhone, Herdling uses Apple's speech recognition. It runs on the device when your language supports it. If it does not, Apple may process the audio on its servers, under Apple's privacy policy. On iPhone you can also download a speech model (Parakeet) that runs fully on the device. The download comes from Hugging Face, a public model host. Your audio is not sent there. On Android, Herdling uses the speech recognition service of your phone's system, which may process audio on the device or on the provider's servers, under the provider's policy.
- **On your computer.** The app records the audio and sends it to your computer over SSH. herdlingd passes it to a speech program that you set up there.

## Read aloud

Herdling can read agent replies out loud. It uses the voices on your phone, or a speech program on your computer that you set up. On iPhone with Apple Intelligence, short summaries of replies are made on the device.

## App updates

Herdling can get small updates without a new store release. To do this, the app checks Expo's update service when it starts. The request includes technical details that are needed to choose the right update: the app version, the platform, the update channel and a random ID made by the update library. It does not include your sessions, your computers or any personal details.

## Usage meters

The Usage tab shows how much of your Claude or ChatGPT plan is left. To get these numbers, herdlingd on your computer asks Anthropic or OpenAI for your usage. It uses the login that the Claude Code or Codex program already saved on that computer. herdlingd only reads that login. It does not change it, and it does not send it to the phone or to us.

## Other services

The only outside services that the app or herdlingd contact are Expo (updates and notifications), Apple or Google (notification delivery and, if you use it, system speech recognition), Hugging Face (only if you download the optional speech model), and Anthropic or OpenAI (only from your computer, for the usage meters). Like any internet service, they see the IP address that a request comes from.

## Permissions

- **Camera:** to scan the pairing QR code. No pictures are saved.
- **Microphone and speech recognition:** for the mic button only.
- **Photos:** to attach photos that you pick to a prompt. The app sees only the photos you pick.
- **Local network:** to find and connect to your computers on your network.
- **Notifications:** to tell you when an agent finishes or needs you.

You can change each permission at any time in your phone's settings.

## Deleting your data

Zog Tech holds no data about you, so there is nothing for us to delete. To remove a computer, open Settings in the app, tap the computer and choose Remove. When the computer is online, it also forgets your phone. Deleting the app removes its data from your phone. On iPhone, the system can keep the app's Keychain entry after you delete the app, until you reset the phone. To remove everything from a computer, uninstall herdlingd and delete `~/.config/herdling` and `~/.cache/herdling`.

## Children

Herdling is a tool for software developers. It is not directed to children under 13, and we do not knowingly collect information from anyone.

## Changes to this policy

If the way Herdling handles data changes, we will update this page and change the effective date above.

## Contact

Questions about this policy can be sent to admin@zog-tech.com. Zog Tech, Inc. also has a [general privacy policy](https://zog-tech.com/privacy.html) for its website.
