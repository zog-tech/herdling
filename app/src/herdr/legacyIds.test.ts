import { hostPlainId, plainId, setCoreActions } from "./backend";
import { migrateSeen, pruneSeen, useSeen } from "./seen";
import { isPaneNotification } from "@/push/dismiss";
import { notificationTarget } from "@/push/useNotificationRouting";

jest.mock("expo-router", () => ({}));
jest.mock("expo-notifications", () => ({}));
jest.mock("@/push/choiceActions", () => ({}));

describe("old hc: ids on a herdlingd 0.2.0 host", () => {
  beforeAll(() => {
    setCoreActions("h2", { methods: ["session.start"], herdlingd: "0.2.0" });
    setCoreActions("h1", { methods: ["session.start"], herdlingd: "0.1.9" });
  });

  it("strips one leading hc: only on a Herdr 2 only host", () => {
    expect(plainId("hc:t7", true)).toBe("t7");
    expect(plainId("hc:space:s1", true)).toBe("space:s1");
    expect(plainId("t7", true)).toBe("t7");
    expect(plainId("hc:t7", false)).toBe("hc:t7");
    expect(hostPlainId("h2", "hc:t7")).toBe("t7");
    expect(hostPlainId("h1", "hc:t7")).toBe("hc:t7");
    expect(hostPlainId("unknown", "hc:t7")).toBe("hc:t7");
  });

  it("a delivered push with an old id opens the plain pane", () => {
    expect(notificationTarget({ hostId: "h2", paneId: "hc:t7" })).toBe("/session/h2/t7?from=push");
    expect(notificationTarget({ hostId: "h1", paneId: "hc:t7" })).toBe("/session/h1/hc%3At7?from=push");
  });

  it("a delivered push with an old id is the notification of the plain pane", () => {
    expect(isPaneNotification({ hostId: "h2", paneId: "hc:t7" }, "h2", "t7")).toBe(true);
    expect(isPaneNotification({ hostId: "h2", paneId: "t7" }, "h2", "hc:t7")).toBe(true);
    expect(isPaneNotification({ hostId: "h1", paneId: "hc:t7" }, "h1", "t7")).toBe(false);
  });

  it("the seen state of an old id moves to the plain id", () => {
    const seen = { "h2:hc:t7": 5, "h2:t7": 3, "h2:hc:t8": 2, "h1:hc:t7": 9, "h2:p1": 1 };
    expect(migrateSeen(seen, "h2")).toEqual({ "h2:t7": 5, "h2:t8": 2, "h1:hc:t7": 9, "h2:p1": 1 });
    // Nothing to move: the same object.
    const clean = { "h2:t7": 1 };
    expect(migrateSeen(clean, "h2")).toBe(clean);
  });

  it("pruneSeen keeps the moved entries of a Herdr 2 only host", () => {
    useSeen.setState({ seen: { "h2:hc:t7": 4, "h2:hc:t9": 1 } });
    pruneSeen("h2", ["t7"]);
    expect(useSeen.getState().seen).toEqual({ "h2:t7": 4 });
  });
});
