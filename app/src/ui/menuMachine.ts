import type { MenuItem, MenuSpec } from "./menuRules";

/**
 * The life of the one menu sheet, as a pure state machine. `MenuSheetHost` sends the events and
 * runs the effects.
 *
 * Why the steps: a picked action can open a screen or a second sheet. A new modal screen or dialog
 * must not come up while the sheet layer is still on screen. So the action runs only after the exit
 * animation ("leaving") and after the layer is gone ("hiding").
 */

/** What ends a menu: a pick, or a close with no pick. */
export type Outcome = { kind: "pick"; item: MenuItem } | { kind: "cancel" };

export type MenuState =
  | { kind: "closed"; gen: number }
  /** The sheet is on screen. */
  | { kind: "open"; menu: MenuSpec; gen: number }
  /** The exit animation runs. `byGesture`: a swipe moves the sheet out itself. */
  | { kind: "leaving"; menu: MenuSpec; gen: number; outcome: Outcome; byGesture: boolean }
  /** The sheet window is hidden; the system removes it. */
  | { kind: "hiding"; gen: number; outcome: Outcome; menu: MenuSpec };

export type MenuEvent =
  | { type: "show"; menu: MenuSpec }
  | { type: "pick"; item: MenuItem }
  /** A tap outside, the close button, the back button or the VoiceOver escape. */
  | { type: "cancel" }
  /** A swipe down passed the close point. The sheet moves out with the finger's speed. */
  | { type: "swiped" }
  | { type: "exitDone"; gen: number }
  | { type: "dismissed"; gen: number };

export type MenuEffect =
  | { kind: "haptic"; feel: "press" | "tap" }
  /** Run the outcome of a menu: the item's `onPick`, or the menu's `onClose`. */
  | { kind: "run"; outcome: Outcome; menu: MenuSpec };

export const initialMenuState: MenuState = { kind: "closed", gen: 0 };

const stay = (state: MenuState) => ({ state, effects: [] as MenuEffect[] });

export function menuReducer(state: MenuState, event: MenuEvent): { state: MenuState; effects: MenuEffect[] } {
  switch (event.type) {
    case "show": {
      const gen = state.gen + 1;
      const effects: MenuEffect[] = [];
      // A new menu replaces the open one: the old one closes with no pick, so a caller that waits
      // for an answer (a confirm) gets its cancel.
      if (state.kind === "open") effects.push({ kind: "run", outcome: { kind: "cancel" }, menu: state.menu });
      // A menu that is on its way out still runs its outcome.
      if (state.kind === "leaving" || state.kind === "hiding") effects.push({ kind: "run", outcome: state.outcome, menu: state.menu });
      if (event.menu.haptic !== false) effects.push({ kind: "haptic", feel: "press" });
      return { state: { kind: "open", menu: event.menu, gen }, effects };
    }
    case "pick":
      if (state.kind !== "open" || event.item.disabled) return stay(state);
      return {
        state: { kind: "leaving", menu: state.menu, gen: state.gen, outcome: { kind: "pick", item: event.item }, byGesture: false },
        effects: [{ kind: "haptic", feel: "tap" }],
      };
    case "cancel":
    case "swiped":
      if (state.kind !== "open") return stay(state);
      return {
        state: { kind: "leaving", menu: state.menu, gen: state.gen, outcome: { kind: "cancel" }, byGesture: event.type === "swiped" },
        effects: [],
      };
    case "exitDone":
      if (state.kind !== "leaving" || state.gen !== event.gen) return stay(state);
      return { state: { kind: "hiding", gen: state.gen, outcome: state.outcome, menu: state.menu }, effects: [] };
    case "dismissed":
      if (state.kind !== "hiding" || state.gen !== event.gen) return stay(state);
      return { state: { kind: "closed", gen: state.gen }, effects: [{ kind: "run", outcome: state.outcome, menu: state.menu }] };
  }
}
