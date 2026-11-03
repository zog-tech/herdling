import {
  addRecent,
  forgetCommand,
  normalizeCommand,
  RECENT_COMMAND_CAP,
  RECENT_COMMAND_MAX_CHARS,
  rememberCommand,
  removeRecent,
  useRecentCommands,
} from "./recentCommands";

jest.mock("@/secureStorage", () => {
  const { createJSONStorage } = jest.requireActual("zustand/middleware");
  const mem = new Map<string, string>();
  return {
    secureJSONStorage: () =>
      createJSONStorage(() => ({
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, v),
        removeItem: (k: string) => void mem.delete(k),
      })),
  };
});

beforeEach(() => useRecentCommands.setState({ byHost: {} }));

test("puts the newest command first", () => {
  expect(addRecent(addRecent([], "ls"), "pwd")).toEqual(["pwd", "ls"]);
});

test("a repeated command moves to the front and is kept once", () => {
  expect(addRecent(["pwd", "ls", "make"], "ls")).toEqual(["ls", "pwd", "make"]);
  const same = ["ls", "pwd"];
  expect(addRecent(same, "ls")).toBe(same);
});

test("trailing spaces and line ends do not make a new command", () => {
  expect(addRecent(["ls -la"], "ls -la  \n")).toEqual(["ls -la"]);
  expect(normalizeCommand("  git status \n")).toBe("  git status");
});

test("keeps at most 20 commands, dropping the oldest", () => {
  let list: readonly string[] = [];
  for (let i = 0; i < 25; i++) list = addRecent(list, `echo ${i}`);
  expect(list).toHaveLength(RECENT_COMMAND_CAP);
  expect(list[0]).toBe("echo 24");
  expect(list[RECENT_COMMAND_CAP - 1]).toBe("echo 5");
});

test("skips empty and too long commands", () => {
  const list = ["ls"];
  expect(addRecent(list, "")).toBe(list);
  expect(addRecent(list, "   \n")).toBe(list);
  expect(addRecent(list, "x".repeat(RECENT_COMMAND_MAX_CHARS + 1))).toBe(list);
  expect(addRecent(list, "x".repeat(RECENT_COMMAND_MAX_CHARS))).toHaveLength(2);
});

test("removes a command", () => {
  expect(removeRecent(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  const list = ["a"];
  expect(removeRecent(list, "z")).toBe(list);
});

test("the store keeps a list per host", () => {
  rememberCommand("studio", "ls");
  rememberCommand("studio", "pnpm test");
  rememberCommand("laptop", "htop");
  expect(useRecentCommands.getState().byHost).toEqual({ studio: ["pnpm test", "ls"], laptop: ["htop"] });
  forgetCommand("studio", "ls");
  expect(useRecentCommands.getState().byHost.studio).toEqual(["pnpm test"]);
  expect(useRecentCommands.getState().byHost.laptop).toEqual(["htop"]);
});

test("a skipped command does not change the store", () => {
  const before = useRecentCommands.getState();
  rememberCommand("studio", " ");
  expect(useRecentCommands.getState()).toBe(before);
});
