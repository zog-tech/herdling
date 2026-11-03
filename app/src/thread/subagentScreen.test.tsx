import { act, create, type ReactTestRenderer } from "react-test-renderer";

import SubagentScreen from "@/app/subagent/[hostId]/[agentId]";

let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
// The list reads the run host the way a code block of the thread does.
let mockRunHost: unknown = "unset";
jest.mock("@/thread/ThreadList", () => {
  const { useContext } = jest.requireActual("react");
  const { RunHostContext: Ctx } = jest.requireActual("@/thread/LiveToolContext");
  return {
    ThreadList: () => {
      mockRunHost = useContext(Ctx);
      return null;
    },
  };
});
jest.mock("@/thread/useSubagentThread", () => ({
  useSubagentThread: () => ({
    status: "live",
    items: [{ kind: "assistant", id: "a1", ts: 1, markdown: "```bash\nls\n```" }],
    running: false,
    loadOlder: () => {},
    loadingOlder: false,
    hasOlder: false,
  }),
}));

let tree: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
});

function render(params: Record<string, string>) {
  mockParams = params;
  act(() => {
    tree = create(<SubagentScreen />);
  });
  return tree!;
}

test("code_blocks_of_a_subagent_run_on_its_host_in_the_parent_folder", () => {
  render({ hostId: "studio", agentId: "a1", log: "/home/sam/s.jsonl", pane: "w1:p1" });
  expect(mockRunHost).toEqual({ hostId: "studio", paneId: "w1:p1" });
});

test("an_older_link_with_no_parent_pane_still_knows_the_host", () => {
  render({ hostId: "studio", agentId: "a1", log: "/home/sam/s.jsonl" });
  expect(mockRunHost).toEqual({ hostId: "studio", paneId: undefined });
});
