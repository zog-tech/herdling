const mockSetCategory = jest.fn(async (..._a: unknown[]) => ({}));
jest.mock("expo-notifications", () => ({ setNotificationCategoryAsync: (...a: unknown[]) => mockSetCategory(...a) }));
jest.mock("@/hosts/connection", () => ({ retryNow: jest.fn(), waitForRpc: jest.fn() }));
jest.mock("@/ui/notice", () => ({ showNotice: jest.fn() }));

import { RpcError } from "@/rpc/RpcClient";

import { answerChoiceTap, choiceTap, registerChoiceCategory, type AnswerDeps, type ChoiceTap } from "./choiceActions";

const data = {
  hostId: "h_1",
  paneId: "w1:p1",
  choice: { yes: { key: "1", label: "Yes" }, no: { key: "3", label: "No, and tell Claude what to do differently (esc)" }, revision: 0 },
};

describe("registerChoiceCategory", () => {
  it("registers Yes and No, both foreground and with authentication; No is destructive", async () => {
    await registerChoiceCategory();
    expect(mockSetCategory).toHaveBeenCalledWith("herdling_choice", [
      { identifier: "choice_yes", buttonTitle: "Yes", options: { opensAppToForeground: true, isAuthenticationRequired: true } },
      { identifier: "choice_no", buttonTitle: "No", options: { opensAppToForeground: true, isDestructive: true, isAuthenticationRequired: true } },
    ]);
  });

  it("does not throw when the system refuses", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockSetCategory.mockRejectedValueOnce(new Error("no"));
    await expect(registerChoiceCategory()).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

describe("choiceTap", () => {
  it("takes the option of the tapped button", () => {
    expect(choiceTap("choice_yes", data)).toEqual({ hostId: "h_1", paneId: "w1:p1", key: "1", label: "Yes", answer: "Yes" });
    expect(choiceTap("choice_no", data)).toEqual({
      hostId: "h_1",
      paneId: "w1:p1",
      key: "3",
      label: "No, and tell Claude what to do differently (esc)",
      answer: "No",
    });
  });

  it("is null for a plain tap or bad data", () => {
    expect(choiceTap("expo.modules.notifications.actions.DEFAULT", data)).toBeNull();
    expect(choiceTap("choice_yes", { hostId: "h_1", paneId: "w1:p1" })).toBeNull();
    expect(choiceTap("choice_yes", { ...data, hostId: "" })).toBeNull();
    expect(choiceTap("choice_yes", { ...data, choice: { yes: { key: "enter", label: "Yes" } } })).toBeNull();
    expect(choiceTap("choice_no", { ...data, choice: { yes: data.choice.yes } })).toBeNull();
    expect(choiceTap("choice_yes", null)).toBeNull();
  });
});

describe("answerChoiceTap", () => {
  const tap: ChoiceTap = { hostId: "h_1", paneId: "w1:p1", key: "1", label: "Yes", answer: "Yes" };

  function setup(o: { pingFails?: boolean; answer?: () => Promise<unknown>; offline?: boolean } = {}) {
    const calls: { method: string; params: unknown }[] = [];
    const rpc = {
      call: jest.fn(async (method: string, params?: object) => {
        calls.push({ method, params });
        if (method === "ping" && o.pingFails) throw new RpcError("timeout", "ping timed out");
        if (method === "pane.answer") return (o.answer ?? (async () => ({ answered: true })))();
        return {};
      }),
    };
    const fresh = {
      call: jest.fn(async (method: string, params?: object) => {
        calls.push({ method: `fresh:${method}`, params });
        return method === "pane.answer" ? { answered: true } : {};
      }),
    };
    const notices: { text: string; failed?: boolean }[] = [];
    const deps: AnswerDeps = {
      connect: jest.fn(async (_h: string, isFresh: boolean) => (o.offline ? undefined : isFresh ? fresh : rpc)) as never,
      notice: (text, n) => notices.push({ text, failed: n?.failed }),
    };
    return { calls, deps, notices };
  }

  it("answers and shows Answered Yes", async () => {
    const s = setup();
    await expect(answerChoiceTap(tap, s.deps)).resolves.toBe("answered");
    expect(s.calls).toEqual([
      { method: "ping", params: {} },
      { method: "pane.answer", params: { pane_id: "w1:p1", key: "1", expect_label: "Yes" } },
    ]);
    expect(s.notices).toEqual([{ text: "Answered Yes", failed: undefined }]);
  });

  it("shows The question changed on stale", async () => {
    const s = setup({ answer: async () => Promise.reject(new RpcError("stale", "the menu changed")) });
    await expect(answerChoiceTap({ ...tap, key: "3", label: "No", answer: "No" }, s.deps)).resolves.toBe("stale");
    expect(s.notices).toEqual([{ text: "The question changed", failed: true }]);
  });

  it("connects again when the old connection does not answer a ping", async () => {
    const s = setup({ pingFails: true });
    await expect(answerChoiceTap(tap, s.deps)).resolves.toBe("answered");
    expect(s.deps.connect).toHaveBeenLastCalledWith("h_1", true);
    expect(s.calls.map((c) => c.method)).toEqual(["ping", "fresh:pane.answer"]);
  });

  it("fails clearly when the computer is not reachable", async () => {
    const s = setup({ offline: true });
    await expect(answerChoiceTap(tap, s.deps)).resolves.toBe("failed");
    expect(s.notices).toEqual([{ text: "Could not reach the computer", failed: true }]);
  });

  it("sends pane.answer once and fails on another error", async () => {
    const s = setup({ answer: async () => Promise.reject(new RpcError("herdr_unavailable", "down")) });
    await expect(answerChoiceTap(tap, s.deps)).resolves.toBe("failed");
    expect(s.calls.filter((c) => c.method.endsWith("pane.answer"))).toHaveLength(1);
    expect(s.notices[0]).toEqual({ text: "Could not answer. Answer in the session.", failed: true });
  });
});
