import { existsSync } from "fs";
import { join } from "path";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { MORE_ROUTES, MorePage } from "./MorePage";
import { useUsageSummary } from "./usageSummary";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/secureStorage", () => {
  const { createJSONStorage } = jest.requireActual("zustand/middleware");
  const mem = new Map<string, string>();
  return {
    secureJSONStorage: () =>
      createJSONStorage(() => ({
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, v),
        removeItem: (k: string) => void mem.delete(k),
      })),
  };
});
jest.mock("expo-secure-store", () => ({
  getItem: jest.fn(() => null),
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock("expo-constants", () => ({ expoConfig: { version: "1.2.3" } }));
jest.mock("expo-updates", () => ({ isEmbeddedLaunch: true }));
jest.mock("@/hosts/store", () => ({
  useHosts: (sel: (s: { hosts: { id: string; name: string }[] }) => unknown) => sel({ hosts: [{ id: "h1", name: "studio.local" }] }),
}));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

let tree: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  mockPush.mockClear();
  useUsageSummary.setState({ byHost: {} });
});

const render = () => {
  act(() => {
    tree = create(<MorePage />);
  });
  return tree!;
};
const row = (t: ReactTestRenderer, title: string) => t.root.find((n) => n.props.accessibilityLabel === title && typeof n.props.onPress === "function");

test("the_index_lists_the_pages_in_the_order_of_the_spec", () => {
  const t = render();
  const titles = t.root
    .findAll((n) => n.props.accessibilityRole === "button" && typeof n.props.onPress === "function" && typeof n.props.accessibilityLabel === "string")
    .map((n) => n.props.accessibilityLabel as string);
  expect([...new Set(titles)]).toEqual([
    "Computers",
    "Usage",
    "Automations",
    "Appearance",
    "Voice",
    "Notifications",
    "Terminal",
    "Prompts",
    "General",
    "Diagnostics",
    "About",
  ]);
});

test("each_row_opens_its_page_and_usage_and_automations_keep_their_old_paths", () => {
  const t = render();
  act(() => row(t, "Usage").props.onPress());
  act(() => row(t, "Automations").props.onPress());
  act(() => row(t, "Computers").props.onPress());
  act(() => row(t, "Prompts").props.onPress());
  expect(mockPush.mock.calls.map((c) => c[0])).toEqual(["/usage", "/automations", "/settings/computers", "/saved-prompts"]);
});

test("the_rows_show_their_values_and_usage_shows_one_only_with_data", () => {
  const t = render();
  expect(row(t, "Usage").props.accessibilityValue).toBeUndefined();
  expect(row(t, "Computers").props.accessibilityValue).toEqual({ text: "1" });
  expect(row(t, "About").props.accessibilityValue).toEqual({ text: "1.2.3" });
  expect(row(t, "Notifications").props.accessibilityValue).toEqual({ text: "On" });
  act(() =>
    useUsageSummary.setState({
      byHost: { h1: { providers: [{ provider: "claude", status: "ok", windows: [{ label: "5h", used_pct: 37, resets_at: null }] }] } },
    }),
  );
  expect(row(t, "Usage").props.accessibilityValue).toEqual({ text: "37% used" });
});

test("every_route_of_the_index_has_a_route_file", () => {
  const app = join(__dirname, "..", "app");
  const file = (route: string) => {
    if (route.startsWith("/settings/")) return join(app, "(tabs)", "settings", `${route.slice("/settings/".length)}.tsx`);
    return join(app, `${route.slice(1)}.tsx`);
  };
  for (const route of Object.values(MORE_ROUTES)) expect(existsSync(file(route))).toBe(true);
  // The old tab folders are gone, so `/usage` and `/automations` resolve to the stack screens only.
  expect(existsSync(join(app, "(tabs)", "usage"))).toBe(false);
  expect(existsSync(join(app, "(tabs)", "automations"))).toBe(false);
});
