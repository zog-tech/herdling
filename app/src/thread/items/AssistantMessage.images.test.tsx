import { Image, Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { AssistantMessage } from "./AssistantMessage";

// This file uses the real markdown package, so the image rule runs as it does in the app.
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock("@/ui/nativeSheet", () => ({ showActionSheet: jest.fn() }));
jest.mock("@/hosts/connection", () => ({ useHostConn: () => ({ status: "online", rpc: null }) }));
jest.mock("@/preview/webview", () => ({ hasWebView: () => true }));

let tree: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  mockPush.mockClear();
});

function render(markdown: string): ReactTestRenderer {
  act(() => {
    tree = create(<AssistantMessage markdown={markdown} id="a1" />);
  });
  return tree!;
}

/** Every image source in the tree: an agent reply must never load one by itself. */
function imageSources(t: ReactTestRenderer): string[] {
  return t.root
    .findAll((n) => n.type === Image || (n.props.source !== undefined && typeof n.props.source === "object"))
    .map((n) => String((n.props.source as { uri?: string } | undefined)?.uri ?? ""));
}

const links = (t: ReactTestRenderer) => t.root.findAll((n) => n.type === Text && n.props.accessibilityRole === "link");
const textOf = (n: { props: { children?: unknown } }): string => {
  const c = n.props.children;
  return Array.isArray(c) ? c.join("") : String(c ?? "");
};

test("a_reply_image_never_loads_by_itself", () => {
  const t = render("Look: ![x](https://tracker.example/p.png) and ![y](tracker.example/q.png)\n\n![](http://10.0.0.9/r.png)");
  expect(imageSources(t)).toEqual([]);
});

test("a_web_image_shows_as_a_link_with_its_alt_text", () => {
  const t = render("![build graph](https://img.example/graph.png)");
  const l = links(t);
  expect(l).toHaveLength(1);
  expect(textOf(l[0])).toBe("build graph");
  act(() => l[0].props.onPress());
  expect(mockPush).toHaveBeenCalledWith(`/browser?url=${encodeURIComponent("https://img.example/graph.png")}`);
});

test("an_image_with_no_alt_text_shows_its_url", () => {
  const t = render("![](https://img.example/a.png)");
  expect(links(t).map(textOf)).toEqual(["https://img.example/a.png"]);
});

test("an_image_that_the_app_does_not_open_is_plain_text", () => {
  const t = render("![pixel](data:image/png;base64,iVBORw0KGgo=) ![z](javascript:alert(1))");
  expect(links(t)).toHaveLength(0);
  expect(imageSources(t)).toEqual([]);
});
