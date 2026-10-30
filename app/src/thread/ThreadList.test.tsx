import type { ThreadItem } from "@zogssh/protocol";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { mergeItems } from "./merge";
import { ThreadList } from "./ThreadList";

const mockRenders = { reply: 0, markdown: 0 };
jest.mock("./items/ReplyPlayButton", () => ({
  ReplyPlayButton: () => {
    mockRenders.reply++;
    return null;
  },
}));
jest.mock("./items/AssistantMessage", () => ({
  AssistantMessage: () => {
    mockRenders.markdown++;
    return null;
  },
}));
jest.mock("@/hosts/connection", () => ({ useHostConn: () => ({ status: "offline", rpc: undefined }) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

const assistant = (id: string, markdown: string): ThreadItem => ({ kind: "assistant", id, ts: 1, markdown });
const tool = (id: string, result?: string): ThreadItem => ({
  kind: "tool",
  id,
  ts: 2,
  name: "Bash",
  input_summary: "ls",
  input: { command: "ls" },
  ...(result === undefined ? {} : { result: { ok: true, text: result, truncated: false } }),
});

const live = { hostId: "h", paneId: "p", active: true };
const list = (items: ThreadItem[]) => (
  <ThreadList items={items} loadOlder={() => {}} loadingOlder={false} hasOlder={false} live={live} />
);

beforeEach(() => {
  mockRenders.reply = 0;
  mockRenders.markdown = 0;
});

test("a_new_running_tool_does_not_re_render_unchanged_rows", () => {
  let items = [assistant("a1", "hello"), tool("t1")];
  let t!: ReactTestRenderer;
  act(() => {
    t = create(list(items));
  });
  expect(mockRenders).toEqual({ reply: 1, markdown: 1 });
  // The newest running tool changes from t1 to t2: the live tool context changes.
  items = mergeItems(items, [tool("t1", "done"), tool("t2")]);
  act(() => t.update(list(items)));
  items = mergeItems(items, [tool("t2", "done"), assistant("a2", "bye")]);
  act(() => t.update(list(items)));
  // a1 rendered once; a2 once.
  expect(mockRenders).toEqual({ reply: 2, markdown: 2 });
  act(() => t.unmount());
});

test("an_equal_follow_batch_keeps_the_same_items_array", () => {
  const items = [assistant("a1", "hello"), tool("t1", "done")];
  // A reconnect or retry sends copies of items the thread already has.
  expect(mergeItems(items, [assistant("a1", "hello"), tool("t1", "done")])).toBe(items);
});
