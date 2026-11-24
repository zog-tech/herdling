import { Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { ThreadPaneContext, type ThreadPane } from "../LiveToolContext";
import { AssistantMessage } from "./AssistantMessage";

// This file uses the real markdown package, so the text and code rules run as in the app.
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock("@/ui/MenuSheet", () => ({ ...jest.requireActual("@/ui/MenuSheet"), showMenu: jest.fn() }));
let mockMethods: string[] | undefined = ["files.get"];
jest.mock("@/hosts/connection", () => ({
  useHostConn: () => ({ status: "online", rpc: null, hello: mockMethods ? { methods: mockMethods } : {} }),
}));

const PANE: ThreadPane = { hostId: "studio", paneId: "t1" };

let tree: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  mockPush.mockClear();
  mockMethods = ["files.get"];
});

function render(markdown: string, pane: ThreadPane | null = PANE): ReactTestRenderer {
  act(() => {
    tree = create(
      <ThreadPaneContext.Provider value={pane}>
        <AssistantMessage markdown={markdown} id="a1" />
      </ThreadPaneContext.Provider>,
    );
  });
  return tree!;
}

const pathLinks = (t: ReactTestRenderer) =>
  t.root.findAll((n) => n.type === Text && n.props.accessibilityRole === "link" && n.props.accessibilityHint === "Opens the file on the computer");
const textOf = (n: { props: { children?: unknown } }): string => {
  const c = n.props.children;
  return Array.isArray(c) ? c.join("") : String(c ?? "");
};

test("inline_code_paths_open_the_file_viewer", () => {
  const t = render("The screens are in `/home/sam/proj/docs/screens/` and `src/content/`. Run `pnpm test`.");
  const l = pathLinks(t);
  expect(l.map(textOf)).toEqual(["/home/sam/proj/docs/screens/", "src/content/"]);
  act(() => l[1].props.onPress());
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/file/[hostId]", params: { hostId: "studio", path: "src/content/", paneId: "t1" } });
});

test("a_line_suffix_is_not_part_of_the_path", () => {
  const t = render("See `src/a.ts:42`.");
  act(() => pathLinks(t)[0].props.onPress());
  expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ path: "src/a.ts" }) }));
});

test("absolute_paths_in_prose_open_too", () => {
  const t = render("I saved it to ~/apps/proj/out.png, as asked. Use and/or src/x for more.");
  expect(pathLinks(t).map(textOf)).toEqual(["~/apps/proj/out.png"]);
});

test("paths_stay_plain_on_a_host_without_files_get", () => {
  mockMethods = ["hello"];
  expect(pathLinks(render("Open `/home/sam/proj/a.md` and ~/x/y"))).toHaveLength(0);
  mockMethods = undefined;
  expect(pathLinks(render("Open `/home/sam/proj/a.md`"))).toHaveLength(0);
});

test("paths_stay_plain_without_a_host", () => {
  expect(pathLinks(render("Open `/home/sam/proj/a.md`", null))).toHaveLength(0);
});

test("a_url_in_inline_code_stays_a_web_link", () => {
  const t = render("Open `http://localhost:5173/a/b`");
  expect(pathLinks(t)).toHaveLength(0);
});
