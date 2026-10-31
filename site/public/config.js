// Store links, the herdlingd installer and the screenshots for the whole site.
// Change a value here when a listing, the installer or a screenshot is ready.
// The HTML has working defaults ("coming soon"), so the pages work without this file.
// The Markdown twins (*.md, llms*.txt) say the same thing in words: update them too (see README.md).
window.HERDLING_CONFIG = {
  // The App Store link of the iPhone app. Empty: "coming soon".
  appStoreUrl: '',
  // A public TestFlight link, shown while appStoreUrl is empty. Empty: no beta button.
  testFlightUrl: '',
  // The Google Play link of the Android app. Empty: "coming soon".
  playUrl: '',
  // The one-line herdlingd installer. Set ready to true when the script is live.
  installer: {
    ready: false,
    command: 'curl -fsSL https://releases.zog-tech.com/herdlingd/install.sh | sh',
  },
  // Screenshot slots that have files in /img/ (<slot>-360.webp and <slot>-720.webp).
  // Slots: overview, session, terminal, new-session, usage, settings, pair.
  // A listed slot replaces its drawn placeholder with the real image.
  screenshots: [],
};
