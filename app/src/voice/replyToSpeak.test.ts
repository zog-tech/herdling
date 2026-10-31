import type { ThreadItem } from "@herdling/protocol";

import { replyToSpeak, shouldSpeak } from "./replyToSpeak";

const user = (id: string): ThreadItem => ({ kind: "user", id, ts: 0, text: "q" });
const asst = (id: string, markdown: string): ThreadItem => ({ kind: "assistant", id, ts: 0, markdown });
const tool = (id: string): ThreadItem => ({ kind: "tool", id, ts: 0, name: "Bash", input_summary: "ls", input: {} });

describe("replyToSpeak", () => {
  it("reply_after_last_user", () => {
    expect(replyToSpeak([user("1"), asst("2", "a"), user("3"), asst("4", "b"), tool("5"), asst("6", "c")])).toBe("b\n\nc");
    expect(replyToSpeak([user("1"), asst("2", "a"), user("3"), tool("4")])).toBeNull();
    expect(replyToSpeak([])).toBeNull();
  });
});

describe("shouldSpeak", () => {
  it("should_speak_only_from_working", () => {
    expect(shouldSpeak("working", "idle")).toBe(true);
    expect(shouldSpeak("working", "done")).toBe(true);
    expect(shouldSpeak("blocked", "idle")).toBe(false);
    expect(shouldSpeak(undefined, "idle")).toBe(false);
    expect(shouldSpeak("working", "blocked")).toBe(false);
  });
});
