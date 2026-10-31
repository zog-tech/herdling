# Herdling: Google Play Console metadata

Package `com.zogtech.herdling`. Version 1.0.0. Paste each field as written. Counts are at the end of `store/checklist.md` and come from `python3 store/check_limits.py`.

## Store listing

- **App name** (max 30): `Herdling`
- **Category:** Applications > Tools
- **Tags:** Developer tools, Productivity (choose the closest Play tags)
- **Contact email:** admin@zog-tech.com
- **Website:** https://herdling.zog-tech.com/
- **Privacy policy URL:** https://herdling.zog-tech.com/privacy
- **Price:** Free. No in-app purchases.
- **Contains ads:** No

### Short description (max 80)

```
Follow and answer the AI coding agents on your own computers, from your phone.
```

### Full description (max 4000)

```
Herdling is a phone app for herdr, the terminal workspace for AI coding agents. Your agents keep working when you leave your desk. Herdling lets you follow them and answer them from anywhere your phone can reach your computers.

SEE EVERY AGENT
One board shows the agents on all of your computers. Each agent shows if it is working, done or waiting for you. The ones that need an answer come first. Usage meters show how much of your plan is left, and each computer shows its CPU and memory.

READ AND REPLY
Open an agent to read its session as a clean chat, with formatted replies, tool calls and subagents. Switch to the live terminal with one tap. Type a reply, answer a question, attach a photo or speak your prompt.

START NEW WORK
Start a new agent session in any folder on any computer. Resume an earlier session. Run saved automations.

GET A PING
Herdling sends a notification when an agent finishes or needs your input. Tap it to open that session. Herdling can stay quiet while you are active at your computer.

TALK AND LISTEN
Tap the mic to speak a prompt. Speech can turn into text on your phone or on your own computer. Herdling can also read replies out loud, in full or as a short summary.

WORKS WITH YOUR AGENTS
Herdling works with the agents that herdr runs, such as Claude Code, Codex, Pi and OpenCode.

PRIVATE BY DESIGN
Herdling connects straight to your own computers over SSH. Your sessions, prompts, photos and recordings go from your phone to your computer and back, and never pass through our servers. We run none. The SSH key is made on your phone and protected by the Android Keystore. There is no account, no analytics, no ads and no tracking.

WHAT YOU NEED
- One or more Mac or Linux computers that run herdr.
- The free herdlingd companion on each computer. Setup takes a few minutes: install it, run "herdlingd pair" and scan the QR code.
- A network path from your phone to your computers, such as your home Wi-Fi or a VPN.

Setup guide and support: herdling.zog-tech.com/docs

Herdling is not made by or affiliated with the makers of herdr, Claude Code, Codex, Pi or OpenCode.
```

## Data safety form

Play counts data as "collected" when the app sends it off the device. These do not count: data sent end-to-end encrypted so that only the sender and the recipient can read it, data processed only in memory to serve a request (ephemeral), and data processed only on the device.

**Section: Data collection and security**

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **No** |

When the answer is No, Play skips the per-type questions and the "encrypted in transit" and deletion questions. The label then shows "No data collected" and "No data shared with third parties". Keep the reasoning below for the review file and for the deletion questions if Play asks them anyway.

Why "No" is accurate:

1. **Session content, prompts, photos, audio, terminal output.** These go over SSH from the phone to the user's own computer. SSH encrypts them end to end; only the phone and the user's computer can read them. Zog Tech runs no server and receives nothing.
2. **No SDKs that collect data.** No analytics, crash reporting, ads or tracking libraries in `app/package.json`. Firebase is used only as the FCM transport for notifications (once set up), with no Firebase Analytics.
3. **Push token and notification content.** The app gets an Expo push token (it wraps the FCM token) and sends it only to the user's own computer over SSH. herdlingd on that computer sends each notification through the Expo push service to FCM. The developer's code on the phone does not send notification content anywhere. Expo and Google handle it only to deliver the notification. The message holds a title (agent or workspace name plus "finished" or "needs you"), a body (agent kind and terminal title) and two internal IDs.
4. **Over-the-air updates.** The app asks Expo's update server for an update with technical details only (app version, runtime version, platform, channel, a random client ID). No user data.
5. **Voice input on the phone.** Uses Android's system `SpeechRecognizer`. The system speech service handles the audio, not the app's own servers.
6. **Pairing.** One request on the local network from the phone to the user's own computer (pairing code, device ID, device name, public key). It never leaves the user's network and never reaches the developer.

Conservative alternative (only if the maintainer prefers it): declare **Device or other IDs: collected, not shared, processed ephemerally: no, required, purpose App functionality**, for the push token that Expo stores. Then answer: encrypted in transit **Yes** (HTTPS to Expo, SSH to the user's computer); users can request deletion **No account; removing the computer in the app deletes the token from that computer**.

If Play asks the security questions:

| Question | Answer |
|---|---|
| Is all user data encrypted in transit? | Yes. SSH between phone and computer, HTTPS/TLS to Expo, FCM. |
| Do you provide a way for users to request that their data be deleted? | The developer holds no data. In the app: Settings > host > Remove deletes the phone's key and push token from that computer. Uninstalling the app deletes all app data on the phone. |
| Account creation | The app has no accounts. (Play's account-deletion URL requirement does not apply.) |
| Independent security review | No |
| Families policy | Not in the Families program |

## Content rating (IARC questionnaire)

- **Category:** Reference, News, or Educational? No. Choose **"All other app types"** (a utility/productivity tool).
- Violence: No
- Fear / horror: No
- Sexuality, nudity: No
- Gambling (real or simulated): No
- Language (profanity, crude humor): No
- Controlled substances (drugs, alcohol, tobacco): No
- Does the app let users interact or exchange content with other users? **No.** The user talks to the user's own agents on the user's own computers.
- Does the app share the user's current location with other users? No
- Does the app allow users to buy digital goods? No
- Does the app contain an unrestricted web browser or search engine? No
- Is the app a news app? No

Expected rating: **Everyone** (IARC 3+, PEGI 3, ESRB Everyone).

## Target audience and content

- **Target age groups:** **18 and over** only. Herdling is a tool for software developers who run AI coding agents.
- **Could the store listing appeal to children?** No.
- **Families program:** not enrolled.
- **News app:** No. **COVID-19 app:** No. **Government app:** No. **Financial features:** none. **Health:** none.
- **Ads:** No, the app contains no ads.

## App access (instructions for reviewers)

Choose: **"All or some functionality is restricted"**, and add one instruction set:

- **Name:** Demo mode
- **Username / password:** none (leave empty; the app has no accounts)
- **Instructions:**

```
Herdling has no accounts. In normal use it connects over SSH to the user's own Mac or Linux computers, which run our free companion program, herdlingd. A review device has no such computer, so the app has a built-in demo mode with a simulated computer and agents.

1. On first launch, tap "Try the demo" (or open herdling://demo).
2. Overview: the board lists the demo agents. The one marked "Needs you" is at the top.
3. Tap that agent and tap an answer to its question. The agent continues.
4. Type a message and tap send; a reply appears. Tap "Terminal" to see the live terminal view.
5. Go back, start a new session from the new-session button, then open the Usage tab.
6. Open Settings: hosts, notification switches and voice settings.

Permission prompts appear only when a feature is used: camera (scan a pairing QR code), microphone (mic button), notifications. The demo works if you decline them.

Setup guide: https://herdling.zog-tech.com/docs  Contact: admin@zog-tech.com
```

## Permissions: justification notes

Play asks for a declaration only for sensitive permissions. None of Herdling's permissions need a Permissions Declaration Form. Keep these notes for review questions and for the in-app prompts:

| Permission | Why |
|---|---|
| `CAMERA` | Scan the pairing QR code that `herdlingd pair` shows on the user's computer. No photos or video are saved or sent. Requested only when the user taps Scan. |
| `RECORD_AUDIO` | The mic button: the user speaks a prompt for the agent. Recording runs only while the user records. Audio goes to the system speech recognizer or, if the user chooses, to the user's own computer over SSH. |
| `MODIFY_AUDIO_SETTINGS` | Route audio while recording and while replies are read aloud. Added by the Expo audio library. |
| `POST_NOTIFICATIONS` | Tell the user when an agent finishes or needs input. Requested on Android 13 and later. |
| `INTERNET`, `ACCESS_NETWORK_STATE` | SSH connections to the user's own computers; check for a connection before connecting. |
| `CHANGE_WIFI_MULTICAST_STATE` | Find the user's computers on the local network (mDNS/Bonjour `_herdling._tcp`). |
| `VIBRATE` | Haptic feedback and notifications. |
| `WAKE_LOCK` | Keep a voice recording or notification delivery alive for a moment (added by Expo libraries). |
| `READ_APP_BADGE` | Show a badge count on the app icon (added by expo-notifications). |

No location, contacts, SMS, call log, storage, accessibility or background location permissions. Photos are picked with the system photo picker, which needs no permission. The app does not target children, so the Families policy does not apply.

## Notifications on Android: Firebase / FCM (blocker for push, not for review)

The Expo push service delivers to Android through Firebase Cloud Messaging. Until FCM is set up, Android push notifications do not arrive; everything else works, and review can go ahead.

To finish it (maintainer):
1. Create a Firebase project (name it Herdling, under the Zog Tech Google account). Disable Google Analytics when asked.
2. Add an Android app with package `com.zogtech.herdling`. Download `google-services.json`.
3. Add it to the app: `"android": { "googleServicesFile": "./google-services.json" }` in `app/app.json`. This is a native change, so it needs a new build.
4. In Firebase > Project settings > Service accounts, create a private key (FCM V1). Upload it to EAS: `eas credentials` > Android > Google Service Account > FCM V1.
5. Test a notification on a real Android device.

## Release details

- **Release name:** 1.0.0 (1)
- **Release notes (en-US, max 500):**

```
First release. Follow the coding agents that herdr runs on your own computers. See their status, read and answer their sessions, open the terminal, start new sessions and get a notification when an agent finishes or needs you.
```
