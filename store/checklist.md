# Herdling: store submission checklist

State on 2026-10-31. "Agent" means a coding agent can do the step with the maintainer's go-ahead. "Maintainer" means it needs a person, an account login or a legal decision.

Done already:
- Website: https://herdling.zog-tech.com/ (product page and marketing URL), https://herdling.zog-tech.com/support (support URL), https://herdling.zog-tech.com/privacy (privacy policy), https://herdling.zog-tech.com/docs (setup guide), https://herdling.zog-tech.com/llms.txt (guide for AI assistants). Source: `site/` (Cloudflare Pages project `herdling-site`, see `site/README.md`). The old https://zog-tech.com/herdling/ pages forward there.
- Listing text: `store/app-store.md`, `store/google-play.md`.
- Play icon: `store/play-icon-512.png` (512 x 512, 32-bit PNG, made from `app/assets/images/icon.png`).
- App Store Connect app record: "Herdling", bundle ID `com.zogtech.herdling`, SKU `herdling-ios`, Apple ID 6829197551.
- iOS permission strings and `ITSAppUsesNonExemptEncryption = false` in `app/app.json`.

## Before either store

1. **Demo mode lands on main** (agent, in progress in a separate worktree). Then check every "(verify once the demo build lands)" sentence in both store files against the real demo: button label "Try the demo", link `herdling://demo`, the 6 steps, "works with no network and no permissions". Remove the markers.
2. **Public download for herdlingd** (maintainer decides). The repo is public (MPL-2.0), so a source build is available now: the website, the README and the guide give the steps (`git clone`, `cargo build --release`, `herdlingd install`). Still to do: the one-line installer, which needs public release binaries for macOS and Linux (GitHub releases or a download link on zog-tech.com) and the script at `releases.zog-tech.com/herdlingd/install.sh`. Then set `installer.ready` in `site/public/config.js`, update the "coming soon" sentences (list in `site/README.md`) and redeploy with `site/scripts/deploy.sh`.
3. **Decide the privacy label stance** (maintainer). Recommended: "Data Not Collected" (Apple) and "No data collected" (Play). The conservative fallback (declare the push token as a device ID) is described in both store files.
4. **Review contact phone number** (maintainer). Apple asks for a phone number for App Review. Use a business number, not a personal one.

## App Store (iOS)

5. **Production build with demo mode** (agent). `eas build -p ios --profile production`. `eas.json` uses `appVersionSource: "remote"` with `autoIncrement`, so EAS sets the build number; `buildNumber: "3"` in `app/app.json` is ignored. Keep `version` at 1.0.0 (runtime policy `appVersion`). Then `eas submit -p ios` to TestFlight.
6. **Screenshots** (agent, after step 1). Required: iPhone 6.9" display, 1320 x 2868 portrait, 3 to 10 images. Take them from the demo on an iPhone 16/17 Pro Max simulator. Suggested set: Overview board, agent chat with a "needs you" question, terminal view, new session, Usage, notification. No iPad set is needed (`supportsTablet: false`).
7. **Version 1.0.0 metadata** (agent, through `asc`). Create the App Store version 1.0.0 entry if it does not exist. Fill: subtitle, promotional text, description, keywords, support URL, marketing URL, copyright, from `store/app-store.md`. Set privacy policy URL on the app info.
8. **App information** (agent with `asc`, or maintainer in the web UI): categories Developer Tools and Productivity, content rights (no third-party content), age rating answers (4+), price Free, availability (all territories, or as chosen).
9. **App Privacy** (maintainer in App Store Connect; the API does not cover it). Answer "No, we do not collect data".
10. **App Review information** (agent with `asc`): sign-in not required, notes from `store/app-store.md`, contact name "Zog Tech Inc. App Review" or a role name, email admin@zog-tech.com, phone from step 4.
11. **Attach the build, submit for review** (maintainer gives the final go). Choose manual or automatic release.

## Google Play (Android)

12. **Play developer account** (maintainer). Organization account for Zog Tech Inc. (D-U-N-S number, identity check). An organization account does not need the 12-tester, 14-day closed test that new personal accounts need.
13. **Create the app** in Play Console (maintainer): name Herdling, default language en-US, app, free. Accept the declarations.
14. **Firebase / FCM** (maintainer, with agent help). Needed for Android push only; not a blocker for review. Steps are in `store/google-play.md`. Adds `google-services.json` to `app/app.json`, so it needs a new native build. Do it before step 15 to avoid a second build.
15. **Upload key and AAB** (agent). `eas build -p android --profile production` makes an AAB and an EAS-managed upload keystore (`eas credentials` shows it). versionCode is set by EAS (remote, auto-increment). Opt in to **Play App Signing** on the first upload (the default). Back up the upload keystore from EAS to the password manager.
16. **First AAB upload by hand** (maintainer). Play requires the first upload in the Console. Use the Internal testing track first.
17. **Service account for later uploads** (maintainer). Google Cloud > service account > JSON key; in Play Console > Users and permissions, invite it with release rights. Store the key in EAS (`eas credentials`) and add `submit.production.android` to `eas.json` (track `internal`). Then `eas submit -p android` works.
18. **Graphics** (agent, after step 1). Phone screenshots: 2 to 8, PNG or JPEG, 9:16, for example 1080 x 1920 (at least 4 at 1080 px or more helps the listing). Feature graphic: 1024 x 500, PNG or JPEG, no alpha. App icon: `store/play-icon-512.png`.
19. **Store listing and App content** (maintainer pastes, or agent with Console access): short and full description, contact email, website, privacy policy URL, Data safety, content rating (IARC), target audience 18+, ads No, App access (demo instructions), news app No, government app No, financial features None, health None.
20. **Release** (maintainer): promote from Internal testing to Production, roll out, send for review.

## Character counts (from `python3 store/check_limits.py`, 2026-10-31)

| Field | Count | Limit |
|---|---|---|
| App Store name | 8 | 30 |
| App Store subtitle | 30 | 30 |
| App Store promotional text | 154 | 170 |
| App Store description | 2107 | 4000 |
| App Store keywords | 99 | 100 |
| App Store review notes | 2009 | 4000 |
| Play app name | 8 | 30 |
| Play short description | 78 | 80 |
| Play full description | 2113 | 4000 |
| Play release notes | 226 | 500 |
