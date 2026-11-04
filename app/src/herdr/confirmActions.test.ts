import type { Hello } from "@herdling/protocol";

import { restartOptions, sessionToKeep } from "./confirmActions";
import type { AgentInfo } from "./snapshot";

jest.mock("@/ui/nativeSheet", () => ({ showActionSheet: jest.fn() }));

const agent = (over: Partial<AgentInfo> = {}): AgentInfo => ({
  pane_id: "w1:p1",
  tab_id: "w1:t1",
  workspace_id: "w1",
  agent: "codex",
  agent_status: "idle",
  cwd: "/home/sam/proj",
  state_change_seq: 1,
  ...over,
});
const hello = (thread_kinds?: string[]): Hello => ({ host: "studio.local", os: "macos", herdlingd: "0.1.4", herdr_ok: true, thread_kinds });

describe("restart choices", () => {
  it("offers to keep the conversation only with a session", () => {
    expect(restartOptions(true).map((o) => o.choice)).toEqual(["keep", "fresh", "options"]);
    expect(restartOptions(false).map((o) => o.choice)).toEqual(["fresh", "options"]);
  });

  it("finds no session to keep on a host that cannot resume the kind", async () => {
    const rpc = { call: jest.fn(async () => ({ kind: "codex", session: "s1", log_path: "/x", cwd: "/p" })) } as any;
    // A host whose thread_kinds lacks codex.
    expect(await sessionToKeep(rpc, hello(["claude"]), agent())).toBeUndefined();
    // A host without thread_kinds knows only Claude.
    expect(await sessionToKeep(rpc, hello(undefined), agent())).toBeUndefined();
    expect(rpc.call).not.toHaveBeenCalled();
    expect(await sessionToKeep(rpc, hello(["claude", "codex"]), agent())).toBe("s1");
  });
});
