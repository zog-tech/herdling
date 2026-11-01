jest.mock("expo-notifications", () => ({}));

import type * as Notifications from "expo-notifications";

import { dismissPaneNotifications, isPaneNotification, type DismissDeps } from "./dismiss";

const note = (identifier: string, data: unknown) => ({ request: { identifier, content: { data } } }) as unknown as Notifications.Notification;

function deps(list: Notifications.Notification[]): DismissDeps & { dismiss: jest.Mock } {
  return { presented: async () => list, dismiss: jest.fn(async (_id: string) => {}) };
}

test("dismisses_only_the_notifications_of_the_pane", async () => {
  const d = deps([
    note("a", { hostId: "h_1", paneId: "w1:p1" }),
    note("b", { hostId: "h_1", paneId: "w1:p2" }),
    note("c", { hostId: "h_2", paneId: "w1:p1" }),
    note("d", { hostId: "h_1", paneId: "w1:p1", choice: {} }),
    note("e", null),
  ]);
  await expect(dismissPaneNotifications("h_1", "w1:p1", d)).resolves.toBe(2);
  expect(d.dismiss.mock.calls.map((c) => c[0])).toEqual(["a", "d"]);
});

test("no_match_dismisses_nothing", async () => {
  const d = deps([note("a", { hostId: "h_1", paneId: "w1:p2" })]);
  await expect(dismissPaneNotifications("h_1", "w1:p1", d)).resolves.toBe(0);
  expect(d.dismiss).not.toHaveBeenCalled();
});

test("empty_ids_dismiss_nothing", async () => {
  const d = deps([note("a", { hostId: "", paneId: "" })]);
  await expect(dismissPaneNotifications("", "", d)).resolves.toBe(0);
  expect(d.dismiss).not.toHaveBeenCalled();
});

test("never_throws", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  const failing: DismissDeps = {
    presented: async () => {
      throw new Error("no");
    },
    dismiss: async () => {},
  };
  await expect(dismissPaneNotifications("h_1", "w1:p1", failing)).resolves.toBe(0);
  warn.mockRestore();
});

test("one_failed_dismiss_does_not_stop_the_others", async () => {
  const d = deps([note("a", { hostId: "h_1", paneId: "w1:p1" }), note("b", { hostId: "h_1", paneId: "w1:p1" })]);
  d.dismiss.mockRejectedValueOnce(new Error("gone"));
  await expect(dismissPaneNotifications("h_1", "w1:p1", d)).resolves.toBe(1);
  expect(d.dismiss).toHaveBeenCalledTimes(2);
});

test("is_pane_notification_checks_both_ids", () => {
  expect(isPaneNotification({ hostId: "h_1", paneId: "w1:p1" }, "h_1", "w1:p1")).toBe(true);
  expect(isPaneNotification({ hostId: "h_1" }, "h_1", "w1:p1")).toBe(false);
  expect(isPaneNotification("x", "h_1", "w1:p1")).toBe(false);
});
