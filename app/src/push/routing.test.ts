import { act, create } from "react-test-renderer";
import { createElement } from "react";

const mockPush = jest.fn();
const mockSetParams = jest.fn();
let mockNavKey: string | undefined = "root";
let mockPath = "/";
jest.mock("expo-router", () => ({
  useRouter: () => ({ navigate: mockPush, setParams: mockSetParams }),
  usePathname: () => mockPath,
  useRootNavigationState: () => (mockNavKey ? { key: mockNavKey } : undefined),
}));

let mockLast: unknown = null;
let mockListener: ((r: unknown) => void) | undefined;
const mockRemove = jest.fn();
const mockClear = jest.fn();
let mockPresented: unknown[] = [];
const mockDismiss = jest.fn(async (_id: string) => {});
jest.mock("expo-notifications", () => ({
  getPresentedNotificationsAsync: async () => mockPresented,
  dismissNotificationAsync: (id: string) => mockDismiss(id),
  getLastNotificationResponse: () => mockLast,
  clearLastNotificationResponse: () => mockClear(),
  addNotificationResponseReceivedListener: (cb: (r: unknown) => void) => {
    mockListener = cb;
    return { remove: mockRemove };
  },
}));

const mockAnswerCalls: { method: string; params: unknown }[] = [];
const mockNotice = jest.fn();
jest.mock("@/hosts/connection", () => ({
  retryNow: jest.fn(),
  waitForRpc: async () => ({
    call: async (method: string, params: unknown) => {
      mockAnswerCalls.push({ method, params });
      return method === "pane.answer" ? { answered: true } : {};
    },
  }),
}));
jest.mock("@/ui/notice", () => ({ showNotice: (...a: unknown[]) => mockNotice(...a) }));

let mockLayout: "compact" | "regular" = "compact";
jest.mock("@/ui/layout", () => ({ useLayoutClass: () => mockLayout }));

import { columnTarget, isPushSession, notificationTarget, setColumnPane, showBannerFor, useNotificationRouting } from "./useNotificationRouting";

function response(id: string, data: unknown) {
  return { notification: { request: { identifier: id, content: { data } } } };
}

function Probe() {
  useNotificationRouting();
  return null;
}

beforeEach(() => {
  mockPush.mockReset();
  mockSetParams.mockReset();
  mockPath = "/";
  mockClear.mockReset();
  mockRemove.mockReset();
  mockLast = null;
  mockListener = undefined;
  mockNavKey = "root";
  mockLayout = "compact";
  setColumnPane(null);
  mockPresented = [];
  mockDismiss.mockClear();
});

describe("notificationTarget", () => {
  it("target_from_data", () => {
    expect(notificationTarget({ hostId: "h_1", paneId: "w1:p1" })).toBe("/session/h_1/w1%3Ap1?from=push");
  });

  it("target_encodes_host_id", () => {
    expect(notificationTarget({ hostId: "h 1/x", paneId: "p" })).toBe("/session/h%201%2Fx/p?from=push");
  });

  it("target_rejects_bad_data", () => {
    expect(notificationTarget({ hostId: "h_1" })).toBeNull();
    expect(notificationTarget({ hostId: "h_1", paneId: 7 })).toBeNull();
    expect(notificationTarget({ hostId: 1, paneId: "w1:p1" })).toBeNull();
    expect(notificationTarget({ hostId: "", paneId: "w1:p1" })).toBeNull();
    expect(notificationTarget(null)).toBeNull();
    expect(notificationTarget("h_1")).toBeNull();
    expect(notificationTarget(undefined)).toBeNull();
  });
});

describe("useNotificationRouting", () => {
  it("routes_cold_start_response_once", () => {
    mockLast = response("n1", { hostId: "h_1", paneId: "w1:p1" });
    let r: ReturnType<typeof create> | undefined;
    act(() => {
      r = create(createElement(Probe));
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith("/session/h_1/w1%3Ap1?from=push");
    expect(mockClear).toHaveBeenCalled();
    // The same response through the listener does not route a second time.
    act(() => mockListener?.(response("n1", { hostId: "h_1", paneId: "w1:p1" })));
    expect(mockPush).toHaveBeenCalledTimes(1);
    act(() => r?.unmount());
    expect(mockRemove).toHaveBeenCalled();
  });

  it("routes_tap_while_running", () => {
    act(() => {
      create(createElement(Probe));
    });
    expect(mockPush).not.toHaveBeenCalled();
    act(() => mockListener?.(response("n2", { hostId: "h_2", paneId: "w2:p3" })));
    expect(mockPush).toHaveBeenCalledWith("/session/h_2/w2%3Ap3?from=push");
  });

  it("ignores_response_with_bad_data", () => {
    act(() => {
      create(createElement(Probe));
    });
    act(() => mockListener?.(response("n3", { paneId: "w1:p1" })));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("waits_for_navigation_before_routing", () => {
    mockNavKey = undefined;
    mockLast = response("n4", { hostId: "h_1", paneId: "p" });
    let r: ReturnType<typeof create> | undefined;
    act(() => {
      r = create(createElement(Probe));
    });
    expect(mockPush).not.toHaveBeenCalled();
    mockNavKey = "root";
    act(() => r?.update(createElement(Probe)));
    expect(mockPush).toHaveBeenCalledWith("/session/h_1/p?from=push");
  });
});

describe("push for the open session", () => {
  it("is_push_session_matches_encoded_and_plain_paths", () => {
    const data = { hostId: "h_1", paneId: "w1:p1" };
    expect(isPushSession("/session/h_1/w1:p1", data)).toBe(true);
    expect(isPushSession("/session/h_1/w1%3Ap1", data)).toBe(true);
    expect(isPushSession("/session/h_1/w1:p2", data)).toBe(false);
    expect(isPushSession("/session/h_2/w1:p1", data)).toBe(false);
    expect(isPushSession("/resume/h_1/w1:p1", data)).toBe(false);
    expect(isPushSession(undefined, data)).toBe(false);
    expect(isPushSession("/session/h_1/w1:p1", null)).toBe(false);
  });

  it("tap_on_open_session_sets_params_instead_of_a_second_screen", () => {
    mockPath = "/session/h_1/w1:p1";
    act(() => {
      create(createElement(Probe));
    });
    act(() => mockListener?.(response("n5", { hostId: "h_1", paneId: "w1:p1" })));
    expect(mockSetParams).toHaveBeenCalledWith({ from: "push" });
    expect(mockPush).not.toHaveBeenCalled();
    // Another pane opens its own screen.
    act(() => mockListener?.(response("n6", { hostId: "h_1", paneId: "w1:p2" })));
    expect(mockPush).toHaveBeenCalledWith("/session/h_1/w1%3Ap2?from=push");
  });

  it("no_banner_while_that_session_is_on_screen", () => {
    mockPath = "/session/h_1/w1:p1";
    act(() => {
      create(createElement(Probe));
    });
    expect(showBannerFor({ hostId: "h_1", paneId: "w1:p1" })).toBe(false);
    expect(showBannerFor({ hostId: "h_1", paneId: "w1:p2" })).toBe(true);
  });
});

describe("choice buttons", () => {
  const data = {
    hostId: "h_1",
    paneId: "w1:p1",
    choice: { yes: { key: "1", label: "Yes" }, no: { key: "3", label: "No, and tell Claude what to do differently (esc)" }, revision: 0 },
  };
  const tap = (id: string, actionIdentifier: string) => ({ actionIdentifier, ...response(id, data) });
  const flush = async () => {
    for (let i = 0; i < 5; i++) await act(async () => {});
  };

  beforeEach(() => {
    mockAnswerCalls.length = 0;
    mockNotice.mockReset();
  });

  it("a No tap opens the session and answers the menu", async () => {
    act(() => {
      create(createElement(Probe));
    });
    act(() => mockListener?.(tap("c1", "choice_no")));
    expect(mockPush).toHaveBeenCalledWith("/session/h_1/w1%3Ap1?from=push");
    await flush();
    expect(mockAnswerCalls.at(-1)).toEqual({
      method: "pane.answer",
      params: { pane_id: "w1:p1", key: "3", expect_label: "No, and tell Claude what to do differently (esc)" },
    });
    expect(mockNotice).toHaveBeenCalledWith("Answered No");
  });

  it("the cold-start Yes tap answers once", async () => {
    mockLast = tap("c2", "choice_yes");
    act(() => {
      create(createElement(Probe));
    });
    act(() => mockListener?.(tap("c2", "choice_yes")));
    await flush();
    expect(mockAnswerCalls.filter((c) => c.method === "pane.answer")).toEqual([
      { method: "pane.answer", params: { pane_id: "w1:p1", key: "1", expect_label: "Yes" } },
    ]);
  });

  it("an answer dismisses the delivered notifications of the pane", async () => {
    mockPresented = [response("c4", data).notification, response("c5", { hostId: "h_1", paneId: "w1:p2" }).notification];
    act(() => {
      create(createElement(Probe));
    });
    act(() => mockListener?.(tap("c4", "choice_yes")));
    await flush();
    expect(mockNotice).toHaveBeenCalledWith("Answered Yes");
    expect(mockDismiss.mock.calls.map((c) => c[0])).toEqual(["c4"]);
  });

  it("a plain tap on a push with choices does not answer", async () => {
    act(() => {
      create(createElement(Probe));
    });
    act(() => mockListener?.(tap("c3", "expo.modules.notifications.actions.DEFAULT")));
    await flush();
    expect(mockAnswerCalls).toEqual([]);
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});

describe("two-column layout", () => {
  it("column_target_selects_the_pane_in_overview", () => {
    expect(columnTarget({ hostId: "h_1", paneId: "w1:p1" })).toEqual({
      pathname: "/",
      params: { host: "h_1", pane: "w1:p1", from: "push" },
    });
    expect(columnTarget({ hostId: "h_1" })).toBeNull();
  });

  it("tap_in_regular_width_opens_the_pane_in_the_column", () => {
    mockLayout = "regular";
    act(() => {
      create(createElement(Probe));
    });
    act(() => mockListener?.(response("n7", { hostId: "h_1", paneId: "w1:p1" })));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/", params: { host: "h_1", pane: "w1:p1", from: "push" } });
  });

  it("no_banner_while_the_column_shows_that_pane", () => {
    setColumnPane({ hostId: "h_1", paneId: "w1:p1" });
    expect(showBannerFor({ hostId: "h_1", paneId: "w1:p1" })).toBe(false);
    expect(showBannerFor({ hostId: "h_1", paneId: "w1:p2" })).toBe(true);
    setColumnPane(null);
    expect(showBannerFor({ hostId: "h_1", paneId: "w1:p1" })).toBe(true);
  });
});

describe("column pane", () => {
  it("a newly shown pane dismisses its notifications once", async () => {
    mockPresented = [response("k1", { hostId: "h_1", paneId: "w1:p1" }).notification];
    setColumnPane({ hostId: "h_1", paneId: "w1:p1" });
    setColumnPane({ hostId: "h_1", paneId: "w1:p1" });
    await act(async () => {});
    expect(mockDismiss.mock.calls.map((c) => c[0])).toEqual(["k1"]);
  });
});
