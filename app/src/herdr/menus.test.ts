import type { MenuSpec } from "@/ui/MenuSheet";

import { chooseRestart } from "./confirmActions";
import { chooseGroupClose } from "./groupClose";
import { moveToGroup } from "./moveFlow";

jest.mock("@/ui/MenuSheet", () => ({ showMenu: jest.fn() }));
jest.mock("@/ui/nativeSheet", () => ({ showActionSheet: jest.fn(), promptText: jest.fn() }));
jest.mock("@/ui/haptics", () => ({ warn: jest.fn(), commit: jest.fn(), fail: jest.fn() }));

const { showMenu } = jest.requireMock<{ showMenu: jest.Mock }>("@/ui/MenuSheet");
const lastMenu = (): MenuSpec => showMenu.mock.calls.at(-1)![0];

beforeEach(() => showMenu.mockReset());

describe("restart sheet", () => {
  it("shows one row per choice with an icon, and resolves the picked choice", async () => {
    const answer = chooseRestart(true);
    const menu = lastMenu();
    expect(menu.title).toBe("Restart this agent?");
    const items = menu.sections[0].items;
    expect(items.map((i) => i.label)).toEqual(["Restart and keep the conversation", "Restart with a new conversation", "Restart with options…"]);
    expect(items.every((i) => i.Icon)).toBe(true);
    items[1].onPick();
    expect(await answer).toBe("fresh");
  });

  it("resolves undefined when the sheet closes with no pick", async () => {
    const answer = chooseRestart(false);
    expect(lastMenu().sections[0].items).toHaveLength(2);
    lastMenu().onClose?.();
    expect(await answer).toBeUndefined();
  });
});

describe("group close sheet", () => {
  it("has one destructive row and resolves true for it", async () => {
    const answer = chooseGroupClose(2);
    const [item] = lastMenu().sections[0].items;
    expect(item.label).toBe("Close the workspace and its 2 worktrees");
    expect(item.destructive).toBe(true);
    item.onPick();
    expect(await answer).toBe(true);
  });

  it("resolves false when the sheet closes with no pick", async () => {
    const answer = chooseGroupClose(undefined);
    lastMenu().onClose?.();
    expect(await answer).toBe(false);
  });
});

describe("move sheet", () => {
  it("lists the spaces first, then the other targets, and moves on a pick", async () => {
    const call = jest.fn(async (method: string) =>
      method === "groups.list"
        ? { groups: [{ workspace_id: "w2", label: "web", source: "space" }, { workspace_id: "w1", label: "api", source: "space" }] }
        : {},
    );
    await moveToGroup({ call } as never, { pane_id: "p1", workspace_id: "w1", group_source: "label" });
    const [spaces, others] = lastMenu().sections;
    expect(spaces.title).toBe("Spaces");
    // The current space is not a target.
    expect(spaces.items.map((i) => i.label)).toEqual(["web"]);
    expect(spaces.items[0].leading).toBeTruthy();
    expect(others.items.map((i) => i.label)).toEqual(["New space", "Name a group…", "Remove the group name"]);
    spaces.items[0].onPick();
    await Promise.resolve();
    expect(call).toHaveBeenCalledWith("pane.move", { pane_id: "p1", workspace_id: "w2" });
  });
});
