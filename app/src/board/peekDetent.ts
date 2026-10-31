/**
 * The one detent of the peek sheet on Android, as a share of the largest sheet height.
 * Android lays out the sheet content at the largest detent, so a sheet with two detents hides
 * the composer at the lower one. The root layout and the sheet keyboard pad both read this value.
 */
export const PEEK_DETENT_ANDROID = 0.75;
