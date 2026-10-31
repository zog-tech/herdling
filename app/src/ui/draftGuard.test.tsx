import { Alert } from "react-native";
import { act, create } from "react-test-renderer";

import { useDraftGuard } from "./draftGuard";

type Prevent = (e: { data: { action: { type: string } } }) => void;

const mockDispatch = jest.fn();
const mockRouter: { prevented: boolean; onPrevent?: Prevent } = { prevented: false };

jest.mock("expo-router", () => ({
  useNavigation: () => ({ dispatch: mockDispatch, setOptions: () => {} }),
  usePreventRemove: (on: boolean, cb: Prevent) => {
    mockRouter.prevented = on;
    mockRouter.onPrevent = cb;
  },
}));

let allow: () => void = () => {};
function Guarded({ draft }: { draft: boolean }) {
  allow = useDraftGuard(draft);
  return null;
}

beforeEach(() => {
  mockDispatch.mockClear();
  mockRouter.prevented = false;
  mockRouter.onPrevent = undefined;
});

test("an_allowed_leave_turns_the_prevention_off_before_it_resends_the_action", () => {
  let t!: ReturnType<typeof create>;
  act(() => {
    t = create(<Guarded draft />);
  });
  expect(mockRouter.prevented).toBe(true);
  allow();
  const action = { type: "REPLACE" };
  // The router prevents the action; the guard must not resend it while the prevention is on.
  act(() => mockRouter.onPrevent!({ data: { action } }));
  expect(mockRouter.prevented).toBe(false);
  expect(mockDispatch).toHaveBeenCalledTimes(1);
  expect(mockDispatch).toHaveBeenCalledWith(action);
  act(() => t.unmount());
});

test("without_allow_the_guard_asks_and_does_not_leave", () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  let t!: ReturnType<typeof create>;
  act(() => {
    t = create(<Guarded draft />);
  });
  act(() => mockRouter.onPrevent!({ data: { action: { type: "GO_BACK" } } }));
  expect(alert).toHaveBeenCalledTimes(1);
  expect(mockRouter.prevented).toBe(true);
  expect(mockDispatch).not.toHaveBeenCalled();
  act(() => t.unmount());
  alert.mockRestore();
});
