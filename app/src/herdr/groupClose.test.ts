import { RpcError } from "@/rpc/RpcClient";

import { closeWithGroupIntent, groupCloseLabel, isGroupCloseRefusal, linkedWorktreeCount } from "./groupClose";

jest.mock("@/ui/nativeSheet", () => ({ showActionSheet: jest.fn() }));

const PANE_REFUSAL = new RpcError("confirmation_required", "closing this pane would close a worktree group");
const WS_REFUSAL = new RpcError(
  "workspace_group_close_required",
  "workspace has linked worktree workspaces; use --group (close_group=true in the API) to close the group",
);

/** A `workspace.list` answer: w1 is the primary of a group with two linked worktrees; w9 is another repo. */
const LIST = {
  type: "workspace_list",
  workspaces: [
    { workspace_id: "w1", worktree: { repo_key: "/home/sam/proj", is_linked_worktree: false } },
    { workspace_id: "w2", worktree: { repo_key: "/home/sam/proj", is_linked_worktree: true } },
    { workspace_id: "w3", worktree: { repo_key: "/home/sam/proj", is_linked_worktree: true } },
    { workspace_id: "w9", worktree: { repo_key: "/home/sam/other", is_linked_worktree: true } },
    { workspace_id: "w5", worktree: null },
  ],
};

function fakeRpc(list: unknown = LIST) {
  const calls: { method: string; params: unknown }[] = [];
  return {
    calls,
    call: jest.fn(async (_m: string, p: { method: string; params: unknown }) => {
      calls.push(p);
      if (p.method === "workspace.list") return list as never;
      return { type: "ok" } as never;
    }),
  };
}

describe("isGroupCloseRefusal", () => {
  it("knows both refusals of herdr 0.9", () => {
    expect(isGroupCloseRefusal(PANE_REFUSAL)).toBe(true);
    expect(isGroupCloseRefusal(new RpcError("confirmation_required", "closing this tab would close a worktree group"))).toBe(true);
    expect(isGroupCloseRefusal(WS_REFUSAL)).toBe(true);
  });

  it("does not take other errors for a refusal", () => {
    expect(isGroupCloseRefusal(new RpcError("confirmation_required", "something else"))).toBe(false);
    expect(isGroupCloseRefusal(new RpcError("pane_not_found", "worktree group"))).toBe(false);
    expect(isGroupCloseRefusal(undefined)).toBe(false);
  });
});

describe("linkedWorktreeCount", () => {
  it("counts the linked worktrees of the same repo", () => {
    expect(linkedWorktreeCount(LIST, "w1")).toBe(2);
  });

  it("is undefined when the list does not say", () => {
    expect(linkedWorktreeCount(LIST, "w5")).toBeUndefined();
    expect(linkedWorktreeCount(LIST, "nope")).toBeUndefined();
    expect(linkedWorktreeCount({}, "w1")).toBeUndefined();
  });

  it("names the option with the count", () => {
    expect(groupCloseLabel(2)).toBe("Close the workspace and its 2 worktrees");
    expect(groupCloseLabel(1)).toBe("Close the workspace and its 1 worktree");
    expect(groupCloseLabel(undefined)).toBe("Close the workspace and its worktrees");
  });
});

describe("closeWithGroupIntent", () => {
  it("does nothing more when the close works", async () => {
    const rpc = fakeRpc();
    const ask = jest.fn();
    expect(await closeWithGroupIntent(rpc, "w1", async () => {}, ask)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
    expect(rpc.calls).toEqual([]);
  });

  it("asks with the count, then closes the group with close_group", async () => {
    const rpc = fakeRpc();
    const ask = jest.fn(async () => true);
    const ok = await closeWithGroupIntent(
      rpc,
      "w1",
      async () => {
        throw PANE_REFUSAL;
      },
      ask,
    );
    expect(ok).toBe(true);
    expect(ask).toHaveBeenCalledWith(2);
    expect(rpc.calls).toEqual([
      { method: "workspace.list", params: {} },
      { method: "workspace.close", params: { workspace_id: "w1", close_group: true } },
    ]);
  });

  it("keeps the group when the user cancels", async () => {
    const rpc = fakeRpc();
    const ok = await closeWithGroupIntent(
      rpc,
      "w1",
      async () => {
        throw WS_REFUSAL;
      },
      async () => false,
    );
    expect(ok).toBe(false);
    expect(rpc.calls.map((c) => c.method)).toEqual(["workspace.list"]);
  });

  it("still asks when workspace.list fails", async () => {
    const rpc = {
      call: jest.fn(async (_m: string, p: { method: string }) => {
        if (p.method === "workspace.list") throw new Error("down");
        return {} as never;
      }),
    };
    const ask = jest.fn(async () => true);
    await closeWithGroupIntent(
      rpc,
      "w1",
      async () => {
        throw PANE_REFUSAL;
      },
      ask,
    );
    expect(ask).toHaveBeenCalledWith(undefined);
  });

  it("passes other errors through, and a refusal without a workspace", async () => {
    const rpc = fakeRpc();
    const ask = jest.fn();
    const other = new RpcError("pane_not_found", "gone");
    await expect(
      closeWithGroupIntent(
        rpc,
        "w1",
        async () => {
          throw other;
        },
        ask,
      ),
    ).rejects.toBe(other);
    await expect(
      closeWithGroupIntent(
        rpc,
        undefined,
        async () => {
          throw PANE_REFUSAL;
        },
        ask,
      ),
    ).rejects.toBe(PANE_REFUSAL);
    expect(ask).not.toHaveBeenCalled();
  });
});
