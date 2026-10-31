import type { ThreadItem } from "@herdling/protocol";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { SEARCH_DEBOUNCE_MS } from "./search";
import type { Thread } from "./useThread";
import { useThreadSearch, type ThreadSearch } from "./useThreadSearch";

const msg = (id: string, text: string): ThreadItem => ({ kind: "assistant", id, ts: 0, markdown: text });

/**
 * A thread with older pages (newest page first). `loadOlder` only records the new thread; the
 * test renders it in `settle`, so no two `act` calls overlap.
 */
function fakeThread(items: ThreadItem[], older: ThreadItem[][]) {
  const box: { t?: Thread; loads: number } = { loads: 0 };
  const make = (its: ThreadItem[], pages: ThreadItem[][]): Thread =>
    ({
      ref: null,
      items: its,
      status: "live",
      error: undefined,
      loadingOlder: false,
      hasOlder: pages.length > 0,
      loadOlder: () => {
        if (pages.length === 0) return;
        box.loads += 1;
        const [page, ...rest] = pages;
        box.t = make([...page, ...its], rest);
      },
    }) as unknown as Thread;
  box.t = make(items, older);
  return box as { t: Thread; loads: number };
}

let latest: ThreadSearch;
let tree: ReactTestRenderer | undefined;
let props: { thread: Thread; open: boolean; query: string };

function Probe({ thread, open, query }: { thread: Thread; open: boolean; query: string }) {
  latest = useThreadSearch(thread, open, query);
  return null;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  jest.useRealTimers();
});

async function render(thread: Thread, open: boolean, query: string) {
  props = { thread, open, query };
  await act(async () => {
    if (tree) tree.update(<Probe {...props} />);
    else tree = create(<Probe {...props} />);
  });
}

/** Lets the debounce pass, then renders each new thread page until the thread stays the same. */
async function settle(box?: { t: Thread }) {
  await act(async () => {
    jest.advanceTimersByTime(SEARCH_DEBOUNCE_MS + 10);
  });
  for (let i = 0; i < 10; i++) {
    await act(async () => {});
    if (box && box.t !== props.thread) await render(box.t, props.open, props.query);
  }
}

test("debounces the query, starts at the newest match and steps with wrap", async () => {
  const th = fakeThread([msg("1", "deploy failed"), msg("2", "ok"), msg("3", "deploy again"), msg("4", "Deploy done")], []);
  await render(th.t, true, "");
  await render(th.t, true, "deploy");
  // Before the debounce: no search yet.
  expect(latest.count).toBe(0);
  await settle();
  expect(latest.count).toBe(3);
  expect(latest.currentId).toBe("4");
  expect(latest.marks.getState()).toEqual({ ids: new Set(["1", "3", "4"]), current: "4" });
  expect(latest.excerpt).toEqual({ before: "", match: "Deploy", after: " done" });

  await act(async () => latest.older());
  expect(latest.currentId).toBe("3");
  await act(async () => latest.older());
  await act(async () => latest.older());
  // No older pages: the step wraps to the newest.
  expect(latest.currentId).toBe("4");
  await act(async () => latest.newer());
  expect(latest.currentId).toBe("1");
});

test("closing clears the marks", async () => {
  const th = fakeThread([msg("1", "alpha")], []);
  await render(th.t, true, "alpha");
  await settle();
  expect(latest.marks.getState().ids.size).toBe(1);
  await render(th.t, false, "alpha");
  await settle();
  expect(latest.count).toBe(0);
  expect(latest.marks.getState()).toEqual({ ids: new Set(), current: undefined });
});

test("older past the oldest match loads older pages until a match shows", async () => {
  const th = fakeThread(
    [msg("5", "needle here"), msg("6", "nothing")],
    [[msg("3", "plain"), msg("4", "plain")], [msg("1", "old needle"), msg("2", "plain")]],
  );
  await render(th.t, true, "needle");
  await settle(th);
  expect(latest.currentId).toBe("5");
  expect(latest.canSeek).toBe(true);
  expect(th.loads).toBe(0);
  await act(async () => latest.older());
  await settle(th);
  expect(th.loads).toBe(2);
  expect(th.t.items.map((i) => i.id)).toEqual(["1", "2", "3", "4", "5", "6"]);
  expect(latest.currentId).toBe("1");
  expect(latest.seeking).toBe(false);
  expect(latest.canSeek).toBe(false);
  // At the start of the conversation: a step wraps.
  await act(async () => latest.older());
  expect(latest.currentId).toBe("5");
});

test("a search with no loaded match can search older messages", async () => {
  const th = fakeThread([msg("3", "plain")], [[msg("1", "zebra"), msg("2", "plain")]]);
  await render(th.t, true, "zebra");
  await settle(th);
  expect(latest.count).toBe(0);
  expect(latest.canSeek).toBe(true);
  await act(async () => latest.older());
  await settle(th);
  expect(latest.currentId).toBe("1");
});

test("no older match gives a note", async () => {
  const th = fakeThread([msg("2", "needle")], [[msg("1", "plain")]]);
  await render(th.t, true, "needle");
  await settle(th);
  await act(async () => latest.older());
  await settle(th);
  expect(latest.note).toContain("No older match");
  expect(latest.currentId).toBe("2");
});
