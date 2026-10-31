/**
 * Pointer hover for a `Pressable` (iPad with a trackpad or a mouse, Android with a mouse). Spread
 * `hoverProps` on the Pressable and use `hovered` for the `state.hoverFill` layer. A touch screen
 * never sends hover, so phones look the same as before.
 */
import { useMemo, useState } from "react";

export function useHover() {
  const [hovered, setHovered] = useState(false);
  const hoverProps = useMemo(() => ({ onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) }), []);
  return { hovered, hoverProps };
}
