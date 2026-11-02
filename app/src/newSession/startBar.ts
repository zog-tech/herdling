/**
 * Layout values for the start bar at the bottom of the New session screen.
 */

/**
 * True when the screen ends at the bottom of the window, so `KeyboardAvoider` must use
 * `atScreenBottom`. On an iPhone, the "modal" presentation is a page sheet. It ends at the bottom
 * of the screen, but `measureInWindow` gives y = 0 for its content: it does not count the sheet
 * offset or the native header. On an iPad, the page sheet is a card in the middle of the screen,
 * so the measured frame is used. On Android, the modal fills the window and the measured frame is correct.
 */
export function startBarAtScreenBottom(os: string, isPad: boolean): boolean {
  return os === "ios" && !isPad;
}

/**
 * The space below the start bar. With the keyboard down, the bar stays above the home indicator.
 * With the keyboard up, the keyboard covers the home indicator area, and the padding of
 * `KeyboardAvoider` moves the bar above the keyboard. Then only the small gap stays.
 */
export function startBarBottomMargin(bottomInset: number, keyboardShown: boolean, gap: number): number {
  return keyboardShown ? gap : Math.max(bottomInset, gap);
}
