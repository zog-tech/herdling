import * as SecureStore from "expo-secure-store";

import {
  CRASH_LOG_BYTES,
  CRASH_LOG_KEY,
  CRASH_LOG_MAX,
  clearCrashLog,
  crashKindLabel,
  crashLogText,
  encodeLog,
  loadCrashLog,
  makeEntry,
  nativeEntry,
  parseLog,
  recordCrash,
  useCrashLog,
  type CrashEntry,
} from "./crashLog";

const mockStore = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItem: jest.fn((k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn((k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));

beforeEach(() => {
  mockStore.clear();
  useCrashLog.setState({ entries: [] });
});

const longStack = (n: number) => ["TypeError: x", ...Array.from({ length: n }, (_, i) => `    at fn${i} (index.bundle:1:${1000 + i})`)].join("\n");
const entry = (i: number, stackLines = 60): CrashEntry => ({ ...makeEntry(Object.assign(new TypeError(`boom ${i}`), { stack: longStack(stackLines) }), "fatal", {}, 1_000 + i) });

test("an_entry_keeps_the_message_the_first_40_stack_lines_the_route_and_the_update", () => {
  const e = Object.assign(new TypeError("Cannot read properties of null (reading 'charAt')"), { stack: longStack(100) });
  const got = makeEntry(e, "fatal", { route: "/session/h1/w1:p2", update: "488f5e09" }, 42);
  expect(got.message).toBe("TypeError: Cannot read properties of null (reading 'charAt')");
  expect(got.stack?.split("\n")).toHaveLength(40);
  expect(got).toMatchObject({ time: 42, kind: "fatal", route: "/session/h1/w1:p2", update: "488f5e09" });
  // A thrown value that is not an Error.
  expect(makeEntry("plain text", "screen").message).toBe("plain text");
  expect(makeEntry("plain text", "screen").stack).toBeUndefined();
});

test("the_stored_value_keeps_the_last_5_entries_in_at_most_4_kb", () => {
  const list = Array.from({ length: 8 }, (_, i) => entry(i));
  const value = encodeLog(list);
  expect(value.length).toBeLessThanOrEqual(CRASH_LOG_BYTES);
  const back = parseLog(value);
  expect(back.length).toBeLessThanOrEqual(CRASH_LOG_MAX);
  // The newest entry stays, with a part of its stack.
  expect(back[back.length - 1].message).toBe("TypeError: boom 7");
  expect(back[back.length - 1].stack).toBeDefined();
});

test("a_huge_message_still_fits", () => {
  const value = encodeLog([makeEntry(new Error("é".repeat(5_000)), "fatal")]);
  expect(new TextEncoder().encode(value).length).toBeLessThanOrEqual(CRASH_LOG_BYTES);
  expect(parseLog(value)).toHaveLength(1);
});

test("a_damaged_value_gives_an_empty_log", () => {
  expect(parseLog("{not json")).toEqual([]);
  expect(parseLog(JSON.stringify({ a: 1 }))).toEqual([]);
  expect(parseLog(JSON.stringify([{ time: 1, message: "ok", kind: "fatal" }, { bad: true }]))).toHaveLength(1);
});

test("record_writes_synchronously_and_appends_to_the_stored_log", () => {
  recordCrash(new Error("first"), "screen");
  recordCrash(new Error("second"), "fatal", { route: "/new" });
  // Synchronous: no promise had to run.
  expect(SecureStore.setItem).toHaveBeenCalledWith(CRASH_LOG_KEY, expect.any(String));
  const stored = parseLog(mockStore.get(CRASH_LOG_KEY));
  expect(stored.map((e) => e.message)).toEqual(["first", "second"]);
  expect(useCrashLog.getState().entries).toHaveLength(2);
  // Newest first.
  expect(crashLogText(stored).indexOf("second")).toBeLessThan(crashLogText(stored).indexOf("first"));
});

test("record_never_throws_when_the_keychain_fails", () => {
  jest.mocked(SecureStore.setItem).mockImplementationOnce(() => {
    throw new Error("locked");
  });
  expect(() => recordCrash(new Error("x"), "fatal")).not.toThrow();
});

test("a_native_entry_keeps_the_headline_and_the_first_40_stack_lines", () => {
  const text = ["java.lang.RuntimeException: boom (thread main)", ...Array.from({ length: 60 }, (_, i) => `    at a.b.C.f${i}(C.java:${i})`)].join("\n");
  const got = nativeEntry(7, text);
  expect(got).toMatchObject({ time: 7, kind: "native", message: "java.lang.RuntimeException: boom (thread main)" });
  expect(got.stack?.split("\n")).toHaveLength(40);
  expect(nativeEntry(7, "only a line").stack).toBeUndefined();
  expect(crashKindLabel("native")).toBe("Native crash, closed the app");
  expect(crashKindLabel("fatal")).toBe("Closed the app");
});

test("load_and_clear", async () => {
  mockStore.set(CRASH_LOG_KEY, encodeLog([entry(1, 3)]));
  expect(loadCrashLog()).toHaveLength(1);
  expect(useCrashLog.getState().entries).toHaveLength(1);
  await clearCrashLog();
  expect(useCrashLog.getState().entries).toEqual([]);
  expect(mockStore.has(CRASH_LOG_KEY)).toBe(false);
});
