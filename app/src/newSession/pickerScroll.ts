/**
 * Where the agent row scrolls to at open, to show the remembered agent. A pure rule, so the
 * picker can test it without a layout.
 */

/**
 * The x offset that brings a chip into view, or undefined when the chip shows already and the row
 * must stay at its start. `x` and `width` are the chip layout in the row content, `viewport` is
 * the width of the row, and `inset` is the side padding of the row content.
 *
 * The row must not scroll when the chip fits: the Shell chip is first, and a scroll to the second
 * chip (the default agent) hides it.
 */
export function revealOffset(x: number, width: number, viewport: number, inset: number): number | undefined {
  if (viewport <= 0 || x + width <= viewport - inset) return undefined;
  return Math.max(0, x - inset);
}
