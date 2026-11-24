import { act, create, type ReactTestRenderer } from "react-test-renderer";

import PeekScreen from "@/app/peek/[hostId]/[paneId]";
import type { RunRequest } from "@/thread/runCommand";

import { PeekSheet } from "./PeekSheet";

const mockDismiss = jest.fn();
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ hostId: "studio", paneId: "w1:p1" }),
  useRouter: () => ({ dismiss: mockDismiss, push: mockPush, back: jest.fn() }),
  router: { push: (...a: unknown[]) => mockPush(...a) },
}));
jest.mock("./PeekSheet", () => ({ PeekSheet: () => null }));
let mockDiscard = true;
const mockAllowLeave = jest.fn();
jest.mock("@/ui/draftGuard", () => ({
  useDraftGuard: () => mockAllowLeave,
  confirmDiscard: () => Promise.resolve(mockDiscard),
}));

// The agent menu needs the connection; the test keeps the handlers the route gives it.
const mockMenus: Record<string, (() => void) | undefined>[] = [];
const mockRestart = jest.fn();
jest.mock("./agentActions", () => ({
  boardAgentMenu: (_i: unknown, h: Record<string, (() => void) | undefined>) => {
    mockMenus.push(h);
    return { sections: [] };
  },
  restartAgent: (...a: unknown[]) => mockRestart(...a),
  spaceRoute: () => "/space-route",
}));
const mockShowMenu = jest.fn();
jest.mock("@/ui/MenuSheet", () => ({ showMenu: (...a: unknown[]) => mockShowMenu(...a) }));

const REQ: RunRequest = { hostId: "studio", paneId: "w1:p1", command: "ls" };

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  mockDismiss.mockClear();
  mockPush.mockClear();
  mockAllowLeave.mockClear();
  mockShowMenu.mockClear();
  mockRestart.mockClear();
  mockMenus.length = 0;
  mockDiscard = true;
  act(() => {
    tree = create(<PeekScreen />);
  });
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
});

const sheet = () => tree!.root.findByType(PeekSheet);
const unmount = () => {
  act(() => tree!.unmount());
  tree = undefined;
};

test("run_closes_the_peek_sheet_then_opens_the_run_sheet", async () => {
  await act(async () => sheet().props.onRun(REQ));
  expect(mockDismiss).toHaveBeenCalledTimes(1);
  // The run sheet waits until the peek sheet is gone: a screen pushed over a form sheet shows inside it.
  expect(mockPush).not.toHaveBeenCalled();
  unmount();
  expect(mockPush).toHaveBeenCalledWith("/run-command");
});

test("with_a_draft_run_asks_first_and_keep_editing_stays", async () => {
  act(() => sheet().props.onDraftChange(true));
  mockDiscard = false;
  await act(async () => sheet().props.onRun(REQ));
  expect(mockDismiss).not.toHaveBeenCalled();
  unmount();
  expect(mockPush).not.toHaveBeenCalled();
});

test("with_a_draft_discard_lets_the_sheet_close", async () => {
  act(() => sheet().props.onDraftChange(true));
  await act(async () => sheet().props.onRun(REQ));
  expect(mockAllowLeave).toHaveBeenCalled();
  expect(mockDismiss).toHaveBeenCalledTimes(1);
});

test("a_plain_close_opens_no_run_sheet", () => {
  unmount();
  expect(mockPush).not.toHaveBeenCalled();
});

const ITEM = { key: "studio:w1:p1", hostId: "studio", agent: { pane_id: "w1:p1" } };
const openMenu = (canExplain: boolean) => {
  act(() => sheet().props.onMenu(ITEM, { canExplain }));
  expect(mockShowMenu).toHaveBeenCalledTimes(1);
  return mockMenus[mockMenus.length - 1];
};

test("the_peek_menu_has_no_reply_peek_or_mark_read_and_explain_only_when_herdr_can", () => {
  const h = openMenu(false);
  expect(h.reply).toBeUndefined();
  expect(h.peek).toBeUndefined();
  expect(h.markRead).toBeUndefined();
  expect(h.explain).toBeUndefined();
  expect(h.openSpace).toBeDefined();
  expect(h.restart).toBeDefined();
  mockShowMenu.mockClear();
  expect(openMenu(true).explain).toBeDefined();
});

test("open_space_closes_the_sheet_then_opens_the_space", async () => {
  jest.useFakeTimers();
  const h = openMenu(false);
  await act(async () => h.openSpace!());
  expect(mockDismiss).toHaveBeenCalledTimes(1);
  expect(mockPush).not.toHaveBeenCalled();
  unmount();
  act(() => jest.runAllTimers());
  expect(mockPush).toHaveBeenCalledWith("/space-route");
  jest.useRealTimers();
});

test("restart_with_a_draft_asks_first_and_keep_editing_stays", async () => {
  jest.useFakeTimers();
  act(() => sheet().props.onDraftChange(true));
  mockDiscard = false;
  const h = openMenu(false);
  await act(async () => h.restart!());
  expect(mockDismiss).not.toHaveBeenCalled();
  unmount();
  act(() => jest.runAllTimers());
  expect(mockRestart).not.toHaveBeenCalled();
  jest.useRealTimers();
});

test("restart_closes_the_sheet_then_runs_the_restart_flow", async () => {
  jest.useFakeTimers();
  const h = openMenu(false);
  await act(async () => h.restart!());
  expect(mockDismiss).toHaveBeenCalledTimes(1);
  unmount();
  act(() => jest.runAllTimers());
  expect(mockRestart).toHaveBeenCalledWith(ITEM, expect.any(Function), expect.any(Function));
  jest.useRealTimers();
});
