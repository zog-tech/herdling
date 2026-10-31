/** One step of a guided walkthrough: one action, and a command to copy when there is one. */
export type Step = { text: string; command?: string };

/** The first step of every macOS walkthrough. The Apple logo glyph is not used: Android cannot show it. */
export const MAC_OPEN_SETTINGS =
  "On the Mac, click the Apple menu (the Apple logo at the top-left of the screen) and choose System Settings.";
