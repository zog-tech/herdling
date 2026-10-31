import type { CommandInfo } from "@herdling/protocol";

jest.mock("@/hosts/connection", () => ({ useHostConn: () => ({ status: "offline", attempt: 0 }) }));

import { commandsApply, filterCommands, slashQuery } from "./commands";

const c = (name: string): CommandInfo => ({ name, source: "user" });
const list = [c("clear"), c("compact"), c("deploy-app"), c("superpowers:brainstorming"), c("tools:compact-all")];
const names = (l: CommandInfo[]) => l.map((x) => x.name);

test("slash_query_only_before_the_first_space", () => {
  expect(slashQuery("/")).toBe("");
  expect(slashQuery("/com")).toBe("com");
  expect(slashQuery("/compact now")).toBeUndefined();
  expect(slashQuery("/compact ")).toBeUndefined();
  expect(slashQuery("hello /x")).toBeUndefined();
  expect(slashQuery("")).toBeUndefined();
});

test("filter_puts_prefix_matches_before_substring_matches", () => {
  expect(names(filterCommands(list, "comp"))).toEqual(["compact", "tools:compact-all"]);
  expect(names(filterCommands(list, "STORM"))).toEqual(["superpowers:brainstorming"]);
  expect(names(filterCommands(list, "a"))).toEqual([
    "clear",
    "compact",
    "deploy-app",
    "superpowers:brainstorming",
    "tools:compact-all",
  ]);
  expect(names(filterCommands(list, "c"))).toEqual(["clear", "compact", "tools:compact-all"]);
  expect(filterCommands(list, "")).toBe(list);
  expect(filterCommands(list, "zzz")).toEqual([]);
});

test("commands_apply_to_claude_or_unknown_agents", () => {
  expect(commandsApply("claude")).toBe(true);
  expect(commandsApply(undefined)).toBe(true);
  expect(commandsApply("unknown")).toBe(true);
  expect(commandsApply("codex")).toBe(false);
});
