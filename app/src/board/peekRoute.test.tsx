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

const REQ: RunRequest = { hostId: "studio", paneId: "w1:p1", command: "ls" };

let tree: ReactTestRenderer | undefined;
beforeEach(() => {
  mockDismiss.mockClear();
  mockPush.mockClear();
  mockAllowLeave.mockClear();
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
