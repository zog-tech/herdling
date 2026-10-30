import { createContext, useContext, type ComponentProps } from "react";
import { ScrollView, type PanGesture } from "react-native-gesture-handler";

/**
 * The swipe-between-agents pan of the session screen, or null outside it.
 * Horizontal scroll views inside the swipe block it (`block`): the pan starts only after the
 * scroll view's native gesture fails, so a sideways drag on a wide code block scrolls the block.
 */
export const SwipePanContext = createContext<PanGesture | null>(null);

/** A sideways-scrolling gesture-handler ScrollView that wins over the swipe between agents. */
export function HScrollView(props: Omit<ComponentProps<typeof ScrollView>, "horizontal" | "block">) {
  const pan = useContext(SwipePanContext);
  return <ScrollView {...props} horizontal block={pan ?? undefined} />;
}
