import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { ErrorScreen } from "./ErrorScreen";
import { useCrashLog } from "./crashLog";

jest.mock("expo-secure-store", () => ({ getItem: jest.fn(() => null), setItem: jest.fn(), deleteItemAsync: jest.fn(async () => {}) }));
jest.mock("expo-updates", () => ({ isEmbeddedLaunch: true, updateId: null }));
const mockRouter = { back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) };
jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

const texts = (t: ReactTestRenderer) =>
  t.root.findAll((n) => typeof n.props.children === "string").map((n) => n.props.children as string);
const button = (t: ReactTestRenderer, label: string) => t.root.find((n) => n.props.accessibilityLabel === label && !!n.props.onPress);

let tree: ReactTestRenderer | undefined;
const render = (el: React.ReactElement) => {
  act(() => {
    tree = create(el);
  });
  return tree!;
};
afterEach(() => {
  act(() => tree?.unmount());
  jest.clearAllMocks();
  useCrashLog.setState({ entries: [] });
});

test("the_screen_shows_the_message_saves_it_and_retries", () => {
  const retry = jest.fn(async () => {});
  const t = render(<ErrorScreen error={new TypeError("Cannot read properties of null (reading 'charAt')")} retry={retry} />);
  expect(texts(t)).toEqual(expect.arrayContaining(["Something went wrong", "Cannot read properties of null (reading 'charAt')"]));
  expect(useCrashLog.getState().entries).toMatchObject([{ kind: "screen", update: "built-in" }]);
  act(() => button(t, "Retry").props.onPress());
  expect(retry).toHaveBeenCalledTimes(1);
});

test("back_goes_back_and_a_screen_does_not_retry", () => {
  const retry = jest.fn(async () => {});
  const t = render(<ErrorScreen error={new Error("x")} retry={retry} />);
  act(() => button(t, "Back").props.onPress());
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  expect(retry).not.toHaveBeenCalled();
});

test("back_with_nothing_to_go_back_to_opens_overview_and_retries", () => {
  mockRouter.canGoBack.mockReturnValueOnce(false);
  const retry = jest.fn(async () => {});
  const t = render(<ErrorScreen error={new Error("x")} retry={retry} />);
  act(() => button(t, "Back").props.onPress());
  expect(mockRouter.replace).toHaveBeenCalledWith("/");
  expect(retry).toHaveBeenCalledTimes(1);
});

test("the_layout_screen_renders_the_layout_again_after_back", () => {
  const retry = jest.fn(async () => {});
  const t = render(<ErrorScreen error={new Error("x")} retry={retry} layout />);
  act(() => button(t, "Back").props.onPress());
  expect(mockRouter.back).toHaveBeenCalledTimes(1);
  expect(retry).toHaveBeenCalledTimes(1);
});
