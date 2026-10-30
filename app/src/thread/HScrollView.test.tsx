import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { Text } from "react-native";
import { GestureHandlerRootView, ScrollView, usePanGesture, type PanGesture } from "react-native-gesture-handler";

import { HScrollView, SwipePanContext } from "./HScrollView";

let pan: PanGesture | undefined;

function InSwipe() {
  pan = usePanGesture({ activeOffsetX: [-30, 30] });
  return (
    <SwipePanContext.Provider value={pan}>
      <HScrollView>
        <Text>wide code</Text>
      </HScrollView>
    </SwipePanContext.Provider>
  );
}

const scrollViews = (t: ReactTestRenderer) => t.root.findAll((n) => n.type === ScrollView);

test("horizontal_scroll_inside_the_swipe_blocks_the_pan", () => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(
      <GestureHandlerRootView>
        <InSwipe />
      </GestureHandlerRootView>,
    );
  });
  const [sv] = scrollViews(t);
  expect(sv.props.horizontal).toBe(true);
  expect(sv.props.block).toBe(pan);
  act(() => t.unmount());
});

test("horizontal_scroll_outside_the_swipe_blocks_nothing", () => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(
      <GestureHandlerRootView>
        <HScrollView>
          <Text>wide code</Text>
        </HScrollView>
      </GestureHandlerRootView>,
    );
  });
  const [sv] = scrollViews(t);
  expect(sv.props.horizontal).toBe(true);
  expect(sv.props.block).toBeUndefined();
  act(() => t.unmount());
});
