# Herdling: App Store Connect metadata

Version 1.0.0. Bundle ID `com.zogtech.herdling`. Paste each field as written. Run `python3 store/check_limits.py` to check the character limits.

## App information

- **Name** (max 30): `Herdling`
- **Subtitle** (max 30): `AI coding agents on your phone`
- **Primary category:** Developer Tools
- **Secondary category:** Productivity
- **Content rights:** The app does not contain, show or access third-party content. (Agent output comes from the user's own computers.)
- **Price:** Free. No in-app purchases.
- **Copyright:** `2026 Zog Tech Inc.`

## URLs

- **Support URL:** https://zog-tech.com/herdling/
- **Marketing URL:** https://zog-tech.com/herdling/
- **Privacy Policy URL:** https://zog-tech.com/herdling/privacy.html

## Promotional text (max 170)

```
Follow the AI coding agents on your own computers. See who is busy, who is done and who needs you, then reply from your phone. No account and no tracking.
```

## Description (max 4000)

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
Herdling connects straight to your own computers over SSH. Your sessions, prompts, photos and recordings go from your phone to your computer and back, and never pass through our servers. We run none. The SSH key is made on your phone and stays in its secure storage. There is no account, no analytics, no ads and no tracking.

WHAT YOU NEED
- One or more Mac or Linux computers that run herdr.
- The free herdlingd companion on each computer. Setup takes a few minutes: install it, run "herdlingd pair" and scan the QR code.
- A network path from your phone to your computers, such as your home Wi-Fi or a VPN.

Setup guide and support: zog-tech.com/herdling

Herdling is not made by or affiliated with the makers of herdr, Claude Code, Codex, Pi or OpenCode.
```

## Keywords (max 100, comma separated, no spaces after commas)

```
herdr,ssh,terminal,remote,developer,prompt,cli,llm,devops,code,multiplexer,monitor,notify,assistant
```

No third-party trademarks (no "Claude", "Codex", "OpenAI", "Anthropic", "tmux"). The words in the name and subtitle are not repeated, because Apple indexes them already.

## Age rating questionnaire

Answer "None" or "No" to every item:

| Question | Answer |
|---|---|
| Cartoon or fantasy violence | None |
| Realistic violence | None |
| Prolonged graphic or sadistic realistic violence | None |
| Profanity or crude humor | None |
| Mature or suggestive themes | None |
| Horror or fear themes | None |
| Medical or treatment information | None |
| Alcohol, tobacco or drug use or references | None |
| Simulated gambling | None |
| Sexual content or nudity | None |
| Graphic sexual content and nudity | None |
| Contests | None |
| Unrestricted web access | No |
| User-generated content shared with other users | No (content stays between the user's phone and the user's own computers) |
| Messaging or chat with other people | No (the chat view talks to the user's own agents, not to other people) |
| Gambling | No |
| Loot boxes | No |
| Parental controls / age assurance | No |

Expected rating: **4+**.

Note: the app shows text that the user's own AI agents produce. This is the user's own content from the user's own computer, not web browsing and not content from other users.

## Export compliance

- `ITSAppUsesNonExemptEncryption` is already `false` in `app/app.json`, so App Store Connect does not ask per build.
- If asked: the app uses encryption, but only standard encryption (SSH through the system and open-source libraries, and HTTPS/TLS). It does not use proprietary or non-standard algorithms. This is exempt under category 5 part 2 (mass market, standard algorithms). No export documentation (CCATS) is needed.
- France: no special encryption declaration needed for standard algorithms in a mass-market app.

## App Privacy ("nutrition label")

**Answer: "No, we do not collect data from this app."** The label then shows **Data Not Collected**.

Why this is accurate under Apple's definitions. Apple counts data as "collected" when it is sent off the device in a way that lets the developer or its third-party partners access it for longer than needed to handle the request in real time.

1. **Session content, prompts, photos, voice recordings, terminal output.** These go from the phone to the user's own computer over SSH. The user owns and controls that computer. Zog Tech runs no server and never receives the data. Data that goes only to a system the user controls is not collected by the developer.
2. **No account, no analytics, no crash reporting, no ads, no tracking SDKs.** `app/package.json` contains none (checked: no Sentry, Firebase Analytics, Crashlytics, PostHog, Amplitude, Mixpanel, Segment, Bugsnag, Datadog or ad SDK). Tracking: none, so no App Tracking Transparency prompt.
3. **Push token and notification content.** The app gets an Expo push token (which wraps the APNs device token) and sends it only to the user's own computer over SSH. herdlingd on that computer sends each notification to Expo's push API, which passes it to APNs. The notification holds a title (agent or workspace name plus "finished" or "needs you"), a short body (agent kind and terminal title) and two internal IDs. The developer's code on the phone never sends notification content anywhere. Expo and Apple handle the token and message only to deliver the notification. This is service delivery, not collection by the developer. Zog Tech cannot read the messages.
4. **Over-the-air updates (expo-updates).** On launch the app asks Expo's update server for an update. The request carries the app version, runtime version, platform, channel and a random client ID that expo-updates makes. It holds no user data, and it is used only to serve the right update.
5. **Speech recognition.** Apple's Speech framework runs on the device when the language supports it; otherwise Apple handles the audio under its own terms. This is a system service, not data collected by the developer.
6. **Optional Parakeet speech model.** A plain file download from Hugging Face. No user data is sent.

Conservative alternative (only if the maintainer prefers it): declare **Identifiers > Device ID**, not linked to the user, not used for tracking, purpose **App Functionality**, to cover the push token held by Expo. Recommendation: keep "Data Not Collected"; the push token goes only to the user's own computer, and Expo stores it only to deliver the user's own notifications.

## App Review information

- **Sign-in required:** No. The app has no accounts.
- **Contact:** Zog Tech Inc., admin@zog-tech.com, phone: (maintainer fills in a business phone number)
- **Attachment:** optional; a short screen recording of the demo path helps.

### Notes for the reviewer (paste into "Notes", max 4000)

```
Herdling is a client for herdr, a terminal workspace for AI coding agents. It has no accounts and no login. In normal use it connects over SSH to the user's own Mac or Linux computers, which run our free companion program, herdlingd.

Because a review device has no paired computer, the app has a built-in demo mode. (verify once the demo build lands) The demo shows a simulated computer with several agents. It needs no network and no permissions. (verify once the demo build lands)

How to review the whole app (verify once the demo build lands):
1. On first launch, tap "Try the demo". You can also open the link herdling://demo.
2. Overview: the board lists the demo agents with their status. The agent marked "Needs you" is at the top.
3. Tap that agent. It asks a question. Tap an answer to reply, and watch the agent continue.
4. Type a message in the box at the bottom and tap send. A reply appears in the chat. Tap "Terminal" at the top to see the same session as a live terminal.
5. Go back and tap the new-session button to start a session in a folder on the demo computer. Then open the Usage tab to see the plan meters.
6. Open the Settings tab: hosts, notification switches, voice settings. The demo computer is listed under Hosts.

Permission prompts. Each prompt appears only when the matching feature is used:
- Camera: when you tap "Scan QR code" to pair a real computer.
- Microphone and speech recognition: when you tap the mic button to speak a prompt.
- Photos: when you attach a photo to a prompt.
- Local network: when the app looks for real computers on the network.
- Notifications: to tell the user when an agent finishes or needs input.
You can decline every prompt; the demo still works.

Data: the app sends no data to us. All session data goes between the phone and the user's own computers over SSH. Notifications are sent by the user's own computer through the Expo push service.

Setup guide for a real computer: https://zog-tech.com/herdling/
Contact: admin@zog-tech.com
```

## Character counts

Run `python3 store/check_limits.py`. The last counts are in `store/checklist.md`.
