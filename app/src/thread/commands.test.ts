import type { CommandInfo } from "@herdling/protocol";

jest.mock("@/hosts/connection", () => ({ useHostConn: () => ({ status: "offline", attempt: 0 }) }));

import { commandQuery, commandsApply, commandsFor, commandTriggers, filterCommands } from "./commands";

const c = (name: string): CommandInfo => ({ name, source: "user" });
const list = [c("clear"), c("compact"), c("deploy-app"), c("superpowers:brainstorming"), c("tools:compact-all")];
const names = (l: CommandInfo[]) => l.map((x) => x.name);

test("slash_query_only_before_the_first_space", () => {
  const q = (t: string) => commandQuery(t, commandTriggers("claude"));
  expect(q("/")).toEqual({ trigger: "/", query: "" });
  expect(q("/com")).toEqual({ trigger: "/", query: "com" });
  expect(q("/compact now")).toBeUndefined();
  expect(q("/compact ")).toBeUndefined();
  expect(q("hello /x")).toBeUndefined();
  expect(q("")).toBeUndefined();
  // Claude has no `$` trigger.
  expect(q("$sk")).toBeUndefined();
});

test("codex_query_opens_on_slash_or_dollar", () => {
  const q = (t: string) => commandQuery(t, commandTriggers("codex"));
  expect(q("$")).toEqual({ trigger: "$", query: "" });
  expect(q("$dep")).toEqual({ trigger: "$", query: "dep" });
  expect(q("/rev")).toEqual({ trigger: "/", query: "rev" });
  expect(q("$dep now")).toBeUndefined();
  expect(q("use $dep")).toBeUndefined();
});

test("opencode_query_opens_on_slash_or_at_and_pi_on_slash_only", () => {
  const q = (kind: string, t: string) => commandQuery(t, commandTriggers(kind));
  expect(q("opencode", "@")).toEqual({ trigger: "@", query: "" });
  expect(q("opencode", "@dep")).toEqual({ trigger: "@", query: "dep" });
  expect(q("opencode", "/nested/sy")).toEqual({ trigger: "/", query: "nested/sy" });
  expect(q("opencode", "$dep")).toBeUndefined();
  expect(q("opencode", "@dep now")).toBeUndefined();
  expect(q("opencode", "see @dep")).toBeUndefined();
  expect(q("pi", "/skill:dep")).toEqual({ trigger: "/", query: "skill:dep" });
  expect(q("pi", "@dep")).toBeUndefined();
  expect(q("pi", "$dep")).toBeUndefined();
  expect(q("codex", "@dep")).toBeUndefined();
  expect(q("claude", "@dep")).toBeUndefined();
});

test("commands_for_splits_by_at_trigger", () => {
  const mixed: CommandInfo[] = [
    { name: "init", source: "builtin" },
    { name: "deploy", source: "user", trigger: "@" },
  ];
  expect(names(commandsFor(mixed, "@"))).toEqual(["deploy"]);
  expect(names(commandsFor(mixed, "/"))).toEqual(["init"]);
});

test("commands_for_splits_by_trigger_and_a_missing_trigger_is_slash", () => {
  const mixed: CommandInfo[] = [
    { name: "review", source: "builtin" },
    { name: "deploy", source: "user", trigger: "$" },
    { name: "prompts:draft", source: "user", trigger: "/" },
  ];
  expect(names(commandsFor(mixed, "/"))).toEqual(["review", "prompts:draft"]);
  expect(names(commandsFor(mixed, "$"))).toEqual(["deploy"]);
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

test("commands_apply_to_kinds_the_host_lists", () => {
  // An older host: Claude only.
  expect(commandsApply("claude")).toBe(true);
  expect(commandsApply(undefined)).toBe(true);
  expect(commandsApply("unknown")).toBe(true);
  expect(commandsApply("codex")).toBe(false);
  expect(commandsApply("pi", ["claude", "codex"])).toBe(false);
  // A newer host.
  expect(commandsApply("codex", ["claude", "codex"])).toBe(true);
  expect(commandsApply("claude", ["claude", "codex"])).toBe(true);
  expect(commandsApply("codex", ["claude"])).toBe(false);
  expect(commandsApply("claude", ["codex"])).toBe(false);
  expect(commandsApply("pi", ["claude", "codex", "pi", "opencode"])).toBe(true);
  expect(commandsApply("opencode", ["claude", "codex", "pi", "opencode"])).toBe(true);
  expect(commandsApply("opencode", ["claude", "codex", "pi"])).toBe(false);
});
