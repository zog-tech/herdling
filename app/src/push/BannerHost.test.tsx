import { act } from "react-test-renderer";

import { useNotifPrefs } from "./prefs";

let mockOpen: { hostId: string; paneId: string } | null = null;
jest.mock("./useNotificationRouting", () => ({
  showBannerFor: (d: { hostId: string; paneId: string }) => !(mockOpen && mockOpen.hostId === d.hostId && mockOpen.paneId === d.paneId),
}));
jest.mock("@/ui/haptics", () => ({ tap: jest.fn() }));
jest.mock("@/secureStorage", () => ({ secureJSONStorage: () => undefined }));
jest.mock("expo-router", () => ({ useRouter: () => ({ navigate: jest.fn() }) }));

import { addBanners, bannerOpened, useBanner } from "./BannerHost";
import { BANNER_MS, BANNER_START, type BannerItem } from "./banner";

const item = (paneId: string, kind: BannerItem["kind"] = "blocked"): BannerItem => ({ key: `h1:${paneId}:${kind}`, hostId: "h1", paneId, kind, title: paneId, detail: "" });

beforeEach(() => {
  jest.useFakeTimers();
  useBanner.setState(BANNER_START, true);
  useNotifPrefs.setState({ finished: true, needs_you: true });
  mockOpen = null;
});
afterEach(() => jest.useRealTimers());

test("a_banner_goes_away_after_its_time_and_the_next_shows", () => {
  addBanners([item("p1"), item("p2")]);
  expect(useBanner.getState().current?.paneId).toBe("p1");
  act(() => jest.advanceTimersByTime(BANNER_MS));
  expect(useBanner.getState().current?.paneId).toBe("p2");
  act(() => jest.advanceTimersByTime(BANNER_MS));
  expect(useBanner.getState().current).toBeUndefined();
});

test("no_banner_for_the_open_session_or_a_kind_that_is_off", () => {
  mockOpen = { hostId: "h1", paneId: "p1" };
  useNotifPrefs.setState({ finished: false });
  addBanners([item("p1"), item("p2", "done"), item("p3", "shell")]);
  expect(useBanner.getState().current?.paneId).toBe("p3");
});

test("opening_the_pane_hides_its_banner", () => {
  addBanners([item("p1")]);
  bannerOpened("h1", "p1");
  expect(useBanner.getState().current).toBeUndefined();
});
