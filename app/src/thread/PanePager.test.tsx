import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import type { TabPanes } from "@/herdr/tabPanes";

import { PanePager } from "./PanePager";

jest.mock("@/ui/haptics", () => ({ tap: jest.fn() }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const tab: TabPanes = {
  tabId: "t1",
  tabLabel: "agents",
  index: 1,
  panes: [
    { pane_id: "p1", title: "fix login", kind: "claude", status: "blocked", terminal: false },
    { pane_id: "p2", title: "zsh", terminal: true },
    { pane_id: "p3", title: "docs", kind: "pi", status: "working", terminal: false },
  ],
};

let tree: ReactTestRenderer;
const open = jest.fn();
beforeEach(() => {
  open.mockClear();
  act(() => {
    tree = create(
      <GestureHandlerRootView>
        <PanePager tab={tab} onOpen={open} />
      </GestureHandlerRootView>,
    );
  });
});
afterEach(() => act(() => tree.unmount()));

const byLabel = (l: string) => tree.root.find((n) => n.props.accessibilityLabel === l && (!!n.props.onPress || !!n.props.onAccessibilityAction));

test("the_strip_names_the_page_and_steps_with_actions", () => {
  const strip = byLabel("Pane 2 of 3 in tab agents");
  act(() => strip.props.onAccessibilityAction({ nativeEvent: { actionName: "increment" } }));
  act(() => strip.props.onAccessibilityAction({ nativeEvent: { actionName: "decrement" } }));
  expect(open.mock.calls).toEqual([["p3"], ["p1"]]);
});

test("the_tab_map_opens_a_tile", () => {
  act(() => byLabel("Tab map").props.onPress());
  // The open pane only closes the map.
  act(() => byLabel("zsh, terminal, open now").props.onPress());
  expect(open).not.toHaveBeenCalled();
  act(() => byLabel("Tab map").props.onPress());
  act(() => byLabel("fix login, Needs you").props.onPress());
  expect(open).toHaveBeenCalledWith("p1");
});
